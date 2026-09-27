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
 *
 * ── 本轮新增（架构调整）──
 * 上一轮最大的空缺是：技能与僵尸的关键机制只写在 `note` 文案里，
 * 于是"这套阵容能不能破解这个挑战"这类问题无法计算，只能靠嘴说。
 * 这一轮把机制变成字段：`Skill` 的每个机械效果都有对应字段，`note` 退回纯描述。
 * 同时每个角色带上 `answers`（能回答哪些挑战维度）与 `specialization`（专精树）。
 *
 * 12 个 id、定位、绑定武器、一级属性分配【全部未改动】——改的只有技能层。
 */

import type { Primary } from './attributes.ts';
import type { WeaponId } from './weapons.ts';
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
  primary: Primary;
  skill: Skill;
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
    primary: { str: 28, agi: 8, tgh: 50, int: 14 },
    skill: {
      name: '磐石壁垒', cooldown: 20, duration: 6, mul: 1.4, cdrAffected: true,
      teamDefMul: 0.5,
      note: '期间全队减伤 50%，自身嘲讽',
    },
    ai: { aggroRange: 14, leashRange: 22, engageDistanceMul: 1.2, targetPriority: 'closest', retreatHpPct: 0 },
    answers: ['taunt', 'mitigate', 'aoeClear'],
    specialization: [
      { id: 'ron-1', name: '负重训练', cost: 1, effect: { kind: 'attr', attr: 'tgh', amount: 6 }, note: '嘲讽期间站得更稳' },
      { id: 'ron-2', name: '壁垒延展', cost: 2, requires: 'ron-1', effect: { kind: 'skill', field: 'duration', amount: 2, mode: 'add' }, note: '减伤窗口 6s → 8s' },
      { id: 'ron-3', name: '不屈壁垒', cost: 3, requires: 'ron-2', effect: { kind: 'answer', add: 'sustain' }, note: '技能窗口内自身持续回复，队伍能在最差的地形上原地死守（迟滞）' },
    ],
  },
  {
    id: 'gwen', name: '磐石·格温', role: 'tank', weapon: 'spear',
    primary: { str: 30, agi: 12, tgh: 46, int: 12 },
    skill: {
      name: '穿刺阵列', cooldown: 16, duration: 4, mul: 2.2, cdrAffected: true,
      piercePct: 0.4,
      note: '直线贯穿，无视 40% 目标护甲',
    },
    ai: { aggroRange: 16, leashRange: 24, engageDistanceMul: 1.0, targetPriority: 'closest', retreatHpPct: 0 },
    answers: ['pierce', 'aoeClear'],
    specialization: [
      { id: 'gwen-1', name: '枪术精研', cost: 1, effect: { kind: 'attr', attr: 'str', amount: 6 }, note: '贯穿伤害的基础值' },
      { id: 'gwen-2', name: '破阵', cost: 2, requires: 'gwen-1', effect: { kind: 'skill', field: 'mul', amount: 2.5, mode: 'mul' }, note: '倍率 2.2 → 5.5，全部押在技能窗口' },
      { id: 'gwen-3', name: '铁壁枪阵', cost: 3, requires: 'gwen-2', effect: { kind: 'answer', add: 'taunt' }, note: '长枪立阵钉住正面，为全队制造集火窗口（围猎）' },
    ],
  },

  // ── 近战输出：高攻速贴脸，靠队友挡伤害 ──
  {
    id: 'kai', name: '疾风·凯', role: 'meleeDps', weapon: 'sword',
    primary: { str: 40, agi: 30, tgh: 20, int: 10 },
    skill: {
      name: '疾风连斩', cooldown: 12, duration: 3, mul: 2.6, cdrAffected: true,
      rateMul: 2.0, critAdd: 0.3, moveMul: 1.4,
      note: '攻速翻倍，暴击率 +30%，期间移动速度 +40%',
    },
    ai: { aggroRange: 18, leashRange: 26, engageDistanceMul: 1.1, targetPriority: 'weakest', retreatHpPct: 0.25 },
    answers: ['burst', 'singleTarget', 'mobility'],
    specialization: [
      { id: 'kai-1', name: '轻身', cost: 1, effect: { kind: 'attr', attr: 'agi', amount: 6 }, note: '暴击与闪避的基础' },
      { id: 'kai-2', name: '连斩不止', cost: 2, requires: 'kai-1', effect: { kind: 'skill', field: 'duration', amount: 2, mode: 'add' }, note: '爆发窗口 3s → 5s' },
      { id: 'kai-3', name: '疾风不息', cost: 3, requires: 'kai-2', effect: { kind: 'answer', add: 'sustainedDps' }, note: '连斩的攻速加成不再依赖技能窗口，持续压制（潮涌）' },
    ],
  },
  {
    id: 'ironbull', name: '断岳·铁牛', role: 'meleeDps', weapon: 'greatsword',
    primary: { str: 46, agi: 18, tgh: 26, int: 10 },
    skill: {
      name: '裂地斩', cooldown: 14, duration: 2, mul: 3.0, cdrAffected: true,
      knockback: 2, armorShredPct: 0.25,
      note: '范围击退 + 撕裂，被击中目标护甲 -25%（持续 2 秒，全队共享）',
    },
    ai: { aggroRange: 15, leashRange: 22, engageDistanceMul: 1.2, targetPriority: 'strongest', retreatHpPct: 0.2 },
    answers: ['aoeClear', 'control', 'armorShred'],
    specialization: [
      { id: 'bull-1', name: '蛮力', cost: 1, effect: { kind: 'attr', attr: 'str', amount: 6 }, note: '' },
      { id: 'bull-2', name: '震波', cost: 2, requires: 'bull-1', effect: { kind: 'skill', field: 'mul', amount: 1.5, mode: 'mul' }, note: '倍率 3.0 → 4.5' },
      { id: 'bull-3', name: '山崩', cost: 3, requires: 'bull-2', effect: { kind: 'answer', add: 'explosive' }, note: '裂地斩的冲击波无视护甲，碎石把敌人压在原地（卡口）' },
    ],
  },

  // ── 远程输出：高 DPS 但脆，需要坦克保护 ──
  {
    id: 'vera', name: '鹰眼·薇拉', role: 'rangedDps', weapon: 'sniper',
    primary: { str: 34, agi: 36, tgh: 14, int: 16 },
    skill: {
      name: '致命标记', cooldown: 18, duration: 5, mul: 2.4, cdrAffected: true,
      vulnPct: 0.35,
      note: '标记目标，全队对其伤害 +35%',
    },
    ai: { aggroRange: 40, leashRange: 55, engageDistanceMul: 0.8, targetPriority: 'strongest', retreatHpPct: 0.3 },
    answers: ['debuff', 'ranged', 'singleTarget', 'burst'],
    specialization: [
      { id: 'vera-1', name: '稳定射击', cost: 1, effect: { kind: 'attr', attr: 'agi', amount: 6 }, note: '' },
      { id: 'vera-2', name: '致命一击', cost: 2, requires: 'vera-1', effect: { kind: 'skill', field: 'cooldown', amount: -4, mode: 'add' }, note: '标记冷却 18s → 14s，窗口更密' },
      { id: 'vera-3', name: '破盾弹', cost: 3, requires: 'vera-2', effect: { kind: 'skill', field: 'mul', amount: 1.5, mode: 'mul' }, note: '技能倍率 ×1.5，标记窗口的单发爆发翻倍' },
    ],
  },
  {
    id: 'jet', name: '弹幕·杰特', role: 'rangedDps', weapon: 'smg',
    primary: { str: 30, agi: 40, tgh: 16, int: 14 },
    skill: {
      name: '弹幕压制', cooldown: 15, duration: 5, mul: 1.9, cdrAffected: true,
      reloadZero: true, rateMul: 1.4,
      note: '换弹时间归零，射速 +40%，压制射击令目标减速',
    },
    ai: { aggroRange: 24, leashRange: 32, engageDistanceMul: 0.85, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['sustainedDps', 'control', 'burst'],
    specialization: [
      { id: 'jet-1', name: '压枪', cost: 1, effect: { kind: 'attr', attr: 'agi', amount: 6 }, note: '' },
      { id: 'jet-2', name: '弹链改造', cost: 2, requires: 'jet-1', effect: { kind: 'skill', field: 'duration', amount: 3, mode: 'add' }, note: '压制窗口 5s → 8s，接近常驻' },
      { id: 'jet-3', name: '火网', cost: 3, requires: 'jet-2', effect: { kind: 'skill', field: 'mul', amount: 1.6, mode: 'mul' }, note: '倍率 1.9 → 3.04，从持续输出变成半个爆发位' },
    ],
  },

  // ── 控制：不追求 DPS，追求让僵尸打不到人 ──
  {
    id: 'ella', name: '霜语·艾拉', role: 'control', weapon: 'freezer',
    primary: { str: 14, agi: 22, tgh: 18, int: 46 },
    skill: {
      name: '绝对零度', cooldown: 22, duration: 3, mul: 1.5, cdrAffected: true,
      teamDefMul: 0, freezeDuration: 3, vulnPct: 0.5,
      note: '全场冻结 3 秒（冻结期间不造成伤害），被冻结目标受伤 +50%',
    },
    ai: { aggroRange: 20, leashRange: 28, engageDistanceMul: 0.8, targetPriority: 'closest', retreatHpPct: 0.35 },
    answers: ['control', 'aoeClear', 'debuff'],
    specialization: [
      { id: 'ella-1', name: '寒气精研', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'ella-2', name: '极寒延展', cost: 2, requires: 'ella-1', effect: { kind: 'skill', field: 'duration', amount: 2, mode: 'add' }, note: '冻结 3s → 5s，集火窗口翻倍' },
      { id: 'ella-3', name: '冰封核心', cost: 3, requires: 'ella-2', effect: { kind: 'skill', field: 'cooldown', amount: -6, mode: 'add' }, note: '冷却 22s → 16s，控制成为主要节奏' },
    ],
  },
  {
    id: 'bom', name: '震地·博姆', role: 'control', weapon: 'grenade',
    primary: { str: 22, agi: 20, tgh: 26, int: 32 },
    skill: {
      name: '连环爆破', cooldown: 18, duration: 4, mul: 2.8, cdrAffected: true,
      teamDefMul: 0.6, knockback: 1.5, slowPct: 0.4, hitsPerCast: 3,
      note: '投掷 3 枚手雷，附带击退与减速 40%',
    },
    ai: { aggroRange: 26, leashRange: 34, engageDistanceMul: 0.9, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['explosive', 'aoeClear', 'control'],
    specialization: [
      { id: 'bom-1', name: '装药强化', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'bom-2', name: '多投', cost: 2, requires: 'bom-1', effect: { kind: 'attr', attr: 'agi', amount: 8 }, note: '投掷节奏更快，三雷覆盖更宽' },
      { id: 'bom-3', name: '破片装药', cost: 3, requires: 'bom-2', effect: { kind: 'answer', add: 'armorShred' }, note: '手雷破片削减护甲并标记目标，全队受益（精英护盾 / 围猎）' },
    ],
  },

  // ── 辅助：治疗与增益 ──
  {
    id: 'lian', name: '圣手·莉安', role: 'support', weapon: 'pistol',
    primary: { str: 14, agi: 20, tgh: 20, int: 46 },
    skill: {
      name: '生命涌流', cooldown: 20, duration: 4, mul: 1.0, cdrAffected: true,
      healPerSec: 0.06,
      note: '持续治疗全队，总量约等于自身最大生命 120%',
    },
    ai: { aggroRange: 22, leashRange: 30, engageDistanceMul: 0.75, targetPriority: 'weakest', retreatHpPct: 0.4 },
    answers: ['sustain', 'mitigate', 'singleTarget'],
    specialization: [
      { id: 'lian-1', name: '医理', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '治疗量随智力走' },
      { id: 'lian-2', name: '涌流不止', cost: 2, requires: 'lian-1', effect: { kind: 'skill', field: 'cooldown', amount: -6, mode: 'add' }, note: '冷却 20s → 14s，续航覆盖全程' },
      // 决策 C2：不做通用复活机制，唯一例外放在辅助位的专精顶层。
      { id: 'lian-3', name: '战地复活', cost: 3, requires: 'lian-2', effect: { kind: 'revive', charges: 1 }, note: '全游戏唯一的复活效果：每局一次，将最近阵亡的队员以 50% 生命拉回战场' },
    ],
  },
  {
    id: 'shaman', name: '烈焰·萨满', role: 'support', weapon: 'flamer',
    primary: { str: 20, agi: 18, tgh: 24, int: 38 },
    skill: {
      name: '战意图腾', cooldown: 24, duration: 8, mul: 1.7, cdrAffected: true,
      atkMul: 0.3, rateMul: 1.2, burnPctPerSec: 0.01,
      note: '全队攻击 +30%，攻速 +20%，范围内敌人每秒受到最大生命 1% 的灼烧伤害',
    },
    ai: { aggroRange: 18, leashRange: 26, engageDistanceMul: 1.0, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['explosive', 'sustainedDps', 'debuff'],
    specialization: [
      { id: 'shaman-1', name: '火种', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'shaman-2', name: '图腾延烧', cost: 2, requires: 'shaman-1', effect: { kind: 'skill', field: 'duration', amount: 4, mode: 'add' }, note: '光环 8s → 12s' },
      { id: 'shaman-3', name: '熔甲', cost: 3, requires: 'shaman-2', effect: { kind: 'answer', add: 'singleTarget' }, note: '火焰从范围压制转为定点熔甲，烧穿单个目标（分裂）' },
    ],
  },

  // ── 召唤：用数量换输出，自动战斗里收益稳定 ──
  {
    id: 'nox', name: '傀儡师·诺克斯', role: 'summoner', weapon: 'boomerang',
    primary: { str: 22, agi: 18, tgh: 22, int: 38 },
    skill: {
      name: '骸骨傀儡', cooldown: 26, duration: 10, mul: 1.8, cdrAffected: true,
      summons: 2,
      note: '召唤 2 只傀儡参战，分摊仇恨并自动索敌',
    },
    ai: { aggroRange: 20, leashRange: 28, engageDistanceMul: 0.9, targetPriority: 'closest', retreatHpPct: 0.3 },
    answers: ['summon', 'singleTarget', 'aoeClear'],
    specialization: [
      { id: 'nox-1', name: '傀儡加固', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '傀儡属性随智力走' },
      { id: 'nox-2', name: '双生', cost: 2, requires: 'nox-1', effect: { kind: 'attr', attr: 'tgh', amount: 8 }, note: '本体更耐打，傀儡不需要保护召唤者' },
      { id: 'nox-3', name: '亡者军团', cost: 3, requires: 'nox-2', effect: { kind: 'skill', field: 'duration', amount: 10, mode: 'add' }, note: '傀儡持续 10s → 20s，接近常驻兵力' },
    ],
  },
  {
    id: 'sif', name: '蜂群·西芙', role: 'summoner', weapon: 'laser',
    primary: { str: 18, agi: 22, tgh: 20, int: 40 },
    skill: {
      name: '纳米蜂群', cooldown: 16, duration: 6, mul: 2.1, cdrAffected: true,
      chainTargets: 6, armorShredPct: 0.2,
      note: '链式激光额外跳 5 目标，附带腐蚀（护甲 -20%）',
    },
    ai: { aggroRange: 28, leashRange: 36, engageDistanceMul: 0.85, targetPriority: 'weakest', retreatHpPct: 0.35 },
    answers: ['aoeClear', 'armorShred', 'sustainedDps', 'summon'],
    specialization: [
      { id: 'sif-1', name: '蜂群增殖', cost: 1, effect: { kind: 'attr', attr: 'int', amount: 6 }, note: '' },
      { id: 'sif-2', name: '跳数增加', cost: 2, requires: 'sif-1', effect: { kind: 'skill', field: 'mul', amount: 1.4, mode: 'mul' }, note: '链式每跳伤害 ×1.4，清潮涌更干净' },
      { id: 'sif-3', name: '蜂群缠附', cost: 3, requires: 'sif-2', effect: { kind: 'answer', add: 'control' }, note: '纳米蜂群黏附目标，普攻附带减速——自爆兵在贴身之前就被拖住（分裂 / 自爆）' },
    ],
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
