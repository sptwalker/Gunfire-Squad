/**
 * 一级属性 → 二级派生属性。
 *
 * 全项目所有单位的数值都必须经过这里，禁止在别处硬编码血量/攻速/暴击。
 * 这样"调一次平衡"只需要改 K 里的系数，而不是满地图找魔法数字。
 */

export interface Primary {
  /** 力量：攻击力 */
  str: number;
  /** 敏捷：攻速、移速、暴击率 */
  agi: number;
  /** 韧性：生命值、护甲值 */
  tgh: number;
  /** 智力：能量上限、技能强度、冷却缩减 */
  int: number;
}

export interface Derived {
  /** 攻击力乘区（仅由力量决定，不含等级） */
  atkMul: number;
  /** 等级带来的最终伤害乘区。独立于 atkMul，保证"每级 +25%"是可读的实数 */
  levelDmgMul: number;
  /** 攻速乘区 */
  hasteMul: number;
  /** 移速乘区 */
  moveMul: number;
  /** 暴击率 0-1 */
  critRate: number;
  /** 暴击伤害倍率 */
  critDmg: number;
  maxHp: number;
  armor: number;
  /** 能量上限 */
  energy: number;
  /** 技能强度乘区 */
  skillPow: number;
  /** 冷却缩减 0-0.8 */
  cdr: number;
}

/** 全局换算系数。改这里 = 改整个游戏的属性手感。 */
export const K = {
  strAtk: 0.02, // 每点力量 +2% 攻击
  agiHaste: 0.01, // 每点敏捷 +1% 攻速
  agiMove: 0.008, // 每点敏捷 +0.8% 移速
  agiCrit: 0.004, // 每点敏捷 +0.4% 暴击率

  hpBase: 2000,
  hpPerTgh: 180,

  armorPerTgh: 2,
  armorK: 100, // 减伤 = armor/(armor+100)

  energyBase: 50,
  energyPerInt: 6,
  intSkill: 0.02, // 每点智力 +2% 技能强度
  intCdr: 0.005, // 每点智力 +0.5% 冷却缩减

  /** 每级 +8% 基础属性（作用于生命/护甲/能量等生存与资源维度） */
  levelGrowth: 0.08,
  /**
   * 每级 +25% 最终伤害，乘在伤害公式最后一级。
   *
   * 为什么不直接放大基础属性：atkMul = 1 + STR×0.02 带 +1 基数，
   * STR 从 34 涨到 45 时乘区只从 1.68 到 1.90（+13%），完全跟不上关卡缩放。
   * 拆成独立乘区后，"升一级 +25%" 玩家看得见也算得清。
   */
  levelDmgPerLevel: 0.25,
  maxLevel: 5,
} as const;

export const CRIT_DMG_BASE = 1.5;
const CDR_CAP = 0.8;

/**
 * @param level 关卡内等级 1-5，每级 +8% 全属性
 */
export function derive(p: Primary, level = 1): Derived {
  const g = 1 + K.levelGrowth * (level - 1);
  const str = p.str * g;
  const agi = p.agi * g;
  const tgh = p.tgh * g;
  const intel = p.int * g;

  return {
    // 伤害用【未缩放】的力量，等级收益走 levelDmgMul，避免双重计算
    atkMul: 1 + p.str * K.strAtk,
    levelDmgMul: 1 + K.levelDmgPerLevel * (level - 1),
    hasteMul: 1 + agi * K.agiHaste,
    moveMul: 1 + agi * K.agiMove,
    critRate: 0.05 + agi * K.agiCrit,
    critDmg: CRIT_DMG_BASE,
    maxHp: K.hpBase + tgh * K.hpPerTgh,
    armor: tgh * K.armorPerTgh,
    energy: K.energyBase + intel * K.energyPerInt,
    skillPow: 1 + intel * K.intSkill,
    cdr: Math.min(CDR_CAP, intel * K.intCdr),
  };
}

/** 属性预算校验用：一级属性总点数 */
export function pointBudget(p: Primary): number {
  return p.str + p.agi + p.tgh + p.int;
}
