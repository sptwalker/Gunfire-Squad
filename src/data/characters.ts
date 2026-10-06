/**
 * 12 名可选角色，从中选 5 人组队。
 *
 * 设计约束（有意为之，不要打破）：
 * 1. 一级属性总和统一为 150 点，六个属性平摊。角色差异靠【分配方式】体现，不靠数值膨胀。
 *    否则"哪个角色强"就变成"哪个角色点数多"，阵容选择失去意义。
 *    ── 第二轮从「100 点四属性」改成「150 点六属性」，这是**重新参数化，不是加强**：
 *    每人多的 50 点全部进了幸运与体质两条新线，而暴击从敏捷、生命从韧性迁了出来，
 *    所以老四维都要下调。验收闸门是每个角色的 DPS 与有效生命相对旧版偏离 ≤10%，
 *    实测全部落在 ±7.5% 内（`_rebalance.ts` 是当时的草稿纸，跑完即弃）。
 *    这条闸门不是可选的——破了它，三个 BOSS 的血量锚点与 15 分钟曲线全部要重跑。
 * 2. 每个角色绑定一把主武器。武器不通用 → 玩家选角色时实际上在选武器组合，
 *    这是阵容深度的主要来源（不额外做羁绊系统）。
 * 3. 角色差异靠 aiProfile 参数体现，不是靠四套不同的 AI 代码。
 *    加一个新角色 = 加一行数据，不是加一个类。
 * 4. 不做羁绊/组合加成。理由：羁绊会让配平复杂度翻倍，而定位互补已经能产生
 *    足够的组合深度。这是本作明确的减法。
 *
 * ── 本轮新增（架构调整）──
 * 上一轮最大的空缺是：技能与僵尸的关键机制只写在 `note` 文案里，
 * 于是"这套阵容能不能破解这个挑战"这类问题无法计算，只能靠嘴说。
 * 这一轮把机制变成字段：`Skill` 的每个机械效果都有对应字段，`note` 退回纯描述。
 * 同时每个角色带上 `answers`（能回答哪些挑战维度）与 `specialization`（专精树）。
 *
 * ── 第二轮新增 ──
 * 一级属性从四维扩到六维（见约束 1）、技能分基础/高级两档（`tier`）、
 * 高级技能随转职替换升级、以及第四个 AI 旋钮来源：玩家的 `SQUAD_COMMANDS`。
 *
 * ── 第三轮新增 ──
 * 队伍的控制方式整体换了：队长由**鼠标点地**驱动（不再只靠 WASD），
 * `SQUAD_COMMANDS` 由四个开关式命令重构成**三个互斥阵型**。
 * 阵型不再是 `AIProfile` 的覆盖那么简单——它还决定**站位锚点怎么算**
 * （`FormationRing`），并且第一次真正用上了早就定义好的 `HeroRole`。
 */

import type { Primary } from './attributes.ts';
import type { WeaponClass, WeaponId } from './weapons.ts';
import type { TacticId } from './progression.ts';
import { ANSWER_DIMS, type AnswerTag, type DimensionId } from './scenes.ts';

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

/**
 * 技能的机械效果。
 *
 * 这些字段是上一轮写在 `note` 里的散文变成的。`mul` / `duration` / `cooldown`
 * 仍是配平主乘区（`skillAvgMul` 只读这三个 + `cdrAffected`），
 * 其余字段表达【形状】——它们不改变技能的等效 DPS，但决定这个技能能回答哪个维度。
 * 例：薇拉的 `vulnPct` 和萨满的 `atkMul` 在配平上等价，但前者需要集火窗口、
 * 后者是常驻光环，所以一个回答【围猎】、一个回答【开阔】。
 */
export interface Skill {
  name: string;
  /**
   * 技能档位。基础技能开局就有；高级技能要**两把钥匙**：
   * 军衔到级（`RANK_REQ`）**且**花技能点买下（见 `progression.ts`）。
   *
   * 为什么两把钥匙而不是一把：玩家的两条诉求是"技能点解锁高级技能"和
   * "军衔解锁高级技能"，两句都要成立。若只认一样，另一条成长线就退化成
   * 纯数值奖励；两把钥匙之后，技能点给【选择权】、军衔给【资格】，
   * 两条线的位置互不重叠——这也是它们不会互相淹没的原因。
   */
  tier: 'basic' | 'advanced';
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

