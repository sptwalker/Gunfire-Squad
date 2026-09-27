/**
 * 战斗数学：纯函数，无状态。
 * 模拟器、游戏运行时、文档里的手算演示，全部调用这里，保证三处数字一致。
 */

import { derive, type Derived } from '../data/attributes.ts';
import { ARMOR_MATRIX, armorRetention, expectedDamage, type ArmorType, type DamageType } from '../data/damage.ts';
import { tierBonus, WEAPONS, type WeaponId } from '../data/weapons.ts';
import { skillAvgMul, type Hero } from '../data/characters.ts';
import type { Zombie } from '../data/zombies.ts';
import { stageMods } from '../data/zombies.ts';

/**
 * AI 效率系数：队员不是完美输出机器。
 * 走位、切换目标、技能前摇、被击退都会损失输出。
 * 0.75 是这类自动战斗游戏的常见实测值，配平必须考虑它，
 * 否则纸面 DPS 达标、实战打不动 BOSS。
 */
export const AI_EFFICIENCY = 0.75;

/**
 * 单个角色对单一目标的期望 DPS（含 AI 效率，不含 AOE 收益）。
 *
 * 四个乘区依次是：
 *   1. 期望单发伤害 —— expectedDamage 内部已按暴击率折算过暴击，此处不重复乘
 *   2. 攻击频率 —— 1 / 攻击间隔
 *   3. 换弹惩罚 —— 弹匣打空期间没有输出，把换弹时间摊掉；近战无弹匣则为 1
 *   4. 等级伤害乘区 × 技能等效乘区 —— 这两个是关卡内成长的主要来源
 */
export function heroRawDps(
  hero: Hero,
  level: number,
  tier: 0 | 1 | 2,
  targetArmor: number,
  targetArmorType: ArmorType,
  dtype: DamageType,
): number {
  const w = WEAPONS[hero.weapon];
  const d = derive(hero.primary, level);
  const tb = tierBonus(tier);

  const perHit = expectedDamage({
    base: w.base * tb.dmg,
    dtype,
    armor: targetArmor,
    armorType: targetArmorType,
    pierce: w.pierce * tb.pierce,
    atkMul: d.atkMul * d.levelDmgMul * skillAvgMul(hero),
    critRate: d.critRate + w.critBonus,
    critDmg: d.critDmg,
  });

  // 攻速乘区（敏捷）必须作用在【频率】上，不能乘进单发伤害——
  // 否则换弹惩罚会按错误的弹匣周期计算。
  const attackRate = w.rate * d.hasteMul;
  const cycle = 1 / attackRate;
  const reloadPenalty =
    w.magazine > 0 ? (w.magazine * cycle) / (w.magazine * cycle + w.reload) : 1;

  return perHit * attackRate * reloadPenalty * AI_EFFICIENCY;
}

/**
 * 实战期望 DPS。
 * AOE 武器的收益体现在【同时命中几个目标】上：命中数越多，总输出越高，
 * 但不会超过武器自身的 hitsPerAttack 上限。
 * @param targets 当前可同时命中的敌人数
 */
export function heroEffectiveDps(
  hero: Hero,
  level: number,
  tier: 0 | 1 | 2,
  targetArmor: number,
  targetArmorType: ArmorType,
  dtype: DamageType,
  targets = 1,
): number {
  const w = WEAPONS[hero.weapon];
  const single = heroRawDps(hero, level, tier, targetArmor, targetArmorType, dtype);
  // 单体武器 targets 再大也只有 1 倍收益
  const hitMul = w.hitsPerAttack === 1 ? 1 : Math.min(targets, w.hitsPerAttack) / 1;
  return single * (w.hitsPerAttack === 1 ? 1 : hitMul);
}

export function squadDps(
  heroes: Hero[],
  level: number,
  tiers: Partial<Record<WeaponId, 0 | 1 | 2>>,
  targetArmor: number,
  targetArmorType: ArmorType,
  targets = 1,
): { total: number; per: { hero: Hero; dps: number }[] } {
  const per = heroes.map((h) => ({
    hero: h,
    dps: heroEffectiveDps(
      h,
      level,
      tiers[h.weapon] ?? 0,
      targetArmor,
      targetArmorType,
      WEAPONS[h.weapon].dtype,
      targets,
    ),
  }));
  return { total: per.reduce((s, x) => s + x.dps, 0), per };
}

/** 僵尸在某阶段的等效生命（含阶段血量倍率） */
export function zombieEhp(z: Zombie, stage: number): number {
  return z.hp * stageMods(stage).hp;
}

/**
 * 穿透折算后的护甲减伤保留比例 0-1。
 * 直接复用 `damage.ts` 的实现——这里曾经复制了一份，把 `PIERCE_K` 写成字面量 60，
 * 于是改 `PIERCE_K` 时两边会静默分叉，而对账测试（1e-6 容差）正是用来抓这种分叉的。
 * 不要在 sim 里重算公式，只允许调用。
 */
export function retention(rawArmor: number, pierce: number): number {
  return armorRetention(rawArmor, pierce);
}

/**
 * 击杀单个僵尸所需时间（TTK）。
 * 用来判断"这群怪是不是清得动"——TTK 超过僵尸走到脸上的时间，就是防线告急。
 */
export function ttk(
  dps: number,
  z: Zombie,
  stage: number,
  pierce: number,
  dtype: DamageType,
): number {
  const effectiveDps =
    dps * retention(z.armor, pierce) * ARMOR_MATRIX[dtype][z.armorType];
  return effectiveDps <= 0 ? Infinity : zombieEhp(z, stage) / effectiveDps;
}

/** 角色有效生命：把护甲减免折算成"能扛多少点原始伤害" */
export function heroEhp(d: Derived): number {
  return d.maxHp * (1 + d.armor / 100);
}

/** 单只僵尸的接触 DPS（按攻击间隔折算，含阶段伤害倍率） */
export function zombieDps(z: Zombie, stage: number): number {
  return (z.atk * stageMods(stage).dmg) / z.atkInterval;
}

/** 队伍总有效生命，用于判断尸潮能否扛住 */
export function squadEhp(heroes: Hero[], level: number): number {
  return heroes.reduce((s, h) => s + heroEhp(derive(h.primary, level)), 0);
}
