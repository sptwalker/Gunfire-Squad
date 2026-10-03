/**
 * 局外成长。两份货币，两条线，互不重叠。
 *
 * ── 为什么必须分成两条 ──
 *   技能点：**新关卡的新星级**给（每颗星 1 点，三星封顶），管"我要不要这支角色变得更强"
 *   荣誉值：**局内随机任务**给，管"这支角色在队里够不够老练"
 * 两者的产出条件完全不同，所以不会出现"刷一个最优关卡同时喂满两条线"。
 *
 * ── 与 `characters.ts` 的 `SpecEffect` 的关系 ──
 * 两条线共用同一个效果联合类型，但**军衔被编译器禁止给 `attr`**：
 *
 *     type RankEffect = Exclude<SpecEffect, { kind: 'attr' }>
 *
 * 这是本轮的架构不变量，与"别给 SpecEffect 加 damageMul"同一手法——
 * 军衔**不直接加战斗属性**。它给的是三样东西：
 *   1. `skill` — 增强已有的低级技能（数值变好，但没解锁新东西）
 *   2. `ai`    — 更聪明的自动战斗（优先打威胁更大的、更及时地躲范围伤害）
 *   2b. `tactic` — 后段的战术动作（地雷 / 陷阱 / 工事 / 堡垒 / 炮火），见 `TACTICS`
 *   3. 高级技能的**解锁资格**（见 `advancedSkillUnlocked`）
 *
 * ── 高级技能要两把钥匙 ──
 * 玩家口径里"技能点解锁高级技能"（P5）与"军衔解锁高级技能"（P6）都得成立。
 * 那就两把都要：**军衔到级给资格，技能点购买给到手**。
 * 只有一把钥匙时，另一句需求就会落空——这是唯一能让两句话同时为真的读法。
 */

import type { Primary } from './attributes.ts';
import type { AnswerTag, Hero, HeroRole, SpecEffect, SpecNode } from './characters.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import type { BuffId } from './run.ts';
import type { DifficultyId } from './scenes.ts';

// ─────────────────────────────────────────────
// 一、技能点
// ─────────────────────────────────────────────

/**
 * 技能点 = **星级**（用户裁决 #4）。每个关卡的每档难度各自最多 3 颗星，
 * **第一次拿到某颗星给 1 点**；三星之后这一关不再产出技能点。
 *
 * 这条规则把"刷"从技能点线上整条拆掉：重打一关唯一的收益是**补星**，
 * 而补星要求打得更好，不是打得更久。
 *
 * 星级（用户裁决，第三轮）：
 *   ★ 通关
 *   ★★ 通关且**最终全员存活**（没有人阵亡；莉安的战地复活拉回来的算活着）
 *   ★★★ ★★ 且**完成本局全部随机任务**
 *
 * 三颗星各是一道看得见的门槛，不是分数线：玩家读得懂"差哪一颗、要怎么补"。
 * 二星逼的是"阵容能不能扛住"，三星逼的是"扛住的同时还能分心做任务"——两条都指向换阵容。
 */
export function starsFor(r: { victory: boolean; deaths: number; tasksDone: number; tasksTotal: number }): 0 | 1 | 2 | 3 {
  if (!r.victory) return 0;
  if (r.deaths > 0) return 1;
  return r.tasksDone >= r.tasksTotal ? 3 : 2;
}

/** 本局给多少技能点 = 新拿到的星数。已有 3 星 → 恒为 0，这就是"三星后不再产出"。 */
export function skillPointsFor(prevStars: number, stars: number): number {
  return Math.max(0, stars - prevStars);
}

/** 全游戏技能点供给上限 = 关卡数 × 3 星 × 难度档数。哨兵 §12a 拿它对需求。 */
export function skillPointSupply(totalLevels: number, difficulties: number): number {
  return totalLevels * 3 * difficulties;
}

// ─────────────────────────────────────────────
// 二、荣誉值与军衔
// ─────────────────────────────────────────────