  // ── 以下为机制化字段 ──
  /** 破甲：技能期间无视目标护甲的比例（0-1） */
  piercePct?: number;
  /** 削甲：技能期间降低目标护甲的比例，对全队生效（0-1） */
  armorShredPct?: number;
  /** 易伤：被标记目标受到的额外伤害比例，全队共享（0-1） */
  vulnPct?: number;
  /** 暴击率加成（绝对值） */
  critAdd?: number;
  /** 攻速倍率（1 = 不变） */
  rateMul?: number;
  /** 移动速度倍率（1 = 不变） */
  moveMul?: number;
  /** 全队攻击力加成（0-1） */
  atkMul?: number;
  /** 对敌减速比例（0-1） */
  slowPct?: number;
  /** 击退距离，格 */
  knockback?: number;
  /** 每秒灼烧伤害，等于【目标最大生命】的比例 */
  burnPctPerSec?: number;
  /** 冻结时长，秒 */
  freezeDuration?: number;
  /** 换弹时间归零 */
  reloadZero?: boolean;
  /** 召唤单位数量 */
  summons?: number;
  /** 每次施放的命中次数（多段技能） */
  hitsPerCast?: number;
  /** 链式跳跃的总目标数（含首个） */
  chainTargets?: number;

  note: string;
}

/**
 * 专精节点的效果。
 *
 * 【硬约束】这个联合类型里刻意【没有】"新增伤害乘区"这类变体。
 * 专精只能改伤害公式的输入——一级属性 / 武器阶 / 技能参数 / AI 参数 / 维度答案——
 * 不能新增乘区。原因：`core.computeDamage` 与 `sim.computeDamage` 之间那个
 * 324 用例、1e-6 容差的对账测试，前提是两者签名一致。一旦专精能插乘区，
 * core 就要多接一个参数，对账测试立刻失效。
 * 这条约束由编译器执行，不是靠注释提醒。
 */
export type SpecEffect =
  | { kind: 'attr'; attr: keyof Primary; amount: number }
  /** 解锁更高武器阶：amount = 可提升的阶数（受武器价格制约） */
  | { kind: 'weaponTier'; amount: number }
  /** 修改技能参数：加法或乘法 */
  | { kind: 'skill'; field: 'cooldown' | 'duration' | 'mul' | 'healPerSec' | 'teamDefMul'; amount: number; mode: 'add' | 'mul' }
  | { kind: 'ai'; field: 'aggroRange' | 'leashRange' | 'engageDistanceMul' | 'retreatHpPct'; amount: number }
  /** 战术动作：只由军衔给，专精树不用，不产出维度答案（见 progression.ts 的 TACTICS） */
  | { kind: 'tactic'; id: TacticId }
  /** 新增维度答案：专精树里最有价值的一类，直接改变这个角色能进的阵容 */
  | { kind: 'answer'; add: AnswerTag }
  /** 复活：全游戏只有莉安有这个效果（决策 C2） */
  | { kind: 'revive'; charges: number };

export interface SpecNode {
  id: string;
  name: string;
  /** 需要先点出的前置节点 */
  requires?: string;
  /** 花费专精点 */
  cost: number;
  effect: SpecEffect;
  note: string;
}

export interface Hero {
  id: string;
  name: string;
  role: HeroRole;
  weapon: WeaponId;
  /** 会用的武器类别，第一个是默认武器的类别。换武器只能在这些类别里换（`canEquip`） */
  weaponClasses: WeaponClass[];
  primary: Primary;
  /** 基础技能，开局就有 */
  skill: Skill;
  /**
   * 高级技能：军衔到级 + 技能点买下才能用（两把钥匙，见 `Skill.tier`）。
   *
   * **刻意不进 `skillAvgMul()`**——那个函数是配平的基准乘区，
   * 一旦把高级技能折进去，所有角色的纸面 DPS 会随"解锁进度"漂移，
   * 而 BOSS 血量锚点是按【基础技能】定死的。高级技能是**玩家的额外选项**，
   * 是通关之后的奖励，不是让数值达标的前提。这条和 `SpecEffect` 禁止新增
   * 伤害乘区是同一类约束：成长线不许动配平的分母。
   */
  advancedSkill: Skill;
  ai: AIProfile;
  /**
   * 这个角色【未点专精时】能回答哪些挑战维度。
   *
   * 专精可以往上加——顶层节点多数是 `{ kind: 'answer', add }`，见 `effectiveAnswers()`。
   * 这样"专精用来 build 不同的维度能力"就是可计算的，而不是文案。
   */
  answers: AnswerTag[];
  /** 专精树。按数组顺序解锁，`requires` 指明前置 */
  specialization: SpecNode[];
}

