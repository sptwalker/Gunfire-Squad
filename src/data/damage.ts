/**
 * 伤害结算。纯函数，无副作用，模拟器与游戏共用。
 *
 * ── 第三轮：从「一条护甲轴」改成「三条抗性轴」 ──
 * 旧版只有一条减伤轴（`armor`），于是所有"打不动"的挑战都退化成同一个问题：
 * 你的输出够不够。第三轮把它拆成三系，每系有自己的门：
 *   物理 → 被 物抗（physRes）挡
 *   法术 → 被 魔抗（magicRes）挡
 *   电磁 → 无视物抗与魔抗，只被 电磁场（energyField）完全吸收
 * 三系闭环：电磁是万能解，代价是遇到磁暴僵尸完全打不动。
 *
 * ── 谁承担维度，谁只是手感 ──
 * `armor` + `armorType`（`ARMOR_MATRIX`）保留，但降级为 ±15% 的手感微调，
 * 只回答"这个目标穿什么甲"，**不再承担任何挑战维度**（见 `ATTR` 第 6 行）。
 * 维度由 physRes / magicRes / energyField 三个百分比承担，因为"换一个伤害系别"
 * 这件事只有它们能机械地表达出来。
 *
 * ── 留地板原则的唯一例外 ──
 * 电磁场可以把电磁伤害压到 0，而且破抗撬不开它。这是全项目唯一一处允许的
 * "完全免疫"，因为它的地板不在自己身上：任何物理或法术攻击都能照常打进去
 * （见 `scenes.ts` 的 D08）。别把这条当成可以推广的先例。
 */

export type DamageType =
  // ── 物理：钝击 / 斩击 / 穿刺 / 爆炸 ──
  | 'impact'
  | 'slash'
  | 'pierce'
  | 'explosive'
  // ── 法术：火 / 冰 / 毒 / 奥术 ──
  | 'fire'
  | 'frost'
  | 'poison'
  | 'arcane'
  // ── 电磁：光线 / 激光 / 电磁脉冲 / 雷电 / 等离子 ──
  // 原来的「雷」从法术划归电磁，风暴术士因此成为电磁系的第二个来源。
  | 'electric';

/** 三个伤害系别。抗性、武器、职业能力都按这一层分组。 */
export type DamageSchool = 'physical' | 'magic' | 'electric';

/**
 * 伤害类型 → 系别。
 *
 * 用一张派生表而不是给每个 `DamageType` 改名，是为了让 `weapons.ts` /
 * `characters.ts` / `run.ts` 里已经写好的 `dtype` 字面量原样继续工作——
 * 分类是一次归类，不是一次重命名。
 */
export const SCHOOL_OF: Record<DamageType, DamageSchool> = {
  impact: 'physical',
  slash: 'physical',
  pierce: 'physical',
  explosive: 'physical',
  fire: 'magic',
  frost: 'magic',
  poison: 'magic',
  arcane: 'magic',
  electric: 'electric',
};

export const SCHOOL_NAME: Record<DamageSchool, string> = {
  physical: '物理',
  magic: '法术',
  electric: '电磁',
};

export const SCHOOLS: DamageSchool[] = ['physical', 'magic', 'electric'];

export type ArmorType = 'none' | 'light' | 'medium' | 'heavy';

/**
 * 伤害类型 × 护甲类型 克制表。1.0 = 中性。
 *
 * **这张表已经不是维度了。** 它的全部职责是在 ±15% 以内表达"这个目标穿什么甲"，
 * 让砍轻甲和砸重甲的手感有一点区别。任何一格都不许超过 1.2 或低于 0.8——
 * 一旦超出这个band，它就会重新变成一条隐藏的减伤轴，和 physRes 抢同一份工作。
 *
 * 没有任何一格是 0，避免出现"这把武器对这个敌人完全无效"的死局。
 */
export const ARMOR_MATRIX: Record<DamageType, Record<ArmorType, number>> = {
  impact: { none: 1.0, light: 1.1, medium: 1.0, heavy: 0.85 },
  slash: { none: 1.0, light: 1.15, medium: 0.95, heavy: 0.8 },
  pierce: { none: 1.0, light: 1.0, medium: 1.1, heavy: 1.05 },
  explosive: { none: 1.0, light: 0.9, medium: 1.1, heavy: 1.2 },
  fire: { none: 1.0, light: 0.95, medium: 1.0, heavy: 1.15 },
  frost: { none: 1.0, light: 1.0, medium: 1.0, heavy: 1.0 },
  poison: { none: 1.0, light: 1.05, medium: 0.95, heavy: 0.9 },
  arcane: { none: 1.0, light: 1.0, medium: 1.05, heavy: 1.0 },
  electric: { none: 1.0, light: 1.0, medium: 1.0, heavy: 1.0 },
};

