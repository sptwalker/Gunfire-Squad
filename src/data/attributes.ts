/**
 * 一级属性 → 二级派生属性。
 *
 * 全项目所有单位的数值都必须经过这里，禁止在别处硬编码血量/攻速/暴击。
 * 这样"调一次平衡"只需要改 K 里的系数，而不是满地图找魔法数字。
 *
 * 六属性的分工边界（第二轮定的，改之前先读这一段）：
 *   - 每个属性只管自己那一列，不许跨列。旧版"敏捷给暴击""韧性给血"就是跨列的典型，
 *     结果是堆敏捷的角色同时拿到攻速和暴击，堆韧性的角色同时拿到血和甲——
 *     两个属性各顶两条线，另外两个属性没有独立理由被堆。
 *   - 攻击侧：力量 → 近战伤害与近战击退，敏捷 → 攻速与远程击退，幸运 → 暴击与掉落。
 *   - 生存侧：体质 → 血，韧性 → 甲 + 抗暴击 + 稳固。
 *   四条攻击线、三条生存线互不重叠，所以"这角色该堆什么"有唯一答案。
 */

export interface Primary {
  /** 力量：攻击力乘区、近战击退力 */
  str: number;
  /** 敏捷：攻速、移速、远程击退力 */
  agi: number;
  /** 韧性：护甲、抗暴击、稳固（抗位移的守方值） */
  tgh: number;
  /** 智力：能量上限、技能强度、冷却缩减 */
  int: number;
  /** 幸运：暴击率、高级道具掉落概率 */
  luk: number;
  /** 体质：生命上限 */
  con: number;
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
  /**
   * 魔抗（意志）：法术伤害的减免比例，同时降低恐惧与混乱的概率与时长。
   *
   * 与僵尸侧的 `Resistances.magicRes` 同语义、同量纲——同一个属性，两边各有一份。
   * 上限见 `MAGIC_RES_CAP`，理由与 `ANTI_CRIT_CAP` 完全相同：留一半地板。
   */
  magicRes: number;
  /** 能量上限 */
  energy: number;
  /** 技能强度乘区 */
  skillPow: number;
  /** 冷却缩减 0-0.8 */
  cdr: number;

  // ── 以下五个是第二轮新增，进的是【控制对抗】与【掉落】两个新系统 ──
  /** 抗暴击：从对方的暴击率里直接扣掉，上限 ANTI_CRIT_CAP */
  antiCrit: number;
  /** 稳固：守方值。对方击退力 / 自己的稳固 决定自己被推开的概率 */
  stab: number;
  /** 近战击退力乘区（力量驱动），乘在武器的 knockback 上 */
  knockMelee: number;
  /** 远程击退力乘区（敏捷驱动） */
  knockRanged: number;
  /** 高级道具掉落的额外权重加成，0.2 = 高级池权重 ×1.2 */
  lootTier: number;
}

