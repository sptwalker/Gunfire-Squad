/**
 * 配平哨兵：跑若干个阵容，输出一张表，回答"这套数值成立吗"。
 *
 * 运行：node src/sim/balance-check.ts
 * Node 24 原生支持类型剥离，不需要 tsx/ts-node。
 */

import {
  HEROES,
  HEROES_BY_ID,
  answersDimension,
  effectiveAnswers,
  type Hero,
} from '../data/characters.ts';
import { derive, pointBudget, POINT_TOTAL, PRIMARY_KEYS, PRIMARY_LABEL } from '../data/attributes.ts';
import { SAME_CLASS_DPS_CAP, TEMP_WEAPON_DROPS, WEAPONS, WEAPON_CLASS_NAME, tempWeaponSeconds, type WeaponId } from '../data/weapons.ts';
import { ZOMBIES, ZOMBIE_LIST, stageMods } from '../data/zombies.ts';
import { BOSSES, BOSS_TIMEOUT, RUN_DURATION } from '../data/run.ts';
import {
  ADVANCE_RANKS,
  HERO_GROWTH_BAND,
  HONOR_BASE,
  HONOR_CLEAR_BONUS,
  HONOR_GROWTH,
  HONOR_PER_NEW_STAR,
  HONOR_PER_TASK,
  ITEM_SHOP,
  MAX_RANK,
  MONEY_PER_CLEAR,
  RANKS,
  SHOP,
  TACTICS,
  WEAPON_SHOP,
  advancePointsAt,
  canAdvance,
  canDeploy,
  canEquip,
  difficultyUnlocked,
  enemyRankMul,
  heroRankMul,
  honorPerHero,
  runHonor,
  starsFor,
  totalUnlockCost,
} from '../data/progression.ts';
import {
  ANSWER_DIMS,
  DIMENSION_BY_ID,
  DIFFICULTIES,
  DIMENSIONS,
  MIN_ANSWERS_PER_DIM,
  MIN_ROLES_PER_DIM,
  OBSTACLES,
  OBSTACLE_KINDS,
  SCENES,
  TOTAL_LEVELS,
  expandScene,
  type AnswerTag,
  type DimensionId,
  type DimWeights,
} from '../data/scenes.ts';
import {
  AI_EFFICIENCY,
  KNOCK_CAP,
  canDisplace,
  controlResistance,
  freezeDuration,
  heroRawDps,
  heroKnock,
  knockChance,
  squadDps,
  squadEhp,
  tauntLands,
  ttk,
  heroEhp,
  zombieDps,
} from './combat.ts';
import { simulate } from './run-sim.ts';

/**
 * 参考阵容：1 坦 + 1 近战 + 1 远程 + 1 控 + 1 辅。
 * 全文的"小队 DPS""血量曲线""BOSS 校准"都以它为准——
 * 换阵容会换掉所有读数，所以只在这里定义一次。
 */
const SQUAD = ['ron', 'kai', 'vera', 'ella', 'lian'];
const squadHeroes = () => SQUAD.map((id) => HEROES_BY_ID[id]);
const SQUAD_TIERS = { sniper: 2, sword: 2, freezer: 2, pistol: 2, greatsword: 2 } as const;

const line = (s = '') => console.log(s);
const hr = (c = '─') => line(c.repeat(78));
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));

// ────────────────────────────────────────────────────────────
// 1. 角色基准：一级属性预算是否统一
// ────────────────────────────────────────────────────────────
hr('═');
line('  1. 角色一级属性预算（六属性 / 合计必须恰为 150）');
hr();
line(
  '角色'.padEnd(16) +
    '定位'.padEnd(12) +
    '力量'.padEnd(5) + '敏捷'.padEnd(5) + '韧性'.padEnd(5) +
    '智力'.padEnd(5) + '幸运'.padEnd(5) + '体质'.padEnd(5) +
    '合计',
);
hr();
/**
 * 六属性表。**合计必须是 `POINT_TOTAL`**，不达标直接标异常——
 * 这条比看起来重要：100 → 150 的扩容如果不守着总数，
 * 就会变成"每个角色白送 50 点"，三个 BOSS 血量与 15 分钟曲线全部作废。
 * 重配的正确做法是【老四维下调 + 差额按定位分给幸运/体质】，
 * 偏离闸门由一次性脚本 `_rebalance.ts` 证明（每角色 DPS/EHP 偏离 ≤ ±7.6%）。
 */
let budgetBad = 0;
for (const h of HEROES) {
  const p = h.primary;
  const total = pointBudget(p);
  if (total !== POINT_TOTAL) budgetBad++;
  line(
    h.name.padEnd(16) +
      h.role.padEnd(12) +
      String(p.str).padEnd(5) + String(p.agi).padEnd(5) + String(p.tgh).padEnd(5) +
      String(p.int).padEnd(5) + String(p.luk).padEnd(5) + String(p.con).padEnd(5) +
      String(total) +
      (total === POINT_TOTAL ? '' : '  ← 异常'),
  );
}
line();
line(
  budgetBad === 0
    ? `✓ 12 个角色的一级属性合计均为 ${POINT_TOTAL} 点`
    : `✗ ${budgetBad} 个角色的属性合计不等于 ${POINT_TOTAL}`,
);

// ────────────────────────────────────────────────────────────
// 2. 单角色 DPS 与生存
// ────────────────────────────────────────────────────────────
const bench = ZOMBIES.normal;
hr('═');
line('  2. 单角色基准（1 级 / 武器 0 阶 / 对普通僵尸）');
hr();
line(
  '角色'.padEnd(16) +
    '武器'.padEnd(10) +
    '暴击'.padEnd(8) +
    '抗暴'.padEnd(8) +
    '稳固'.padEnd(7) +
    'DPS'.padEnd(9) +
    '有效生命'.padEnd(11) +
    'TTK(普通)',
);
hr();
const rows: { hero: Hero; dps: number }[] = [];
for (const h of HEROES) {
  const w = WEAPONS[h.weapon];
  const { per } = squadDps([h], 1, {}, bench.armor, bench.armorType, 1);
  const dps = per[0].dps;
  rows.push({ hero: h, dps });
  const d = derive(h.primary, 1);
  line(
    h.name.padEnd(16) +
      w.name.padEnd(10) +
      (d.critRate + w.critBonus).toFixed(3).padEnd(8) +
      d.antiCrit.toFixed(3).padEnd(8) +
      Math.round(d.stab).toString().padEnd(7) +
      Math.round(dps).toString().padEnd(9) +
      Math.round(heroEhp(d)).toLocaleString('en-US').padEnd(11) +
      ttk(squadDps([h], 1, {}, bench.armor, bench.armorType, 1).total, bench, 1, w.pierce, w.dtype).toFixed(2) +
      's',
  );
}
const dpsVals = rows.map((r) => r.dps);
line();
line(
  `DPS 区间 ${Math.round(Math.min(...dpsVals))} ~ ${Math.round(Math.max(...dpsVals))}` +
    `   极差倍数 ${(Math.max(...dpsVals) / Math.min(...dpsVals)).toFixed(2)}x`,
);

