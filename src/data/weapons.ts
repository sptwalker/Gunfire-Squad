/**
 * 14 种武器。
 *
 * 关键设计取舍：
 * 1. 远程武器用【弹匣 + 换弹】而不是【弹药总数】。玩家不管理弹药数量，只承担换弹节奏，
 *    换弹时间就是免费的节奏起伏来源，不需要额外设计一套弹药经济。
 * 2. 每种武器都有 pierce 值。穿透的作用是削弱目标护甲（见 damage.ts），
 *    这让"穿透"成为独立于攻击力的第三条成长轴，避免后期只剩堆攻击一条路。
 * 3. hitsPerAttack > 1 的武器有天然 AOE 优势，所以单发伤害必须压低，
 *    否则近战群伤武器会直接碾压单体远程武器。
 */

import type { DamageSchool, DamageType } from './damage.ts';

/**
 * 武器类别（第三轮，C7-9）。**职业**定义自己能用哪些类别，类别跨职业共用。
 * 用户给的初始清单 + 第二轮的步枪类（C6 裁决，保留）+ 第三轮 P2 射手树扩展的投索 / 电磁 = 17 类。
 * 刀盾 / 重锤 / 魔法 / 药水 / 投索 / 电磁 暂无具体武器——军械库在 P2 末尾按职业树重建。
 *
 * **同类武器的持续 DPS 跨度 ≤ 1.3 倍**（用户裁决，`SAME_CLASS_DPS_CAP`，哨兵 §13a 守线）。
 * 同类武器之间换的是手感与附加效果（冻结 / 灼烧 / 击退 / 射程），不是数字。
 */
export const SAME_CLASS_DPS_CAP = 1.3;

/**
 * 三个伤害系别钥匙（K08 physical / K09 magic / K10 electric）的供给规则。
 *
 * **不手打标签，按武器类别派发。** 理由：系别是武器自己的属性（`dtype`），
 * 一个职业能不能"换系别打铁甲"完全由它手里的武器决定，跟技能文案无关。
 * 手打的结果是纯物理的剑士树反而没有 physical——那正是"派发"要消灭的错误。
 *
 * 判定是**并集**：`makeClass` 已经把主武器和所有轴分支解锁的武器类别并起来，
 * 所以一个走到"换上手枪"分线的剑士自动拿到 physical，不需要单独记一笔。
 * 三个系别都拿不到的职业（药水 / 魔法 / 投索三个纯增益类别）视为两种系别皆通，
 * 由 `scenes.ts` 的 D06/D07 判据兜底，不在这里补假标签。
 */
export const SCHOOL_OF_CLASS: Partial<Record<WeaponClass, DamageSchool>> = {
  blade: 'physical', shield: 'physical', polearm: 'physical', hammer: 'physical',
  bow: 'physical', pistol: 'physical', smg: 'physical', rifle: 'physical',
  sniper: 'physical', heavy: 'physical', thrown: 'physical',
  magic: 'magic', sprayer: 'magic', potion: 'magic',
  beam: 'electric', railgun: 'electric',
};

export type WeaponClass =
  | 'blade' | 'shield' | 'polearm' | 'hammer' | 'bow' | 'pistol' | 'smg' | 'rifle' | 'sniper'
  | 'heavy' | 'thrown' | 'sprayer' | 'magic' | 'potion' | 'beam' | 'lasso' | 'railgun';

export const WEAPON_CLASS_NAME: Record<WeaponClass, string> = {
  blade: '刀剑', shield: '刀盾', polearm: '长枪', hammer: '重锤', bow: '弓箭', pistol: '手枪', smg: '冲锋枪',
  rifle: '步枪', sniper: '狙击枪', heavy: '重武器', thrown: '投掷', sprayer: '喷射', magic: '魔法', potion: '药水', beam: '光线',
  lasso: '投索', railgun: '电磁',
};