/** 全局换算系数。改这里 = 改整个游戏的属性手感。 */
export const K = {
  strAtk: 0.02, // 每点力量 +2% 攻击
  agiHaste: 0.01, // 每点敏捷 +1% 攻速
  agiMove: 0.008, // 每点敏捷 +0.8% 移速
  luckCrit: 0.004, // 每点幸运 +0.4% 暴击率（从敏捷迁过来的，数值刻意不变）
  luckLoot: 0.006, // 每点幸运 +0.6% 高级掉落权重

  hpBase: 2000,
  hpPerCon: 180, // 从韧性迁过来的，数值刻意不变

  armorPerTgh: 2,
  armorK: 100, // 减伤 = armor/(armor+100)

  tghAntiCrit: 0.003, // 每点（已缩放的）韧性 +0.3% 抗暴击
  tghStab: 1.0, // 稳固 = 韧性 × 这个数，量纲与武器 knockback 对齐

  strKnock: 0.012, // 每点（已缩放的）力量近战击退 +1.2%
  agiKnock: 0.012, // 每点（已缩放的）敏捷远程击退 +1.2%

  energyBase: 50,
  energyPerInt: 6,
  intSkill: 0.02, // 每点智力 +2% 技能强度
  intCdr: 0.005, // 每点智力 +0.5% 冷却缩减
  intMagicRes: 0.003, // 每点（已缩放的）智力 +0.3% 魔抗与意志，上限见 MAGIC_RES_CAP

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
 * 抗暴击的硬上限。
 *
 * **不能到 1.0**：一旦有角色能抗掉全部暴击，暴击这条成长轴就对他完全作废，
 * 而暴击是幸运属性唯一的存在理由。0.5 的意思是"堆韧性能砍掉一半暴击收益，
 * 但永远砍不干净"——留一半地板，幸运流才有活路。
 *
 * 与"减速不设对抗属性"是同一条设计原则：控制与反制体系必须每层都留地板。
 */
export const ANTI_CRIT_CAP = 0.5;

/**
 * 魔抗（意志）的硬上限。
 *
 * 与 `ANTI_CRIT_CAP` 同一条理由：法术是三个伤害系别之一，一旦有人能把它减到 0，
 * 全法术阵容对他就彻底作废了。0.5 = "堆智力砍得掉一半法术，砍不干净"。
 *
 * 恐惧与混乱的抵抗共用这个值，所以这条地板同时守住了精神维度的下限——
 * 宁神（K17）永远是最优解，意志只是没有钥匙时的减损。
 *
 * 智力因此有了第三个用途（前两个是能量与技能强度），
 * 这正是它被选来派生魔抗的原因：一级属性的 150 点预算不用重配。
 */
export const MAGIC_RES_CAP = 0.5;

/**
 * @param level 关卡内等级 1-5，每级 +8% 全属性
 */
export function derive(p: Primary, level = 1): Derived {
  const g = 1 + K.levelGrowth * (level - 1);
  const str = p.str * g;
  const agi = p.agi * g;
  const tgh = p.tgh * g;
  const intel = p.int * g;
  const luk = p.luk * g;
  const con = p.con * g;

  return {
    // 伤害用【未缩放】的力量，等级收益走 levelDmgMul，避免双重计算
    atkMul: 1 + p.str * K.strAtk,
    levelDmgMul: 1 + K.levelDmgPerLevel * (level - 1),
    hasteMul: 1 + agi * K.agiHaste,
    moveMul: 1 + agi * K.agiMove,
    critRate: 0.05 + luk * K.luckCrit,
    critDmg: CRIT_DMG_BASE,
    maxHp: K.hpBase + con * K.hpPerCon,
    armor: tgh * K.armorPerTgh,
    magicRes: Math.min(MAGIC_RES_CAP, intel * K.intMagicRes),
    energy: K.energyBase + intel * K.energyPerInt,
    skillPow: 1 + intel * K.intSkill,
    cdr: Math.min(CDR_CAP, intel * K.intCdr),

    antiCrit: Math.min(ANTI_CRIT_CAP, tgh * K.tghAntiCrit),
    stab: tgh * K.tghStab,
    // 击退力带 +1 基数，和 atkMul 同形：等级成长压缩，但不至于被等级推爆。
    // 它不需要独立乘区，因为守方的稳固同样随等级涨，两边互相抵消。
    knockMelee: 1 + str * K.strKnock,
    knockRanged: 1 + agi * K.agiKnock,
    lootTier: luk * K.luckLoot,
  };
}

/** 属性预算校验用：一级属性总点数 */
export function pointBudget(p: Primary): number {
  return p.str + p.agi + p.tgh + p.int + p.luk + p.con;
}

/** 六属性的展示顺序与中文名，UI 与文档共用一处，不各写一遍 */
export const PRIMARY_KEYS = ['str', 'agi', 'tgh', 'int', 'luk', 'con'] as const;
export type PrimaryKey = (typeof PRIMARY_KEYS)[number];

export const PRIMARY_LABEL: Record<PrimaryKey, string> = {
  str: '力量',
  agi: '敏捷',
  tgh: '韧性',
  int: '智力',
  luk: '幸运',
  con: '体质',
};

/** 每个角色的一级属性总预算。改这个数 = 全体角色重配。 */
export const POINT_TOTAL = 150;
