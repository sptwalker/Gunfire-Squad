/**
 * 伤害结算。纯函数，无副作用，模拟器与游戏共用。
 */

import type { Derived } from './attributes.ts';

export type DamageType =
  | 'impact'
  | 'slash'
  | 'pierce'
  | 'fire'
  | 'frost'
  | 'explosive'
  | 'poison';

export type ArmorType = 'none' | 'light' | 'medium' | 'heavy';

/**
 * 伤害类型 × 护甲类型 克制表。1.0 = 中性。
 *
 * 设计意图：
 *  - 斩击 克 轻甲（切脆皮），被 重甲 克
 *  - 穿刺 / 爆炸 克 重甲（这是穿透系武器存在的意义）
 *  - 火焰 克 重甲（烧穿板甲），被 轻甲 部分规避
 * 没有任何一格是 0，避免出现"这把武器对这个敌人完全无效"的死局。
 */
export const ARMOR_MATRIX: Record<DamageType, Record<ArmorType, number>> = {
  impact: { none: 1.0, light: 1.1, medium: 1.0, heavy: 0.85 },
  slash: { none: 1.0, light: 1.15, medium: 0.95, heavy: 0.8 },
  pierce: { none: 1.0, light: 1.0, medium: 1.1, heavy: 1.05 },
  fire: { none: 1.0, light: 0.95, medium: 1.0, heavy: 1.15 },
  frost: { none: 1.0, light: 1.0, medium: 1.0, heavy: 1.0 },
  explosive: { none: 1.0, light: 0.9, medium: 1.1, heavy: 1.2 },
  poison: { none: 1.0, light: 1.05, medium: 0.95, heavy: 0.9 },
};

/** 穿透曲线常数：穿透值达到该数时，有效护甲减半 */
export const PIERCE_K = 60;

/**
 * 穿透的作用是【削弱目标护甲】，不是【自己再乘一个减伤】。
 * 有效护甲 = 护甲 × (1 - pierce/(pierce+60))
 */
export function effectiveArmor(rawArmor: number, pierce: number): number {
  return Math.max(0, rawArmor * (1 - pierce / (pierce + PIERCE_K)));
}

/** 护甲值减伤后的伤害保留比例 0-1 */
export function armorRetention(rawArmor: number, pierce: number): number {
  const eff = effectiveArmor(rawArmor, pierce);
  return 1 - eff / (eff + 100);
}

export interface DamageInput {
  /** 武器单次基础伤害 */
  base: number;
  dtype: DamageType;
  /** 目标护甲值 */
  armor: number;
  /** 目标护甲类型 */
  armorType: ArmorType;
  /** 攻击方穿透 */
  pierce: number;
  /** 攻击方攻击力乘区 */
  atkMul: number;
  crit: boolean;
  critDmg: number;
  /** 技能倍率，普攻为 1 */
  skillMul?: number;
  /**
   * 目标抗暴击 0-1。**只在 `expectedDamage` 里生效，`computeDamage` 不看它**——
   * 抗暴击是"降低暴击发生的概率"，而 `computeDamage` 拿到的已经是"这一下暴没暴"的既成事实。
   * 放进 `DamageInput` 而不是 `expectedDamage` 的私有参数，是为了让调用方
   * 在构造输入时就必须提供它（漏了会被编译器抓住），不提供时默认 0。
   */
  targetAntiCrit?: number;
}

/** 最终伤害 = 基础 × 攻击乘区 × 暴击 × 护甲减免 × 甲型克制 × 技能倍率 */
export function computeDamage(d: DamageInput): number {
  const critMul = d.crit ? d.critDmg : 1;
  return (
    d.base *
    d.atkMul *
    critMul *
    armorRetention(d.armor, d.pierce) *
    ARMOR_MATRIX[d.dtype][d.armorType] *
    (d.skillMul ?? 1)
  );
}

/**
 * 期望伤害（把暴击按概率折算），用于配平计算，不用于实际结算。
 *
 * 抗暴击在这里**直接扣暴击率**，而不是在伤害上乘一个减伤——
 * 前者让"抗暴击"与"暴击率"共用一把尺子（都在 0-1 上加减），
 * 后者会引入第三个乘区，而伤害乘区已经够多了（`04-技术框架.md` §4 的
 * `SpecEffect` 明确禁止新增伤害乘区，这里是同一原则在数据层的体现）。
 *
 * 扣完取 `max(0, ...)`：抗暴击高于攻方暴击率时归零，不倒扣成负暴击。
 */
export function expectedDamage(d: Omit<DamageInput, 'crit'> & { critRate: number }): number {
  const critRate = Math.max(0, d.critRate - (d.targetAntiCrit ?? 0));
  const critMul = 1 + critRate * (d.critDmg - 1);
  return computeDamage({ ...d, crit: false }) * critMul;
}
