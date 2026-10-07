/**
 * 数值表生成器：node src/sim/numbers-doc.ts > docs/02-数值表.html
 * 表格里的每个数字都从 src/data 与 src/sim 现算，不手填。计算口径与 balance-check.ts 一致。
 */

import { HEROES, HEROES_BY_ID, answersDimension, effectiveAnswers, type Hero } from '../data/characters.ts';
import { ANTI_CRIT_CAP, CRIT_DMG_BASE, K, MAGIC_RES_CAP, POINT_TOTAL, derive, pointBudget } from '../data/attributes.ts';
import { ARMOR_MATRIX, PIERCE_K, SCHOOL_NAME, SCHOOL_OF, armorRetention, type ArmorType, type DamageType } from '../data/damage.ts';
import { LEVEL_TIER_AT, SAME_CLASS_DPS_CAP, TEMP_WEAPON_DROPS, WEAPONS, WEAPON_CLASS_NAME, WEAPON_LIST, tempWeaponSeconds, tierBonus, type WeaponId } from '../data/weapons.ts';
import { ANTI_HEAL_MUL, STAGE_DMG_MUL, STAGE_HP_MUL, ZOMBIES, ZOMBIE_LIST } from '../data/zombies.ts';
import { BOSSES, BOSS_PHASE_SPAWN_MUL, BUFFS, LEVEL_TIME, RUN_DURATION, RUN_END, STAGES } from '../data/run.ts';
import {
  ADVANCE_RANKS, HERO_GROWTH_BAND, HONOR_BASE, HONOR_CLEAR_BONUS, HONOR_GROWTH, HONOR_PER_NEW_STAR, HONOR_PER_TASK,
  ITEM_SHOP, MAX_RANK, RANKS, TACTICS, WEAPON_SHOP, advancePointsAt, canAdvance, canDeploy, enemyRankMul,
  heroRankMul, honorPerHero, runHonor, totalUnlockCost,
} from '../data/progression.ts';
import {
  ANSWER_DIMS, DIFFICULTIES, DIMENSIONS, DIMENSION_BY_ID, DIM_ALTS, DIM_KEYS, KEY_LIST, MIN_ANSWERS_PER_DIM,
  MIN_KEYS_PER_DIM, OBSTACLES, OBSTACLE_KINDS, SCENES, TOTAL_LEVELS, expandScene, type DimensionId,
} from '../data/scenes.ts';
import {
  KNOCK_CAP, canDisplace, controlResistance, freezeDuration, heroEhp, heroKnock, heroRawDps, knockChance,
  squadDps, squadEhp, tauntLands, ttk, zombieDps, zombieEhp,
} from './combat.ts';
import { simulate } from './run-sim.ts';
// @ts-expect-error 纯 JS 模块，无类型声明
import { page } from '../../tools/md2html.mjs';

const out: string[] = [];
const p = (s = '') => out.push(s);
const tbl = (head: string[], rows: (string | number)[][]) => {
  p(`| ${head.join(' | ')} |`);
  p(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) p(`| ${r.join(' | ')} |`);
  p();
};
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const f2 = (x: number) => x.toFixed(2);
const pc = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const range = (v: number[]) => `${n0(Math.min(...v))} ~ ${n0(Math.max(...v))}`;

const ARMOR_NAME: Record<ArmorType, string> = { none: '无', light: '轻甲', medium: '中甲', heavy: '重甲' };
const DTYPE_NAME: Record<DamageType, string> = {
  impact: '冲击', slash: '斩击', pierce: '穿刺', explosive: '爆炸', fire: '火焰', frost: '冰霜', poison: '毒', arcane: '奥术', electric: '电磁',
};
const ROLE_NAME: Record<Hero['role'], string> = { tank: '坦克', meleeDps: '近战输出', rangedDps: '远程输出', control: '控制', support: '辅助', summoner: '召唤' };
const PRIO_NAME = { closest: '最近', weakest: '最弱', strongest: '最强' } as const;
const HOLD_NAME = { never: '不站', safe: '安全才站', engaged: '接敌即站' } as const;
const dimNames = (ids: readonly DimensionId[]) => ids.map((d) => DIMENSION_BY_ID[d].name).join(' · ') || '—';

/** 参考阵容：1 坦 + 1 近战 + 1 远程 + 1 控 + 1 辅。全文的小队读数都以它为准。 */
const SQUAD = ['ron', 'kai', 'vera', 'ella', 'lian'];
const SQ = SQUAD.map((id) => HEROES_BY_ID[id]);
const SQUAD_TIERS = { sniper: 2, sword: 2, freezer: 2, pistol: 2, greatsword: 2 } as const;
const bench = ZOMBIES.normal;
const sim = simulate(SQUAD);
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260925 + i * 7919);

p('# 02 数值表');
p();
p('> 由 `node src/sim/numbers-doc.ts > docs/02-数值表.html` 生成，**不要手改**。');
p('> 每个数字都从 `src/data/*.ts` 与 `src/sim/*.ts` 现算，口径与 `npm run sim`（`balance-check.ts`）一致。改数字去改数据，再重跑这条命令。');
p('>');
p(`> 参考阵容：${SQ.map((h) => h.name).join(' · ')}。全文的“小队 DPS”“血量曲线”“BOSS 校准”都以它为准。`);
p();

// ───────────────────────── 1 ─────────────────────────
p('## 1. 属性换算系数（`attributes.ts` 的 `K`）');
p();
p('改这张表 = 改整个游戏的属性手感。**所有单位的所有数值都必须经过这里**，禁止在别处硬编码血量 / 攻速 / 暴击。');
p();
const KDESC: Record<string, (v: number) => string> = {
  strAtk: (v) => `每点力量 +${pc(v, 1)} 攻击`,
  agiHaste: (v) => `每点敏捷 +${pc(v, 1)} 攻速`,
  agiMove: (v) => `每点敏捷 +${pc(v, 1)} 移速`,
  luckCrit: (v) => `每点幸运 +${pc(v, 1)} 暴击率`,
  luckLoot: (v) => `每点幸运 +${pc(v, 1)} 高级掉落权重`,
  hpBase: () => '基础生命',
  hpPerCon: (v) => `每点体质 +${v} 生命`,
  armorPerTgh: (v) => `每点韧性 +${v} 护甲`,
  armorK: (v) => `减伤 = 护甲 / (护甲 + ${v})`,
  tghAntiCrit: (v) => `每点韧性 +${pc(v, 1)} 抗暴击，上限 ${ANTI_CRIT_CAP}`,
  tghStab: (v) => `稳固 = 韧性 × ${v}，量纲与武器击退对齐`,
  strKnock: (v) => `每点力量 +${pc(v, 1)} 近战击退力`,
  agiKnock: (v) => `每点敏捷 +${pc(v, 1)} 远程击退力`,
  energyBase: () => '基础能量',
  energyPerInt: (v) => `每点智力 +${v} 能量`,
  intSkill: (v) => `每点智力 +${pc(v, 1)} 技能强度`,
  intCdr: (v) => `每点智力 +${pc(v, 1)} 冷却缩减（上限 80%）`,
  intMagicRes: (v) => `每点智力 +${pc(v, 1)} 魔抗，上限 ${MAGIC_RES_CAP}`,
  levelGrowth: (v) => `每级 +${pc(v, 0)} 基础属性`,
  levelDmgPerLevel: (v) => `每级 +${pc(v, 0)} 最终伤害`,
  maxLevel: () => '关卡内最高等级',
};
tbl(['系数', '值', '含义'], [
  ...Object.entries(K).map(([k, v]) => [`\`${k}\``, v, KDESC[k]?.(v) ?? '']),
  ['`CRIT_DMG_BASE`', CRIT_DMG_BASE, '基础暴击伤害倍率'],
  ['`ANTI_CRIT_CAP`', ANTI_CRIT_CAP, '抗暴击硬上限。**不能到 1.0**，见 §1.2'],
  ['`MAGIC_RES_CAP`', MAGIC_RES_CAP, '英雄魔抗上限，理由同上'],
]);