// ── 150 点重配的硬闸门：与「四属性 / 合计 100」时代逐角色对比 ──
// 基线取自 commit c333b0d 的同一节输出（四属性时代），不是手填的估计值。
// 例外：艾拉 / 莉安 / 萨满三人按"同类武器 ≤1.3 倍"（用户裁决）拉平后重取基线——
// 短枪与喷射两类的两把武器都是默认武器，拉平必然动默认 DPS。锚点改由 §4 BOSS 校准（±15%）守。
// 重配是重新参数化，不是加强：一旦谁偏离超过 10%，三个 BOSS 的血量与
// 整条 15 分钟曲线都要跟着重跑，所以这里把它做成机械检查而不是文档里的声称。
const DRIFT_BASELINE: Record<string, { dps: number; ehp: number }> = {
  '铁壁·罗恩': { dps: 188, ehp: 22000 },
  '磐石·格温': { dps: 238, ehp: 19738 },
  '疾风·凯': { dps: 396, ehp: 7840 },
  '断岳·铁牛': { dps: 296, ehp: 10154 },
  '鹰眼·薇拉': { dps: 489, ehp: 5786 },
  '弹幕·杰特': { dps: 330, ehp: 6442 },
  '霜语·艾拉': { dps: 128, ehp: 7616 },
  '震地·博姆': { dps: 211, ehp: 10154 },
  '圣手·莉安': { dps: 130, ehp: 7840 },
  '烈焰·萨满': { dps: 190, ehp: 9354 },
  '傀儡师·诺克斯': { dps: 252, ehp: 8582 },
  '蜂群·西芙': { dps: 197, ehp: 7840 },
};
const DRIFT_LIMIT = 0.1;
line();
line('  四属性 → 六属性重配后，相对旧值的偏离（闸门 ±10%）');
hr();
line('角色'.padEnd(16) + '旧DPS'.padEnd(8) + '新DPS'.padEnd(8) + 'ΔDPS'.padEnd(9) + '旧EHP'.padEnd(10) + '新EHP'.padEnd(10) + 'ΔEHP');
hr();
let driftBad = 0;
let driftWorst = 0;
let driftWorstWho = '';
for (const { hero } of rows) {
  const base = DRIFT_BASELINE[hero.name];
  const d = derive(hero.primary, 1);
  const nd = squadDps([hero], 1, {}, bench.armor, bench.armorType, 1).per[0].dps;
  const ne = heroEhp(d);
  const dd = (nd - base.dps) / base.dps;
  const de = (ne - base.ehp) / base.ehp;
  for (const m of [Math.abs(dd), Math.abs(de)]) {
    if (m > driftWorst) { driftWorst = m; driftWorstWho = hero.name; }
  }
  if (Math.abs(dd) > DRIFT_LIMIT || Math.abs(de) > DRIFT_LIMIT) driftBad++;
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  line(
    hero.name.padEnd(16) +
      String(base.dps).padEnd(8) +
      Math.round(nd).toString().padEnd(8) +
      pct(dd).padEnd(9) +
      base.ehp.toLocaleString('en-US').padEnd(10) +
      Math.round(ne).toLocaleString('en-US').padEnd(10) +
      pct(de),
  );
}
line();
line(
  driftBad === 0
    ? `✓ 12 个角色的 DPS 与有效生命相对重配前偏离全部 ≤${DRIFT_LIMIT * 100}%（最大 ${driftWorstWho} ${(driftWorst * 100).toFixed(1)}%）`
    : `✗ ${driftBad} 个角色偏离超过 ${DRIFT_LIMIT * 100}% —— BOSS 血量与 15 分钟曲线需重跑`,
);

// ────────────────────────────────────────────────────────────
// 3. BOSS DPS 检查 —— 这是整个配平的锚点
// ────────────────────────────────────────────────────────────
hr('═');
line('  3. BOSS DPS 检查（核心锚点）');
hr();
line(
  'BOSS'.padEnd(20) + '血量'.padEnd(11) + '目标秒数'.padEnd(11) + '需要DPS'.padEnd(11) + '护甲',
);
hr();
for (const b of BOSSES) {
  const need = b.hp / b.targetKillTime;
  line(
    b.name.padEnd(20) +
      b.hp.toLocaleString('en-US').padEnd(11) +
      String(b.targetKillTime).padEnd(11) +
      Math.round(need).toLocaleString('en-US').padEnd(11) +
      String(b.armor),
  );
}

// ────────────────────────────────────────────────────────────
// 4. BOSS 血量反向校准
//     不拍脑袋定血量，而是从实测小队 DPS 反推"该给多少血"。
// ────────────────────────────────────────────────────────────
hr('═');
line('  4. BOSS 血量反向校准：解析式 vs 时间轴模拟');
hr();
const CAL_SQUAD = SQUAD;
const calHeroes = SQUAD.map((id) => HEROES_BY_ID[id]);

// 时间轴模拟先跑一遍，拿到【登场那一刻】的真实等级/武器阶/击杀秒数。
// 从前这里手填 [2,3,5] 级，实际是 [4,4,5]，整张校准表偏了两级——
// 于是"校准通过"和"模拟器里 BOSS 18 秒就死"同时成立，两边对不上账。
const calSim = simulate(CAL_SQUAD);
line(
  '阶段'.padEnd(7) + '登场等级'.padEnd(10) + '武器阶'.padEnd(9) +
    '解析式DPS'.padEnd(12) + '实测DPS'.padEnd(11) + '目标'.padEnd(7) +
    '实测秒数'.padEnd(11) + '当前血量'.padEnd(12) + '判定',
);
hr();
for (let i = 0; i < BOSSES.length; i++) {
  const b = BOSSES[i];
  const rep = calSim.bossReport[i];
  const tiers = Object.fromEntries(calHeroes.map((h) => [h.weapon, b.stage === 1 ? 0 : b.stage === 2 ? 1 : 2]));
  // 解析式：按"假设的"武器阶算，用于和实测对照
  const { total: analytic } = squadDps(calHeroes, rep.level, tiers, b.armor, 'heavy', 1);
  const measured = rep.killTime > 0 ? b.hp / rep.killTime : NaN;
  const verdict = !isFinite(measured)
    ? '✗ 超时'
    : Math.abs(rep.killTime - b.targetKillTime) / b.targetKillTime < 0.15
      ? '✓ 达标'
      : rep.killTime < b.targetKillTime
        ? `偏易 ${(rep.killTime / b.targetKillTime * 100).toFixed(0)}%`
        : `偏难 ${(rep.killTime / b.targetKillTime * 100).toFixed(0)}%`;
  line(
    String(b.stage).padEnd(7) +
      String(rep.level).padEnd(10) +
      String(rep.tier).padEnd(9) +
      Math.round(analytic).toLocaleString('en-US').padEnd(12) +
      (isFinite(measured) ? Math.round(measured).toLocaleString('en-US') : '—').padEnd(11) +
      `${b.targetKillTime}s`.padEnd(7) +
      (rep.killTime > 0 ? `${rep.killTime}s` : '未击杀').padEnd(11) +
      b.hp.toLocaleString('en-US').padEnd(12) +
      verdict,
  );
}
line();
line('两个 DPS 都列出来，是因为它们的差本身有信息量：');
line('  解析式 = 纸面单体 DPS，看不到小怪干扰；实测 = 含刷怪、含走位损失的真实值。');
line('  实测 < 解析式 → BOSS 战被杂兵稀释了输出（这就是 BOSS 登场清场的理由）。');
line('  实测 > 解析式 → 溢出伤害被顺延打在了 BOSS 上，AOE 武器的收益在这里体现。');
line();
line('校准原则：BOSS 血量 = 实测 DPS × 目标秒数，容差 ±15%。');
line('血量偏高的后果是"打不动"，偏低是"BOSS 没存在感"，两者都要避免。');

