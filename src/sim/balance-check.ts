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
import { derive } from '../data/attributes.ts';
import { WEAPONS } from '../data/weapons.ts';
import { ZOMBIES, stageMods } from '../data/zombies.ts';
import { BOSSES, RUN_DURATION } from '../data/run.ts';
import {
  ANSWER_DIMS,
  DIMENSION_BY_ID,
  DIMENSIONS,
  MIN_ANSWERS_PER_DIM,
  MIN_ROLES_PER_DIM,
  SCENES,
  TOTAL_LEVELS,
  expandScene,
  type AnswerTag,
  type DimensionId,
  type DimWeights,
} from '../data/scenes.ts';
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
// 覆盖全部 12 个维度的阵容数——这个数字越大，说明"能不能进"这件事门槛越低
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