export type WeaponId =
  | 'greatsword'
  | 'sword'
  | 'spear'
  | 'bow'
  | 'pistol'
  | 'smg'
  | 'rifle'
  | 'sniper'
  | 'grenade'
  | 'flamer'
  | 'freezer'
  | 'boomerang'
  | 'rocket'
  | 'laser';

export interface Weapon {
  id: WeaponId;
  name: string;
  category: 'melee' | 'ranged' | 'thrown';
  dtype: DamageType;
  /** 单发基础伤害 */
  base: number;
  /** 每秒攻击次数 */
  rate: number;
  /** 射程，单位：格 */
  range: number;
  pierce: number;
  /** 每次攻击命中目标数 */
  hitsPerAttack: number;
  /** 弹匣容量，近战为 0（无换弹） */
  magazine: number;
  /** 换弹时间，秒 */
  reload: number;
  /** 溅射半径，格。0 表示单体 */
  aoe: number;
  /** 额外暴击率加成 */
  critBonus: number;
  /**
   * 击退力。乘上攻击者的 knockMelee / knockRanged 之后再与目标的稳固对撞，
   * 见 `sim/combat.ts` 的 `knockChance()`。量纲与 `Derived.stab` 对齐。
   *
   * 这条数值的设计梯度：**越慢越重的武器推得越开**。
   * 火箭筒 70 / 大刀 45 是两端，冲锋枪 6 几乎推不动——
   * 于是"想要击退"就必然要接受低射速，而不是白拿一个控场属性。
   */
  knockback: number;
  /**
   * 武器类别（用户裁决：角色只能用自己会的类别）。同类武器输出模式相近，
   * 所以换武器是"同一种打法换个手感"，不是跨模式跳数字。角色会哪些类别见 `Hero.weaponClasses`。
   */
  class: WeaponClass;
  /** 附加效果说明，仅文档用 */
  note: string;
}