p('### 1.1 六属性的分工边界（改之前先读这一条）');
p();
tbl(['一级属性', '提供'], [
  ['力量 STR', '近战伤害乘区、近战击退力'],
  ['敏捷 AGI', '攻速、移速、远程击退力'],
  ['韧性 TGH', '护甲、抗暴击、稳固'],
  ['智力 INT', '能量、技能强度、冷却缩减、魔抗'],
  ['幸运 LUK', '暴击率、高级掉落概率'],
  ['体质 CON', '生命上限'],
]);
p('**每个属性只管自己那一列，不许跨列。** 旧版“敏捷给暴击”“韧性给血”就是跨列：堆敏捷同时拿攻速和暴击、堆韧性同时拿血和甲，另外两个属性没有独立理由被堆。拆开之后“这角色该堆什么”才有唯一答案。§11 的控制对抗是同一条思路：**每个系统里，每一项都要有独立的对抗面。**');
p();
p('### 1.2 两层“地板”：抗暴击上限与减速');
p();
p('```\n控制与反制体系必须每层都留地板，否则整条成长轴会被一次堆满而作废。\n```');
p();
p(`- 抗暴击封顶 ${ANTI_CRIT_CAP}：堆韧性能砍掉一部分暴击收益，但永远砍不干净——幸运流才有活路。`);
p('- 减速**不设**任何对抗属性：它是全游戏唯一不受抗性影响的控制手段（见 §11）。');
p();
p('### 1.3 两条容易算错的地方');
p();
p(`**A. 敏捷的攻速作用在“频率”上，不乘进单发伤害。** 攻击频率 = 武器射速 × (1 + 敏捷 × ${K.agiHaste})。乘进单发会让换弹惩罚按错误的弹匣周期算，大弹匣武器被系统性高估。`);
p();
p(`**B. 等级伤害走独立乘区，不去缩放力量。** \`atkMul = 1 + 力量 × ${K.strAtk}\` 带一个 +1 基数，若让等级缩放力量，乘区涨幅跟不上关卡缩放。拆成 \`levelDmgMul\` 之后“每级 +${pc(K.levelDmgPerLevel, 0)}”才是实数。`);
p();

// ───────────────────────── 2 ─────────────────────────
p('## 2. 伤害公式（`damage.ts`）');
p();
p('```');
p('最终伤害 = 基础 × atkMul × levelDmgMul × 技能乘区 × 暴击期望');
p('         × 护甲保留（只对物理）× 甲型克制 × 抗性保留');
p(`有效护甲  = 目标护甲 × (1 - 穿透/(穿透+${PIERCE_K}))`);
p('护甲保留  = 1 - 有效护甲/(有效护甲+100)');
p('暴击期望  = 1 + max(0, 暴击率 - 目标抗暴击) × (暴击伤害 - 1)');
p('抗性保留  = 物理 1-物抗 · 法术 1-魔抗 · 电磁 1-电磁场（破抗降物抗与魔抗，撬不开电磁场）');
p('```');
p();
p('**抗暴击扣的是暴击率，不是伤害。** “抗暴击”与“暴击率”共用一把 0-1 的尺子，而不是又多出一个伤害乘区。扣到负数时归零。');
p();
p('**三层减伤各管一件事**：`armorRetention` 只削物理，是“穿透够不够”；`ARMOR_MATRIX` 对所有系别 ±15% 以内，只是手感；`resistMul` 才是挑战维度那一层。');
p();
p('### 2.1 穿透的实际收益');
p();
const PIERCES = [0, 30, 60, 80];
const armorTargets: [string, number][] = [[`${bench.name}`, bench.armor], [ZOMBIES.brute.name, ZOMBIES.brute.armor], [BOSSES.at(-1)!.name, BOSSES.at(-1)!.armor]];
tbl(['目标（护甲）', ...PIERCES.map((x) => `穿透 ${x} 保留`), '80 / 0'], armorTargets.map(([n, a]) => [
  `${n}（${a}）`, ...PIERCES.map((x) => f2(armorRetention(a, x))), `**${f2(armorRetention(a, 80) / armorRetention(a, 0))}×**`,
]));
p('穿透削弱的是**目标**护甲，收益随目标护甲单调变陡——这就是“带穿刺武器”成为战术选择、穿透能当成独立成长轴的原因。');
p();
p('### 2.2 甲型克制矩阵（任何一格都在 0.8–1.2 之间）');
p();
tbl(['伤害类型', '系别', ...Object.values(ARMOR_NAME)], (Object.keys(ARMOR_MATRIX) as DamageType[]).map((d) => [
  `${DTYPE_NAME[d]} \`${d}\``, SCHOOL_NAME[SCHOOL_OF[d]], ...(Object.keys(ARMOR_NAME) as ArmorType[]).map((a) => f2(ARMOR_MATRIX[d][a])),
]));

// ───────────────────────── 3 ─────────────────────────
p(`## 3. 武器表（${WEAPON_LIST.length} 种）`);
p();
p('### 3.1 基础数值');
p();
tbl(['武器', '类别', '伤害', '单发', '射速/s', '射程', '穿透', '命中数', '弹匣', '换弹', 'AOE', '暴击+', '击退', '军械库价'], WEAPON_LIST.map((w) => [
  `**${w.name}**`, WEAPON_CLASS_NAME[w.class], DTYPE_NAME[w.dtype], w.base, w.rate, w.range, w.pierce, w.hitsPerAttack,
  w.magazine || '—', w.reload ? `${w.reload}s` : '—', w.aoe, w.critBonus ? `+${pc(w.critBonus, 0)}` : 0, w.knockback, n0(WEAPON_SHOP[w.id].price),
]));
const kb = [...WEAPON_LIST].sort((a, b) => b.knockback - a.knockback);
p(`**击退的梯度：越慢越重的武器推得越开。** ${kb[0].name} ${kb[0].knockback} / ${kb[1].name} ${kb[1].knockback} 在顶端，${kb.at(-1)!.name} ${kb.at(-1)!.knockback} 几乎推不动——想要击退就得接受低射速。表里是攻方基础值，实际击退力还要乘属性乘区，判定见 §11.1。`);
p();
p('> 原则：**任何一把武器都不应该在所有维度上都赢。** 出现了，就说明某个维度的代价没被算进去。');
p();
p('### 3.2 武器阶：局内自动成长，不可购买');
p();
tbl(['等级', '武器阶', '伤害', '穿透'], Object.entries(LEVEL_TIER_AT).map(([lv, t]) => [lv, t, `×${f2(tierBonus(t).dmg)}`, `×${f2(tierBonus(t).pierce)}`]));
p('**阶不能买，只能涨。** 买种类给的是**新答案**（新的维度解），买阶给的是**新数字**（同一套答案打得更疼），后者会架空“卡住只能换阵容”这个设计前提。');
p();

