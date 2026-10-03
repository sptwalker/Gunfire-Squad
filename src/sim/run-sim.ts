/**
 * 15 分钟关卡时间轴模拟。
 *
 * 目的不是"模拟得像游戏"，而是回答三个配平问题：
 *   1. 僵尸产出速率 vs 小队清怪速率，前沿会不会崩？
 *   2. 小队血量曲线是否撑得住，谁先死、死在第几分钟？
 *   3. BOSS 血量锚点对应的 DPS 目标，小队是否够得着？
 *
 * 刻意简化掉的部分（不影响上述三个判断）：
 *   - 地图抽象成一维距离，不做真实寻路与地形
 *   - 队员不做走位，AOE 收益按"同时接战目标数"估算
 *   - 增益道具、任务 NPC 不参与模拟
 * 这些留给真实原型验证，模拟器只做数值哨兵。
 */

import { HEROES_BY_ID, type Hero } from '../data/characters.ts';
import { derive } from '../data/attributes.ts';
import { WEAPONS, tierForLevel, type WeaponId } from '../data/weapons.ts';
import { ZOMBIES, stageMods, type ZombieId } from '../data/zombies.ts';
import { STAGES, BOSSES, RUN_DURATION, RUN_END, BOSS_TIMEOUT, BOSS_PHASE_SPAWN_MUL, levelAt } from '../data/run.ts';
import { heroRawDps } from './combat.ts';

// ── 可调参数：改这里就是改整个关卡的难度手感 ──
const DT = 0.1;
/**
 * 僵尸刷新点到小队的距离，格。
 *
 * 25 格 = 俯视相机视口边缘。早期版本用 60，结果是【所有】僵尸在被看见之前
 * 就走完了全程被打死——实测每分钟"贴身僵尸数"恒为 0，小队全程满血。
 * 那个值让模拟器只能回答"清怪速率够不够"，回答不了"会不会死"。
 */
const SPAWN_DISTANCE = 25;
/** 近战接触距离，格 */
const MELEE_RANGE = 1.2;
/** 队员的平均接战目标数，用于估算 AOE 武器收益 */
const ENGAGED_TARGETS = 2.5;
const SEED = 20260925;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimZombie {
  kind: ZombieId;
  hp: number;
  maxHp: number;
  dist: number;
  speed: number;
  stage: number;
  isBoss: boolean;
  bossName: string;
  bossIdx: number;
  attackCd: number;
  /** 单次攻击伤害，已含阶段倍率 */
  atk: number;
  atkInterval: number;
  armor: number;
}

function threatRateAt(t: number): number {
  for (const s of STAGES) {
    if (t >= s.start && t < s.start + s.duration) {
      const p = (t - s.start) / s.duration;
      return s.threatRateStart + (s.threatRateEnd - s.threatRateStart) * p;
    }
  }
  return 0;
}

function pickZombie(stageIndex: number, rnd: () => number): ZombieId {
  const table = STAGES[stageIndex].spawnTable;
  let r = rnd() * table.reduce((s, g) => s + g.weight, 0);
  for (const g of table) {
    r -= g.weight;
    if (r <= 0) return g.zombie;
  }
  return table[0].zombie;
}

/** 当前 BOSS 阶段序号（1-3），不在 BOSS 战则返回 0 */
function bossPhaseAt(t: number): number {
  const b = BOSSES.find((x) => t >= x.at && t < x.at + 90);
  return b ? b.stage : 0;
}

export interface Snapshot {
  t: number;
  zombies: number;
  squadHpPct: number;
  alive: number;
  kills: number;
  points: number;
  money: number;
  level: number;
  squadDps: number;
  /** 正在贴身接触（能打到人）的僵尸数。场上只数不等于接触只数——
   *  僵尸从 25 格外走进来，大部分死在路上。这个数才是承伤的真实驱动量。 */
  contact: number;
  boss?: string;
}

export interface SimResult {
  snapshots: Snapshot[];
  deaths: { hero: string; t: number }[];
  result: 'victory' | 'squadWiped' | 'bossTimeout';
  totalKills: number;
  totalMoney: number;
  totalPoints: number;
  /** 全队累计承受的（护甲后）伤害，用于判断"这一局到底有多疼" */
  dmgTaken: number;
  weaponTiers: Partial<Record<WeaponId, 0 | 1 | 2>>;
  bossKills: string[];
  /** 每个 BOSS 的击杀 / 结果，用于单独判断是哪一场卡住的 */
  bossReport: {
    name: string; killed: boolean; hpPctLeft: number; t: number;
    /** BOSS 登场那一刻小队的等级与武器阶 —— 反向校准必须用这个，
     *  不能手填。手填过一次 [2,3,5]，实际是 [4,4,5]，整张校准表因此偏了。 */
    level: number; tier: number;
    /** 实测击杀秒数，未击杀则为 -1 */
    killTime: number;
  }[];
}

