/**
 * 12 名可选角色，从中选 5 人组队。
 *
 * 设计约束（有意为之，不要打破）：
 * 1. 一级属性总和统一为 100 点。角色差异靠【分配方式】体现，不靠数值膨胀。
 *    否则"哪个角色强"就变成"哪个角色点数多"，阵容选择失去意义。
 * 2. 每个角色绑定一把主武器。武器不通用 → 玩家选角色时实际上在选武器组合，
 *    这是阵容深度的主要来源（不额外做羁绊系统）。
 * 3. 角色差异靠 aiProfile 参数体现，不是靠四套不同的 AI 代码。
 *    加一个新角色 = 加一行数据，不是加一个类。
 * 4. 不做羁绊/组合加成。理由：羁绊会让配平复杂度翻倍，而定位互补已经能产生
 *    足够的组合深度。这是本作明确的减法。
 */

import type { Primary } from './attributes.ts';
import type { WeaponId } from './weapons.ts';

export type HeroRole = 'tank' | 'meleeDps' | 'rangedDps' | 'control' | 'support' | 'summoner';

export type TargetPriority = 'closest' | 'weakest' | 'strongest';

export interface AIProfile {
  /** 索敌半径，格 */
  aggroRange: number;
  /** 脱战半径，格。超出后放弃当前目标 */
  leashRange: number;
  /** 交战距离 = 武器射程 × 该系数。近战 >1 表示前压，远程 <1 表示保持距离 */
  engageDistanceMul: number;
  /** 目标优先级 */
  targetPriority: TargetPriority;
  /** 血量低于该比例时后撤，0 表示永不后撤 */
  retreatHpPct: number;
}

export interface Skill {
  name: string;
  /** 冷却，秒 */
  cooldown: number;
  /** 持续时间，秒。0 表示瞬发 */
  duration: number;
  /** 技能期间的伤害倍率 */
  mul: number;
  /** 冷却缩减是否生效 */
  cdrAffected: boolean;
  /**
   * 防御向：技能生效期间，全队受到的伤害乘以该系数（1 = 无减伤）。
   * 只有控制/辅助角色需要填——纯伤害模拟器看不见它们的价值，
   * 不填就会得出"带治疗不如多带一个输出"的错误结论。
   */
  teamDefMul?: number;
  /** 防御向：每秒为全队回复的生命，等于【自身最大生命】的这个比例 */
  healPerSec?: number;
  note: string;
}

export interface Hero {
  id: string;
  name: string;
  role: HeroRole;
  weapon: WeaponId;
  primary: Primary;
  skill: Skill;
  ai: AIProfile;
}