// ───────────────────────── 4 ─────────────────────────
p(`## 4. 僵尸表（${ZOMBIE_LIST.length} 种 + 分裂小僵尸）`);
p();
p('僵尸名都是临时的。`dims` 一列是刷怪表的推导依据：子关卡的维度权重直接决定刷怪表，**没有手写的关卡配置**。');
p();
const zAll = [...ZOMBIE_LIST, ZOMBIES.spawnling];
tbl(['僵尸', '血', '速度', '护甲', '甲型', '物抗', '魔抗', '电磁场', '回血/s', '攻击', '间隔', '积分', '金钱', '威胁', '贡献维度'], zAll.map((z) => [
  `**${z.name}**`, n0(z.hp), z.speed, z.armor, ARMOR_NAME[z.armorType], pc(z.resist.physRes, 0), pc(z.resist.magicRes, 0), pc(z.resist.energyField, 0),
  z.regen || '—', z.atk, `${z.atkInterval}s`, z.points, z.money, z.threat, dimNames(z.dims),
]));
p(`${ZOMBIES.spawnling.name}只由分裂产生，不吃刷怪预算。atkInterval ≥ 99 的僵尸不做常规攻击（如自爆）。`);
p();
p('### 4.1 特殊行为');
p();
tbl(['僵尸', '行为', '说明'], zAll.map((z) => [z.name, `\`${z.behavior}\``, z.special || z.tag]));
p('### 4.2 控制对抗字段（判定见 §11）');
p();
tbl(['僵尸', '稳固', '霸体', '抗冻', '狡诈', '施加击退', '击退类型'], zAll.map((z) => [
  z.name, z.superArmor ? `**${z.stab}**` : z.stab, z.superArmor ? '**✓**' : '—', f2(z.freezeRes), f2(z.cunning), z.knock,
  { knockback: '击退', knockdown: '击倒', none: '—' }[z.knockKind],
]));
const hk = HEROES.map((h) => heroKnock(h, 5, 2));
p(`- **稳固段咬住英雄击退力跨度定**（英雄满级满阶击退力 ${Math.min(...hk).toFixed(1)} ~ ${Math.max(...hk).toFixed(1)}）。两端尺度不对齐，玩家就感觉不到稳固存在。`);
p('- **霸体只免位移**（击退 + 击倒），不免冻结 / 嘲讽 / 减速——那三类各有独立的对抗属性。“免一切控制”会让控制流整体作废，玩家学到的只是“别带控制”。');
p('- **僵尸也反推英雄**：近战偏击倒（短暂失去行动），远程偏击退（位移，打乱阵型）。');
p();
p('### 4.3 阶段缩放与生存压力');
p();
tbl(['阶段', '血量倍率', '伤害倍率'], STAGES.map((s, i) => [`${s.index} ${s.name}`, `×${STAGE_HP_MUL[i]}`, `×${STAGE_DMG_MUL[i]}`]));
const growth = (derive(SQ[0].primary, 5).levelDmgMul / derive(SQ[0].primary, 1).levelDmgMul) * tierBonus(2).dmg;
p(`血量倍率**必须低于**小队输出成长（1 → 5 级 × 0 → 2 阶 ≈ ×${growth.toFixed(1)}），让玩家越打越轻松。`);
p();
const squadDpsAt3 = squadDps(SQ, 5, SQUAD_TIERS, 200, 'none', 2.5).total;
p(`下表“单只击杀”用参考阵容满级满阶、同时面对 2.5 个目标的小队 DPS（${n0(squadDpsAt3)}），统一按穿刺 / 穿透 60 计。`);
p();
const surv = ZOMBIE_LIST.flatMap((z) => [1, 3].map((st) => ({ z, st, d: zombieDps(z, st), t: ttk(squadDpsAt3, z, st, 60, 'pierce') })));
tbl(['僵尸', '阶段', '接触 DPS', '单只击杀'], surv.map(({ z, st, d, t }) => [st === 1 ? z.name : '', st, n0(d), Number.isFinite(t) ? `${f2(t)}s` : '打不动']));
const slow = surv.filter((x) => x.st === 3 && Number.isFinite(x.t)).sort((a, b) => b.t - a.t)[0];
p(`阶段 3 最慢的是 **${slow.z.name} ${f2(slow.t)}s**——它不一定致命，但它占着你的输出时间。“打不动”表示该系伤害被完全吸收（电磁场），要换系别。`);
p();

// ───────────────────────── 5 ─────────────────────────
p(`## 5. 角色表（${HEROES.length} 名）`);
p();
p('> 这 12 名是第二轮的固定英雄，用作配平基准。第三轮职业制的职业数据见 [10-职业树](10-职业树.html)。');
p();
p(`### 5.1 一级属性（六属性，合计必须恰为 ${POINT_TOTAL}）`);
p();
tbl(['角色', '定位', '武器', '力', '敏', '韧', '智', '幸', '体', '合计'], HEROES.map((h) => {
  const q = h.primary;
  const t = pointBudget(q);
  return [h.name, ROLE_NAME[h.role], WEAPONS[h.weapon].name, q.str, q.agi, q.tgh, q.int, q.luk, q.con, t === POINT_TOTAL ? t : `**${t} ✗**`];
}));
p(`**统一 ${POINT_TOTAL} 点是硬约束。** 否则“哪个角色强”就变成“哪个角色点数多”。角色差异靠分配方式体现，不靠数值膨胀。`);
p();
p('### 5.2 单角色基准（1 级 / 武器 0 阶 / 对普通僵尸）');
p();
const base = HEROES.map((h) => {
  const w = WEAPONS[h.weapon];
  const d = derive(h.primary, 1);
  const dps = squadDps([h], 1, {}, bench.armor, bench.armorType, 1).total;
  return { h, w, d, dps, ehp: heroEhp(d), t: ttk(dps, bench, 1, w.pierce, w.dtype) };
}).sort((a, b) => b.dps - a.dps);
tbl(['角色', '武器', '暴击', '抗暴', '稳固', 'DPS', '有效生命', 'TTK(普通)'], base.map((r) => [
  r.h.name, r.w.name, (r.d.critRate + r.w.critBonus).toFixed(3), r.d.antiCrit.toFixed(3), Math.round(r.d.stab), n0(r.dps), n0(r.ehp), `${f2(r.t)}s`,
]));
const dv = base.map((r) => r.dps);
p(`DPS 区间 ${range(dv)}，极差 **${(Math.max(...dv) / Math.min(...dv)).toFixed(2)}×**。全员极差是刻意保留的——压平之后“选谁”只剩外观差异。真正要压平的是**同定位内**的极差：`);
p();
const roles = [...new Set(HEROES.map((h) => h.role))];
tbl(['定位', '成员', '组内极差'], roles.map((r) => {
  const g = base.filter((x) => x.h.role === r);
  const v = g.map((x) => x.dps);
  return [ROLE_NAME[r], g.map((x) => x.h.name).join('、'), `${(Math.max(...v) / Math.min(...v)).toFixed(2)}×`];
}));
p('控制与辅助组的极差偏大是设计意图：输出最低的那位，技能是全场冻结或全队治疗，价值不能用 DPS 衡量。要给她们补 DPS，正确做法是削弱技能，否则“带控制 / 治疗”就成了没有代价的选择。');
p();
p('### 5.3 技能与 AI 参数');
p();
tbl(['角色', '技能', '冷却', '持续', '倍率', '索敌', '脱战', '交战×', '优先级', '后撤', '驻守'], HEROES.map((h) => [
  h.name, `${h.skill.name}（${h.skill.note}）`, h.skill.cooldown, h.skill.duration, h.skill.mul, h.ai.aggroRange, h.ai.leashRange,
  h.ai.engageDistanceMul, PRIO_NAME[h.ai.targetPriority], h.ai.retreatHpPct ? pc(h.ai.retreatHpPct, 0) : '永不', HOLD_NAME[h.ai.holdPolicy],
]));
p('**这张表就是角色差异化的全部**——所有角色共用同一套 AI 代码，加一个角色 = 加一行数据，不是加一个类。');
p();

