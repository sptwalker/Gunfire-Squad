/**
 * `docs/03-计算演示.html` 的复算脚本。
 *
 * 跑法：node src/sim/_calc03.ts
 * 它把薇拉对卡俄斯的六步链逐段打印出来，**全部走真实实现**（derive / expectedDamage /
 * heroRawDps），不是手抄的常量。文档里每个数字都应该能在输出里找到。
 *
 * 改公式之后先跑这个，再改文档——反过来就会写出"文档说 1.68、代码给 1.66"的漂移。
 */
import { derive, K } from '../data/attributes.ts';
import { HEROES } from '../data/characters.ts';
import { WEAPONS, tierBonus } from '../data/weapons.ts';
import { armorRetention, expectedDamage, PIERCE_K } from '../data/damage.ts';
import { AI_EFFICIENCY, heroRawDps } from './combat.ts';

const LEVEL = 5;
const TIER = 2 as const;
const BOSS_ARMOR = 480;
const BOSS_HP = 94_000;

const vera = HEROES.find((h) => h.id === 'vera');
if (!vera) throw new Error('薇拉不见了——characters.ts 里 id 改了？');

const w = WEAPONS[vera.weapon];
const tb = tierBonus(TIER);
const g = 1 + K.levelGrowth * (LEVEL - 1);
const d = derive(vera.primary, LEVEL);
const pierce = w.pierce * tb.pierce;

const line = (s = '') => console.log(s);

line('── 1. 一级属性 → 派生 ──────────────────────────────');
const sum = Object.values(vera.primary).reduce((a, b) => a + b, 0);
line(`一级属性 ${JSON.stringify(vera.primary)}   合计 ${sum}`);
if (sum !== 150) throw new Error(`预算约束破了：合计 ${sum}，应为 150`);
line(`g = ${g}`);
line(`atkMul ${d.atkMul.toFixed(3)}   levelDmgMul ${d.levelDmgMul.toFixed(2)}`);
line(`hasteMul ${d.hasteMul.toFixed(4)}   critRate ${d.critRate.toFixed(5)}`);
line(`（不在本链上）antiCrit ${d.antiCrit.toFixed(4)}  stab ${d.stab.toFixed(2)}  ` +
  `lootTier ${d.lootTier.toFixed(3)}  knockRanged ${d.knockRanged.toFixed(4)}`);

line('\n── 2. 武器与阶 ─────────────────────────────────────');
line(`单发基础 ${w.base} × ${tb.dmg} = ${(w.base * tb.dmg).toFixed(1)}`);
line(`穿透 ${w.pierce} × ${tb.pierce} = ${pierce.toFixed(1)}`);

line('\n── 3. 穿透 → 有效护甲 ──────────────────────────────');
line(`PIERCE_K = ${PIERCE_K}`);
for (const p of [0, 60, pierce]) {
  line(`  穿透 ${String(p).padStart(5)} → 有效护甲 ${(BOSS_ARMOR * (1 - p / (p + PIERCE_K))).toFixed(1)}` +
    `  保留 ${armorRetention(BOSS_ARMOR, p).toFixed(4)}` +
    `  相对收益 ${(armorRetention(BOSS_ARMOR, p) / armorRetention(BOSS_ARMOR, 0)).toFixed(2)}x`);
}

line('\n── 4. 单发期望伤害 ─────────────────────────────────');
const critExpect = 1 + (d.critRate + w.critBonus) * (d.critDmg - 1);
const skillAvg = 1 + (vera.skill.duration / vera.skill.cooldown) * (vera.skill.mul - 1);
line(`暴击期望 1 + (${d.critRate.toFixed(5)} + ${w.critBonus}) × ${d.critDmg - 1} = ${critExpect.toFixed(4)}`);
line(`技能乘区（期望折算）1 + (${vera.skill.duration}/${vera.skill.cooldown}) × ${vera.skill.mul - 1} = ${skillAvg.toFixed(4)}`);

const perHit = (skillMul: number) =>
  expectedDamage({
    base: w.base * tb.dmg, dtype: w.dtype, armor: BOSS_ARMOR, armorType: 'heavy',
    pierce, atkMul: d.atkMul * d.levelDmgMul * skillMul,
    critRate: d.critRate + w.critBonus, critDmg: d.critDmg, targetAntiCrit: 0,
  });
line(`无技能窗口 ${perHit(1).toFixed(1)}   含技能折算 ${perHit(skillAvg).toFixed(1)}`);

line('\n── 5. 攻速与换弹惩罚 ───────────────────────────────');
const rate = w.rate * d.hasteMul;
const cycle = 1 / rate;
const magCycle = w.magazine * cycle;
const reloadPenalty = magCycle / (magCycle + w.reload);
line(`频率 ${w.rate} × ${d.hasteMul.toFixed(4)} = ${rate.toFixed(5)}/s   周期 ${cycle.toFixed(4)}s`);
line(`弹匣周期 ${magCycle.toFixed(4)}s   换弹惩罚 ${reloadPenalty.toFixed(4)}`);

line('\n── 6. 单目标 DPS ───────────────────────────────────');
const dps = heroRawDps(vera, LEVEL, TIER, BOSS_ARMOR, 'heavy', w.dtype, 0);
line(`DPS = ${perHit(skillAvg).toFixed(1)} × ${rate.toFixed(5)} × ${reloadPenalty.toFixed(4)} × ${AI_EFFICIENCY} = ${dps.toFixed(1)}`);
line(`单人打穿卡俄斯 ${(BOSS_HP / dps).toFixed(1)}s   vs 目标 60s`);

line('\n── 7. 反向验证（数据源：npm run sim 的 §4） ────────');
line('阶段  等级  阶   解析式DPS   实测DPS   目标   实测秒数');
line('1     3     1    1,022       1,565    30s    31.0s');
line('2     4     1    1,309       1,528    45s    45.8s');
line('3     5     2    1,542       1,836    60s    51.2s');
line('（这张表由 balance-check.ts 的 §4 打印，这里只做对照——改公式后两边都要更新）');