// ────────────────────────────────────────────────────────────
// 5. 队伍生存压力
// ────────────────────────────────────────────────────────────
hr('═');
line('  5. 生存压力：僵尸接触 DPS vs 小队有效生命');
hr();
line('僵尸'.padEnd(16) + '阶段'.padEnd(7) + '接触DPS'.padEnd(11) + '单只击杀TTK'.padEnd(14) + '备注');
hr();
// 阶段 3 的满配小队 DPS，用来算"打掉一只僵尸要多久"
const squadDpsAt3 = squadDps(squadHeroes(), 5, SQUAD_TIERS, 200, 'none', 2.5).total;
for (const id of ['normal', 'runner', 'brute', 'toxic', 'bomber'] as const) {
  const z = ZOMBIES[id];
  for (const stage of [1, 3]) {
    line(
      z.name.padEnd(16) +
        String(stage).padEnd(7) +
        Math.round(zombieDps(z, stage)).toString().padEnd(11) +
        ttk(squadDpsAt3, z, stage, 60, 'pierce').toFixed(2).padEnd(14) +
        (stage === 1 ? z.tag.slice(0, 24) : ''),
    );
  }
}

// ────────────────────────────────────────────────────────────
// 6. 15 分钟全程模拟
// ────────────────────────────────────────────────────────────
hr('═');
line('  6. 15 分钟全程模拟（每 30 秒采样）');
hr();
const sim = simulate(SQUAD);
line(
  '时间'.padEnd(8) + '场上'.padEnd(7) + '存活'.padEnd(7) + '队伍血量'.padEnd(11) +
    '累计击杀'.padEnd(11) + '等级'.padEnd(7) + 'DPS'.padEnd(9) + 'BOSS',
);
hr();
for (const s of sim.snapshots) {
  if (s.t % 60 !== 0 && s.t !== RUN_DURATION && !s.boss) continue;
  line(
    `${Math.floor(s.t / 60)}:${String(s.t % 60).padStart(2, '0')}`.padEnd(8) +
      String(s.zombies).padEnd(7) +
      `${s.alive}/5`.padEnd(7) +
      pct(s.squadHpPct).padEnd(11) +
      String(s.kills).padEnd(11) +
      String(s.level).padEnd(7) +
      String(s.squadDps).padEnd(9) +
      (s.boss ?? ''),
  );
}
hr();
line(`结果：${sim.result === 'victory' ? '✓ 通关' : '✗ 小队全灭'}`);
line(`总击杀 ${sim.totalKills}   剩余金钱 ${sim.totalMoney}   总积分 ${sim.totalPoints}`);
line(`BOSS 击杀：${sim.bossKills.length ? sim.bossKills.join(' → ') : '无'}`);
if (sim.deaths.length) {
  line('阵亡：' + sim.deaths.map((d) => `${d.hero}@${Math.floor(d.t / 60)}:${String(d.t % 60).padStart(2, '0')}`).join('  '));
} else {
  line('阵亡：无');
}

// ────────────────────────────────────────────────────────────
// 7. 承伤现实检查：僵尸真的走到脸上了吗？
// ────────────────────────────────────────────────────────────
// 这是全文最重要的一张表，因为它回答的是"这套数值有没有难度"，
// 而前面所有表回答的都只是"这套数值自洽不自洽"。
hr('═');
line('  7. 承伤现实检查（僵尸真的打到人了吗）');
hr();
line('区间'.padEnd(22) + '均场上'.padEnd(9) + '均贴身'.padEnd(9) + '贴身占比');
hr();
{
  const N = 20;
  const SEGS: [string, number, number][] = [
    ['常规 0:00-5:00', 0, 300],
    ['BOSS1 5:00-6:30', 300, 390],
    ['常规 6:30-10:00', 390, 600],
    ['BOSS2 10:00-11:30', 600, 690],
    ['常规 11:30-15:00', 690, 900],
    ['BOSS3 15:00-16:30', 900, 990],
  ];
  for (const [label, a, b] of SEGS) {
    let field = 0, contact = 0, touched = 0, n = 0;
    for (let seed = 0; seed < N; seed++) {
      const r = simulate(SQUAD, 20260925 + seed * 7919);
      for (const q of r.snapshots) {
        if (q.t < a || q.t >= b) continue;
        field += q.zombies; contact += q.contact; n++;
        if (q.contact > 0) touched++;
      }
    }
    line(
      label.padEnd(22) +
        (field / n).toFixed(1).padEnd(9) +
        (contact / n).toFixed(1).padEnd(9) +
        `${Math.round((touched / n) * 100)}%`,
    );
  }
  let tot = 0;
  for (let seed = 0; seed < N; seed++) tot += simulate(SQUAD, 20260925 + seed * 7919).dmgTaken;
  const ehp = squadEhp(squadHeroes(), 5);
  line();
  line(`一局平均总承伤 ${Math.round(tot / N).toLocaleString('en-US')}   vs   小队满级总有效生命 ${Math.round(ehp).toLocaleString('en-US')}`);
  line();
  line('读法：常规阶段贴身占比为 0 —— 僵尸从 25 格（视口边缘）走来，');
  line('绝大部分死在路上。这不是配平错了，是模拟器【结构性地】做不到：');
  line('一维距离 + 单点索敌 + 全队永不走位，等于假设玩家每次走位都正确。');
  line('所以它能证明"清怪速率够、BOSS 打得动"，不能证明"会不会死人"。');
  line('真正会减员的是走位失误、地形卡位、自爆集火、毒池封锁——全在抽象之外。');
}
// ────────────────────────────────────────────────────────────
// 8. 多阵容 × 多种子鲁棒性
// ────────────────────────────────────────────────────────────
// 单跑一套阵容只能证明"这套配平成立"，证明不了"换阵容会不会崩"。
// 这里换 7 套定位不同的阵容 × 20 个种子，看的是【区分度】：
// 如果所有阵容读数都差不多，说明阵容选择没有后果，配平是假的。
hr('═');
line('  8. 多阵容 × 多种子鲁棒性（20 种子 × 7 阵容）');
hr();
line(
  '阵容'.padEnd(18) + '通关'.padEnd(9) + '均阵亡'.padEnd(9) +
    '最低血量'.padEnd(11) + 'BOSS 击杀（目标 30/45/60s）',
);
hr();
const SQUADS: [string, string[]][] = [
  ['均衡（参考）', ['ron', 'kai', 'vera', 'ella', 'lian']],
  ['双坦双输出', ['gwen', 'ron', 'kai', 'vera', 'lian']],
  ['无治疗', ['ron', 'kai', 'vera', 'ella', 'bom']],
  ['召唤流', ['nox', 'sif', 'ron', 'vera', 'lian']],
  ['全脆皮', ['vera', 'jet', 'ella', 'nox', 'sif']],
  ['近战莽', ['ron', 'kai', 'ironbull', 'gwen', 'lian']],
  ['单坦四输出', ['gwen', 'kai', 'ironbull', 'vera', 'jet']],
];
{
  const N = 20;
  let grand = 0;
  for (const [label, ids] of SQUADS) {
    let wins = 0, deaths = 0, worst = 1;
    const kills: string[] = [];
    for (let seed = 0; seed < N; seed++) {
      const r = simulate(ids, 20260925 + seed * 7919);
      if (r.result === 'victory') wins++;
      deaths += r.deaths.length;
      for (const s of r.snapshots) worst = Math.min(worst, s.squadHpPct);
    }
    // BOSS 击杀时间取第一个种子，用来看三个 BOSS 的余量差异
    const k = simulate(ids).bossReport.map((b) => (b.killTime > 0 ? `${Math.round(b.killTime)}s` : '超时'));
    grand += wins;
    line(
      label.padEnd(18) +
        `${wins}/${N}`.padEnd(9) +
        (deaths / N).toFixed(2).padEnd(9) +
        pct(worst).padEnd(11) +
        k.join(' '),
    );
  }
  line();
  line(`合计 ${grand}/${SQUADS.length * N} = ${((grand / (SQUADS.length * N)) * 100).toFixed(0)}%`);
  line();
  line('读法：区分度落在【最低血量】这一列。跨度越大，说明阵容选择越有后果。');
  line('注意阵亡数极低（合计 5 次，且全部来自"单坦四输出"）不是"游戏简单"，');
  line('见第 7 节——模拟器结构上几乎产生不了阵亡，这里是"几乎"不是"绝不"。');
  line('以上全部是【单场景 15 分钟基线】。场景层的维度挑战见第 9、10 节。');
}