export const WEAPONS: Record<WeaponId, Weapon> = {
  greatsword: {
    id: 'greatsword', name: '大刀', category: 'melee', dtype: 'slash',
    base: 190, rate: 0.8, range: 2, pierce: 35, hitsPerAttack: 3,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0,
    knockback: 45,
    class: 'blade',
    note: '扇形横扫，同时命中 3 个目标',
  },
  sword: {
    id: 'sword', name: '剑', category: 'melee', dtype: 'slash',
    base: 110, rate: 1.6, range: 2.5, pierce: 25, hitsPerAttack: 1,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0.05,
    knockback: 15,
    class: 'blade',
    note: '攻速快，暴击率高',
  },
  spear: {
    id: 'spear', name: '长枪', category: 'melee', dtype: 'pierce',
    base: 150, rate: 1.0, range: 4, pierce: 55, hitsPerAttack: 2,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0,
    knockback: 35,
    class: 'polearm',
    note: '直线贯穿，需站定输出',
  },
  bow: {
    id: 'bow', name: '弓箭', category: 'ranged', dtype: 'pierce',
    base: 260, rate: 0.7, range: 30, pierce: 60, hitsPerAttack: 1,
    magazine: 8, reload: 1.6, aoe: 0, critBonus: 0.1,
    knockback: 20,
    class: 'bow',
    note: '蓄力，蓄满必定暴击',
  },
  pistol: {
    id: 'pistol', name: '手枪', category: 'ranged', dtype: 'impact',
    base: 88, rate: 2.0, range: 22, pierce: 20, hitsPerAttack: 1,
    magazine: 12, reload: 1.8, aoe: 0, critBonus: 0,
    knockback: 12,
    class: 'pistol',
    note: '高攻速，低后坐',
  },
  smg: {
    id: 'smg', name: '冲锋枪', category: 'ranged', dtype: 'impact',
    base: 52, rate: 5.0, range: 20, pierce: 10, hitsPerAttack: 1,
    magazine: 30, reload: 2.2, aoe: 0, critBonus: 0,
    knockback: 6,
    class: 'smg',
    note: '高射速持续输出，但穿透低、对重甲乏力',
  },
  rifle: {
    id: 'rifle', name: '突击步枪', category: 'ranged', dtype: 'pierce',
    base: 58, rate: 3.0, range: 30, pierce: 40, hitsPerAttack: 1,
    magazine: 30, reload: 2.4, aoe: 0, critBonus: 0.05,
    knockback: 14,
    class: 'rifle',
    note: '中远距离全自动，射程与穿透介于冲锋枪和狙击枪之间',
  },
  sniper: {
    id: 'sniper', name: '狙击枪', category: 'ranged', dtype: 'pierce',
    base: 700, rate: 0.35, range: 60, pierce: 80, hitsPerAttack: 1,
    magazine: 5, reload: 2.5, aoe: 0, critBonus: 0.15,
    knockback: 30,
    class: 'sniper',
    note: '弱点判定，命中弱点 ×2.5；单发最高但持续输出最低',
  },
  grenade: {
    id: 'grenade', name: '手雷', category: 'thrown', dtype: 'explosive',
    base: 420, rate: 0.5, range: 25, pierce: 30, hitsPerAttack: 6,
    magazine: 3, reload: 3.0, aoe: 4, critBonus: 0,
    knockback: 40,
    class: 'heavy',
    note: '抛物线投掷，范围 4 格',
  },
  flamer: {
    id: 'flamer', name: '喷火器', category: 'ranged', dtype: 'fire',
    base: 23, rate: 8.0, range: 8, pierce: 20, hitsPerAttack: 4,
    magazine: 100, reload: 3.0, aoe: 0, critBonus: 0,
    knockback: 5,
    class: 'sprayer',
    note: '锥形持续，叠加灼烧',
  },
  freezer: {
    id: 'freezer', name: '冷冻器', category: 'ranged', dtype: 'frost',
    base: 62, rate: 2.5, range: 10, pierce: 15, hitsPerAttack: 2,
    magazine: 20, reload: 2.0, aoe: 0, critBonus: 0,
    knockback: 10,
    class: 'sprayer',
    note: '减速 30%，叠满冻结 1.5 秒',
  },
  boomerang: {
    id: 'boomerang', name: '回旋镖', category: 'thrown', dtype: 'impact',
    base: 180, rate: 0.9, range: 18, pierce: 50, hitsPerAttack: 2,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0.05,
    knockback: 25,
    class: 'thrown',
    note: '飞出回收，双次命中',
  },
  rocket: {
    id: 'rocket', name: '火箭筒', category: 'ranged', dtype: 'explosive',
    base: 680, rate: 0.35, range: 35, pierce: 65, hitsPerAttack: 5,
    magazine: 2, reload: 3.5, aoe: 5, critBonus: 0,
    knockback: 70,
    class: 'heavy',
    note: '慢速高伤，击退',
  },
  laser: {
    id: 'laser', name: '激光枪', category: 'ranged', dtype: 'electric',
    base: 140, rate: 1.2, range: 40, pierce: 70, hitsPerAttack: 3,
    magazine: 8, reload: 2.4, aoe: 0, critBonus: 0.05,
    knockback: 12,
    class: 'beam',
    note: '瞬时命中，链式跳 3 目标',
  },
};

export const WEAPON_LIST: Weapon[] = Object.values(WEAPONS);

/** 武器升级阶：0 / 1 / 2，随局内等级自动涨（不卖） */
export const WEAPON_TIERS = [0, 1, 2] as const;
export type WeaponTier = (typeof WEAPON_TIERS)[number];

/** 阶数对基础伤害与穿透的加成 */
export function tierBonus(tier: WeaponTier): { dmg: number; pierce: number } {
  return { dmg: 1 + 0.35 * tier, pierce: 1 + 0.2 * tier };
}