export const HEROES: Hero[] = [
  // ── 坦克：低输出高生存，负责把僵尸挡在外圈 ──
  {
    id: 'ron', name: '铁壁·罗恩', role: 'tank', weapon: 'greatsword',
    weaponClasses: ['blade', 'polearm'],
    primary: { str: 28, agi: 8, tgh: 42, int: 14, luk: 4, con: 54 },
    skill: {
      tier: 'basic',
      name: '磐石壁垒', cooldown: 20, duration: 6, mul: 1.4, cdrAffected: true,
      teamDefMul: 0.5,
      note: '期间全队减伤 50%，自身嘲讽',
    },
    advancedSkill: {
      tier: 'advanced', name: '铁壁冲锋', cooldown: 18, duration: 4, mul: 1.2, cdrAffected: true,
      knockback: 3, teamDefMul: 0.7,
      note: '向前冲撞，正面敌人被推开并强制嘲讽 4 秒——把已经在贴脸的怪群推回外圈',
    },
    ai: { aggroRange: 14, leashRange: 22, engageDistanceMul: 1.2, targetPriority: 'closest', retreatHpPct: 0 },
    answers: ['taunt', 'mitigate', 'aoeClear', 'deflect'],
    specialization: [
      { id: 'ron-1', name: '负重训练', cost: 1, effect: { kind: 'attr', attr: 'tgh', amount: 6 }, note: '嘲讽期间站得更稳' },
      { id: 'ron-2', name: '壁垒延展', cost: 2, requires: 'ron-1', effect: { kind: 'skill', field: 'duration', amount: 2, mode: 'add' }, note: '减伤窗口 6s → 8s' },
      { id: 'ron-3', name: '不屈壁垒', cost: 3, requires: 'ron-2', effect: { kind: 'answer', add: 'sustain' }, note: '技能窗口内自身持续回复，队伍能在最差的地形上原地死守（毒区 / 远程压制）' },
    ],
  },
  {
    id: 'gwen', name: '磐石·格温', role: 'tank', weapon: 'spear',
    weaponClasses: ['polearm', 'blade'],
    primary: { str: 30, agi: 12, tgh: 42, int: 10, luk: 6, con: 50 },
    skill: {
      tier: 'basic',
      name: '穿刺阵列', cooldown: 16, duration: 4, mul: 2.2, cdrAffected: true,
      piercePct: 0.4,
      note: '直线贯穿，无视 40% 目标护甲',
    },
    advancedSkill: {
      tier: 'advanced', name: '万枪归一', cooldown: 20, duration: 1, mul: 3.4, cdrAffected: true,
      piercePct: 1.0, hitsPerCast: 4,
      note: '投出长枪贯穿一整条直线，完全无视护甲并连续命中 4 次',
    },
    ai: { aggroRange: 16, leashRange: 24, engageDistanceMul: 1.0, targetPriority: 'closest', retreatHpPct: 0 },
    answers: ['block', 'aoeClear', 'deflect'],
    specialization: [
      { id: 'gwen-1', name: '枪术精研', cost: 1, effect: { kind: 'attr', attr: 'str', amount: 6 }, note: '贯穿伤害的基础值' },
      { id: 'gwen-2', name: '破阵', cost: 2, requires: 'gwen-1', effect: { kind: 'skill', field: 'mul', amount: 2.5, mode: 'mul' }, note: '倍率 2.2 → 5.5，全部押在技能窗口' },
      { id: 'gwen-3', name: '铁壁枪阵', cost: 3, requires: 'gwen-2', effect: { kind: 'answer', add: 'taunt' }, note: '长枪立阵钉住正面，为全队制造集火窗口（号令 / 招魂）' },
    ],
  },

  // ── 近战输出：高攻速贴脸，靠队友挡伤害 ──
  {
    id: 'kai', name: '疾风·凯', role: 'meleeDps', weapon: 'sword',
    weaponClasses: ['blade'],
    primary: { str: 40, agi: 28, tgh: 18, int: 10, luk: 32, con: 22 },
    skill: {
      tier: 'basic',
      name: '疾风连斩', cooldown: 12, duration: 3, mul: 2.6, cdrAffected: true,
      rateMul: 2.0, critAdd: 0.3, moveMul: 1.4,
      note: '攻速翻倍，暴击率 +30%，期间移动速度 +40%',
    },
    advancedSkill: {
      tier: 'advanced', name: '残影斩', cooldown: 15, duration: 3, mul: 3.2, cdrAffected: true,
      moveMul: 2.0, critAdd: 0.5,
      note: '瞬移到威胁最高的目标背后连斩，期间攻速与暴击大幅提升',
    },
    ai: { aggroRange: 18, leashRange: 26, engageDistanceMul: 1.1, targetPriority: 'weakest', retreatHpPct: 0.25 },
    answers: ['burst', 'singleTarget', 'mobility'],
    specialization: [
      { id: 'kai-1', name: '轻身', cost: 1, effect: { kind: 'attr', attr: 'agi', amount: 6 }, note: '暴击与闪避的基础' },
      { id: 'kai-2', name: '连斩不止', cost: 2, requires: 'kai-1', effect: { kind: 'skill', field: 'duration', amount: 2, mode: 'add' }, note: '爆发窗口 3s → 5s' },
      { id: 'kai-3', name: '疾风不息', cost: 3, requires: 'kai-2', effect: { kind: 'answer', add: 'aoeClear' }, note: '连斩的攻速加成不再依赖技能窗口，持续压制（潮涌）' },
    ],
  },
  {
    id: 'ironbull', name: '断岳·铁牛', role: 'meleeDps', weapon: 'greatsword',
    weaponClasses: ['blade', 'polearm'],
    primary: { str: 50, agi: 16, tgh: 26, int: 10, luk: 20, con: 28 },
    skill: {
      tier: 'basic',
      name: '裂地斩', cooldown: 14, duration: 2, mul: 3.0, cdrAffected: true,
      knockback: 2, armorShredPct: 0.25,
      note: '范围击退 + 撕裂，被击中目标护甲 -25%（持续 2 秒，全队共享）',
    },
    advancedSkill: {
      tier: 'advanced', name: '崩山', cooldown: 22, duration: 3, mul: 4.2, cdrAffected: true,
      knockback: 3, armorShredPct: 0.4,
      note: '跃起砸地，范围内敌人被击倒并撕裂护甲——清场与开团两用',
    },
    ai: { aggroRange: 15, leashRange: 22, engageDistanceMul: 1.2, targetPriority: 'strongest', retreatHpPct: 0.2 },
    answers: ['aoeClear', 'control', 'shred'],
    specialization: [
      { id: 'bull-1', name: '蛮力', cost: 1, effect: { kind: 'attr', attr: 'str', amount: 6 }, note: '' },
      { id: 'bull-2', name: '震波', cost: 2, requires: 'bull-1', effect: { kind: 'skill', field: 'mul', amount: 1.5, mode: 'mul' }, note: '倍率 3.0 → 4.5' },
      { id: 'bull-3', name: '山崩', cost: 3, requires: 'bull-2', effect: { kind: 'answer', add: 'seismic' }, note: '裂地斩的冲击波穿透地面，碎石把敌人压在原地（潮涌 / 遁地）' },
    ],
  },

  // ── 远程输出：高 DPS 但脆，需要坦克保护 ──
  {
    id: 'vera', name: '鹰眼·薇拉', role: 'rangedDps', weapon: 'sniper',
    weaponClasses: ['sniper', 'bow', 'rifle'],
    primary: { str: 33, agi: 34, tgh: 14, int: 16, luk: 38, con: 15 },
    skill: {
      tier: 'basic',
      name: '致命标记', cooldown: 18, duration: 5, mul: 2.4, cdrAffected: true,
      vulnPct: 0.35,
      note: '标记目标，全队对其伤害 +35%',
    },
    advancedSkill: {
      tier: 'advanced', name: '穿甲狙击', cooldown: 24, duration: 1, mul: 5.0, cdrAffected: true,
      piercePct: 0.8, critAdd: 0.4,
      note: '蓄力一击，无视 80% 护甲。专治高防与霸体目标',
    },
    ai: { aggroRange: 40, leashRange: 55, engageDistanceMul: 0.8, targetPriority: 'strongest', retreatHpPct: 0.3 },
    answers: ['shred', 'ranged', 'singleTarget', 'burst', 'antiAir'],
    specialization: [
      { id: 'vera-1', name: '稳定射击', cost: 1, effect: { kind: 'attr', attr: 'agi', amount: 6 }, note: '' },
      { id: 'vera-2', name: '致命一击', cost: 2, requires: 'vera-1', effect: { kind: 'skill', field: 'cooldown', amount: -4, mode: 'add' }, note: '标记冷却 18s → 14s，窗口更密' },
      { id: 'vera-3', name: '贯日狙击', cost: 3, requires: 'vera-2', effect: { kind: 'answer', add: 'physical' }, note: '蓄力后沿直线打出一发超远程穿甲弹（射程 60 格，全图级），一路穿透所有目标并击退——击退走 knockChance 对撞稳固，霸体只吃伤害不被推开（物抗 / 魔抗）' },
    ],
  },
  {
    id: 'jet', name: '弹幕·杰特', role: 'rangedDps', weapon: 'smg',
    weaponClasses: ['smg', 'rifle'],
    primary: { str: 30, agi: 38, tgh: 16, int: 14, luk: 36, con: 16 },
    skill: {
      tier: 'basic',
      name: '弹幕压制', cooldown: 15, duration: 5, mul: 1.9, cdrAffected: true,
      reloadZero: true, rateMul: 1.4,
      note: '换弹时间归零，射速 +40%，压制射击令目标减速',
    },
    advancedSkill: {
      tier: 'advanced', name: '弹雨覆盖', cooldown: 20, duration: 6, mul: 2.2, cdrAffected: true,
      rateMul: 1.6, slowPct: 0.5,
      note: '把弹幕铺满一整片地面，持续压制的区域里敌人寸步难行',
    },
    ai: { aggroRange: 24, leashRange: 32, engageDistanceMul: 0.85, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['aoeClear', 'control', 'burst', 'antiAir'],
    specialization: [
      { id: 'jet-1', name: '压枪', cost: 1, effect: { kind: 'attr', attr: 'agi', amount: 6 }, note: '' },
      { id: 'jet-2', name: '弹链改造', cost: 2, requires: 'jet-1', effect: { kind: 'skill', field: 'duration', amount: 3, mode: 'add' }, note: '压制窗口 5s → 8s，接近常驻' },
      { id: 'jet-3', name: '天降火雨', cost: 3, requires: 'jet-2', effect: { kind: 'answer', add: 'magic' }, note: '召唤一片火雨覆盖目标区域（半径 6 格、持续 8 秒），灼烧伤害不吃护甲减免，区域内持续打击（物抗 / 电磁场 / 潮涌）' },
    ],
  },

  // ── 控制：不追求 DPS，追求让僵尸打不到人 ──
  {
    id: 'ella', name: '霜语·艾拉', role: 'control', weapon: 'freezer',
    weaponClasses: ['sprayer'],
    primary: { str: 14, agi: 22, tgh: 18, int: 54, luk: 22, con: 20 },
    skill: {
      tier: 'basic',
      name: '绝对零度', cooldown: 22, duration: 3, mul: 1.5, cdrAffected: true,
      teamDefMul: 0, freezeDuration: 3, vulnPct: 0.5,
      note: '全场冻结 3 秒（冻结期间不造成伤害），被冻结目标受伤 +50%',
    },
    advancedSkill: {
      tier: 'advanced', name: '寒霜新星', cooldown: 26, duration: 4, mul: 1.8, cdrAffected: true,
      freezeDuration: 4, slowPct: 0.6,
      note: '以自身为中心扩散的冻结波，被控住的敌人解冻后仍被减速',
    },
    ai: { aggroRange: 20, leashRange: 28, engageDistanceMul: 0.8, targetPriority: 'closest', retreatHpPct: 0.35 },
    answers: ['control', 'aoeClear', 'magic', 'calm'],
    specialization: [
      { id: 'ella-1', name: '寒气精研', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'ella-2', name: '极寒延展', cost: 2, requires: 'ella-1', effect: { kind: 'skill', field: 'duration', amount: 2, mode: 'add' }, note: '冻结 3s → 5s，集火窗口翻倍' },
      { id: 'ella-3', name: '永冻领域', cost: 3, requires: 'ella-2', effect: { kind: 'answer', add: 'mitigate' }, note: '大范围（半径 10 格）把敌人彻底冻成冰雕：普通僵尸按抗冻 freezeRes 判定，冻住即永久退出战斗，冰雕一击即碎并正常结算；精英与 BOSS 只冻 3 秒——冻住的敌人不再造成伤害，全队承伤骤降（突进 / 毒区 / 远程压制）' },
    ],
  },
  {
    id: 'bom', name: '震地·博姆', role: 'control', weapon: 'grenade',
    weaponClasses: ['heavy'],
    primary: { str: 22, agi: 20, tgh: 26, int: 34, luk: 20, con: 28 },
    skill: {
      tier: 'basic',
      name: '连环爆破', cooldown: 18, duration: 4, mul: 2.8, cdrAffected: true,
      teamDefMul: 0.6, knockback: 1.5, slowPct: 0.4, hitsPerCast: 3,
      note: '投掷 3 枚手雷，附带击退与减速 40%',
    },
    advancedSkill: {
      tier: 'advanced', name: '定点轰炸', cooldown: 24, duration: 5, mul: 3.6, cdrAffected: true,
      knockback: 2.5, burnPctPerSec: 0.015,
      note: '呼叫炮击覆盖一整片区域，持续击倒并燃烧',
    },
    ai: { aggroRange: 26, leashRange: 34, engageDistanceMul: 0.9, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['summon', 'aoeClear', 'control'],
    specialization: [
      { id: 'bom-1', name: '装药强化', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'bom-2', name: '多投', cost: 2, requires: 'bom-1', effect: { kind: 'attr', attr: 'agi', amount: 8 }, note: '投掷节奏更快，三雷覆盖更宽' },
      { id: 'bom-3', name: '破片装药', cost: 3, requires: 'bom-2', effect: { kind: 'answer', add: 'shred' }, note: '手雷破片削减目标抗性并标记，全队受益（物抗 / 魔抗）' },
    ],
  },

  // ── 辅助：治疗与增益 ──
  {
    id: 'lian', name: '圣手·莉安', role: 'support', weapon: 'pistol',
    // ponytail: 弓箭对她是 ×2.00（跨类别也会击穿 BOSS 锚点），步枪 ×1.53，所以只留短枪
    weaponClasses: ['pistol'],
    primary: { str: 14, agi: 20, tgh: 20, int: 52, luk: 22, con: 22 },
    skill: {
      tier: 'basic',
      name: '生命涌流', cooldown: 20, duration: 4, mul: 1.0, cdrAffected: true,
      healPerSec: 0.06,
      note: '持续治疗全队，总量约等于自身最大生命 120%',
    },
    advancedSkill: {
      tier: 'advanced', name: '圣愈领域', cooldown: 28, duration: 8, mul: 1.0, cdrAffected: true,
      healPerSec: 0.09, teamDefMul: 0.8,
      note: '展开持续治疗领域，范围内的队员同时获得减伤',
    },
    ai: { aggroRange: 22, leashRange: 30, engageDistanceMul: 0.75, targetPriority: 'weakest', retreatHpPct: 0.4 },
    answers: ['sustain', 'mitigate', 'singleTarget', 'dispel'],
    specialization: [
      { id: 'lian-1', name: '医理', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '治疗量随智力走' },
      { id: 'lian-2', name: '涌流不止', cost: 2, requires: 'lian-1', effect: { kind: 'skill', field: 'cooldown', amount: -6, mode: 'add' }, note: '冷却 20s → 14s，续航覆盖全程' },
      // 决策 C2：不做通用复活机制，唯一例外放在辅助位的专精顶层。
      { id: 'lian-3', name: '战地复活', cost: 3, requires: 'lian-2', effect: { kind: 'revive', charges: 1 }, note: '全游戏唯一的复活效果：每局一次，将最近阵亡的队员以 50% 生命拉回战场' },
    ],
  },
  {
    id: 'shaman', name: '烈焰·萨满', role: 'support', weapon: 'flamer',
    weaponClasses: ['sprayer'],
    primary: { str: 20, agi: 18, tgh: 24, int: 44, luk: 18, con: 26 },
    skill: {
      tier: 'basic',
      name: '战意图腾', cooldown: 24, duration: 8, mul: 1.7, cdrAffected: true,
      atkMul: 0.3, rateMul: 1.2, burnPctPerSec: 0.01,
      note: '全队攻击 +30%，攻速 +20%，范围内敌人每秒受到最大生命 1% 的灼烧伤害',
    },
    advancedSkill: {
      tier: 'advanced', name: '熔岩图腾', cooldown: 26, duration: 10, mul: 2.0, cdrAffected: true,
      burnPctPerSec: 0.02, slowPct: 0.35,
      note: '图腾涌出熔岩，覆盖的地面持续灼烧并拖慢敌人',
    },
    ai: { aggroRange: 18, leashRange: 26, engageDistanceMul: 1.0, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['aoeClear', 'magic', 'mitigate', 'dispel'],
    specialization: [
      { id: 'shaman-1', name: '火种', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'shaman-2', name: '图腾延烧', cost: 2, requires: 'shaman-1', effect: { kind: 'skill', field: 'duration', amount: 4, mode: 'add' }, note: '光环 8s → 12s' },
      { id: 'shaman-3', name: '熔甲', cost: 3, requires: 'shaman-2', effect: { kind: 'answer', add: 'antiHeal' }, note: '火焰从范围压制转为定点熔甲，被烧穿的目标无法回复（再生 / 招魂）' },
    ],
  },

  // ── 召唤：用数量换输出，自动战斗里收益稳定 ──
  {
    id: 'nox', name: '傀儡师·诺克斯', role: 'summoner', weapon: 'boomerang',
    weaponClasses: ['thrown', 'bow'],
    primary: { str: 22, agi: 18, tgh: 22, int: 46, luk: 20, con: 22 },
    skill: {
      tier: 'basic',
      name: '骸骨傀儡', cooldown: 26, duration: 10, mul: 1.8, cdrAffected: true,
      summons: 2,
      note: '召唤 2 只傀儡参战，分摊仇恨并自动索敌',
    },
    advancedSkill: {
      tier: 'advanced', name: '骸骨巨像', cooldown: 30, duration: 15, mul: 2.4, cdrAffected: true,
      summons: 1,
      note: '召唤一只大型傀儡，血量与伤害远超普通傀儡，能独立顶住一条线',
    },
    ai: { aggroRange: 20, leashRange: 28, engageDistanceMul: 0.9, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['summon', 'singleTarget', 'cleanse', 'calm'],
    specialization: [
      { id: 'nox-1', name: '傀儡加固', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '傀儡属性随智力走' },
      { id: 'nox-2', name: '双生', cost: 2, requires: 'nox-1', effect: { kind: 'attr', attr: 'tgh', amount: 8 }, note: '本体更耐打，傀儡不需要保护召唤者' },
      { id: 'nox-3', name: '亡者军团', cost: 3, requires: 'nox-2', effect: { kind: 'answer', add: 'mitigate' }, note: '把周围（半径 8 格）地上的敌方尸体唤起为傀儡军团，至多 12 具、持续 30 秒、血量为原僵尸的 50%；精英与 BOSS 的尸体唤不起。军团是一堵会走的肉墙，替小队吃突进与喷吐（突进 / 遁地 / 空中）' },
    ],
  },
  {
    id: 'sif', name: '蜂群·西芙', role: 'summoner', weapon: 'laser',
    weaponClasses: ['beam', 'pistol'],
    primary: { str: 18, agi: 22, tgh: 20, int: 44, luk: 24, con: 22 },
    skill: {
      tier: 'basic',
      name: '纳米蜂群', cooldown: 16, duration: 6, mul: 2.1, cdrAffected: true,
      chainTargets: 6, armorShredPct: 0.2,
      note: '链式激光额外跳 5 目标，附带腐蚀（护甲 -20%）',
    },
    advancedSkill: {
      tier: 'advanced', name: '蜂群风暴', cooldown: 22, duration: 6, mul: 2.6, cdrAffected: true,
      chainTargets: 12, armorShredPct: 0.35,
      note: '蜂群扩散至全场，链式跳跃到 12 个目标并深度腐蚀护甲',
    },
    ai: { aggroRange: 28, leashRange: 36, engageDistanceMul: 0.85, targetPriority: 'weakest', retreatHpPct: 0.35 },
    answers: ['aoeClear', 'electric', 'detect', 'summon'],
    specialization: [
      { id: 'sif-1', name: '蜂群增殖', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'sif-2', name: '跳数增加', cost: 2, requires: 'sif-1', effect: { kind: 'skill', field: 'mul', amount: 1.4, mode: 'mul' }, note: '链式每跳伤害 ×1.4，清潮涌更干净' },
      { id: 'sif-3', name: '蜂群缠附', cost: 3, requires: 'sif-2', effect: { kind: 'answer', add: 'control' }, note: '纳米蜂群黏附目标，普攻附带减速——自爆兵在贴身之前就被拖住（自爆 / 突进）' },
    ],
  },
];

export const HEROES_BY_ID: Record<string, Hero> = Object.fromEntries(
  HEROES.map((h) => [h.id, h]),
);

export const SQUAD_SIZE = 5;

/**
 * 三种小队阵型（第三轮重构，取代第二轮的四个命令按钮）。
 *
 * 阵型是 AI 的**输入**，不是新的 AI 代码——每一档只决定队员的**站位锚点**
 * （原型里的 `h.home`）怎么算：谁站外圈、谁站中心、离队长多远、朝哪边展开。
 * 索敌 / 拴绳 / 走位 / 开火全部复用队员自己的 `aiProfile`。
 * 阵型管的是"队伍长什么形状"，不管"队员怎么打架"。
 *
 * 三档**互斥**，是同一条轴上的三个档位。互斥不是限制，是减负：
 * 不存在"集火的同时紧密跟随"这类叠加态，玩家脑子里只需要维持一个位。
 * 命令栏因此仍然是**效率旋钮**，不是操作门槛（`00-决策清单.md` A29）——
 * 压舱石依旧是"**不碰阵型也能通关**"。
 *
 * 覆盖规则：阵型的 `overrides` 叠在角色自己的 `ai` 之上。
 * 默认档 `defend` 的 `overrides` 是 `{}`——**默认值必须是"什么都不覆盖"**，
 * 否则"不碰阵型也能通关"这条无法成立。
 */
export interface FormationRing {
  /** 这一层站哪些定位。`HeroRole` 早就在数据里了，阵型是它第一次真正被 AI 用上 */
  roles: HeroRole[];
  /** 站位锚点距队长的半径，格 */
  radius: number;
  /** 相对阵型朝向的方位角，弧度：0 = 正前，π = 正后。`spread` 为 2π 时无意义 */
  bearing: number;
  /** 该层展开的总张角，弧度；2π = 铺满一圈（环形阵） */
  spread: number;
  /** 最大活动半径，格。**硬约束**：超出即强制回位。
   *  地面画出来的近战活动圈读的就是这个数——可视化和约束同源，不许有两份。 */
  tether: number;
}

export interface SquadCommand {
  id: SquadCommandId;
  name: string;
  /** 这一档吃不吃玩家指定的朝向。false = 环形，朝向无意义 */
  facing: boolean;
  /** 从外到内排列，先铺前面的层 */
  rings: FormationRing[];
  /** 切到这一档时，队员 AI 的覆盖值 */
  overrides: Partial<AIProfile>;
  note: string;
}

export type SquadCommandId = 'defend' | 'ring' | 'advance';

/** 近战层：坦克排在前面，所以 `roles` 的顺序就是槽位的顺序，重剑士跟在坦克后面 */
const MELEE: HeroRole[] = ['tank', 'meleeDps'];
/** 中心层：辅助与控制都不顶前排，站在队长身边 */
const CORE: HeroRole[] = ['support', 'control', 'summoner'];
/** 后排层：纯输出，站最后面 */
const BACK: HeroRole[] = ['rangedDps'];

export const SQUAD_COMMANDS: SquadCommand[] = [
  {
    id: 'defend', name: '普通防御阵型', facing: true,
    // 最紧的一档：近战铺一道扇形挡在阵前，远程缩在队长身后，辅助在中心
    rings: [
      { roles: MELEE, radius: 2.2, bearing: 0, spread: Math.PI * 1.1, tether: 7 },
      { roles: BACK, radius: 4.4, bearing: Math.PI, spread: Math.PI * 0.9, tether: 2.5 },
      { roles: CORE, radius: 1.3, bearing: Math.PI, spread: Math.PI * 2, tether: 2.5 },
    ],
    overrides: {},
    note: '默认档。最紧密的站位，有朝向。近战在前、远程在后、辅助在中心，全员收在队长周围',
  },
  {
    id: 'ring', name: '环形防御阵型', facing: false,
    // 无朝向：近战铺满外圈防 360°，远程同样环视射击，辅助在内圈游走
    rings: [
      { roles: MELEE, radius: 3.0, bearing: 0, spread: Math.PI * 2, tether: 7 },
      { roles: BACK, radius: 5.2, bearing: 0, spread: Math.PI * 2, tether: 2.5 },
      { roles: CORE, radius: 1.6, bearing: 0, spread: Math.PI * 2, tether: 3 },
    ],
    overrides: { engageDistanceMul: 0.9 },
    note: '被包围时用。没有朝向，近战在外圈防四面来敌，远程环视射击，辅助在内圈按需游走',
  },
  {
    id: 'advance', name: '搜索推进阵型', facing: true,
    // 松散：近战可以前置得更远，整层的活动半径也跟着放大
    rings: [
      { roles: MELEE, radius: 4.0, bearing: 0, spread: Math.PI * 1.4, tether: 10 },
      { roles: BACK, radius: 5.5, bearing: Math.PI, spread: Math.PI * 1.2, tether: 3.5 },
      { roles: CORE, radius: 2.0, bearing: 0, spread: Math.PI * 2, tether: 4 },
    ],
    overrides: { aggroRange: 6, engageDistanceMul: 1.15 },
    note: '推进与清图用。站位更松散，近战可以前置得更远、活动范围更大，代价是收不紧',
  },
];

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

/**
 * 这个角色能回答哪些维度。
 *
 * `answers` 是【基础答案】，专精树里 `{ kind: 'answer', add }` 的节点会往上加。
 * 默认传 `Infinity`（全点满）——哨兵关心的是"这个角色最终能进哪些阵容"，
 * 而不是"0 专精点的角色能进哪些"。想看初始状态就显式传 0。
 */
export function effectiveAnswers(hero: Hero, specPoints = Infinity): AnswerTag[] {
  const out = new Set<AnswerTag>(hero.answers);
  let budget = specPoints;
  let cost = 0;
  // 专精树是有序的：按数组顺序解锁，买不起就停
  for (const node of hero.specialization) {
    cost += node.cost;
    if (cost > budget) break;
    if (node.effect.kind === 'answer') out.add(node.effect.add);
  }
  return [...out];
}

/** 某角色能否回答指定维度（含专精加成）。哨兵 §9 的覆盖矩阵与 §10 的阵容枚举都走这里 */
export function answersDimension(hero: Hero, dim: DimensionId): boolean {
  return effectiveAnswers(hero).some((a) => ANSWER_DIMS[a].includes(dim));
}

/** 某角色的答案标签能回答哪些维度（含专精加成，去重） */
export function answeredDims(hero: Hero): DimensionId[] {
  const out = new Set<DimensionId>();
  for (const a of effectiveAnswers(hero)) for (const d of ANSWER_DIMS[a]) out.add(d);
  return [...out];
}