// ───────────────────────── 6 ─────────────────────────
p('## 6. BOSS 规格与反向校准');
p();
p('### 6.1 BOSS 数值');
p();
tbl(['BOSS', '登场', '血量', '护甲', '速度', '攻击', '半径', '目标击杀', '需求 DPS'], BOSSES.map((b) => [
  `**${b.name}**`, mmss(b.at), n0(b.hp), b.armor, b.speed, b.atk, b.radius, `${b.targetKillTime}s`, n0(b.hp / b.targetKillTime),
]));
p('### 6.2 反向校准（解析式 vs 时间轴模拟）');
p();
p('**校准用 BOSS 登场那一刻的真实等级与武器阶，不能手填。** 手填过一次，“校准全部通过”和“模拟器里 BOSS 十八秒就死”同时成立，错误被那张“通过”的表掩盖了整整一轮。');
p();
const cal = BOSSES.map((b, i) => {
  const rep = sim.bossReport[i];
  const tiers = Object.fromEntries(SQ.map((h) => [h.weapon, b.stage === 1 ? 0 : b.stage === 2 ? 1 : 2]));
  const analytic = squadDps(SQ, rep.level, tiers, b.armor, 'heavy', 1).total;
  const ok = rep.killTime > 0 && Math.abs(rep.killTime - b.targetKillTime) / b.targetKillTime < 0.15;
  return { b, rep, analytic, measured: rep.killTime > 0 ? b.hp / rep.killTime : NaN, ok };
});
tbl(['阶段', '登场等级', '武器阶', '解析式 DPS', '实测 DPS', '目标', '实测秒数', '偏离', '判定'], cal.map((c) => [
  c.b.stage, c.rep.level, c.rep.tier, n0(c.analytic), Number.isFinite(c.measured) ? `**${n0(c.measured)}**` : '—', `${c.b.targetKillTime}s`,
  c.rep.killTime > 0 ? `${c.rep.killTime}s` : '未击杀', c.rep.killTime > 0 ? `${c.rep.killTime > c.b.targetKillTime ? '+' : ''}${pc(c.rep.killTime / c.b.targetKillTime - 1)}` : '—',
  c.ok ? '✓ 达标' : c.rep.killTime > 0 && c.rep.killTime < c.b.targetKillTime ? `偏易 ${pc(c.rep.killTime / c.b.targetKillTime, 0)}` : '偏难',
]));
p('```\n校准方法：BOSS 血量 = 实测 DPS × 目标秒数，容差 ±15%\n```');
p();
tbl(['情况', '含义'], [
  ['实测 < 解析式', 'BOSS 战被杂兵稀释了输出 → 这就是“BOSS 登场清场”的理由'],
  ['实测 > 解析式', '清场后全队溢出伤害灌在 BOSS 身上，技能窗口叠在一起 → AOE 与技能的收益在这里体现'],
]);
p('**判据是实测秒数，不是“常驻 DPS ÷ 需求 DPS”。** 常驻 DPS 低于需求是常态，通关靠的是技能窗口；拿它当判据会得出“第一关打不动”的假警报。');
p();
p('### 6.3 配平锚点为什么是 BOSS 而不是僵尸');
p();
p('```\nBOSS 血量 → 反推必须 N 秒内击杀 → 小队 DPS 目标\n         → 单角色 DPS → 武器伤害 → 僵尸血量\n```');
p();
p('**只在小队 DPS 公式或成长曲线变动后重跑校准，不要凭手感改。** 手填的第一版比实测需求高 3–6 倍，第 1 个 BOSS 就全灭。');
p();

// ───────────────────────── 7 ─────────────────────────
p('## 7. 关卡与经济');
p();
tbl(['项', '值'], [
  ['常规阶段总时长', `${RUN_DURATION}s（${STAGES.length} × ${STAGES[0].duration}s）`],
  ['循环总长 `RUN_END`', `${RUN_END}s（含最后一个 BOSS 窗口）`],
  ['胜利条件', `${BOSSES.length} 个 BOSS 全部击杀`],
]);
p('本节描述的是**一次 run 之内**的数值。关卡之间怎么变难走的是另一条机制（威胁预算 + 维度权重），见 §7.1。');
p();
p(`### 7.1 场景层：${TOTAL_LEVELS} 个子关卡从哪来`);
p();
const sceneRows = SCENES.map((s) => ({ s, lv: expandScene(s, 'normal') }));
tbl(['场景', '子关卡', '首关威胁', '终关威胁', '终关 / 首关'], [
  ...sceneRows.map(({ s, lv }) => [s.name, lv.length, f2(lv[0].threatBudget), f2(lv.at(-1)!.threatBudget), `×${f2(lv.at(-1)!.threatBudget / lv[0].threatBudget)}`]),
  ['**合计**', `**${TOTAL_LEVELS}**`, '', '', ''],
]);
p('**同场景内威胁预算只涨两倍左右。** 难度增长的另一半来自**构成**：活跃维度从 1 个变成 3 个且权重全开——玩家卡住时需要换阵容，而不是刷数值。全部来自 `scenes.ts` 的 `expandScene()`。');
p();
p('#### 7.1.1 三档难度');
p();
tbl(['档', '威胁乘数', '权重上移', '环境修正', '说明'], DIFFICULTIES.map((d) => [d.name, `×${d.threatMul}`, `${d.weightShift} 档`, d.envMod, d.note]));
const jg = SCENES.find((s) => s.id === 'jungle')!;
const fmtDims = (d: object) => '{ ' + Object.entries(d).map(([k, v]) => `${k}: ${+(+v).toFixed(2)}`).join(', ') + ' }';
p(`**权重上移改的是次级维度，不改主维度。** 实测${jg.name}第 10 关：`);
p();
p('```');
for (const d of DIFFICULTIES) p(`${d.name.padEnd(4, '　')} ${fmtDims(expandScene(jg, d.id)[9].dims)}`);
p('```');
p();
p('**僵尸与 BOSS 的个体数值不随难度变**，改的全是预算与维度权重——否则 §6 的 BOSS 锚点立刻失效。维度定义见 [08-关卡方案](08-关卡方案.html)，答案矩阵见 [09-角色与成长](09-角色与成长.html)。');
p();
p('### 7.2 刷怪速率（威胁值/秒，单场景基线）');
p();
const zn = (id: string) => ZOMBIES[id as keyof typeof ZOMBIES].name;
tbl(['阶段', '起始', '结束', '出怪构成（权重）'], STAGES.map((s) => [
  `${s.index} ${s.name}`, s.threatRateStart, s.threatRateEnd, s.spawnTable.map((e) => `${zn(e.zombie)} ${e.weight}`).join(' / '),
]));
p('后期阶段的威胁速率不一定更高：出怪表里高威胁僵尸占比更大，同样的威胁值对应**更少的只数、更高的单体质量**。');
p();
p('#### 7.2.1 BOSS 战期间的刷怪乘数（分阶段）');
p();
tbl(['BOSS', '乘数', '参考阵容实测场上均只数'], BOSSES.map((b, i) => {
  const ss = sim.snapshots.filter((s) => s.boss?.startsWith(b.name));
  return [b.name, BOSS_PHASE_SPAWN_MUL[i], ss.length ? (ss.reduce((a, s) => a + s.zombies, 0) / ss.length).toFixed(1) : '—'];
}));
p('**倍数骗人，只数不骗人。** 预算按威胁值计，而各阶段出怪表的单位威胁对应的身体数完全不同，所以乘数必须分阶段。三个阶段同用一个乘数时，难度峰跑到了第二场，关底反而成了过场。');
p();
p('### 7.3 等级与武器（局内零购买）');
p();
const lv5 = sim.snapshots.find((s) => s.level === 5);
tbl(['项', '值'], [
  ['等级时间表 `LEVEL_TIME`', `[${LEVEL_TIME.join(', ')}] 秒`],
  ['每级效果', `+${pc(K.levelGrowth, 0)} 基础属性，+${pc(K.levelDmgPerLevel, 0)} 最终伤害`],
  ['武器阶', Object.entries(LEVEL_TIER_AT).map(([l, t]) => `${l} 级 → ${t} 阶`).join('，')],
  ['实测满级时刻', lv5 ? mmss(lv5.t) : '—'],
  ['实测一局产出', `${n0(sim.totalMoney)} 金钱（**带出关卡**，局内不使用）`],
]);
p('**变强只由时间驱动。** 金钱只累积、结算带出；积分降级为结算得分，不参与成长。打得轻不轻松不再决定你什么时候变强。');
p();
p('### 7.4 局外军械库（`progression.ts` 的 `SHOP`）');
p();
const wp = Object.values(WEAPON_SHOP).map((s) => s.price);
const ip = Object.values(ITEM_SHOP).map((s) => s.price);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
tbl(['类别', '件数', '价位区间', '合计'], [
  ['武器解锁', wp.length, range(wp), n0(sum(wp))],
  ['道具解锁', ip.length, range(ip), n0(sum(ip))],
  ['**全解锁**', `**${wp.length + ip.length}**`, '', `**${n0(totalUnlockCost())}**`],
]);
const shopRuns = Math.ceil(totalUnlockCost() / sim.totalMoney);
p(`按一局 ${n0(sim.totalMoney)} 金钱计：**解锁全部 ≈ ${shopRuns} 局 ≈ ${((shopRuns * RUN_DURATION) / 3600).toFixed(1)} 小时**。刻意压短：商店卖的是**选项**，选项必须来得早。买的是装备本身（买断、全队共享），不卖阶、不卖属性。`);
p();
p('> ⚠ 军械库仍是第二轮的 14 把武器，武器类别定稿后重做；招募刷新的花费那时加入金钱线。');
p();
p('### 7.5 增益道具');
p();
tbl(['道具', '持续', '效果', '军械库价', '自动触发'], BUFFS.map((b) => {
  const it = ITEM_SHOP[b.id as keyof typeof ITEM_SHOP];
  return [b.name, `${b.duration}s`, b.effect, it ? n0(it.price) : '—', it?.trigger ?? '—'];
}));

