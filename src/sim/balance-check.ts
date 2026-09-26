/**
 * 配平哨兵：跑若干个阵容，输出一张表，回答"这套数值成立吗"。
 *
 * 运行：node src/sim/balance-check.ts
 * Node 24 原生支持类型剥离，不需要 tsx/ts-node。
 */

import { HEROES, HEROES_BY_ID, type Hero } from '../data/characters.ts';
import { derive } from '../data/attributes.ts';
import { WEAPONS } from '../data/weapons.ts';
import { ZOMBIES, stageMods } from '../data/zombies.ts';
import { BOSSES, RUN_DURATION } from '../data/run.ts';
import {
  AI_EFFICIENCY,
  squadDps,
  squadEhp,
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
line('  1. 角色一级属性预算');
hr();
line('角色'.padEnd(18) + '定位'.padEnd(12) + 'STR/AGI/TGH/INT'.padEnd(20) + '合计');
hr();
for (const h of HEROES) {
  const p = h.primary;
  const total = p.str + p.agi + p.tgh + p.int;
  const flag = total === 100 ? '' : `  ← 异常`;
  line(
    h.name.padEnd(18) +
      h.role.padEnd(12) +
      `${p.str}/${p.agi}/${p.tgh}/${p.int}`.padEnd(20) +
      String(total) +
      flag,
  );
}

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
    '单发'.padEnd(9) +
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
      num(w.base).padEnd(9) +
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
  line('注意 0 阵亡不是"游戏简单"，见第 7 节——模拟器结构上产生不了阵亡。');
}

hr('═');
hr('═');