export const HEROES: Hero[] = [
  // ── 坦克：低输出高生存，负责把僵尸挡在外圈 ──
  {
    id: 'ron', name: '铁壁·罗恩', role: 'tank', weapon: 'greatsword',
    primary: { str: 28, agi: 8, tgh: 50, int: 14 },
    skill: { name: '磐石壁垒', cooldown: 20, duration: 6, mul: 1.4, cdrAffected: true, teamDefMul: 0.5, note: '期间全队减伤 50%，自身嘲讽' },
    ai: { aggroRange: 14, leashRange: 22, engageDistanceMul: 1.2, targetPriority: 'closest', retreatHpPct: 0 },
  },
  {
    id: 'gwen', name: '磐石·格温', role: 'tank', weapon: 'spear',
    primary: { str: 30, agi: 12, tgh: 46, int: 12 },
    skill: { name: '穿刺阵列', cooldown: 16, duration: 4, mul: 2.2, cdrAffected: true, note: '直线贯穿，无视 40% 目标护甲' },
    ai: { aggroRange: 16, leashRange: 24, engageDistanceMul: 1.0, targetPriority: 'closest', retreatHpPct: 0 },
  },

  // ── 近战输出：高攻速贴脸，靠队友挡伤害 ──
  {
    id: 'kai', name: '疾风·凯', role: 'meleeDps', weapon: 'sword',
    primary: { str: 40, agi: 30, tgh: 20, int: 10 },
    skill: { name: '疾风连斩', cooldown: 12, duration: 3, mul: 2.6, cdrAffected: true, note: '攻速翻倍，暴击率 +30%' },
    ai: { aggroRange: 18, leashRange: 26, engageDistanceMul: 1.1, targetPriority: 'weakest', retreatHpPct: 0.25 },
  },
  {
    id: 'ironbull', name: '断岳·铁牛', role: 'meleeDps', weapon: 'greatsword',
    primary: { str: 46, agi: 18, tgh: 26, int: 10 },
    skill: { name: '裂地斩', cooldown: 14, duration: 2, mul: 3.0, cdrAffected: true, note: '范围击退 + 撕裂持续伤害' },
    ai: { aggroRange: 15, leashRange: 22, engageDistanceMul: 1.2, targetPriority: 'strongest', retreatHpPct: 0.2 },
  },

  // ── 远程输出：高 DPS 但脆，需要坦克保护 ──
  {
    id: 'vera', name: '鹰眼·薇拉', role: 'rangedDps', weapon: 'sniper',
    primary: { str: 34, agi: 36, tgh: 14, int: 16 },
    skill: { name: '致命标记', cooldown: 18, duration: 5, mul: 2.4, cdrAffected: true, note: '标记目标，全队对其伤害 +35%' },
    ai: { aggroRange: 40, leashRange: 55, engageDistanceMul: 0.8, targetPriority: 'strongest', retreatHpPct: 0.3 },
  },
  {
    id: 'jet', name: '弹幕·杰特', role: 'rangedDps', weapon: 'smg',
    primary: { str: 30, agi: 40, tgh: 16, int: 14 },
    skill: { name: '弹幕压制', cooldown: 15, duration: 5, mul: 1.9, cdrAffected: true, note: '换弹时间归零，射速 +40%' },
    ai: { aggroRange: 24, leashRange: 32, engageDistanceMul: 0.85, targetPriority: 'closest', retreatHpPct: 0.3 },
  },

  // ── 控制：不追求 DPS，追求让僵尸打不到人 ──
  {
    id: 'ella', name: '霜语·艾拉', role: 'control', weapon: 'freezer',
    primary: { str: 14, agi: 22, tgh: 18, int: 46 },
    skill: { name: '绝对零度', cooldown: 22, duration: 3, mul: 1.5, cdrAffected: true, teamDefMul: 0, note: '全场冻结 3 秒，被冻结目标受伤 +50%' },
    ai: { aggroRange: 20, leashRange: 28, engageDistanceMul: 0.8, targetPriority: 'closest', retreatHpPct: 0.35 },
  },
  {
    id: 'bom', name: '震地·博姆', role: 'control', weapon: 'grenade',
    primary: { str: 22, agi: 20, tgh: 26, int: 32 },
    skill: { name: '连环爆破', cooldown: 18, duration: 4, mul: 2.8, cdrAffected: true, teamDefMul: 0.6, note: '投掷 3 枚手雷，附带击退与减速 40%' },
    ai: { aggroRange: 26, leashRange: 34, engageDistanceMul: 0.9, targetPriority: 'closest', retreatHpPct: 0.3 },
  },

  // ── 辅助：治疗与增益 ──
  {
    id: 'lian', name: '圣手·莉安', role: 'support', weapon: 'pistol',
    primary: { str: 14, agi: 20, tgh: 20, int: 46 },
    skill: { name: '生命涌流', cooldown: 20, duration: 4, mul: 1.0, cdrAffected: true, healPerSec: 0.06, note: '持续治疗全队，总量约等于自身最大生命 120%' },
    ai: { aggroRange: 22, leashRange: 30, engageDistanceMul: 0.75, targetPriority: 'weakest', retreatHpPct: 0.4 },
  },
  {
    id: 'shaman', name: '烈焰·萨满', role: 'support', weapon: 'flamer',
    primary: { str: 20, agi: 18, tgh: 24, int: 38 },
    skill: { name: '战意图腾', cooldown: 24, duration: 8, mul: 1.7, cdrAffected: true, note: '全队攻击 +30%，攻速 +20%，自带灼烧光环' },
    ai: { aggroRange: 18, leashRange: 26, engageDistanceMul: 1.0, targetPriority: 'closest', retreatHpPct: 0.3 },
  },

  // ── 召唤：用数量换输出，自动战斗里收益稳定 ──
  {
    id: 'nox', name: '傀儡师·诺克斯', role: 'summoner', weapon: 'boomerang',
    primary: { str: 22, agi: 18, tgh: 22, int: 38 },
    skill: { name: '骸骨傀儡', cooldown: 26, duration: 10, mul: 1.8, cdrAffected: true, note: '召唤 2 只傀儡参战，分摊仇恨' },
    ai: { aggroRange: 20, leashRange: 28, engageDistanceMul: 0.9, targetPriority: 'closest', retreatHpPct: 0.3 },
  },
  {
    id: 'sif', name: '蜂群·西芙', role: 'summoner', weapon: 'laser',
    primary: { str: 18, agi: 22, tgh: 20, int: 40 },
    skill: { name: '纳米蜂群', cooldown: 16, duration: 6, mul: 2.1, cdrAffected: true, note: '链式激光额外跳 5 目标，附带腐蚀' },
    ai: { aggroRange: 28, leashRange: 36, engageDistanceMul: 0.85, targetPriority: 'weakest', retreatHpPct: 0.35 },
  },
];

export const HEROES_BY_ID: Record<string, Hero> = Object.fromEntries(
  HEROES.map((h) => [h.id, h]),
);

export const SQUAD_SIZE = 5;

/**
 * 技能的平均 DPS 乘区 = 1 + 冷却占比 × (倍率 - 1)。
 * 这是把"瞬发/持续技能"简化成等效持续输出的手段——
 * 对于自动战斗的配平够用；真实技能机制（治疗、控制）另算。
 */
export function skillAvgMul(hero: Hero): number {
  const s = hero.skill;
  const cd = s.cdrAffected ? s.cooldown : s.cooldown;
  const uptime = s.duration / Math.max(cd, 0.01);
  return 1 + uptime * (s.mul - 1);
}

/** 队伍的定位覆盖度，用于提示阵容是否偏科 */
export function roleCoverage(heroes: Hero[]): Partial<Record<HeroRole, number>> {
  const out: Partial<Record<HeroRole, number>> = {};
  for (const h of heroes) out[h.role] = (out[h.role] ?? 0) + 1;
  return out;
}