/** 一次局内任务给多少荣誉值。数值定得比技能点大，因为军衔需要累积。 */
export const HONOR_PER_TASK = 12;
/** 关底额外给的荣誉值（通关奖励，不是任务） */
export const HONOR_CLEAR_BONUS = 20;

/**
 * 荣誉值会**平均分给所有参战队员**——不是只给 MVP，也不是全给队长。
 *
 * 这一条是本设计的题眼：军衔衡量的是"这支小队打了多少仗"，
 * 不是"谁抢到了人头"。所以换阵容不会让某个角色落后，
 * 12 个角色一起长，玩家每换一套阵容都是拿一支成型的队伍去打，
 * 而不是在重新养一个白板。
 */
export function honorPerHero(totalHonor: number, squadSize: number): number {
  return totalHonor / squadSize;
}

/**
 * 军衔阶梯。12 级。
 *
 * `req` 是**累计**荣誉值，不是本级差值——累计值让"我离下一级还有多远"
 * 可以直接读，不用做减法。
 *
 * 曲线形状：前 6 级陡（每级 +60~90），后 6 级缓（每级 +150~400）。
 * 前段让玩家在一两局内就看见第一个军衔变化（正反馈要早），
 * 后段拉长到十几局，让满军衔是一件长期的事。
 */
export interface Rank {
  level: number;
  name: string;
  /** 累计荣誉值门槛 */
  req: number;
  /** 本级给的效果。不含 `attr`——见文件头，由 RankEffect 强制。 */
  effects: RankEffect[];
  note: string;
}

export type RankEffect = Exclude<SpecEffect, { kind: 'attr' }>;

/** 军衔门槛：到这一级才**允许购买**对应角色的高级技能。 */
export const ADVANCED_SKILL_RANK = 5;

/**
 * 战术动作：后段军衔解锁的 AI 行为（用户裁决 #9）。
 *
 * 原来军衔后 6 级只有 `mul ×1.15` 这类看不见的数，90 小时的线靠它撑不住（09 §8 未定项 6）。
 * 战术动作是**看得见的行为**：地上多了一颗雷、路口多了一排沙袋；
 * 每次触发都在 HUD 上给一行文字提示（用户裁决 #10，`callout`）。
 *
 * 它们**不给维度答案**（`effectiveAnswers` 不读军衔）：地雷能帮你打突进，
 * 但阵容里没有突进答案的队伍照样过不了突进关。战术动作改的是
 * "同一套答案执行得好不好"——这正是军衔该管的那一层。
 *
 * `builds` 复用 `scenes.ts` 的 `OBSTACLES`：工事就是一排我方的沙袋，不是新障碍。
 */
export type TacticId = 'fortify' | 'mine' | 'trap' | 'bastion' | 'artillery';

export interface Tactic {
  id: TacticId;
  name: string;
  /** 能用它的定位 */
  roles: HeroRole[];
  /** 冷却秒数。AI 自己判断时机，冷却只是上限 */
  cooldown: number;
  /** AI 触发条件，一句话。M2 的 `core/ai.ts` 照这句写规则 */
  trigger: string;
  /** 放下去的障碍（复用 OBSTACLES 的 id） */
  builds?: 'sandbag' | 'woodwall';
  /** 给玩家的文字提示。{hero} 替换为队员名 */
  callout: string;
  note: string;
}