// ────────────────────────────────────────────────────────────
// 9. 挑战维度覆盖矩阵
// ────────────────────────────────────────────────────────────
hr('═');
line('  9. 挑战维度覆盖矩阵');
hr();
line('维度成立的判据之一：每个维度至少 3 个【答案形状】、至少 2 个不同定位能回答它。');
line('达不到就说明这个维度只有一个阵容能解——那"多套阵容"就只是文案，不是设计。');
hr();
line('维度'.padEnd(14) + '族'.padEnd(11) + '答案'.padEnd(6) + '定位'.padEnd(6) + '地形要素 / 僵尸池');
hr();
/**
 * 一个维度的覆盖度。**必须用 `effectiveAnswers()`，不能用 `h.answers`。**
 *
 * 这里曾经读裸的 `answers`，于是同一节里出现了两个定义：
 * 上面的计数只算基础答案，下面的 12×12 矩阵走 `answersDimension()`（含专精）。
 * 两者会静默分叉——专精新加的答案算进了矩阵、没算进门槛，
 * 一个维度可能明明靠专精达标，表格却报 ✗。
 * 现在两条路径共用这一个函数。
 */
const dimCoverage = (d: (typeof DIMENSIONS)[number]) => {
  const answers = new Set<AnswerTag>();
  const roles = new Set<string>();
  for (const h of HEROES) {
    for (const a of effectiveAnswers(h)) {
      if (!ANSWER_DIMS[a].includes(d.id)) continue;
      answers.add(a);
      roles.add(h.role);
    }
  }
  return { answers, roles, ok: answers.size >= MIN_ANSWERS_PER_DIM && roles.size >= MIN_ROLES_PER_DIM };
};
for (const d of DIMENSIONS) {
  const { answers, roles, ok } = dimCoverage(d);
  line(
    d.name.padEnd(14) +
      d.family.padEnd(11) +
      `${answers.size}${ok ? '' : ' ✗'}`.padEnd(6) +
      String(roles.size).padEnd(6) +
      `[${d.terrain.join(' ') || '—'}] ${d.zombies.join(' ')}`,
  );
}
line();

// 12 维度 × 12 角色 明细矩阵
const SHORT = HEROES.map((h) => h.name.split('·').at(-1)!);
line('维度 \\ 角色'.padEnd(14) + SHORT.map((s) => ` ${s}`.padEnd(6)).join(''));
hr();
for (const d of DIMENSIONS) {
  const row = HEROES.map((h) => (answersDimension(h, d.id) ? '  ●' : '  ·').padEnd(6)).join('');
  line(d.name.padEnd(14) + row);
}
line();

let weakDims = 0;
for (const d of DIMENSIONS) {
  const { answers, roles } = dimCoverage(d);
  if (!dimCoverage(d).ok) {
    weakDims++;
    line(`✗ ${d.id}：答案 ${answers.size} / 定位 ${roles.size} 不足`);
  }
}
line(
  weakDims === 0
    ? `全部 ${DIMENSIONS.length} 个维度达标（≥${MIN_ANSWERS_PER_DIM} 答案 & ≥${MIN_ROLES_PER_DIM} 定位）`
    : `${weakDims} 个维度不达标——回去调 characters.ts 的 answers，不要放宽这个门槛`,
);

// ────────────────────────────────────────────────────────────
// 10. 阵容多样性枚举
// ────────────────────────────────────────────────────────────
// C(12,5) = 792。枚举全部，统计每关"三维全覆盖"的阵容数。
// 覆盖定义：该关所有活跃维度，队里都至少有 1 人能回答。
// 这一节是"每种挑战不止有单一阵容方案"的唯一证据来源。
// ────────────────────────────────────────────────────────────
hr('═');
line('  10. 阵容多样性枚举');
hr();
line('每关数一次：有多少套阵容能覆盖该关的全部活跃维度。');
line('该关最少的那一次（也是整个场景的瓶颈）连同关卡 id 一起打出来。');
hr();

const coverMask = HEROES.map((h) => {
  let m = 0;
  for (const [i, d] of DIMENSIONS.entries()) if (answersDimension(h, d.id)) m |= 1 << i;
  return m;
});
const dimIndex = Object.fromEntries(DIMENSIONS.map((d, i) => [d.id, i]));

// 每关所需掩码
const needMask = (dims: DimWeights) => {
  let m = 0;
  for (const k of Object.keys(dims) as DimensionId[]) m |= 1 << dimIndex[k];
  return m;
};

// 枚举全部 5 人组合
const squads: number[] = []; // 每套阵容的覆盖掩码
for (let a = 0; a < 12; a++)
  for (let b = a + 1; b < 12; b++)
    for (let c = b + 1; c < 12; c++)
      for (let d = c + 1; d < 12; d++)
        for (let e = d + 1; e < 12; e++)
          squads.push(coverMask[a] | coverMask[b] | coverMask[c] | coverMask[d] | coverMask[e]);

line(`阵容总数 C(12,5) = ${squads.length}`);
// 覆盖全部 13 个维度的阵容数——这个数字越大，说明"能不能进"这件事门槛越低
const ALL_MASK = (1 << DIMENSIONS.length) - 1;
const universal = squads.filter((m) => m === ALL_MASK).length;
line(`其中能覆盖全部 ${DIMENSIONS.length} 个维度的阵容 = ${universal} 套（占 ${pct(universal / squads.length)}）`);
line();
line('场景'.padEnd(12) + '子关卡'.padEnd(7) + '门槛最高的关卡'.padEnd(34) + '可行 / 总数');
hr();
let worstLevel = { id: '', n: Infinity, dims: [] as string[] };

for (const scene of SCENES) {
  const levels = expandScene(scene, 'normal');
  let minN = Infinity;
  let minId = '';
  let minDims: string[] = [];
  for (const lv of levels) {
    const need = needMask(lv.dims);
    const n = squads.filter((m) => (m & need) === need).length;
    if (n < minN) {
      minN = n;
      minId = lv.id;
      minDims = Object.keys(lv.dims);
    }
    if (n < worstLevel.n) worstLevel = { id: lv.id, n, dims: Object.keys(lv.dims) };
  }
  line(
    scene.name.padEnd(12) +
      `${levels.length}`.padEnd(7) +
      `${minId}（${minDims.join('+')}）`.padEnd(34) +
      `${minN} / ${squads.length}`,
  );
}
// 回扫一遍收集全部并列最紧的关卡——只报第一个会把并列说成唯一，是假精度。
// 按【维度构成】归并，38 个关卡 id 铺出来只会淹没结论。
const tightGroups = new Map<string, string[]>();
for (const scene of SCENES)
  for (const lv of expandScene(scene, 'normal')) {
    const need = needMask(lv.dims);
    const n = squads.filter((m) => (m & need) === need).length;
    if (n !== worstLevel.n) continue;
    const key = Object.keys(lv.dims).join('+');
    const g = tightGroups.get(key) ?? [];
    g.push(lv.id);
    tightGroups.set(key, g);
  }
