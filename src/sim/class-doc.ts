/**
 * 职业树文档生成器：node src/sim/class-doc.ts > docs/10-职业树.md
 * 文档里的每个表都从 src/data/classes.ts 推导，不手填。
 */

import { CLASS_BY_ID, CLASS_TREES, SKILL_SLOTS, axisAt, expandTree, type AxisSide, type ClassDef, type SkillDef } from '../data/classes.ts';
import { PRIMARY_KEYS, PRIMARY_LABEL } from '../data/attributes.ts';
import { ADVANCE_RANKS, RANKS } from '../data/progression.ts';
import { WEAPON_CLASS_NAME } from '../data/weapons.ts';
import { ANSWER_DIMS, DIMENSION_BY_ID } from '../data/scenes.ts';

const out: string[] = [];
const p = (s = '') => out.push(s);
const rk = (lv: number) => `${RANKS[lv - 1].code} ${RANKS[lv - 1].name}`;
const TIER = ['入门', '基础职业', '基础职业方向', '特色职业分线', '职业流派', '职业专精', '英雄角色', '五星'];
const STAGE = ['新兵', '士官', '中级士官', '准尉', '尉官', '校官', '将官', '五星上将'];
const attr = (s: AxisSide) => Object.entries(s.attr).map(([k, v]) => `${PRIMARY_LABEL[k as keyof typeof PRIMARY_LABEL]}${v! > 0 ? '+' : ''}${v}`).join(' ');
const wpn = (s: AxisSide) => s.weapons?.map((w) => WEAPON_CLASS_NAME[w]).join(' / ') ?? '—';
const sk = ([n, x, g]: SkillDef) => `**${n}** — ${x}（${g.join(' + ')}）`;