export const TACTICS: Record<TacticId, Tactic> = {
  fortify: {
    id: 'fortify', name: '构筑工事', roles: ['tank', 'meleeDps'], cooldown: 40,
    trigger: '原地交战超过 8 秒，且正面敌人 ≥ 6', builds: 'sandbag', callout: '{hero} 构筑工事',
    note: '正面放一排沙袋。挡人不挡弹——远程在后面照打，近战怪被拦在外面',
  },
  mine: {
    id: 'mine', name: '布设地雷', roles: ['control', 'rangedDps', 'meleeDps'], cooldown: 30,
    trigger: '突进 / 自爆僵尸从同一方向接近', callout: '{hero} 布设地雷',
    note: '来路上埋 3 颗雷。对突进与自爆是提前量，对慢速重甲几乎无效',
  },
  trap: {
    id: 'trap', name: '埋设陷阱', roles: ['control', 'support', 'summoner'], cooldown: 35,
    trigger: '卡口 / 走廊地形，且敌人正在排队通过', callout: '{hero} 埋设陷阱',
    note: '减速网 + 短时定身。定身吃抗冻判定（freezeRes），减速永远生效',
  },
  bastion: {
    id: 'bastion', name: '架设堡垒', roles: ['tank', 'support'], cooldown: 90,
    trigger: '护送 / 守护任务进行中，或 BOSS 战开始', builds: 'woodwall', callout: '{hero} 架设堡垒',
    note: '三面木墙围出据点，什么都挡，耐久 900——"原地死守"的物质形态',
  },
  artillery: {
    id: 'artillery', name: '呼叫炮火', roles: ['rangedDps', 'control', 'support'], cooldown: 120,
    trigger: '视野内有精英，或 ≥ 12 只僵尸聚在 5 格内', callout: '{hero} 呼叫炮火——3 秒后落点',
    note: '3 秒延迟的大范围轰炸。延迟就是它的平衡：AI 要预判"将要在那里"的怪',
  },
};

export const RANKS: Rank[] = [
  { level: 1, name: '列兵', req: 0, effects: [], note: '起点。新角色入队时的默认军衔' },
  {
    level: 2, name: '上等兵', req: 60,
    effects: [{ kind: 'ai', field: 'retreatHpPct', amount: 0.05 }],
    note: '低血撤退早 5% 触发。第一次能明显感觉到的"队员变聪明了"',
  },
  {
    level: 3, name: '下士', req: 150,
    effects: [{ kind: 'skill', field: 'cooldown', amount: -0.08, mode: 'mul' }],
    note: '全部技能冷却 -8%。不新增能力，只让已有的转得更勤',
  },
  {
    level: 4, name: '中士', req: 260,
    effects: [{ kind: 'ai', field: 'aggroRange', amount: 2 }],
    note: '索敌半径 +2 格。更多时间在开火，更少时间在找目标',
  },
  {
    level: 5, name: '上士', req: 400,
    effects: [{ kind: 'skill', field: 'duration', amount: 0.15, mode: 'mul' }],
    note: '技能持续时间 +15%。**本级同时是高级技能的解锁门槛**',
  },
  {
    level: 6, name: '准尉', req: 580,
    effects: [{ kind: 'tactic', id: 'fortify' }, { kind: 'skill', field: 'mul', amount: 1.12, mode: 'mul' }],
    note: '技能倍率 ×1.12。**解锁战术动作「构筑工事」**——从这一级起军衔给的是看得见的行为',
  },
  {
    level: 7, name: '少尉', req: 820,
    effects: [{ kind: 'tactic', id: 'mine' }, { kind: 'ai', field: 'engageDistanceMul', amount: -0.1 }],
    note: '接敌距离 -10%。解锁「布设地雷」',
  },
  {
    level: 8, name: '中尉', req: 1150,
    effects: [{ kind: 'tactic', id: 'trap' }, { kind: 'skill', field: 'cooldown', amount: -0.12, mode: 'mul' }],
    note: '冷却再 -12%（与 3 级叠加 -19%）。解锁「埋设陷阱」',
  },
  {
    level: 9, name: '上尉', req: 1600,
    effects: [{ kind: 'skill', field: 'mul', amount: 1.15, mode: 'mul' }],
    note: '倍率再 ×1.15',
  },
  {
    level: 10, name: '少校', req: 2200,
    effects: [{ kind: 'tactic', id: 'bastion' }, { kind: 'ai', field: 'aggroRange', amount: 3 }],
    note: '索敌再 +3 格。解锁「架设堡垒」',
  },
  {
    level: 11, name: '中校', req: 3000,
    effects: [{ kind: 'skill', field: 'duration', amount: 0.2, mode: 'mul' }],
    note: '持续时间再 +20%',
  },
  {
    level: 12, name: '上校', req: 4000,
    effects: [{ kind: 'tactic', id: 'artillery' },
      { kind: 'skill', field: 'mul', amount: 1.18, mode: 'mul' },
      { kind: 'skill', field: 'cooldown', amount: -0.1, mode: 'mul' },
    ],
    note: '满军衔。解锁「呼叫炮火」，倍率与冷却再抬一档',
  },
];