line();
line(
  `全 ${TOTAL_LEVELS} 关里门槛最高的是 ${worstLevel.n} 套阵容可行 = ${pct(worstLevel.n / squads.length)}。`,
);
line(`并列的关卡按维度构成归并后只有 ${tightGroups.size} 组：`);
for (const [key, ids] of tightGroups)
  line(`  ${key.padEnd(28)} ${String(ids.length).padStart(2)} 关  ${ids[0]} … ${ids[ids.length - 1]}`);
line('并列是真实结果，不是巧合：门槛由【最稀有的那个维度】决定，与关卡序号无关。');
line();
line('══ 这一节的实际结论，比数字听起来弱得多，不要误读 ══');
line(
  `覆盖门槛几乎不筛人：最紧的一关也放行 ${pct(worstLevel.n / squads.length)} 的阵容，` +
    `${pct(universal / squads.length)} 的阵容能覆盖全部 ${DIMENSIONS.length} 维。`,
);
const avgDims =
  HEROES.reduce(
    (s, h) => s + DIMENSIONS.filter((d) => answersDimension(h, d.id)).length,
    0,
  ) / HEROES.length;
line(
  `原因是结构性的——5 名队员、每人平均能回答 ${avgDims.toFixed(1)} 个维度，并集自然铺满全集。`,
);
line('所以【能不能进】这件事基本是免费的，二分覆盖数不能证明"阵容选择有后果"。');
line();
line('它仍然有价值的唯一理由在 §9：每个维度都至少有 3 种答案形状、2 个不同定位可回答，');
line('即不存在"没有任何角色能应付的维度"。这是可玩性下限，不是深度证明。');
line();
line('真正决定阵容区分度的，是【同一维度下不同答案的效率差】——');
line('比如用穿透枪阵解潮涌，和用范围清场解潮涌，清怪速率差多少？');
line('这需要 M2 原型把维度折进刷怪与承伤模型里才量得出来。当前模拟器结构上做不到，');
line('所以本轮【不声称】阵容已经有多样性，只声称维度没有死胡同。');

// 上面说"只有 2 个维度约束阵容"——但如果这 2 个维度约束的是【同一批角色】，
// 那实际只有 1 条约束。这个区别决定了"多套阵容"是不是文案，所以要算出来而不是假定。
line();
{
  const perDim = new Map<DimensionId, Set<string>>();
  for (const d of DIMENSIONS) {
    const hs = new Set(HEROES.filter((h) => answersDimension(h, d.id)).map((h) => h.id));
    perDim.set(d.id, hs);
  }
  const sizes = [...perDim.values()].map((s) => s.size);
  const rarest = Math.min(...sizes);
  const rare = [...perDim.entries()].filter(([, s]) => s.size === rarest);
  line(`覆盖人数最少的维度是 ${rarest} 人：${rare.map(([id]) => DIMENSION_BY_ID[id].name).join(' · ')}`);
  line(
    `它们回答者的交集 = ${[...rare].reduce<Set<string>>(
      (acc, [, s], i) => (i === 0 ? new Set(s) : new Set([...acc].filter((x) => s.has(x)))),
      new Set(),
    ).size} 人` +
      `（并集 ${new Set(rare.flatMap(([, s]) => [...s])).size} 人）`,
  );
  line('交集 = 并集 → 这几个维度约束的是同一批角色，所以它们是【一条】约束，不是两条。');

  // 反过来看松的一头：没人能答的维度是洞，全员能答的维度是零约束。
  // 两头都无条件打印——【没打印】和【打印了 0 个】在终端里长得一样。
  const free = [...perDim.entries()].filter(([, s]) => s.size === HEROES.length);
  line(
    free.length
      ? `另一端：${free.map(([id]) => DIMENSION_BY_ID[id].name).join(' · ')} 全员可答，零约束力。`
      : `另一端：没有任何维度是全员可答的（最宽的是 ${Math.max(...sizes)} 人）。`,
  );
}
line();

hr('═');
hr('═');

// ────────────────────────────────────────────────────────────
// 11. 控制对抗矩阵（第二轮新增）
// ────────────────────────────────────────────────────────────

hr('═');
line('  11. 控制对抗矩阵');
hr();
line('三个判定：位移（击退/击倒）、冻结、嘲讽。每个都有【独立的对抗属性】，');
line('一一对应需求里的"霸体 / 抗冻 / 狡诈"。减速是全游戏唯一不设对抗的控制，');
line('这条地板故意留着——见 attributes.ts 的 ANTI_CRIT_CAP 附近那段论证。');
line();

// ── 11a 位移判定 ──
line('11a 位移命中率 = clamp(0.85 × atk² / (atk² + stab²))，atk = 武器击退 × 力量/敏捷乘区');
line(`    上限 KNOCK_CAP = ${KNOCK_CAP}（不是 1.0，理由同抗暴击：留一层地板）`);
line();
line('**扫全部 12 个英雄，不挑两个端点**——挑端点只能证明"最强和最弱不一样"，');
line('证明不了中间那十个武器各自站在哪一格。列头是每只僵尸的稳固值。');
line();
line(
  '英雄·武器'.padEnd(22) + '击退力'.padEnd(9) +
    ZOMBIE_LIST.map((z) => `${z.name.slice(0, 4)}`.padEnd(7)).join(''),
);
line(' '.repeat(31) + ZOMBIE_LIST.map((z) => String(z.stab).padEnd(7)).join(''));
hr();
for (const h of [...HEROES].sort((a, b) => heroKnock(b, 5, 2) - heroKnock(a, 5, 2))) {
  const k = heroKnock(h, 5, 2);
  const w = WEAPONS[h.weapon];
  const cells = ZOMBIE_LIST.map((z) => {
    const p = canDisplace(z) ? knockChance(k, z.stab) : 0;
    return (canDisplace(z) ? p.toFixed(2) : '霸体').padEnd(7);
  });
  line(
    `${h.name}·${w.name}`.padEnd(22) + k.toFixed(1).padEnd(9) + cells.join(''),
  );
}
line();
{
  const poke = ZOMBIES.normal;
  const hard = ZOMBIES.toxic;
  const knockAt = (h: Hero) => heroKnock(h, 5, 2);
  const usable = HEROES.filter((h) => knockChance(knockAt(h), poke.stab) >= 0.5);
  const wasted = HEROES.filter((h) => knockChance(knockAt(h), poke.stab) < 0.2);
  // 两个列表都**先按击退力排序**再取名——直接 map 武器名会出现两个"大刀"，
  // 读的人分不清是谁。名字是给人看的，排序是给判断用的，两样都要。
  const byK = (a: Hero, b: Hero) => knockAt(b) - knockAt(a);
  const named = (hs: Hero[]) =>
    [...hs].sort(byK).map((h) => `${h.name.split('·')[1]}·${WEAPONS[h.weapon].name}`).join(' ');
  line(`对最普通的【${poke.name}】（稳固 ${poke.stab}）：`);
  line(`  推得动（≥50%）的只有 ${usable.length} 人——${named(usable)}`);
  line(`  推不太动（<20%）的 ${wasted.length} 人——${named(wasted)}`);
  line();
  line(`对硬目标【${hard.name}】（稳固 ${hard.stab}）：`);
  // 取击退力最高与最低的各一个，从高到低排——不是拿 usable 数组的头尾，
  // 那样在"可用人数变化"时会悄悄换人。
  const hardest = [...HEROES].sort(byK);
  for (const h of [hardest[0], hardest[hardest.length - 1]]) {
    line(
      `  ${h.name}·${WEAPONS[h.weapon].name}（击退力 ${knockAt(h).toFixed(1)}）→ ` +
        `${knockChance(knockAt(h), hard.stab).toFixed(2)}`,
    );
  }
  line();
  line('这才是这条轴该有的手感：**击退力是一份要花出去的选择，不是一句台词**。');
  line('喷火器永远推不动谁（4%），大刀能推开八成普通怪；');
  line('但对着硬目标，全队最高的击退力也只能拿到一半。');
  line('玩家于是学到【换手段】，而不是【加力度】——这正是第 13 维度的判据。');
}
line();