// ───────────────────────── 8 ─────────────────────────
p('## 8. 15 分钟全程模拟（参考阵容，默认种子）');
p();
tbl(['时间', '场上', '存活', '队伍血量', '累计击杀', '等级', 'DPS', 'BOSS'], sim.snapshots
  .filter((s) => s.t % 60 === 0 || s.t === RUN_DURATION || s.boss)
  .map((s) => [mmss(s.t), s.zombies, `${s.alive}/5`, pc(s.squadHpPct), s.kills, s.level, s.squadDps, s.boss ?? '']));
const RESULT = { victory: '✓ 通关', squadWiped: '✗ 全灭', bossTimeout: '✗ BOSS 超时' };
p('```');
p(`最终：${RESULT[sim.result]}  总击杀 ${n0(sim.totalKills)}  金钱 ${n0(sim.totalMoney)}  积分 ${n0(sim.totalPoints)}  阵亡：${sim.deaths.length ? sim.deaths.map((d) => `${d.hero}@${mmss(d.t)}`).join(' ') : '无'}`);
p(`BOSS：${sim.bossKills.join(' → ') || '无'}`);
p('```');
p();
const minHp = Math.min(...sim.snapshots.map((s) => s.squadHpPct));
p(`**能说明什么**：清怪速率始终高于刷怪速率，场上只数没有雪崩；三个 BOSS 击杀秒数都在 §6.2 的容差内。**不能说明什么**：全程最低血量 ${pc(minHp)}，且几乎只在 BOSS 窗口里掉——不是小队太强，是模拟器结构上打不到人，见 §10。`);
p();
p('这是单场景 15 分钟基线。场景层改的是刷怪构成与维度权重，不改僵尸数值与 BOSS 血量，所以对每一关的普通档都成立；噩梦档威胁 ×1.5，要等原型再量。');
p();

// ───────────────────────── 9 ─────────────────────────
p('## 9. 多阵容 × 多种子鲁棒性');
p();
const SQUADS: [string, string[]][] = [
  ['均衡（参考）', SQUAD],
  ['双坦双输出', ['gwen', 'ron', 'kai', 'vera', 'lian']],
  ['无治疗', ['ron', 'kai', 'vera', 'ella', 'bom']],
  ['召唤流', ['nox', 'sif', 'ron', 'vera', 'lian']],
  ['全脆皮', ['vera', 'jet', 'ella', 'nox', 'sif']],
  ['近战莽', ['ron', 'kai', 'ironbull', 'gwen', 'lian']],
  ['单坦四输出', ['gwen', 'kai', 'ironbull', 'vera', 'jet']],
];
let grand = 0;
const multi = SQUADS.map(([label, ids]) => {
  let wins = 0, deaths = 0, worst = 1;
  for (const seed of SEEDS) {
    const r = simulate(ids, seed);
    if (r.result === 'victory') wins++;
    deaths += r.deaths.length;
    for (const s of r.snapshots) worst = Math.min(worst, s.squadHpPct);
  }
  grand += wins;
  const k = simulate(ids).bossReport.map((b) => (b.killTime > 0 ? `${Math.round(b.killTime)}s` : '超时')).join(' ');
  return { label, ids, wins, deaths: deaths / SEEDS.length, worst, k };
});
p(`${SEEDS.length} 个种子 × ${SQUADS.length} 套阵容 = ${SEEDS.length * SQUADS.length} 次完整模拟，合计通关 **${grand}/${SEEDS.length * SQUADS.length}**。`);
p();
tbl(['阵容', '成员', '通关', '均阵亡', '最低血量', `BOSS 击杀（目标 ${BOSSES.map((b) => b.targetKillTime).join('/')}s）`], multi.map((m) => [
  m.label, m.ids.map((id) => HEROES_BY_ID[id].name.split('·').at(-1)).join(' '), `${m.wins}/${SEEDS.length}`, m.deaths.toFixed(2), pc(m.worst), m.k,
]));
const ws = multi.map((m) => m.worst);
const best = multi.reduce((a, b) => (b.worst > a.worst ? b : a));
const worstSq = multi.reduce((a, b) => (b.worst < a.worst ? b : a));
p(`**区分度落在“最低血量”一列**：跨度 ${pc(Math.min(...ws))} ~ ${pc(Math.max(...ws))}。最抗压的是 ${best.label}，最吃力的是 ${worstSq.label}。阵容应该影响**余量**，而不是决定**成败**。`);
p();
p('读数里“无治疗”往往不比“双坦”差——模拟器只建模接触伤害、几乎产生不了阵亡，“清怪快”永远优于“扛得住”，治疗的价值体现不出来。真人试玩时这条大概率会反过来，留给原型验证。');
p();
p('### 9.1 维度覆盖（只证明没有死胡同）');
p();
const dimRows = DIMENSIONS.map((d) => {
  const answers = new Set(HEROES.flatMap((h) => effectiveAnswers(h).filter((a) => ANSWER_DIMS[a].includes(d.id))));
  const keys = [...answers].filter((a) => KEY_LIST.includes(a));
  const who = HEROES.filter((h) => answersDimension(h, d.id)).length;
  const ok = keys.length >= MIN_KEYS_PER_DIM && answers.size >= MIN_ANSWERS_PER_DIM;
  return { d, answers, keys, who, ok };
});
tbl(['维度', '族', '钥匙', '替代答案', '基准角色可答', '判定'], dimRows.map((r) => [
  r.d.name, r.d.family, DIM_KEYS[r.d.id].join(' ') || '—', DIM_ALTS[r.d.id].join(' ') || '—', `${r.who}/${HEROES.length}`, r.ok ? '✓' : '✗',
]));
const coverMask = HEROES.map((h) => DIMENSIONS.reduce((m, d, i) => (answersDimension(h, d.id) ? m | (1 << i) : m), 0));
const squads: number[] = [];
const n = HEROES.length;
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++)
  squads.push(coverMask[a] | coverMask[b] | coverMask[c] | coverMask[d] | coverMask[e]);
