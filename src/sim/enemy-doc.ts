/**
 * 敌对目标评审页生成器：node src/sim/enemy-doc.ts > docs/13-敌对目标评审.html
 * 数值全部来自 src/data（zombies / enemies / run）与原型技能参数（proto/m0/gamedata.js 的 T.ZB / T.BB），不手填。
 */

import { ZOMBIES, STAGE_HP_MUL, STAGE_DMG_MUL, type Zombie } from '../data/zombies.ts';
import { ELITES, ELITE_MUL, MUTANTS, BOSS_DESIGN, type Enemy } from '../data/enemies.ts';
import { BOSSES, BOSS_TIMEOUT } from '../data/run.ts';
import { DIMENSION_BY_ID, type DimensionId } from '../data/scenes.ts';
import { zombieEhp, zombieDps, controlResistance } from './combat.ts';
// @ts-expect-error 纯 JS 模块，无类型声明
import { T, ORDER_Z, BOSSES as PB } from '../../proto/m0/gamedata.js';
// @ts-expect-error 纯 JS 模块，无类型声明
import { page } from '../../tools/md2html.mjs';

const out: string[] = [];
const p = (s = '') => out.push(s);
const f = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const dims = (d: DimensionId[]) => d.map((k) => DIMENSION_BY_ID[k]?.name ?? k).join(' / ') || '—';
const res = (z: Zombie) => [z.resist.physRes && `物 ${pct(z.resist.physRes)}`, z.resist.magicRes && `法 ${pct(z.resist.magicRes)}`, z.resist.energyField && `电磁 ${pct(z.resist.energyField)}`].filter(Boolean).join(' ') || '—';
const params = (o: Record<string, unknown> | undefined) => o ? Object.entries(o).filter(([k]) => k !== 'desc').map(([k, v]) => `\`${k}\` ${v}`).join('，') || '—' : '—';
const ehp3 = (z: Zombie) => [1, 2, 3].map((s) => f(zombieEhp(z, s))).join(' / ');

const HEAD = '| 名称 | 生命 | 移速 | 护甲 | 抗性 | 攻击 / 间隔 | DPS(1段) | EHP 1/2/3 段 | 稳固 | 霸体 | 抗冻 | 狡诈 | 控抗 | 威胁 | 金钱 |';
const SEP = '|' + '---|'.repeat(15);
const row = (z: Zombie) => `| ${z.name} | ${f(z.hp)} | ${z.speed} | ${z.armor}（${z.armorType}） | ${res(z)} | ${z.atk} / ${z.atkInterval}s | ${f(zombieDps(z, 1), 1)} | ${ehp3(z)} | ${z.stab} | ${z.superArmor ? '是' : '—'} | ${pct(z.freezeRes)} | ${pct(z.cunning)} | ${f(controlResistance(z), 2)} | ${z.threat} | ${z.money} |`;
const design = (e: Pick<Enemy, 'idea' | 'look' | 'ai' | 'skills'>) => {
  p(`- **设计思路**：${e.idea}`);
  p(`- **外形描述**：${e.look}`);
  p(`- **AI 行为**：${e.ai}`);
  p('- **技能**：');
  for (const [n, d] of e.skills) p(`  - **${n}** — ${d}`);
};

p('# 13 敌对目标评审');
p();
p('> 本页由 `node src/sim/enemy-doc.ts` 生成，不要手改。改数值去 `src/data/zombies.ts` / `src/data/enemies.ts` / `src/data/run.ts`，改原型技能参数去 `proto/m0/gamedata.js` 的 `T.ZB` / `T.BB`，然后重新生成。');
p();
p(`共 ${ORDER_Z.length} 种僵尸、${Object.keys(ELITES).length} 种精英、${Object.keys(MUTANTS).length} 种变异生物、${BOSSES.length} 个 BOSS。模型在 \`proto/m0/assets/\`：僵尸 \`vox_z_*\`、精英 \`vox_e_*\`、变异生物 \`vox_m_*\`、BOSS \`vox_b_*\`；展示页 \`proto/m0/zombies.html\`。`);
p();
p(`EHP = 生命 × 阶段血量倍率（${STAGE_HP_MUL.join(' / ')}）；DPS = 攻击 × 阶段伤害倍率（${STAGE_DMG_MUL.join(' / ')}）÷ 攻击间隔。控抗 = （霸体 + 稳固归一 + 抗冻 + 狡诈）÷ 4，见 \`combat.ts controlResistance\`。`);
p();