export const MAX_RANK = RANKS.length;

/** 累计荣誉值 → 军衔等级 1-12。 */
export function rankAt(honor: number): number {
  let lv = 1;
  for (const r of RANKS) if (honor >= r.req) lv = r.level;
  return lv;
}

/** 这个定位在这个军衔能用哪些战术动作。 */
export function tacticsFor(role: HeroRole, rank: number): Tactic[] {
  return rankEffects(rank)
    .flatMap((e) => (e.kind === 'tactic' ? [TACTICS[e.id]] : []))
    .filter((t) => t.roles.includes(role));
}

/** 从 1 级到 `level` 级累计得到的效果。军衔效果是**叠加**的，不是取最高级那一条。 */
export function rankEffects(level: number): RankEffect[] {
  return RANKS.filter((r) => r.level <= level).flatMap((r) => r.effects);
}

/**
 * 高级技能的双钥匙判定。
 *
 * 两把都要：军衔给资格，技能点给到手。
 * 于是 P5 的"技能点解锁高级技能"与 P6 的"军衔解锁高级技能"都成立——
 * 少任何一把，另一句需求就会落空。
 */
export function advancedSkillUnlocked(rank: number, purchased: boolean): boolean {
  return rank >= ADVANCED_SKILL_RANK && purchased;
}

/** 高级技能的技能点售价。所有人同价，因为 12 个高级技能是同一量级的设计承诺。 */
export const ADVANCED_SKILL_COST = 4;

// ─────────────────────────────────────────────
// 三、局外军械库（用户裁决 #1：买的是非消耗品，全队共享）
// ─────────────────────────────────────────────

/**
 * 金钱买的是**装备本身**：买断、永久、不会用掉。
 *   - **一件可以同时装给多位会用这一类武器的角色**（`Hero.weaponClasses`）
 *   - 每人出战前选 1 把主武器 + 1 件道具；默认武器免费、永远在库里
 *
 * 仍然不卖：武器阶、角色等级、属性——它们局内按秒表自动涨（`run.ts` 的 `LEVEL_TIME`）。
 *
 * 同类武器 DPS 差 ≤ `SAME_CLASS_DPS_CAP`（1.3，用户裁决方案 B），哨兵 §13a 当闸门守——
 * 否则金钱买到的是**数字**不是答案，BOSS 血量锚点（按默认武器配平）也会被击穿。见 09 §8 第 7 条。
 */
export interface ShopEntry {
  id: string;
  name: string;
  /** 买断价，单位：金钱 */
  price: number;
  /** 一句话说清它给的是哪种新答案 */
  pitch: string;
}

/**
 * 武器售价。**按"越不可替代越贵"定价，不按强度。**
 * 绝对价位由实测产出反推：一局带出 ≈10,313（§6 的 `totalMoney`），全部 ≈14 局。
 * 共享让每件更值，但件数没变，所以总价不因共享下调。
 */
