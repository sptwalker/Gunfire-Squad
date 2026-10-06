/**
 * 战斗数学：纯函数，无状态。
 * 模拟器、游戏运行时、文档里的手算演示，全部调用这里，保证三处数字一致。
 */

import { derive, type Derived } from '../data/attributes.ts';
import {
  ARMOR_MATRIX,
  SCHOOL_OF,
  armorRetention,
  expectedDamage,
  resistMul,
  type ArmorType,
  type DamageType,
  type Resistances,
} from '../data/damage.ts';
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
  /** 目标抗暴击 0-1。不传 = 0，即打一个没有韧性的目标。 */
  targetAntiCrit = 0,
  /**
   * 目标三系抗性。**不传 = 无抗性**，所以旧调用点全部保持原值——
   * 但凡是"打某个具体僵尸"的调用点都必须显式传 `z.resist`，
   * 否则物抗/魔抗/电磁场这三个维度在读数里根本不存在。
   */
  resist?: Resistances,
  /** 攻方破抗 0-1，同时降物抗与魔抗 */
  shred = 0,
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
    targetAntiCrit,
    resist,
    shred,
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
  targetAntiCrit = 0,
  resist?: Resistances,
  shred = 0,
): number {
  const w = WEAPONS[hero.weapon];
  const single = heroRawDps(
    hero, level, tier, targetArmor, targetArmorType, dtype, targetAntiCrit, resist, shred,
  );
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
  targetAntiCrit = 0,
  resist?: Resistances,
  shred = 0,
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
      targetAntiCrit,
      resist,
      shred,
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
 *
 * ── 第三轮修正：护甲只对物理生效 ──
 * 旧版把 `retention(z.armor, pierce)` 乘在所有伤害系别上，于是法术和电磁
 * 也在被目标的"护甲值"减伤——那让三系变成同一个问题。
 * 现在护甲只削物理，法术与电磁各自走 `z.resist` 的 magicRes / energyField。
 * `z.resist` 是僵尸身上的字段，所以这里不需要调用方传抗性，维度自动生效。
 */
export function ttk(
  dps: number,
  z: Zombie,
  stage: number,
  pierce: number,
  dtype: DamageType,
  /** 攻方破抗 0-1，降物抗与魔抗 */
  shred = 0,
): number {
  const school = SCHOOL_OF[dtype];
  const physical = school === 'physical' ? retention(z.armor, pierce) : 1;
  const effectiveDps =
    dps * physical * ARMOR_MATRIX[dtype][z.armorType] * resistMul(school, z.resist, shred);
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

// ────────────────────────────────────────────────────────────
// 控制对抗（第二轮新增）
// ────────────────────────────────────────────────────────────

/**
 * 击退/击倒的命中率上限。
 *
 * **不能到 1.0**，理由与 `ANTI_CRIT_CAP = 0.5` 是同一条：
 * 一旦某把武器能 100% 推住某个目标，位移就不再是对局变量，
 * "把怪推在门外"会变成一条万能的通关路径。
 * 0.85 的意思是"堆击退能把控场做到八成五，剩下那一成半永远靠站位和运气"。
 */
export const KNOCK_CAP = 0.85;

/**
 * 判定的陡峭度。命中率取的是 Hill 形式：
 *
 *     命中率 = clamp(KNOCK_CAP × atk^n / (atk^n + stab^n), 0, KNOCK_CAP)
 *
 * n = 2 而不是 1，这条是本设计的要害，值得写清楚：
 * 用 n = 1 的裸比值时，冲锋枪（击退力 8.7）对普通僵尸（稳固 12）能拿到 42% ——
 * 一把"几乎推不动"的武器推出了四成概率，与它的设计定位直接矛盾。
 * n = 2 之后同一组数字是 34%（再乘 cap），而火箭筒 vs 护盾僵尸只有 34%（且它霸体，实际为 0）。
 * **平方关系表达的是"击退力必须明显压过稳固才推得动"，这正是这个属性该有的手感。**
 *
 * 它同时也是"控制抗性"这个维度成立的前提：抗性高的单位不是"少被推一点"，
 * 而是"根本推不动"，玩家才会去换手段而不是加力度。
 */
export const KNOCK_EXP = 2;

/**
 * 一次控制判定的命中率 0-1。
 *
 * 攻方击退力 = 武器 knockback × (近战 ? knockMelee : knockRanged)，见 `heroKnock()`
 * 守方稳固   = 英雄 `Derived.stab` / 僵尸 `Zombie.stab`
 *
 * 霸体**不在这里判**——它是"免疫位移"的是非题而不是概率调节，
 * 由调用方先行短路，见 `canDisplace()`。
 */
export function knockChance(attackerKnock: number, defenderStab: number): number {
  const a = Math.max(0, attackerKnock);
  if (a <= 0) return 0;
  const s = Math.max(0, defenderStab);
  const an = Math.pow(a, KNOCK_EXP);
  const sn = Math.pow(s, KNOCK_EXP);
  const raw = an / (an + sn);
  return Math.min(KNOCK_CAP, KNOCK_CAP * raw);
}

/**
 * 霸体只免位移。冻结与嘲讽各走自己的对抗属性（`freezeRes` / `cunning`），
 * 减速**故意不设**对抗属性——控制体系需要一层永远关不上的门，
 * 否则"控制流"作为一个流派会整体作废。
 */
export function canDisplace(defender: { superArmor: boolean }): boolean {
  return !defender.superArmor;
}

/**
 * 冻结的实际时长。抗冻同时**降概率也缩时长**——
 * 只降概率的话，堆满抗冻的单位一旦被冻住，时长和零抗冻一模一样，
 * 直觉上是错的（"抗冻"应该冻得更短）。
 */
export function freezeDuration(baseSec: number, freezeRes: number): number {
  const res = Math.max(0, Math.min(1, freezeRes));
  return baseSec * (1 - res);
}

/** 嘲讽是否生效。狡诈按概率抵抗。`roll` 是 0-1 的随机数，由调用方给。 */
export function tauntLands(cunning: number, roll: number): boolean {
  return roll >= Math.max(0, Math.min(1, cunning));
}

/**
 * 一个英雄的击退力。
 * 近战看力量（`knockMelee`），远程看敏捷（`knockRanged`）——
 * 与"力量越大近战击退越高、敏捷越高远程击退越高"一一对应。
 * 武器阶额外 +10%/阶：高阶武器更重，与"阶自动成长"的局内节奏同向。
 */
export function heroKnock(hero: Hero, level: number, tier: 0 | 1 | 2): number {
  const w = WEAPONS[hero.weapon];
  const d = derive(hero.primary, level);
  const isMelee = w.category === 'melee';
  return w.knockback * (isMelee ? d.knockMelee : d.knockRanged) * (1 + 0.1 * tier);
}

/**
 * 僵尸对英雄的击退力。僵尸端的 `knock` 是表值，**刻意不随等级涨**——
 * 英雄的稳固随等级涨（`tgh × g`），如果两边一起涨就等于没涨。
 * 让守方随成长变稳，玩家才会感觉到"练起来之后队形不那么容易被冲散"。
 */
export function zombieKnock(z: Zombie, stage: number): number {
  return z.knock * stageMods(stage).dmg;
}

/**
 * 控制抗性的综合评分 0-1，只给哨兵和文档用，不参与实际结算。
 * 四项取平均：霸体视作稳固满分，其余三项是各自的抵抗值。
 * 它的用途是让"哪个僵尸最抗控"这件事可排序、可被文档引用，
 * 而不是散在四列数字里靠人眼比。
 */
export function controlResistance(z: Zombie): number {
  const armorScore = z.superArmor ? 1 : 0;
  // 稳固的归一化直接复用 knockChance 的 60 饱和点——
  // 两处若各用各的常数，"评分"和"实际命中率"会给出互相矛盾的排序。
  const stabScore = z.stab / (z.stab + 60);
  return (armorScore + stabScore + z.freezeRes + z.cunning) / 4;
}