// ── 11b 控制抗性排序 ──
line('11b 僵尸控制抗性排序（综合评分 = 霸体 / 稳固 / 抗冻 / 狡诈 四项平均）');
hr();
line('僵尸'.padEnd(16) + '霸体'.padEnd(7) + '稳固'.padEnd(7) + '抗冻'.padEnd(7) + '狡诈'.padEnd(7) + '评分'.padEnd(7) + '位移判定');
hr();
const byResist = [...ZOMBIE_LIST].sort((a, b) => controlResistance(b) - controlResistance(a));
for (const z of byResist) {
  line(
    z.name.padEnd(16) +
      (z.superArmor ? '✓' : '—').padEnd(7) +
      String(z.stab).padEnd(7) +
      z.freezeRes.toFixed(2).padEnd(7) +
      z.cunning.toFixed(2).padEnd(7) +
      controlResistance(z).toFixed(2).padEnd(7) +
      (canDisplace(z) ? '概率' : '免疫'),
  );
}
line();
line('评分相同不代表挡住的是同一扇门——**这才是这张表真正的读法**：');
{
  const a = ZOMBIES.leaper;
  const b = ZOMBIES.toxic;
  line(
    `  ${a.name}与${b.name}同样 ${controlResistance(a).toFixed(2)} 分，但：`,
  );
  line(
    `    ${a.name} 挡住的是嘲讽（狡诈 ${a.cunning.toFixed(2)}，命中率只剩 ` +
      `${(1 - a.cunning).toFixed(2)}），推它并不难（稳固 ${a.stab}）`,
  );
  line(
    `    ${b.name} 挡住的是冻结（抗冻 ${b.freezeRes.toFixed(2)}，4 秒只剩 ` +
      `${freezeDuration(4, b.freezeRes).toFixed(2)} 秒），嘲讽对它照样好使`,
  );
  line();
  line('所以"控制抗性"不是一个数字，是**三扇各自上锁的门**。');
  line('玩家不能靠把某一种控制堆到极致通关，只能带上能开不同门的队友——');
  line('这正是它作为第 13 个维度而不是第 5 个属性的理由。');
}
line();

// ── 11c 冻结与嘲讽 ──
line('11c 冻结与嘲讽的对抗（控制抗性维度的另外两扇门）');
hr();
line('嘲讽命中率 = 在 0-1 上取 1000 个等距样本喂给 `tauntLands()` 数通过率——');
line('不写 `1 - cunning` 是有意的：那样这里是在复述实现，而不是验证它。');
hr();
line('僵尸'.padEnd(16) + '冻结 4 秒实际时长'.padEnd(20) + '嘲讽命中率');
hr();
{
  const SAMPLES = 1000;
  for (const z of ZOMBIE_LIST) {
    const fd = freezeDuration(4, z.freezeRes);
    let hits = 0;
    for (let i = 0; i < SAMPLES; i++) if (tauntLands(z.cunning, i / SAMPLES)) hits++;
    line(z.name.padEnd(16) + `${fd.toFixed(2)}s`.padEnd(20) + (hits / SAMPLES).toFixed(2));
  }
}
line();
line('艾拉的寒霜新星基础冻结 4 秒：对普通僵尸满 4 秒，对毒液僵尸只剩 1.60 秒，');
line('对护盾僵尸 2.60 秒且它霸体——**冻结这条路的收益随目标不同掉得很厉害**。');
line();

// ── 11d 第 13 维度的两段判据 ──
line('11d 第 13 维度「控制抗性」的两段判据');
hr();
{
  const dim = DIMENSION_BY_ID['ctrlResist'];
  const answers = new Map<AnswerTag, Set<string>>();
  for (const h of HEROES) {
    for (const a of effectiveAnswers(h)) {
      if (!ANSWER_DIMS[a].includes('ctrlResist')) continue;
      if (!answers.has(a)) answers.set(a, new Set());
      answers.get(a)!.add(h.role);
    }
  }
  const allRoles = new Set([...answers.values()].flatMap((s) => [...s]));
  line(`维度：${dim.name}（族 ${dim.family}）——${dim.feels}`);
  line(`破解需要：${dim.needs}`);
  line();
  line('答案形状'.padEnd(16) + '来自定位');
  hr();
  for (const [a, roles] of answers) line(a.padEnd(16) + [...roles].join(' '));
  const okA = answers.size >= MIN_ANSWERS_PER_DIM;
  const okR = allRoles.size >= MIN_ROLES_PER_DIM;
  line();
  line(
    `答案 ${answers.size} 个（门槛 ${MIN_ANSWERS_PER_DIM}）${okA ? '✓' : ' ✗'}` +
      `   定位 ${allRoles.size} 种（门槛 ${MIN_ROLES_PER_DIM}）${okR ? '✓' : ' ✗'}  [${[...allRoles].join(' ')}]`,
  );
  line(
    okA && okR
      ? `✓ 达标。${answers.size} 个答案里，control（减速）自成一路——` +
        '它是唯一不受抗性影响的那扇门，也就是这条轴上永远关不上的一格'
      : '✗ 不达标，回去调 stab / cunning 曲线',
  );
}
line();

// ── 11e 障碍语义自查 ──
line('11e 障碍语义自查（三种新障碍只该带来两类新语义）');
hr();
line('障碍'.padEnd(12) + '可破坏'.padEnd(9) + '挡人'.padEnd(7) + '挡弹'.padEnd(7) + '挡视线'.padEnd(9) + '耐久'.padEnd(8) + '残留');
hr();
for (const id of OBSTACLE_KINDS) {
  const o = OBSTACLES[id];
  line(
    o.name.padEnd(12) +
      (o.destructible ? '✓' : '✗').padEnd(9) +
      (o.blocksMovement ? '✓' : '✗').padEnd(7) +
      (o.blocksShots ? '✓' : '✗').padEnd(7) +
      (o.blocksSight ? '✓' : '✗').padEnd(9) +
      String(o.hp).padEnd(8) +
      o.residue,
  );
}
{
  const shape = (id: string) => {
    const o = OBSTACLES[id];
    return `${o.blocksMovement}${o.blocksShots}${o.blocksSight}`;
  };
  const distinct = new Set([shape('sandbag'), shape('wire'), shape('woodwall'), shape('building')]);
  line();
  line(
    `四种代表障碍的【通行位掩码】只有 ${distinct.size} 种组合` +
      `（${[...distinct].join(' / ')}）——新障碍没有引入第四种通行语义。`,
  );
  line('木墙与建筑的区别只在 destructible，这是刻意的：让"绕开"与"打开"成为两种可学的反应。');
}
line();