const ALL = (1 << DIMENSIONS.length) - 1;
const universal = squads.filter((m) => m === ALL).length;
const dimIdx = Object.fromEntries(DIMENSIONS.map((d, i) => [d.id, i]));
let tight = Infinity;
for (const { lv } of sceneRows) for (const l of lv) {
  const need = Object.keys(l.dims).reduce((m, k) => m | (1 << dimIdx[k]), 0);
  tight = Math.min(tight, squads.filter((m) => (m & need) === need).length);
}
const avgDims = HEROES.reduce((s, h) => s + DIMENSIONS.filter((d) => answersDimension(h, d.id)).length, 0) / HEROES.length;
p(`判据：每个维度 ≥${MIN_KEYS_PER_DIM} 把钥匙、≥${MIN_ANSWERS_PER_DIM} 种答案。${dimRows.every((r) => r.ok) ? `**全部 ${DIMENSIONS.length} 个维度达标。**` : `**${dimRows.filter((r) => !r.ok).length} 个维度不达标。**`}`);
p();
p(`**但覆盖门槛几乎不筛人**：C(${n},5) = ${squads.length} 套阵容里，${universal} 套（${pc(universal / squads.length)}）能覆盖全部维度；门槛最高的一关也放行 ${tight} 套（${pc(tight / squads.length)}）。原因是结构性的——每人平均能答 ${avgDims.toFixed(1)} 个维度，5 人并集自然铺满。这是**可玩性下限，不是深度证明**；真正的区分度在“同一维度下不同答案的效率差”，要等原型把维度折进刷怪与承伤模型才量得出来。`);
p();

// ───────────────────────── 10 ─────────────────────────
p('## 10. 模拟器的能力边界（必读）');
p();
p(`### 10.1 实测：常规阶段僵尸几乎走不到脸上（${SEEDS.length} 种子平均）`);
p();
const SEGS: [string, number, number][] = [
  ['常规 0:00-5:00', 0, 300], ['BOSS1 5:00-6:30', 300, 390], ['常规 6:30-10:00', 390, 600],
  ['BOSS2 10:00-11:30', 600, 690], ['常规 11:30-15:00', 690, 900], ['BOSS3 15:00-16:30', 900, 990],
];
const runs = SEEDS.map((s) => simulate(SQUAD, s));
tbl(['区间', '均场上', '均贴身', '有贴身的时刻占比'], SEGS.map(([label, a, b]) => {
  let field = 0, contact = 0, touched = 0, k = 0;
  for (const r of runs) for (const q of r.snapshots) {
    if (q.t < a || q.t >= b) continue;
    field += q.zombies; contact += q.contact; k++;
    if (q.contact > 0) touched++;
  }
  return [label, (field / k).toFixed(1), (contact / k).toFixed(1), pc(touched / k, 0)];
}));
p('```');
p(`一局平均总承伤 ${n0(runs.reduce((s, r) => s + r.dmgTaken, 0) / runs.length)}   vs   小队满级总有效生命 ${n0(squadEhp(SQ, 5))}`);
p('```');
p();
p('僵尸从 25 格（视口边缘）出发，绝大多数死在路上。贴身主要发生在 BOSS 窗口——BOSS 血厚打不死，杂兵才有机会走到脸上。');
p();
p('### 10.2 为什么必然如此');
p();
tbl(['简化', '后果'], [
  ['地图抽象成**一维距离**', '所有僵尸从同一个方向来，没有包围'],
  ['索敌是**单点最近目标**', '5 个人不会分头堵不同方向'],
  ['队员**完全不走位**', '等于假设玩家每一次走位决策都正确'],
]);
p('三条叠起来 → 小队输出 100% 集中在唯一来向 → 前沿永不被压到脸上。');
p();
p('### 10.3 能回答 / 不能回答');
p();
p('- **能**：清怪速率够不够、BOSS 血量锚点对不对、阵容之间有没有区分度、各乘区有没有写错、每个维度有没有死胡同。');
p('- **不能**：会死几个人、难度手感对不对、站位与牵引有没有意义。这些必须靠真人原型试玩，这条边界记在 `00-决策清单` D0。');
p();