// ── 僵尸 ──
p('## 一、僵尸');
p();
p(HEAD); p(SEP);
for (const id of ORDER_Z as (keyof typeof ZOMBIES)[]) p(row(ZOMBIES[id]));
p();
for (const id of ORDER_Z as (keyof typeof ZOMBIES)[]) {
  const z = ZOMBIES[id];
  p(`### ${z.name}（\`${id}\`）`);
  p();
  p(`- **定位**：${z.tag}`);
  p(`- **挑战维度**：${dims(z.dims)}；行为标签 \`${z.behavior}\`；击退 ${z.knock}（${z.knockKind}）`);
  p(`- **机制**：${z.special}`);
  if (T.ZB[id]) p(`- **原型参数**：${T.ZB[id].desc ?? ''}（${params(T.ZB[id])}）`);
  p(`- **模型**：\`vox_z_${id === 'spawnling' ? 'splitter（× 0.4）' : id}\``);
  p();
}

// ── 精英 ──
p('## 二、精英僵尸');
p();
p('精英 = 基础种 × 统一倍率 + 一条放大基础种行为的专属能力；AI 统一多一层"优先后排 / 残血"。分裂小僵尸不单独出精英。');
p();
p('| 倍率 | 生命 | 攻击 | 护甲 | 移速 | 稳固 | 抗冻 | 狡诈 | 威胁 | 奖励 | 体型 |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
const M = ELITE_MUL;
p(`| 值 | ×${M.hp} | ×${M.atk} | ×${M.armor} | ×${M.speed} | +${M.stab} | +${M.freezeRes} | +${M.cunning} | ×${M.threat} | ×${M.reward} | ×${M.scale} |`);
p();
p(HEAD); p(SEP);
for (const e of Object.values(ELITES)) p(row(e as unknown as Zombie));
p();
for (const e of Object.values(ELITES)) {
  const z = ZOMBIES[e.base!];
  p(`### ${e.name}（\`${e.id}\`，基础：${z.name}）`);
  p();
  p(`- **数值对比**：生命 ${f(z.hp)} → ${f(e.hp)}，攻击 ${z.atk} → ${e.atk}，护甲 ${z.armor} → ${e.armor}，移速 ${z.speed} → ${e.speed}，控抗 ${f(controlResistance(z), 2)} → ${f(controlResistance(e as unknown as Zombie), 2)}`);
  design(e);
  p(`- **技能参数**：${params(e.p)}`);
  p(`- **模型**：\`vox_${e.id}\``);
  p();
}

// ── 变异生物 ──
p('## 三、变异生物');
p();
p('病毒感染的野兽。和僵尸的区别是快、成群、会配合——僵尸是一个个单独的问题，变异生物是一组协同的问题。');
p();
p(HEAD); p(SEP);
for (const m of Object.values(MUTANTS)) p(row(m as unknown as Zombie));
p();
for (const m of Object.values(MUTANTS)) {
  p(`### ${m.name}（\`${m.id}\`）`);
  p();
  p(`- **定位**：${m.tag}`);
  p(`- **挑战维度**：${dims(m.dims)}；行为标签 \`${m.behavior}\`；击退 ${m.knock}（${m.knockKind}）`);
  p(`- **机制**：${m.special}`);
  design(m);
  p(`- **技能参数**：${params(m.p)}`);
  p(`- **模型**：\`vox_m_${m.id}\``);
  p();
}

// ── BOSS ──
p('## 四、BOSS');
p();
p(`每个阶段末一个 BOSS；超时 ${BOSS_TIMEOUT} 秒判负。`);
p();
p('| 阶段 | 名称 | 出场（秒） | 生命 | 护甲 | 移速 | 攻击 | 半径 | 目标击杀时间 |');
p('|---|---|---|---|---|---|---|---|---|');
for (const b of BOSSES) p(`| ${b.stage} | ${b.name} | ${b.at} | ${f(b.hp)} | ${b.armor} | ${b.speed} | ${b.atk} | ${b.radius} | ${b.targetKillTime}s |`);
p();
BOSSES.forEach((b, i) => {
  const file = PB[i]?.file;
  p(`### 第 ${b.stage} 段：${b.name}`);
  p();
  p(`- **数值**：生命 ${f(b.hp)}，护甲 ${b.armor}，移速 ${b.speed}，攻击 ${b.atk}，半径 ${b.radius}；第 ${b.at} 秒出场，目标 ${b.targetKillTime} 秒内击杀`);
  p(`- **设计备注**：${b.note}`);
  if (BOSS_DESIGN[i]) design(BOSS_DESIGN[i]);
  if (file) p(`- **原型参数**：${T.BB[file]?.desc ?? ''}（${params(T.BB[file])}）`);
  p(`- **模型**：\`vox_b_${file ?? '?'}\``);
  p();
});

console.log(page(out.join('\n')));