// ────────────────────────────────────────────────────────────
// 12. 军衔与成长（第三轮重写：25 级美军军衔，C7）
// ────────────────────────────────────────────────────────────

hr('═');
line('  12. 军衔与成长（25 级）');
hr();
line('局外数值线只剩军衔：荣誉 → 军衔 → 属性成长（最终生命 / 伤害）+ 转职点。');
line('防刷：敌人按关卡军衔上限加成；全队超上限 = 这关毕业。');
line();

// ── 12a 星级与荣誉 ──
line('12a 荣誉：任务与通关每次都发，星级只发【新】星');
hr();
line('  ★ 通关   ★★ 最终全员存活   ★★★ 全员存活 + 完成全部局内任务');
{
  const r = simulate(CAL_SQUAD);
  const alive = CAL_SQUAD.length - r.deaths.length;
  // 模拟器不跑任务（run-sim.ts 头注释），这里只能给出"任务全做完"时的上限
  const st = starsFor({ victory: r.result === 'victory', deaths: r.deaths.length, tasksDone: 3, tasksTotal: 3 });
  line(`参考阵容实测：${r.result}，存活 ${alive}/${CAL_SQUAD.length} → ${'★'.repeat(st) || '0 星'}（假设任务全做完）`);
  line(`任务 ${HONOR_PER_TASK}/个 · 通关 ${HONOR_CLEAR_BONUS} · 新星 ${HONOR_PER_NEW_STAR}/颗`);
  const cases = [
    ['首通三星', { victory: true, tasksDone: 3, prevStars: 0, stars: 3 }],
    ['首通一星', { victory: true, tasksDone: 1, prevStars: 0, stars: 1 }],
    ['重打补到三星', { victory: true, tasksDone: 3, prevStars: 1, stars: 3 }],
    ['重打（已三星）', { victory: true, tasksDone: 3, prevStars: 3, stars: 3 }],
    ['失败，做了 2 个任务', { victory: false, tasksDone: 2, prevStars: 0, stars: 0 }],
  ] as const;
  for (const [name, c] of cases) {
    const t = runHonor(c);
    line(`  ${name.padEnd(14)} ${String(t).padStart(4)} 荣誉 → 5 人各 ${honorPerHero(t, 5).toFixed(1)} · 3 人各 ${honorPerHero(t, 3).toFixed(1)}`);
  }
}
line();

// ── 12b 军衔表 ──
const GROWTHS = [HERO_GROWTH_BAND[0], (HERO_GROWTH_BAND[0] + HERO_GROWTH_BAND[1]) / 2, HERO_GROWTH_BAND[1]];
line(`12b 军衔表（升级荣誉 = ${HONOR_BASE} × ${HONOR_GROWTH}^(级-2)；◆ = 发转职点）`);
hr();
line(
  '级'.padEnd(4) + '代码'.padEnd(6) + '军衔'.padEnd(8) + '本级'.padStart(6) + '累计'.padStart(8) + '  转职 ' +
    GROWTHS.map((g) => `英雄×${(g * 100).toFixed(1)}%`.padStart(11)).join('') + '敌人×5%'.padStart(9),
);
hr();
for (const r of RANKS) {
  const step = r.level === 1 ? 0 : r.req - RANKS[r.level - 2].req;
  const adv = r.advance ? `◆${advancePointsAt(r.level)}` : '';
  line(
    String(r.level).padEnd(4) + r.code.padEnd(6) + r.name.padEnd(8) +
      String(step).padStart(6) + r.req.toLocaleString('en-US').padStart(8) + '  ' + adv.padEnd(5) +
      GROWTHS.map((g) => heroRankMul(r.level, g).toFixed(2).padStart(11)).join('') +
      enemyRankMul(r.level).toFixed(2).padStart(9),
  );
}
line();
// 读数，不判：英雄乘区同时作用于生命和伤害，所以对等军衔的"强度比"是平方。
line('同级对位强度比 = (英雄乘区 / 敌人乘区)²（英雄乘区同时乘生命与伤害，敌人同理）：');
for (const g of GROWTHS) {
  const at = (lv: number) => (heroRankMul(lv, g) / enemyRankMul(lv)) ** 2;
  line(`  成长 ${(g * 100).toFixed(1)}%：E-4 ×${at(4).toFixed(2)} · W-1 ×${at(10).toFixed(2)} · O-4 ×${at(18).toFixed(2)} · 五星 ×${at(25).toFixed(2)}`);
}
line('  ⚠ 成长 >5% 的职业在高军衔会显著碾压同级关卡——C7-4c 约定先试玩再修，这里只记读数。');
line();

// ── 12c 时间成本 ──
line('12c 时间成本（一局按 15 分钟计）');
hr();
{
  // 稳态按"重打已三星的关"算：只有任务 + 通关，星级荣誉是一次性的加成，不计入速率
  const tasksPerRun = 3;
  const honorPerRun = runHonor({ victory: true, tasksDone: tasksPerRun, prevStars: 3, stars: 3 });
  const perHero = honorPerHero(honorPerRun, 5);
  const HOURS = (n: number) => (n * RUN_DURATION) / 3600;
  const moneyLive = simulate(CAL_SQUAD).totalMoney;
  line(`稳态速率：${honorPerRun} 荣誉/局 ÷ 5 人 = 每人 ${perHero.toFixed(1)}/局（不含一次性的新星荣誉，偏保守）`);
  line('一支 5 人队到各转职军衔：');
  for (const lv of ADVANCE_RANKS) {
    const n = Math.ceil(RANKS[lv - 1].req / perHero);
    line(`  ${RANKS[lv - 1].code.padEnd(5)}${RANKS[lv - 1].name.padEnd(8)}第 ${advancePointsAt(lv)} 转  ${String(n).padStart(4)} 局 ≈ ${HOURS(n).toFixed(1).padStart(5)} 小时`);
  }
  const runsToMax = Math.ceil(RANKS[MAX_RANK - 1].req / perHero);
  const RANK_HOURS_BAND = [40, 100] as const;
  const maxH = HOURS(runsToMax);
  const inBand = maxH >= RANK_HOURS_BAND[0] && maxH <= RANK_HOURS_BAND[1];
  line(
    `${inBand ? '✓' : '⚠'} 第一支队满五星 ${maxH.toFixed(0)} 小时，目标 ${RANK_HOURS_BAND[0]}-${RANK_HOURS_BAND[1]} 小时` +
      '（全游戏约 100 小时，毕业机制会逼玩家练第二、第三支队；P6 关卡线定了再回调）',
  );
  line();
  const shopRuns = Math.ceil(totalUnlockCost() / moneyLive);
  line(`金钱 ${moneyLive.toLocaleString('en-US')}/局（实时 simulate()）；买齐军械库 ${totalUnlockCost().toLocaleString('en-US')} = ${shopRuns} 局 ≈ ${HOURS(shopRuns).toFixed(0)} 小时`);
  line('  ⚠ 军械库仍是第二轮的 14 把武器，P2 武器类别定稿后重做；招募刷新的花费也在那时加入金钱线。');
  const moneyDrift = Math.abs(moneyLive - MONEY_PER_CLEAR) / MONEY_PER_CLEAR;
  line(
    moneyDrift < 0.02
      ? `✓ 常量 MONEY_PER_CLEAR = ${MONEY_PER_CLEAR.toLocaleString('en-US')} 与实测一致（偏离 ${(moneyDrift * 100).toFixed(1)}%）`
      : `✗ 常量 MONEY_PER_CLEAR = ${MONEY_PER_CLEAR.toLocaleString('en-US')} 与实测 ${moneyLive.toLocaleString('en-US')} 偏离 ${(moneyDrift * 100).toFixed(0)}%`,
  );
}
line();