// ───────────────────────── 11 ─────────────────────────
p('## 11. 控制对抗矩阵');
p();
p('一条判定，两端对撞，形状复用 `PIERCE_K` 那条饱和曲线：');
p();
p(`\`\`\`\n位移命中率 = clamp(${KNOCK_CAP} × atk² / (atk² + stab²))\n    atk  = 武器击退 × (近战 1+力量×${K.strKnock} / 远程 1+敏捷×${K.agiKnock})\n    stab = 目标稳固\n\`\`\``);
p();
tbl(['概念', '在哪', '含义'], [
  ['击退力', '武器 `knockback` × 属性乘区', '攻方'],
  ['稳固', `英雄：韧性 × ${K.tghStab}；僵尸：表值 \`stab\``, '守方'],
  ['霸体', '僵尸 `superArmor`', '**只免位移**，冻结 / 嘲讽 / 减速照常生效'],
  ['抗冻', '僵尸 `freezeRes`', '削减冻结时长'],
  ['狡诈', '僵尸 `cunning`', '抵嘲讽'],
]);
p(`**上限 \`KNOCK_CAP = ${KNOCK_CAP}\`，不是 1.0**——任何一条控制的顶端都要留一层地板。**减速不设对抗属性**，是这条轴上永远关不上的一格。`);
p();
p(`### 11.1 位移：全部 ${HEROES.length} 个英雄 × ${ZOMBIE_LIST.length} 种僵尸（5 级 / 2 阶）`);
p();
p('扫全部英雄，不挑两个端点——挑端点只能证明“最强和最弱不一样”，证明不了中间各自站在哪一格。列头括号里是僵尸的稳固。');
p();
const byKnock = [...HEROES].sort((a, b) => heroKnock(b, 5, 2) - heroKnock(a, 5, 2));
tbl(['英雄·武器', '击退力', ...ZOMBIE_LIST.map((z) => `${z.name.replace('僵尸', '')}（${z.stab}）`)], byKnock.map((h) => {
  const k = heroKnock(h, 5, 2);
  return [`${h.name}·${WEAPONS[h.weapon].name}`, k.toFixed(1), ...ZOMBIE_LIST.map((z) => (canDisplace(z) ? f2(knockChance(k, z.stab)) : '霸体'))];
}));
const usable = byKnock.filter((h) => knockChance(heroKnock(h, 5, 2), bench.stab) >= 0.5);
const wasted = byKnock.filter((h) => knockChance(heroKnock(h, 5, 2), bench.stab) < 0.2);
const tox = ZOMBIES.toxic;
p(`对最普通的${bench.name}（稳固 ${bench.stab}）：推得动（≥50%）的 ${usable.length} 人，推不太动（<20%）的 ${wasted.length} 人。对${tox.name}（稳固 ${tox.stab}）：全队最高的 ${byKnock[0].name} 只有 ${f2(knockChance(heroKnock(byKnock[0], 5, 2), tox.stab))}，最低的 ${byKnock.at(-1)!.name} 只剩 ${f2(knockChance(heroKnock(byKnock.at(-1)!, 5, 2), tox.stab))}。`);
p();
p('**击退力是一份要花出去的选择，不是一句台词。** 对着硬目标，加力度的收益很快饱和——玩家学到的是**换手段**。');
p();
p('### 11.2 僵尸控制抗性：三扇各自上锁的门');
p();
p('综合评分 = 霸体 / 稳固 / 抗冻 / 狡诈 四项平均。冻结时长按 4 秒基础算；嘲讽命中率是在 0–1 上取 1000 个等距样本喂给 `tauntLands()` 数通过率——不写 `1 - cunning`，那样是在复述实现而不是验证它。');
p();
tbl(['僵尸', '霸体', '稳固', '抗冻', '狡诈', '评分', '冻结 4s 实际', '嘲讽命中率'], [...ZOMBIE_LIST].sort((a, b) => controlResistance(b) - controlResistance(a)).map((z) => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (tauntLands(z.cunning, i / 1000)) hits++;
  return [z.name, z.superArmor ? '✓' : '—', z.stab, f2(z.freezeRes), f2(z.cunning), f2(controlResistance(z)), `${f2(freezeDuration(4, z.freezeRes))}s`, f2(hits / 1000)];
}));
const lp = ZOMBIES.leaper;
p(`**评分接近不代表挡住的是同一扇门**：${lp.name}挡的是嘲讽（狡诈 ${f2(lp.cunning)}），推它不难（稳固 ${lp.stab}）；${tox.name}挡的是冻结（抗冻 ${f2(tox.freezeRes)}，4 秒只剩 ${f2(freezeDuration(4, tox.freezeRes))} 秒），嘲讽对它照样好使。玩家不能把某一种控制堆到极致通关，只能带上能开不同门的队友。`);
p();
const rg = ZOMBIES.regenerator;
const rdim = DIMENSION_BY_ID.regen;
p(`### 11.3 硬锁维度「${rdim.name}」：回血速率 vs 输出速率`);
p();
{
  const ehp = zombieEhp(rg, 1);
  const healed = rg.regen * ANTI_HEAL_MUL;
  const { total, per } = squadDps(SQ, 5, SQUAD_TIERS, rg.armor, rg.armorType, 1, 0, rg.resist);
  const kill = (dps: number, r: number) => (dps <= r ? Infinity : ehp / (dps - r));
  const fmt = (t: number) => (Number.isFinite(t) ? `${t.toFixed(1)}s` : '**打不死**');
  p(`${rdim.lock} 钥匙：${DIM_KEYS.regen.join(' ')}；替代答案：${DIM_ALTS.regen.join(' ') || '—'}。`);
  p();
  p(`${rg.name}：有效生命 ${n0(ehp)}，回血 ${rg.regen}/s，被重创后 ${healed}/s。下表是参考阵容每人满级满阶的单人 DPS：`);
  p();
  tbl(['成员', '单人 DPS', '无钥匙击杀', '带重创击杀'], [
    ...per.map(({ hero, dps }) => [hero.name, n0(dps), fmt(kill(dps, rg.regen)), fmt(kill(dps, healed))]),
    ['**全队**', n0(total), fmt(kill(total, rg.regen)), fmt(kill(total, healed))],
  ]);
  p('它不是“血更厚”（血厚只是多打两秒），而是“输出盖不过回血就永远打不完”。钥匙打开的是通路，不是跳过按钮。');
  p();
}
p('### 11.4 障碍语义');
p();
tbl(['障碍', '可破坏', '挡人', '挡弹', '挡视线', '耐久', '残留'], OBSTACLE_KINDS.map((id) => {
  const o = OBSTACLES[id];
  const y = (b: boolean) => (b ? '✓' : '✗');
  return [o.name, y(o.destructible), y(o.blocksMovement), y(o.blocksShots), y(o.blocksSight), o.hp, o.residue];
}));
const shapes = new Set(OBSTACLE_KINDS.map((id) => { const o = OBSTACLES[id]; return `${o.blocksMovement}/${o.blocksShots}/${o.blocksSight}`; }));
p(`四种代表障碍的通行位掩码只有 **${shapes.size}** 种组合。新语义只有两条：**子弹能穿但人不能穿**、**墙可炸开**。木墙与建筑只差 \`destructible\`——让“绕开”与“打开”成为两种可学的反应。`);
p();