export const WEAPON_SHOP: Record<WeaponId, ShopEntry> = {
  pistol: { id: 'pistol', name: '手枪', price: 800, pitch: '全定位都能拿。平庸但便宜' },
  smg: { id: 'smg', name: '冲锋枪', price: 3600, pitch: '对【潮涌】的答案：射速换单发，靠子弹数淹没数量' },
  rifle: { id: 'rifle', name: '突击步枪', price: 7200, pitch: '对【开阔】与【远程压制】的答案：30 格全自动，站得远也打得满' },
  sword: { id: 'sword', name: '长剑', price: 4400, pitch: '对【迟滞】的答案：高攻速近战在减速地形里仍能维持输出' },
  spear: { id: 'spear', name: '长矛', price: 5600, pitch: '对【重甲】的廉价解：中等穿透 + 两段判定' },
  greatsword: { id: 'greatsword', name: '大刀', price: 6400, pitch: '对【卡口】的答案：三连判定横扫，一次挥击覆盖整条通道' },
  flamer: { id: 'flamer', name: '喷火器', price: 7600, pitch: '对【潮涌】与【毒区】的答案：持续火焰覆盖不挑目标数' },
  freezer: { id: 'freezer', name: '冷冻枪', price: 8800, pitch: '唯一的成规模减速来源。【突进】与【自爆】的通用解' },
  boomerang: { id: 'boomerang', name: '回旋镖', price: 9600, pitch: '对【分裂】的答案：往返两段判定，小僵尸成群时收益翻倍' },
  grenade: { id: 'grenade', name: '榴弹发射器', price: 11200, pitch: '对【卡口】与【分裂】的答案：AOE 覆盖，六段判定' },
  bow: { id: 'bow', name: '长弓', price: 12800, pitch: '对【远程压制】的答案：最高单发穿透之一，能把喷吐僵尸点掉' },
  sniper: { id: 'sniper', name: '狙击枪', price: 15200, pitch: '对【精英护盾】的答案：一发破盾窗口，全游戏最高单发' },
  rocket: { id: 'rocket', name: '火箭筒', price: 16000, pitch: '唯一的成规模击退来源。五段判定 + 70 击退，是控制流的入口' },
  laser: { id: 'laser', name: '激光枪', price: 16800, pitch: '对【重甲】的答案：高穿透 + 高频 + 中甲克制，几无短板所以最贵' },
};

/**
 * 道具：非消耗品。装备后**每局按 `trigger` 自动触发一次**，下一局重新就绪。
 * 效果复用 `run.ts` 的 `BUFFS`——和局内拾取的增益是同一套数，
 * 区别只在：拾取的看运气，装备的是你事先选好的那一次。
 *
 * ponytail: 用户原话里的"法术"没有单独建表，它在这套结构里就是另一种道具；
 * 等出现第一个不能用 BUFFS 表达的法术再拆。
 */
export interface ItemEntry extends ShopEntry {
  buff: BuffId;
  trigger: string;
}

export const ITEM_SHOP: Record<BuffId, ItemEntry> = {
  shield: { id: 'shield', name: '防御盾', price: 2400, buff: 'shield', trigger: '持有者血量首次低于 40%', pitch: '15 秒减伤 50%。对【自爆】与 BOSS 高伤窗口的应急解' },
  haste: { id: 'haste', name: '加速', price: 2400, buff: 'haste', trigger: '持有者在毒池 / 减速地形上超过 2 秒', pitch: '15 秒移速 +60%。对【毒区】与【卡口】的转移解' },
  power: { id: 'power', name: '增伤', price: 3600, buff: 'power', trigger: 'BOSS 或精英进入射程', pitch: '15 秒伤害 +40%。对【精英护盾】破盾窗口的爆发解' },
  heal: { id: 'heal', name: '加血', price: 3600, buff: 'heal', trigger: '全队平均血量首次低于 50%', pitch: '立即回 40% 最大生命。【续战】续航的兜底' },
  cdr: { id: 'cdr', name: '冷却缩减', price: 4800, buff: 'cdr', trigger: '持有者的技能刚进入冷却', pitch: '15 秒冷却 -40%。把一次技能窗口变成两次' },
};

export const SHOP: ShopEntry[] = [...Object.values(WEAPON_SHOP), ...Object.values(ITEM_SHOP)];

export function totalUnlockCost(): number {
  return SHOP.reduce((s, e) => s + e.price, 0);
}

/** 出战配置：1 把主武器 + 至多 1 件道具。 */
export interface Loadout {
  weapon: WeaponId;
  item?: BuffId;
}