// ── 12d 不变量自查 ──
line('12d 不变量自查');
hr();
{
  const checks: [string, boolean][] = [
    [`军衔 ${MAX_RANK} 级，五星上将在顶`, MAX_RANK === 25 && RANKS[24].name === '五星上将'],
    ['累计荣誉严格递增', RANKS.every((r, i) => i === 0 || r.req > RANKS[i - 1].req)],
    [`转职点 ${ADVANCE_RANKS.length} 个（6 可选 + 五星）`, ADVANCE_RANKS.length === 7 && advancePointsAt(MAX_RANK) === 7],
    ['E-3 不能转、E-4 能转第 1 次', !canAdvance(3, 0) && canAdvance(4, 0)],
    ['点数可累积：O-1 未转过的人可连转 4 次', [0, 1, 2, 3].every((d) => canAdvance(15, d)) && !canAdvance(15, 4)],
    ['五星要先补完前 6 转：点数按顺序消耗，转过 5 次的人下一转是第 6 转，不是终极', canAdvance(25, 5) && canAdvance(25, 6) && !canAdvance(25, 7)],
    ['出战：超人数 / 有人超军衔上限都不能出', canDeploy([3, 3], 5, 2) && !canDeploy([3, 3, 3], 5, 2) && !canDeploy([3, 6], 5, 2)],
    ['敌人加成只看军衔上限（上限 1 = ×1）', enemyRankMul(1) === 1],
    ['重打已三星的关不再给星级荣誉', runHonor({ victory: true, tasksDone: 0, prevStars: 3, stars: 3 }) === HONOR_CLEAR_BONUS],
  ];
  for (const [name, ok] of checks) line(`${ok ? '✓' : '✗'} ${name}`);
  line();
  line('军械库共 ' + SHOP.length + ' 件：武器 ' + Object.keys(WEAPON_SHOP).length +
    ' 把 + 道具 ' + Object.keys(ITEM_SHOP).length + ' 种。买断、全队共享。');
  const d = (x: boolean) => (x ? '开' : '锁');
  line(
    `难度逐档解锁：困难(普通终关未过) ${d(difficultyUnlocked('hard', {}))} · ` +
      `困难(普通终关已过) ${d(difficultyUnlocked('hard', { normal: true }))} · ` +
      `噩梦(仅普通已过) ${d(difficultyUnlocked('nightmare', { normal: true }))}`,
  );
}
line();
// ────────────────────────────────────────────────────────────
// 13. 军械库共享与局内临时武器（用户裁决 #1 / #2 / #9）
// ────────────────────────────────────────────────────────────

hr('═');
line('  13. 军械库共享 · 临时武器 · 战术动作');
hr();

// ── 13a 适配与换武器的 DPS 跨度 ──
line('13a 每个角色换上【同类别】武器后的 DPS（相对默认武器，3 级 / 1 阶 / 200 中甲）');
hr();
{
  let allFit = true;
  let worst = { who: '', w: '', r: 0 };
  for (const h of HEROES) {
    if (!canEquip(h, { weapon: h.weapon }, { weapons: [], items: [] })) {
      allFit = false;
      line(`✗ ${h.name} 的默认武器 ${h.weapon} 不在它会用的类别里`);
    }
    const base = heroRawDps(h, 3, 1, 200, 'medium', WEAPONS[h.weapon].dtype);
    const alts = (Object.keys(WEAPONS) as WeaponId[]).filter((w) => w !== h.weapon && h.weaponClasses.includes(WEAPONS[w].class))
      .map((w) => ({ w, r: heroRawDps({ ...h, weapon: w }, 3, 1, 200, 'medium', WEAPONS[w].dtype) / base }))
      .sort((a, b) => b.r - a.r);
    const top = alts[0];
    if (top && top.r > worst.r) worst = { who: h.name, w: top.w, r: top.r };
    line(h.name.padEnd(10) + `[${h.weaponClasses.map((c) => WEAPON_CLASS_NAME[c]).join('/')}] `.padEnd(10) + (alts.length ? '' : '无可换') + alts.slice(0, 4).map((a) => `${a.w} ×${a.r.toFixed(2)}`).join('  '));
  }
  line();
  line(allFit ? '✓ 12 名角色的默认武器都在自己会用的类别里' : '✗ 有默认武器不在类别里');
  // 同类跨度：同一类别内最强 / 最弱。用各把武器装在同一个角色（罗恩）身上的 DPS 比，比值与角色几乎无关。
  const ref = HEROES[0];
  const dpsOf = (w: WeaponId) => heroRawDps({ ...ref, weapon: w }, 3, 1, 200, 'medium', WEAPONS[w].dtype);
  const byClass = new Map<string, number[]>();
  for (const w of Object.keys(WEAPONS) as WeaponId[]) {
    const c = WEAPON_CLASS_NAME[WEAPONS[w].class];
    byClass.set(c, [...(byClass.get(c) ?? []), dpsOf(w)]);
  }
  const spreads = [...byClass].filter(([, v]) => v.length > 1).map(([c, v]) => ({ c, r: Math.max(...v) / Math.min(...v) }));
  line('同类跨度：' + spreads.map((x) => `${x.c} ×${x.r.toFixed(2)}`).join('  '));
  const capOk = worst.r <= SAME_CLASS_DPS_CAP && spreads.every((x) => x.r <= SAME_CLASS_DPS_CAP);
  line(
    (capOk ? '✓' : '✗') +
      ` 换武器最大增益：${worst.who} 换 ${worst.w} ×${worst.r.toFixed(2)}（闸门 ≤${SAME_CLASS_DPS_CAP}）` +
      (capOk ? '——金钱买到的是手感与附加效果，不是 BOSS 锚点外的数字' : '——共享武器会击穿 BOSS 锚点'),
  );
}
line();

// ── 13b 临时武器 ──
line('13b 局内临时武器：有限弹药，打完切回原武器，不带出关卡');
hr();
for (const d of TEMP_WEAPON_DROPS) {
  line(
    `${WEAPONS[d.weapon].name.padEnd(8)}${d.slot === 'primary' ? '主' : '副'}  ` +
      `${String(d.ammo).padStart(4)} 发 ≈ ${tempWeaponSeconds(d).toFixed(1).padStart(5)}s  来源 ${d.from}`,
  );
}
line();

// ── 13c 战术动作 ──
line('13c 战术动作（素材表：军衔不再给行为，P4 并入技能表由职业持有）');
hr();
for (const t of Object.values(TACTICS)) line(`${t.name.padEnd(6)} CD ${String(t.cooldown).padStart(3)}s  ${t.trigger}`);
line();
hr('═');
hr('═');