/** 穿透曲线常数：穿透值达到该数时，有效护甲减半 */
export const PIERCE_K = 60;

/**
 * 穿透的作用是【削弱目标物理护甲】，不是【自己再乘一个减伤】。
 * 有效护甲 = 护甲 × (1 - pierce/(pierce+60))
 *
 * 只对物理系别生效——法术和电磁没有"护甲"这回事，它们各自走 physRes 那一层的对位。
 */
export function effectiveArmor(rawArmor: number, pierce: number): number {
  return Math.max(0, rawArmor * (1 - pierce / (pierce + PIERCE_K)));
}

/** 护甲值减伤后的伤害保留比例 0-1 */
export function armorRetention(rawArmor: number, pierce: number): number {
  const eff = effectiveArmor(rawArmor, pierce);
  return 1 - eff / (eff + 100);
}

/**
 * 目标的抗性面板。
 *
 * 三个字段都是【减免比例】0-1，不是减免值。用比例而不是绝对值，是因为
 * 维度要的是"这套阵容打不动"，而不是"这一下打少了 40 点"——后者会随
 * 攻速、倍率、等级漂移，前者不会。
 */
export interface Resistances {
  /** 物抗：物理伤害的减免比例 */
  physRes: number;
  /** 魔抗：法术伤害的减免比例 */
  magicRes: number;
  /**
   * 电磁场：电磁伤害的减免比例。1 = 完全吸收。
   *
   * 全项目唯一一处允许把伤害压到 0 的地方，理由见文件头。
   * **破抗撬不开它**——破抗同时降物抗和魔抗，已经是最强的通用钥匙；
   * 再让它撬电磁场，电磁场这一维就形同虚设。
   */
  energyField: number;
}

export const NO_RESIST: Resistances = { physRes: 0, magicRes: 0, energyField: 0 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 抗性减免后的伤害保留比例。
 *
 * @param shred 攻方破抗 0-1。**同时**降物抗与魔抗，对电磁场无效。
 *   降的是抗性本身而不是伤害，所以它给全队用，而且对高抗目标收益更高——
 *   这正是"破抗服务两个维度"的来由。
 */
export function resistMul(school: DamageSchool, r: Resistances, shred = 0): number {
  const cut = (v: number) => clamp01(v - shred);
  switch (school) {
    case 'physical':
      return 1 - cut(r.physRes);
    case 'magic':
      return 1 - cut(r.magicRes);
    case 'electric':
      return 1 - clamp01(r.energyField);
  }
}

export interface DamageInput {
  /** 武器单次基础伤害 */
  base: number;
  dtype: DamageType;
  /** 目标护甲值（只对物理生效） */
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
  /** 目标三系抗性。不传 = 无抗性（测试基准与早期调用点用得上） */
  resist?: Resistances;
  /** 攻方破抗 0-1，同时降物抗与魔抗 */
  shred?: number;
}

/**
 * 最终伤害 = 基础 × 攻击乘区 × 暴击 × 物理护甲减免 × 甲型克制 × 抗性减免 × 技能倍率
 *
 * 注意三个乘区的分工，别让它们互相重叠：
 *   `armorRetention`  只对【物理】生效，是"这把武器的穿透够不够"那一层
 *   `ARMOR_MATRIX`    对所有系别生效，幅度 ±15%，只是手感
 *   `resistMul`       对所有系别生效，是**维度**那一层
 */
export function computeDamage(d: DamageInput): number {
  const critMul = d.crit ? d.critDmg : 1;
  const school = SCHOOL_OF[d.dtype];
  const physical = school === 'physical' ? armorRetention(d.armor, d.pierce) : 1;
  return (
    d.base *
    d.atkMul *
    critMul *
    physical *
    ARMOR_MATRIX[d.dtype][d.armorType] *
    resistMul(school, d.resist ?? NO_RESIST, d.shred ?? 0) *
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