for (const tree of Object.values(CLASS_TREES)) {
  const t = tree!;
  const cs = expandTree(t);
  const T = (k: number) => cs.filter((c) => c.tier === k);

  p(`# 职业树：${t.name}（第三轮 P2 样板 · 第二版）`);
  p();
  p('> 由 `node src/sim/class-doc.ts` 从 `src/data/classes.ts` 生成，**不要手改**。');
  p('> 技能只写行为，倍率 / 冷却 / 数值在 P4 技能表定（走模拟器）。');
  p();

  p('## 1. 规则');
  p();
  p('- 第 k 次转职 = 二选一。第 1 转选**基础职业**（锋/盾），第 2 转选**基础职业方向**（轻/重），全树共用，共 4 个方向；第 3 转每个方向有自己的两条**特色职业分线**，每条分线是一种独有机制（分身、巨人化、虚化……）；第 4 转是分线内的两个**职业流派**；第 5 转**职业专精**（光环取向）、第 6 转**英雄角色**（号令取向）全树共用，但具体技能由分线决定。例：基础职业选剑士，练双剑方向，影剑士线转刺客流，学追魂专精，最后出刹那。');
  p(`- 每树 ${cs.length} 个职业：` + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => T(k).length).join(' + ') + '。英雄角色 64 个有手写英雄名，五星一对一升级，换称号、留名字，五星特性每位英雄单独设计。');
  p('- 武器类别只增不减；属性每条边增减和为 0，所以每个职业都是 150 点。');
  p(`- 军衔成长率：${t.axes[0].sides.map((s, i) => `${s.name}支 ${(t.growth[i] * 100).toFixed(0)}%/级`).join('，')}。`);
  p();
  p('### 1.1 技能越往上越团队化（替换制）');
  p();
  p('| 阶段 | 解锁军衔 | 转职 | 选什么 | 技能槽变化 | 作用范围 | 身上技能数 |');
  p('|---|---|---|---|---|---|---|');
  const pick = ['—', '锋 / 盾', '轻 / 重', '本方向的两条分线', '本分线的两个流派', '光环 进取 / 守护', '号令 授 / 令', '—'];
  for (let k = 0; k <= 7; k++) {
    const lv = k === 0 ? 1 : ADVANCE_RANKS[k - 1];
    const ch = SKILL_SLOTS.flatMap((s) => (s.opens === k ? [[`开 ${s.id}`, s.scope]] : s.upgrades.includes(k) ? [[`升 ${s.id}`, k === 7 ? '号令强化（每位英雄单独设计）' : s.scope]] : []));
    p(`| ${STAGE[k]} | ${rk(lv)} | ${TIER[k]} | ${pick[k]} | ${ch.map((c) => c[0]).join('、') || '—'} | ${ch.map((c) => c[1]).join('、') || '—'} | ${SKILL_SLOTS.filter((s) => s.opens <= k).length} |`);
  }
  p();

  p('## 2. 总览');
  p();
  p('### 2.1 共用轴（第 1、2、5、6 转）');
  p();
  p('| 转 | 军衔 | 轴 | 边 | 新增武器 | 属性 | 定位 |');
  p('|---|---|---|---|---|---|---|');
  t.axes.forEach((a, i) => {
    const k = i < 2 ? i : i + 2;
    a.sides.forEach((s, j) => p(`| ${j ? '' : k + 1} | ${j ? '' : RANKS[ADVANCE_RANKS[k] - 1].code} | ${j ? '' : a.name} | **${s.name}** | ${wpn(s)} | ${attr(s)} | ${s.note} |`));
  });
  p();
  p('### 2.2 八条特色职业分线（第 3 转）');
  p();
  p('| 基础职业方向 | 特色职业分线 | 机制家族 | 新增武器 | 属性 | 玩起来像什么 |');
  p('|---|---|---|---|---|---|');
  t.styles.forEach((pair, i) => pair.forEach((a, j) =>
    p(`| ${j ? '' : t.names.core[i]} | **${a.title}** | ${a.family} | ${wpn(a)} | ${attr(a)} | ${a.note} |`)));
  p();
  p('### 2.3 A 槽：自身技（第 1 转开，第 2 转升）');
  p();
  for (const [k, s] of Object.entries(t.skillA)) p(`- \`${k}\` ${k.length === 1 ? t.names.t1[+k] : t.names.core[parseInt(k, 2)]}：${sk(s)}`);
  p();

  p('## 3. 特色职业分线详解');
  p();
  p('每条分线一条完整成长链：B 分线技（特色职业分线）→ B+ 职业流派 → C 光环（职业专精）→ D 号令（英雄角色） → 五星特性（每位英雄在自己的号令上单独强化，64 个各不相同）。');
  p();
  t.styles.forEach((pair, i) => pair.forEach((a, j) => {
    const pre = [Math.floor(i / 2), i % 2, j];
    p(`### 3.${i * 2 + j + 1} ${a.title}（${t.names.core[i]} · ${a.family}）`);
    p();
    p(`> ${a.note}`);
    p();
    p(`- **B 特色职业分线** ${sk(a.skill)}`);
    a.variants.forEach((v) => p(`- **B+ 职业流派 · ${v.title}**（${v.note}；${attr(v)}${v.weapons ? '；+' + wpn(v) : ''}）${sk(v.skill)}`));
    a.aura.forEach((s, k) => p(`- **C 职业专精 · ${t.axes[2].sides[k].name}光环** ${sk(s)}`));
    a.order.forEach((s, k) => p(`- **D 英雄角色 · ${t.axes[3].sides[k].name}号令** ${sk(s)}`));
    p();
    p('| 英雄角色 | 五星 | 路径 | 武器 | 力/敏/韧/智/幸/体 | B · C · D | 五星特性（号令强化） | 答案标签 |');
    p('|---|---|---|---|---|---|---|---|');
    for (const c of T(6).filter((c) => pre.every((b, k) => c.path[k] === b))) {
      const u = CLASS_BY_ID[c.id + '+'];
      const path = c.path.slice(3).map((b, k) => axisAt(t, c.path, k + 3).sides[b].name).join(' · ');
      p(`| **${c.name}** | ${u.name} | ${path} | ${c.weaponClasses.map((w) => WEAPON_CLASS_NAME[w]).join('/')} | ${PRIMARY_KEYS.map((k) => c.primary[k]).join('/')} | ` +
        c.slots.slice(1).map((s) => s.name).join(' · ') + ` | **${u.slots[3].name}**：${u.slots[3].text} | ${u.tags.join(' ')} |`);
    }
    p();
  }));

  p('## 4. 职业清单（第 0–5 转）');
  p();
  const row = (c: ClassDef) =>
    `| ${c.name} | ${c.path.map((b, k) => axisAt(t, c.path, k).sides[b].name).join('·') || '—'} | ${c.weaponClasses.map((w) => WEAPON_CLASS_NAME[w]).join(' / ')} | ` +
    PRIMARY_KEYS.map((k) => c.primary[k]).join('/') + ' | ' + c.slots.map((s) => `${s.slot}${s.level} ${s.name}`).join('<br>') + ` | ${c.tags.join(' ')} |`;
  for (let k = 0; k <= 5; k++) {
    p(`### 4.${k + 1} ${TIER[k]}（${STAGE[k]}，${rk(k === 0 ? 1 : ADVANCE_RANKS[k - 1])}，${T(k).length} 个）`);
    p();
    p('| 职业 | 路径 | 武器 | 力/敏/韧/智/幸/体 | 技能 | 答案标签 |\n|---|---|---|---|---|---|');
    for (const c of T(k)) p(row(c));
    p();
  }

  p('## 5. 覆盖与自查');
  p();
  const first = new Map<string, number>();
  for (const c of cs) for (const g of c.tags) first.set(g, Math.min(first.get(g) ?? 99, c.rank));
  p('| 答案标签 | 本树最早军衔 | 应对维度 |');
  p('|---|---|---|');
  for (const g of Object.keys(ANSWER_DIMS) as (keyof typeof ANSWER_DIMS)[]) {
    p(`| ${g} | ${first.has(g) ? rk(first.get(g)!) : '**本树没有**'} | ${ANSWER_DIMS[g].map((d) => DIMENSION_BY_ID[d].name).join('、')} |`);
  }
  p();
  const keys = new Set(cs.flatMap((c) => c.slots.map((s) => s.skill)));
  p(`- 本树技能条目：${keys.size} 个（P4 按这些 key 落数值）。`);
  p('- 191 个职业、名字不重复、属性 150、成长率在区间内、技能数按阶、兄弟职业技能不同、8 条分线机制家族不同、五星一对一且五星特性各不相同——由 `npm run sim` §14 守。');
  p();
}

console.log(out.join('\n'));