export function simulate(squadIds: string[], seed = SEED): SimResult {
  const rnd = mulberry32(seed);
  const squad: Hero[] = squadIds.map((id) => {
    const h = HEROES_BY_ID[id];
    if (!h) throw new Error(`未知角色 id: ${id}`);
    return h;
  });

  const tiers: Partial<Record<WeaponId, 0 | 1 | 2>> = {};
  const alive = squad.map(() => true);
  const hp = squad.map((h) => derive(h.primary, 1).maxHp);

  // 技能状态：AI 一有能量就放，所以每个角色的技能是一个固定占空比的方波。
  // 初相位按索引错开，避免 5 个人同时开大（那会让减伤/治疗在时间轴上叠在一起，
  // 得出比真实战斗乐观得多的生存曲线）。
  const skillCd = squad.map((h) =>
    h.skill.cdrAffected ? h.skill.cooldown * (1 - derive(h.primary, 1).cdr) : h.skill.cooldown,
  );
  const skillActive = squad.map(() => false);
  /** 下次可释放时间（初相位错开） */
  const nextCastAt = squad.map((_, i) => (i * skillCd[i]) / squad.length);
  const activeUntil = squad.map(() => 0);

  let level = 1;
  let points = 0;
  let money = 0;
  let kills = 0;
  let threatBudget = 0;

  const zs: SimZombie[] = [];
  const snapshots: Snapshot[] = [];
  const deaths: { hero: string; t: number }[] = [];
  const bossKills: string[] = [];
  const bossStarted: { name: string; t: number; hp: number; level: number; tier: number; killT: number }[] = [];
  let result: SimResult['result'] = 'victory';
  let lastSquadDps = 0;
  let dmgTaken = 0;

  // 全部 BOSS 被击杀 = 通关；任何一个超时未死 = 失败
  const allBossesDead = () => bossKills.length >= BOSSES.length;

  const stageOf = (t: number) => (t < 300 ? 1 : t < 600 ? 2 : 3);

  const spawn = (
    kind: ZombieId,
    dist: number,
    stage: number,
    opts: Partial<SimZombie> = {},
  ) => {
    const z = ZOMBIES[kind];
    const mods = stageMods(stage);
    zs.push({
      kind,
      hp: z.hp * mods.hp,
      maxHp: z.hp * mods.hp,
      dist,
      speed: z.speed,
      stage,
      isBoss: false,
      bossName: '',
      bossIdx: -1,
      attackCd: 0,
      atk: z.atk * mods.dmg,
      atkInterval: z.atkInterval,
      armor: z.armor,
      ...opts,
    });
  };

  for (let step = 0; ; step++) {
    const t = step * DT;
    if (t > RUN_END) break;
    const stage = stageOf(t);
    const mods = stageMods(stage);

    // ── 等级与武器阶：全部按时间自动成长 ──
    // 第二轮起局内【没有任何购买动作】。等级由秒表决定（run.ts 的 LEVEL_TIME），
    // 武器阶跟着等级走（weapons.ts 的 tierForLevel）。
    // 于是"打得好的队伍升级更快"这条雪球被拆掉了——阵容强弱只决定这段时间
    // 打得轻不轻松，不决定你什么时候变强。money 只累积，结算时带出关卡。
    level = levelAt(t);
    for (const h of squad) tiers[h.weapon] = tierForLevel(level);

    // ── BOSS 出现 / 常规刷怪（BOSS 战期间暂停刷怪）──
    const bossPhase = bossPhaseAt(t);
    const bossOnField = zs.some((z) => z.isBoss);
    if (bossPhase > 0 && !bossOnField) {
      const b = BOSSES[bossPhase - 1];
      // 只在该 BOSS 还没打过的情况下生成，避免击杀后被重复刷出
      const alreadyFought = bossStarted.some((s) => s.name === b.name);
      if (!alreadyFought && t >= b.at && t - b.at < DT * 1.5) {
        bossStarted.push({ name: b.name, t, hp: b.hp, level, tier: tiers[squad[0].weapon] ?? 0, killT: -1 });
        // BOSS 登场清场：移除场上的【杂兵】，但保留【特化型】僵尸。
        //
        // 理由不是数值，是读法：关底决战被 78 只杂兵稀释时，玩家读到的是
        // "被围死"而不是"打不过 BOSS"——前者让人归因于随机性，后者让人想再打一次。
        //
        // 但"全清"会把 BOSS 战抽成纯 DPS 木桩：实测全清后关底战最低血量 96.4%，
        // 难度峰跑到了 10:40 的第二场 BOSS（55.1%），关底反而没有张力。
        // 所以只清【用数量施压】的三种，保留【用行为施压】的特化型——
        // 场上不再是一堵肉墙，但毒池、自爆、跳跃依然在逼你走位。
        const TRASH: ReadonlySet<string> = new Set(['normal', 'runner', 'spawnling']);
        for (let i = zs.length - 1; i >= 0; i--) {
          if (!zs[i].isBoss && TRASH.has(zs[i].kind)) zs.splice(i, 1);
        }
        spawn('brute', SPAWN_DISTANCE * 0.5, b.stage, {
          hp: b.hp, maxHp: b.hp, speed: b.speed, isBoss: true,
          bossName: b.name, bossIdx: bossPhase - 1,
          atk: b.atk, atkInterval: 1.5, armor: b.armor,
        });
      }
    }
    // 刷怪：BOSS 战期间减速而非停止，避免"打木桩"和"阶段 3 反而更空"
    {
      const mul = bossPhase > 0 ? BOSS_PHASE_SPAWN_MUL[bossPhase - 1] : 1;
      threatBudget += threatRateAt(t) * DT * mul;
      let guard = 0;
      while (threatBudget >= 1 && guard++ < 50) {
        const kind = pickZombie(stage - 1, rnd);
        if (threatBudget < ZOMBIES[kind].threat) break;
        threatBudget -= ZOMBIES[kind].threat;
        spawn(kind, SPAWN_DISTANCE * (0.85 + rnd() * 0.3), stage);
      }
    }

    // ── 技能状态推进 ──
    for (let i = 0; i < squad.length; i++) {
      if (!alive[i]) continue;
      const sk = squad[i].skill;
      if (!skillActive[i] && t >= nextCastAt[i]) {
        skillActive[i] = true;
        activeUntil[i] = t + sk.duration;
        nextCastAt[i] = t + skillCd[i];
      }
      if (skillActive[i] && t >= activeUntil[i]) skillActive[i] = false;
    }

    // ── 僵尸推进 ──
    for (const z of zs) if (z.dist > MELEE_RANGE) z.dist -= z.speed * DT;

    // ── 小队输出：按距离排序，最近的先吃伤害 ──
    let squadDps = 0;
    for (let i = 0; i < squad.length; i++) {
      if (!alive[i]) continue;
      const h = squad[i];
      const w = WEAPONS[h.weapon];
      const tier = tiers[h.weapon] ?? 0;
      const d = derive(h.primary, level);

      const inRange = zs.filter((z) => z.dist <= w.range);
      if (inRange.length === 0) continue;
      inRange.sort((a, b) => a.dist - b.dist);

      // 复用 combat.ts 的 DPS 公式，避免两处实现漂移
      const main = inRange[0];
      const dps =
        heroRawDps(h, level, tier, main.armor, main.isBoss ? 'heavy' : ZOMBIES[main.kind].armorType, w.dtype) *
        (w.hitsPerAttack === 1
          ? 1
          : Math.min(ENGAGED_TARGETS, inRange.length, w.hitsPerAttack));
      squadDps += dps;

      // 结算这一帧的伤害，溢出伤害顺延到下一个目标
      let remaining = dps * DT;
      for (const tg of inRange) {
        if (remaining <= 0) break;
        const dealt = Math.min(remaining, tg.hp);
        tg.hp -= dealt;
        remaining -= dealt;
      }
    }
    lastSquadDps = squadDps;

    // ── 击杀结算 ──
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      if (z.hp > 0) continue;
      zs.splice(i, 1);
      kills++;
      if (z.isBoss) {
        bossKills.push(z.bossName);
        const st = bossStarted.find((s) => s.name === z.bossName);
        if (st) st.killT = t;
        continue;
      }
      const kz = ZOMBIES[z.kind];
      points += kz.points;
      money += kz.money;
      if (z.kind === 'splitter') {
        for (let s = 0; s < 3; s++) {
          spawn('spawnling', z.dist + 0.3 + s * 0.2, z.stage);
        }
      }
    }

    // ── 僵尸反击 ──
    // 减伤取【最强的一个】，不做叠乘。若叠乘，罗恩 0.5 × 博姆 0.6 = 0.3，
    // 两个辅助同时开技就能让全队承伤降到三成，配平会直接崩掉。
    let teamDefMul = 1;
    for (let i = 0; i < squad.length; i++) {
      if (!alive[i] || !skillActive[i]) continue;
      const m = squad[i].skill.teamDefMul;
      if (m !== undefined) teamDefMul = Math.min(teamDefMul, m);
    }
    const hitThisFrame = squad.map(() => false);
    for (const z of zs) {
      if (z.dist > MELEE_RANGE + 0.5) continue;
      z.attackCd -= DT;
      if (z.attackCd > 0) continue;
      z.attackCd = z.atkInterval;

      const live = alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      if (live.length === 0) break;
      const vi = live[Math.floor(rnd() * live.length)];
      const vd = derive(squad[vi].primary, level);
      const raw = z.atk * (1 - vd.armor / (vd.armor + 100)) * teamDefMul;
      hp[vi] -= raw;
      dmgTaken += raw;
      hitThisFrame[vi] = true;
      if (hp[vi] <= 0) {
        hp[vi] = 0;
        alive[vi] = false;
        deaths.push({ hero: squad[vi].name, t: Math.round(t) });
      }
    }

    // ── 脱战回复 + 治疗技能 ──
    //
    // 基础回复【必须是脱战才生效的】。早期版本每帧无条件加 1%/s，
    // 那等于给全队挂了一个常驻回血，把接触伤害整条抵消掉——
    // 结果三个 BOSS 战的血量曲线全都贴在 90% 以上，压力读数完全失效。
    // 这条本来就是"脱战"回复，交战中被咬住就不该回血，否则"被围住"没有任何后果。
    //
    // 治疗技能不受此限：它是技能，交战中也该生效，否则奶妈在硬仗里等于没有技能。
    let heal = 0;
    for (let i = 0; i < squad.length; i++) {
      if (!alive[i] || !skillActive[i]) continue;
      const hps = squad[i].skill.healPerSec;
      if (hps) heal += derive(squad[i].primary, level).maxHp * hps;
    }
    for (let i = 0; i < squad.length; i++) {
      if (!alive[i]) continue;
      const maxHp = derive(squad[i].primary, level).maxHp;
      const regen = hitThisFrame[i] ? 0 : maxHp * 0.01;
      hp[i] = Math.min(maxHp, hp[i] + (regen + heal) * DT);
    }

    if (!alive.some((a) => a)) {
      result = 'squadWiped';
      snapshots.push(snapshot(t + DT));
      break;
    }

    // 三个 BOSS 全部击杀 = 通关，不必再等满 BOSS_TIMEOUT
    if (allBossesDead()) {
      result = 'victory';
      snapshots.push(snapshot(t + DT));
      break;
    }

    // BOSS 超时：出现后 BOSS_TIMEOUT 秒仍未死亡
    for (const s of bossStarted) {
      const killed = bossKills.includes(s.name);
      const b = BOSSES.find((x) => x.name === s.name)!;
      if (!killed && t >= b.at + BOSS_TIMEOUT) {
        result = 'bossTimeout';
        snapshots.push(snapshot(t + DT));
        break;
      }
    }
    if (result === 'bossTimeout') break;

    if (Math.abs(t % 10) < DT / 2) snapshots.push(snapshot(t));

    function snapshot(tt: number): Snapshot {
      const liveMax = squad.filter((_, i) => alive[i]).map((h) => derive(h.primary, level).maxHp);
      const liveHp = hp.filter((_, i) => alive[i]);
      const pct = liveMax.length
        ? liveHp.reduce((s, v, i) => s + v / liveMax[i], 0) / liveMax.length
        : 0;
      const boss = zs.find((z) => z.isBoss);
      return {
        t: Math.round(tt),
        zombies: zs.length,
        contact: zs.filter((z) => z.dist <= MELEE_RANGE + 0.5).length,
        squadHpPct: pct,
        alive: alive.filter((a) => a).length,
        kills,
        points,
        money,
        level,
        squadDps: Math.round(lastSquadDps),
        ...(boss
          ? { boss: `${boss.bossName} ${Math.round((boss.hp / boss.maxHp) * 100)}%` }
          : {}),
      };
    }
  }

  return {
    snapshots,
    deaths,
    result,
    totalKills: kills,
    totalMoney: money,
    totalPoints: points,
    dmgTaken,
    weaponTiers: tiers,
    bossKills,
    bossReport: BOSSES.map((b) => {
      const killed = bossKills.includes(b.name);
      const onField = zs.find((z) => z.bossName === b.name);
      const started = bossStarted.find((s) => s.name === b.name);
      return {
        name: b.name,
        killed,
        hpPctLeft: killed ? 0 : onField ? onField.hp / onField.maxHp : 1,
        t: b.at,
        level: started?.level ?? 1,
        tier: started?.tier ?? 0,
        killTime: started && started.killT >= 0 ? Math.round((started.killT - b.at) * 10) / 10 : -1,
      };
    }),
  };
}