/**
 * 能不能这样装备：库里有（默认武器永远算有）+ 角色会用这一类 + 道具库里有。
 * 同一件东西**可以同时出现在多个人的配置里**——这就是"共享"的全部实现。
 */
export function canEquip(hero: Hero, lo: Loadout, owned: { weapons: WeaponId[]; items: BuffId[] }): boolean {
  const hasWeapon = lo.weapon === hero.weapon || owned.weapons.includes(lo.weapon);
  const hasItem = lo.item === undefined || owned.items.includes(lo.item);
  return hasWeapon && hero.weaponClasses.includes(WEAPONS[lo.weapon].class) && hasItem;
}

/**
 * 一次通关的金钱产出快照，给文档引用。真源是模拟器：
 * 哨兵 §12c 直接调 `simulate()`，偏离 >2% 打 ✗（第一轮这里写过 620，实测 10,288）。
 */
export const MONEY_PER_CLEAR = 10288;

export function clearsToUnlockAll(): number {
  return Math.ceil(totalUnlockCost() / MONEY_PER_CLEAR);
}

// ─────────────────────────────────────────────
// 四、跨关卡继承什么（用户裁决 #6）
// ─────────────────────────────────────────────

/**
 * 存档。**只有这里的东西跨关卡继承**：军衔（荣誉）、技能（专精 + 高级技能）、军械库。
 * 其余全部是局内成长，每关从 1 级 / 0 阶开始：等级、武器阶、临时武器、拾取的增益。
 */
export interface Profile {
  version: 3;
  money: number;
  skillPoints: number;
  honor: Record<string, number>;
  /** 每个角色已点的专精节点 id */
  spec: Record<string, string[]>;
  advanced: Record<string, boolean>;
  owned: { weapons: WeaponId[]; items: BuffId[] };
  loadouts: Record<string, Loadout>;
  /** key = `${关卡 id}@${难度}` */
  stars: Record<string, 0 | 1 | 2 | 3>;
}

// ─────────────────────────────────────────────
// 五、世界地图与难度解锁（用户裁决 #5 / #7）
// ─────────────────────────────────────────────

/**
 * 世界地图 = 6 条**并列**的区域线（每个场景一条），入口全部开放；线内按顺序解锁。
 * 先推哪条由玩家定——于是"先练哪套阵容"是玩家的选择，不是关卡表替他定的。
 * `08` §3.1 的场景顺序降级为推荐顺序。
 */
export function levelUnlocked(indexInScene: number, clearedInScene: number): boolean {
  return indexInScene <= clearedInScene;
}

/**
 * 难度按场景逐档解锁：本场景普通档终关通关 → 困难开放；困难终关 → 噩梦。
 * 按场景而不是全局，和多线地图一致：丛林打到噩梦不需要先打完沼泽。
 */
export function difficultyUnlocked(d: DifficultyId, finalCleared: Partial<Record<DifficultyId, boolean>>): boolean {
  if (d === 'normal') return true;
  return !!finalCleared[d === 'hard' ? 'normal' : 'hard'];
}

/** 专精节点 → 军衔能否给。军衔只给 skill / ai / tactic。 */
export function rankCanGrant(node: SpecNode): boolean {
  return node.effect.kind === 'skill' || node.effect.kind === 'ai' || node.effect.kind === 'tactic';
}

/** 被军衔挡在外面的效果类型。供文档与哨兵自检引用，避免口头约束。 */
export const RANK_FORBIDDEN_EFFECTS = ['attr', 'answer', 'revive', 'weaponTier'] as const;

/** 仅用于类型完整性自检：RankEffect 必须真能排除掉 attr。 */
export type _RankEffectExcludesAttr = Extract<RankEffect, { kind: 'attr' }> extends never ? true : never;

/** 维度答案标签的军衔来源检查——军衔不给 answer，这里显式留一个空。 */
export const RANK_GRANTED_ANSWERS: AnswerTag[] = [];

/** 军衔对 `Primary` 的影响**恒为空**。编译器与运行时双保险。 */
export const RANK_PRIMARY_DELTA: Partial<Primary> = {};