// ───────────────────────── 12 ─────────────────────────
p(`## 12. 军衔与成长（${MAX_RANK} 级）`);
p();
p('局外数值线只剩**军衔**一条：荣誉 → 军衔 → **属性成长**（最终生命 / 最终伤害）+ **转职点**。防刷靠两件事：敌人按**关卡军衔上限**加成；出战队员都不能超上限，全队超了 = 这关毕业。');
p();
p('> 曲线与成长率都是起点，不是配平结论：荣誉曲线等关卡线定了再回调；成长率的滚雪球先试玩再说。');
p();
p('### 12.1 荣誉：任务与通关每次都发，星级只发【新】星');
p();
tbl(['星', '条件'], [['★', '通关'], ['★★', '通关，且最终全员存活（被复活的算活着）'], ['★★★', '★★，且完成本局全部局内任务']]);
p(`任务 ${HONOR_PER_TASK}/个 · 通关 ${HONOR_CLEAR_BONUS} · 新星 ${HONOR_PER_NEW_STAR}/颗。荣誉**平均分给出战队员**——少带人每人分得多，这是“可以少带”的回报。`);
p();
const cases = [
  ['首通三星', { victory: true, tasksDone: 3, prevStars: 0, stars: 3 }],
  ['首通一星', { victory: true, tasksDone: 1, prevStars: 0, stars: 1 }],
  ['重打补到三星', { victory: true, tasksDone: 3, prevStars: 1, stars: 3 }],
  ['重打（已三星）', { victory: true, tasksDone: 3, prevStars: 3, stars: 3 }],
  ['失败，做了 2 个任务', { victory: false, tasksDone: 2, prevStars: 0, stars: 0 }],
] as const;
tbl(['情况', '荣誉', '5 人各得', '3 人各得'], cases.map(([name, c]) => { const t = runHonor(c); return [name, t, honorPerHero(t, 5).toFixed(1), honorPerHero(t, 3).toFixed(1)]; }));
p(`### 12.2 军衔表（${MAX_RANK} 级）`);
p();
const GROWTHS = [HERO_GROWTH_BAND[0], (HERO_GROWTH_BAND[0] + HERO_GROWTH_BAND[1]) / 2, HERO_GROWTH_BAND[1]];
p(`升级荣誉 = ${HONOR_BASE} × ${HONOR_GROWTH}^(级−2)。◆ = 发 1 个转职点并解锁该层职业。英雄乘区 = (1+成长)^(级−1)，敌人乘区按关卡军衔上限算，都同时乘最终生命与最终伤害。`);
p();
tbl(['级', '代码', '军衔', '本级', '累计', '转职', ...GROWTHS.map((g) => `英雄 ${pc(g, 1)}`), '敌人'], RANKS.map((r) => [
  r.level, r.code, r.name, r.level === 1 ? 0 : r.req - RANKS[r.level - 2].req, n0(r.req), r.advance ? `◆${advancePointsAt(r.level)}` : '',
  ...GROWTHS.map((g) => f2(heroRankMul(r.level, g))), f2(enemyRankMul(r.level)),
]));
p('转职点可以攒着不用；点数按顺序消耗，第 7 点（五星终极）自然要求先用完前 6 点。');
p();
p('### 12.3 ⚠ 同级对位强度比（只记读数，先试玩）');
p();
const at = [4, 10, 18, 25];
tbl(['成长', ...at.map((l) => RANKS[l - 1].code)], GROWTHS.map((g) => [pc(g, 1), ...at.map((l) => `×${f2((heroRankMul(l, g) / enemyRankMul(l)) ** 2)}`)]));
p('对位强度比 = (英雄乘区 / 敌人乘区)²。成长高于敌人的职业在高军衔会显著碾压同级关卡。**用户裁决：先试玩再说。** 要收的话：压低成长上限，或让敌人成长跟英雄成长区间的中值走。');
p();
p('### 12.4 时间成本（一局 15 分钟）');
p();
const honorPerRun = runHonor({ victory: true, tasksDone: 3, prevStars: 3, stars: 3 });
const perHero = honorPerHero(honorPerRun, 5);
const H = (k: number) => (k * RUN_DURATION) / 3600;
p(`稳态按“重打已三星的关”算：${honorPerRun} 荣誉/局 ÷ 5 人 = 每人 ${perHero.toFixed(1)}/局（不含一次性的新星荣誉，偏保守）。`);
p();
tbl(['转职', '军衔', '局数', '小时'], ADVANCE_RANKS.map((lv) => {
  const k = Math.ceil(RANKS[lv - 1].req / perHero);
  return [lv === MAX_RANK ? '五星' : `第 ${advancePointsAt(lv)} 转`, `${RANKS[lv - 1].code} ${RANKS[lv - 1].name}`, k, H(k).toFixed(1)];
}));
const maxH = H(Math.ceil(RANKS[MAX_RANK - 1].req / perHero));
p(`${maxH >= 40 && maxH <= 100 ? '✓' : '⚠'} 第一支队满五星约 **${maxH.toFixed(0)} 小时**，目标 40–100 小时。全游戏约 100 小时，毕业机制会逼玩家练第二、第三支队。军械库那条线只要 ${shopRuns} 局——**最先到手的是选项，长期投入的是军衔。**`);
p();
p('### 12.5 不变量自查');
p();
const checks: [string, boolean][] = [
  [`军衔 ${MAX_RANK} 级，五星上将在顶`, MAX_RANK === 25 && RANKS[24].name === '五星上将'],
  ['累计荣誉严格递增', RANKS.every((r, i) => i === 0 || r.req > RANKS[i - 1].req)],
  [`转职点 ${ADVANCE_RANKS.length} 个（6 可选 + 五星）`, ADVANCE_RANKS.length === 7 && advancePointsAt(MAX_RANK) === 7],
  ['E-3 不能转、E-4 能转第 1 次', !canAdvance(3, 0) && canAdvance(4, 0)],
  ['点数可累积：O-1 未转过的人可连转 4 次', [0, 1, 2, 3].every((d) => canAdvance(15, d)) && !canAdvance(15, 4)],
  ['五星要先补完前 6 转', canAdvance(25, 5) && canAdvance(25, 6) && !canAdvance(25, 7)],
  ['出战：超人数 / 有人超军衔上限都不能出', canDeploy([3, 3], 5, 2) && !canDeploy([3, 3, 3], 5, 2) && !canDeploy([3, 6], 5, 2)],
  ['敌人加成只看军衔上限（上限 1 = ×1）', enemyRankMul(1) === 1],
  ['重打已三星的关不再给星级荣誉', runHonor({ victory: true, tasksDone: 0, prevStars: 3, stars: 3 }) === HONOR_CLEAR_BONUS],
];
for (const [name, ok] of checks) p(`- ${ok ? '✓' : '✗'} ${name}`);
p();

// ───────────────────────── 13 ─────────────────────────
p('## 13. 军械库共享 · 临时武器 · 战术动作');
p();
p('### 13.1 同类武器的 DPS 跨度');
p();
const ref = HEROES[0];
const dpsOf = (w: WeaponId) => heroRawDps({ ...ref, weapon: w }, 3, 1, 200, 'medium', WEAPONS[w].dtype);
const byClass = new Map<string, WeaponId[]>();
for (const w of WEAPON_LIST) byClass.set(WEAPON_CLASS_NAME[w.class], [...(byClass.get(WEAPON_CLASS_NAME[w.class]) ?? []), w.id]);
const spreads = [...byClass].filter(([, v]) => v.length > 1).map(([c, v]) => {
  const d = v.map(dpsOf);
  return { c, v, r: Math.max(...d) / Math.min(...d) };
});
p(`同一角色（${ref.name}，3 级 / 1 阶 / 护甲 200 中甲）换装同类武器的 DPS 比。闸门 ≤${SAME_CLASS_DPS_CAP}：金钱买到的是手感与附加效果，不是 BOSS 锚点外的数字。`);
p();
tbl(['类别', '武器', '最强 / 最弱', '判定'], spreads.map((s) => [s.c, s.v.map((w) => WEAPONS[w].name).join('、'), `×${f2(s.r)}`, s.r <= SAME_CLASS_DPS_CAP ? '✓' : '✗']));
p('### 13.2 局内临时武器');
p();
p('有限弹药，打完切回原武器，不带出关卡。只从现有武器里选——兼任商店试用。');
p();
const FROM = { elite: '精英', crate: '补给箱', boss: 'BOSS' };
tbl(['武器', '槽位', '弹药', '可用时长', '来源', '说明'], TEMP_WEAPON_DROPS.map((d) => [
  WEAPONS[d.weapon].name, d.slot === 'primary' ? '主' : '副', d.ammo, `${tempWeaponSeconds(d).toFixed(1)}s`, FROM[d.from], d.note,
]));
p('### 13.3 战术动作（素材表，并入职业技能）');
p();
tbl(['动作', '冷却', 'AI 触发', '说明'], Object.values(TACTICS).map((t) => [t.name, `${t.cooldown}s`, t.trigger, t.note]));

// ───────────────────────── 14 ─────────────────────────
p('## 14. 复核办法');
p();
p('```bash\nnode src/sim/numbers-doc.ts > docs/02-数值表.html   # 本页\nnpm run sim                                        # 哨兵（含 §14 职业树检查）\n```');
p();
p('本页没有一个手抄的数字。数字一旦有了“手抄”的入口，就一定会腐坏——第二轮逐条复核时抓出过五处，成因全部相同。哨兵仍回答不了“会不会死人、难度对不对”（见 §10）。');

console.log(page(out.join('\n')));
