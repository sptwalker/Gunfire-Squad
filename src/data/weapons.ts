/**
 * 13 种武器。
 *
 * 关键设计取舍：
 * 1. 远程武器用【弹匣 + 换弹】而不是【弹药总数】。玩家不管理弹药数量，只承担换弹节奏，
 *    换弹时间就是免费的节奏起伏来源，不需要额外设计一套弹药经济。
 * 2. 每种武器都有 pierce 值。穿透的作用是削弱目标护甲（见 damage.ts），
 *    这让"穿透"成为独立于攻击力的第三条成长轴，避免后期只剩堆攻击一条路。
 * 3. hitsPerAttack > 1 的武器有天然 AOE 优势，所以单发伤害必须压低，
 *    否则近战群伤武器会直接碾压单体远程武器。
 */

import type { DamageType } from './damage.ts';

export type WeaponId =
  | 'greatsword'
  | 'sword'
  | 'spear'
  | 'bow'
  | 'pistol'
  | 'smg'
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
  /** 附加效果说明，仅文档用 */
  note: string;
}

export const WEAPONS: Record<WeaponId, Weapon> = {
  greatsword: {
    id: 'greatsword', name: '大刀', category: 'melee', dtype: 'slash',
    base: 190, rate: 0.8, range: 2, pierce: 35, hitsPerAttack: 3,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0,
    note: '扇形横扫，同时命中 3 个目标',
  },
  sword: {
    id: 'sword', name: '剑', category: 'melee', dtype: 'slash',
    base: 110, rate: 1.6, range: 2.5, pierce: 25, hitsPerAttack: 1,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0.05,
    note: '攻速快，暴击率高',
  },
  spear: {
    id: 'spear', name: '长枪', category: 'melee', dtype: 'pierce',
    base: 150, rate: 1.0, range: 4, pierce: 55, hitsPerAttack: 2,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0,
    note: '直线贯穿，需站定输出',
  },
  bow: {
    id: 'bow', name: '弓箭', category: 'ranged', dtype: 'pierce',
    base: 260, rate: 0.7, range: 30, pierce: 60, hitsPerAttack: 1,
    magazine: 8, reload: 1.6, aoe: 0, critBonus: 0.1,
    note: '蓄力，蓄满必定暴击',
  },
  pistol: {
    id: 'pistol', name: '手枪', category: 'ranged', dtype: 'impact',
    base: 65, rate: 2.0, range: 22, pierce: 20, hitsPerAttack: 1,
    magazine: 12, reload: 1.8, aoe: 0, critBonus: 0,
    note: '高攻速，低后坐',
  },
  smg: {
    id: 'smg', name: '冲锋枪', category: 'ranged', dtype: 'impact',
    base: 52, rate: 5.0, range: 20, pierce: 10, hitsPerAttack: 1,
    magazine: 30, reload: 2.2, aoe: 0, critBonus: 0,
    note: '高射速持续输出，但穿透低、对重甲乏力',
  },
  sniper: {
    id: 'sniper', name: '狙击枪', category: 'ranged', dtype: 'pierce',
    base: 700, rate: 0.35, range: 60, pierce: 80, hitsPerAttack: 1,
    magazine: 5, reload: 2.5, aoe: 0, critBonus: 0.15,
    note: '弱点判定，命中弱点 ×2.5；单发最高但持续输出最低',
  },
  grenade: {
    id: 'grenade', name: '手雷', category: 'thrown', dtype: 'explosive',
    base: 420, rate: 0.5, range: 25, pierce: 30, hitsPerAttack: 6,
    magazine: 3, reload: 3.0, aoe: 4, critBonus: 0,
    note: '抛物线投掷，范围 4 格',
  },
  flamer: {
    id: 'flamer', name: '喷火器', category: 'ranged', dtype: 'fire',
    base: 32, rate: 8.0, range: 8, pierce: 20, hitsPerAttack: 4,
    magazine: 100, reload: 3.0, aoe: 0, critBonus: 0,
    note: '锥形持续，叠加灼烧',
  },
  freezer: {
    id: 'freezer', name: '冷冻器', category: 'ranged', dtype: 'frost',
    base: 45, rate: 2.5, range: 10, pierce: 15, hitsPerAttack: 2,
    magazine: 20, reload: 2.0, aoe: 0, critBonus: 0,
    note: '减速 30%，叠满冻结 1.5 秒',
  },
  boomerang: {
    id: 'boomerang', name: '回旋镖', category: 'thrown', dtype: 'impact',
    base: 180, rate: 0.9, range: 18, pierce: 50, hitsPerAttack: 2,
    magazine: 0, reload: 0, aoe: 0, critBonus: 0.05,
    note: '飞出回收，双次命中',
  },
  rocket: {
    id: 'rocket', name: '火箭筒', category: 'ranged', dtype: 'explosive',
    base: 1100, rate: 0.35, range: 35, pierce: 65, hitsPerAttack: 5,
    magazine: 2, reload: 3.5, aoe: 5, critBonus: 0,
    note: '慢速高伤，击退',
  },
  laser: {
    id: 'laser', name: '激光枪', category: 'ranged', dtype: 'impact',
    base: 140, rate: 1.2, range: 40, pierce: 70, hitsPerAttack: 3,
    magazine: 8, reload: 2.4, aoe: 0, critBonus: 0.05,
    note: '瞬时命中，链式跳 3 目标',
  },
};

export const WEAPON_LIST: Weapon[] = Object.values(WEAPONS);

/** 武器升级阶：0 / 1 / 2，金钱购买 */
export const WEAPON_TIERS = [0, 1, 2] as const;
export type WeaponTier = (typeof WEAPON_TIERS)[number];

/** 阶数对基础伤害与穿透的加成 */
export function tierBonus(tier: WeaponTier): { dmg: number; pierce: number } {
  return { dmg: 1 + 0.35 * tier, pierce: 1 + 0.2 * tier };
}

/** 各阶购买价，单位：金钱 */
export const WEAPON_PRICE: Record<WeaponTier, number> = { 0: 300, 1: 700, 2: 1500 };