/**
 * 武器阶数是**局内自动成长**，不是买来的。
 * 第二轮把 `WEAPON_PRICE`（0/1/2 阶的购买价）整条删掉了——
 * 局内不再有任何购买动作，阶随角色等级自动提升。
 * 局外的金钱只买**解锁权**（新的武器种类），价目表见 `progression.ts` 的 `SHOP`。
 *
 * 为什么阶不能买：可购买的阶是一条"打不过就回去刷"的通路，
 * 而本作的前提是"卡住只能换阵容"。买种类给的是**新答案**（新的维度解），
 * 买阶给的是**新数字**（同一套答案打得更疼），后者会直接架空设计前提。
 */
export const LEVEL_TIER_AT: Record<number, WeaponTier> = { 1: 0, 3: 1, 5: 2 };

/** 关卡内等级 → 武器阶。等级本身就是按存活时长自动涨的（见 `run.ts` 的 `LEVEL_TIME`）。 */
export function tierForLevel(level: number): WeaponTier {
  if (level >= 5) return 2;
  if (level >= 3) return 1;
  return 0;
}

// ─────────────────────────────────────────────
// 局内临时武器（第三轮新增）
// ─────────────────────────────────────────────

/**
 * 局内捡到的临时武器。**不能带出局外、不能买、弹药有限。**
 *
 * - `slot: 'primary'`   捡起后替换主武器，全部攻击改用它
 * - `slot: 'secondary'` 不替换主武器，AI 只在 `useOn` 命中时拿出来打
 * 两种都一样：弹药打光 → 自动切回原武器，这把从手里消失。
 *
 * 武器阶跟随**捡起时的局内等级**（`tierForLevel`），不单独成长。
 * 武器类别**不限制**临时武器——谁捡到谁用。
 * ponytail: 忽略类别是有意的，它是"尝一口没买的武器"的入口；若试玩里坦克扛火箭筒太离谱，再加类别校验。
 *
 * 为什么只从 14 把现有武器里选、不做局内专属武器：
 * 临时武器兼任**商店试用**——玩家在局内用过火箭筒，才知道 16,000 花得值不值。
 */
export interface TempWeaponDrop {
  weapon: WeaponId;
  slot: 'primary' | 'secondary';
  /** 总发数。近战武器按挥击次数计 */
  ammo: number;
  /** secondary 专用：AI 什么时候拿出来用 */
  useOn?: 'elite' | 'boss' | 'pack';
  /** 掉落来源 */
  from: 'elite' | 'crate' | 'boss';
  note: string;
}

export const TEMP_WEAPON_DROPS: TempWeaponDrop[] = [
  { weapon: 'rocket', slot: 'secondary', ammo: 6, useOn: 'pack', from: 'elite',
    note: '专打扎堆的怪群。6 发 ≈ 一次 BOSS 战的清场补刀' },
  { weapon: 'sniper', slot: 'secondary', ammo: 8, useOn: 'elite', from: 'elite',
    note: '专点精英与护盾。主武器不变，只在精英出现时换手' },
  { weapon: 'grenade', slot: 'secondary', ammo: 10, useOn: 'pack', from: 'crate',
    note: '补给箱常见货。给没有 AOE 的阵容一个短暂的清场窗口' },
  { weapon: 'flamer', slot: 'primary', ammo: 120, from: 'crate',
    note: '替换主武器。120 发 ≈ 30 秒持续喷射，打完切回' },
  { weapon: 'laser', slot: 'primary', ammo: 60, from: 'boss',
    note: 'BOSS 掉落。替换主武器约 50 秒——正好覆盖下一波精英' },
];

/** 一把临时武器能打多少秒（不含换弹）。哨兵 §13b 用它核对"临时"是否真的临时。 */
export function tempWeaponSeconds(d: TempWeaponDrop): number {
  return d.ammo / WEAPONS[d.weapon].rate;
}
