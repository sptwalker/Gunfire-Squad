/**
 * 局外成长（第三轮，`00` §C7）。
 *
 * ── 数值线只剩一条：军衔 ──
 * 25 级美军军衔 = 局外等级。荣誉值 → 军衔 → 两样东西：
 *   1. **属性成长**：每级 5–10%（按职业，具体值在 P2 职业表里），复利，
 *      加在**最终生命与最终伤害**上——全游戏唯一允许的额外乘区（C7-5）
 *   2. **转职点**：到 `ADVANCE_RANKS` 发 1 点，并解锁那一层职业
 * 技能点与专精树已删除（C7-3）；技能随转职替换升级，见技能表（P4）。
 *
 * ── 防刷靠两件事 ──
 *   - 敌人按**关卡的军衔上限**同步加成（`enemyRankMul`），不按关卡序号——加关卡不推高敌人
 *   - 出战队员**都不能超过**关卡上限（`canDeploy`）——超了这关就毕业，刷不了
 *
 * ponytail: 5% / 5–10% / 荣誉曲线都是起点，不是配平结论（C7-4c：先试玩再修）。
 */

import type { Hero } from './characters.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import type { BuffId } from './run.ts';
import type { DifficultyId } from './scenes.ts';

// ─────────────────────────────────────────────
// 一、星级与荣誉
// ─────────────────────────────────────────────

/**
 * 星级（C6-#8，不变）：
 *   ★ 通关
 *   ★★ 通关且**最终全员存活**（被复活技能拉回来的算活着）
 *   ★★★ ★★ 且**完成本局全部随机任务**
 */
export function starsFor(r: { victory: boolean; deaths: number; tasksDone: number; tasksTotal: number }): 0 | 1 | 2 | 3 {
  if (!r.victory) return 0;
  if (r.deaths > 0) return 1;
  return r.tasksDone >= r.tasksTotal ? 3 : 2;
}

/** 一次局内任务的荣誉值（每次都发） */
export const HONOR_PER_TASK = 12;
/** 通关奖励（每次都发） */
export const HONOR_CLEAR_BONUS = 20;
/** 每颗**新**星的荣誉值，只在首次拿到时发（C7-7）——接替原来的技能点 */
export const HONOR_PER_NEW_STAR = 30;

/** 一局的荣誉总额。星级部分只算新星，重打只补差星。 */
export function runHonor(r: { victory: boolean; tasksDone: number; prevStars: number; stars: number }): number {
  return r.tasksDone * HONOR_PER_TASK + (r.victory ? HONOR_CLEAR_BONUS : 0) +
    Math.max(0, r.stars - r.prevStars) * HONOR_PER_NEW_STAR;
}

/**
 * 荣誉**平均分给出战队员**（C7-7）。少带人 = 每人分得多——
 * 这就是"可以少带"（C7-15）的回报，不是漏洞。
 * 已在本关毕业的队员不能出战（`canDeploy`），所以"直到毕业"不需要单独判定。
 */
export function honorPerHero(totalHonor: number, squadSize: number): number {
  return totalHonor / squadSize;
}

// ─────────────────────────────────────────────
// 二、军衔（25 级）
// ─────────────────────────────────────────────

/**
 * 美军军衔标准中文译名。E-1 / E-2 英文同为 Private，中文错开为新兵 / 二等兵；
 * E-4 取 Corporal（下士）。W 系、O 系接在 E 系之后，是游戏里的线性排序，
 * 不代表现实晋升路径。
 */
const RANK_TABLE: [code: string, name: string][] = [
  ['E-1', '新兵'], ['E-2', '二等兵'], ['E-3', '一等兵'], ['E-4', '下士'], ['E-5', '中士'],
  ['E-6', '上士'], ['E-7', '一级军士长'], ['E-8', '军士长'], ['E-9', '总军士长'],
  ['W-1', '准尉'], ['W-2', '二级准尉'], ['W-3', '三级准尉'], ['W-4', '四级准尉'], ['W-5', '五级准尉'],
  ['O-1', '少尉'], ['O-2', '中尉'], ['O-3', '上尉'], ['O-4', '少校'], ['O-5', '中校'], ['O-6', '上校'],
  ['O-7', '准将'], ['O-8', '少将'], ['O-9', '中将'], ['O-10', '上将'], ['★5', '五星上将'],
];

/**
 * 升到第 n 级要的荣誉 = `HONOR_BASE × HONOR_GROWTH^(n-2)`。几何曲线：
 * 前段一两局升一级（正反馈要早），后段十几局一级。
 * ponytail: 只校准到"一支队满五星的小时数"（哨兵 §12c），P6 关卡线定了再按 100 小时总量回调。
 */
export const HONOR_BASE = 24;
export const HONOR_GROWTH = 1.12;

/** 发转职点的军衔：E-4 / E-7 / W-1 / O-1 / O-4 / O-7 / 五星（C7-2c） */
export const ADVANCE_RANKS = [4, 7, 10, 15, 18, 21, 25] as const;

export interface Rank {
  level: number;
  code: string;
  name: string;
  /** 累计荣誉值门槛 */
  req: number;
  /** 本级发转职点 */
  advance: boolean;
}

export const RANKS: Rank[] = (() => {
  let req = 0;
  return RANK_TABLE.map(([code, name], i) => {
    const level = i + 1;
    if (level > 1) req += Math.round(HONOR_BASE * HONOR_GROWTH ** (level - 2));
    return { level, code, name, req, advance: (ADVANCE_RANKS as readonly number[]).includes(level) };
  });
})();

export const MAX_RANK = RANKS.length;

/** 累计荣誉值 → 军衔等级 1-25。 */
export function rankAt(honor: number): number {
  let lv = 1;
  for (const r of RANKS) if (honor >= r.req) lv = r.level;
  return lv;
}

/** 到这个军衔为止一共发了几个转职点。 */
export function advancePointsAt(rank: number): number {
  return ADVANCE_RANKS.filter((r) => r <= rank).length;
}

/**
 * 能不能再转一次。`done` = 已转次数（0 = 基础职业，7 = 终极）。
 * 点数可以攒着不用（C7-2a）；点数按顺序消耗，第 7 点（五星）自然要求先用完前 6 点——
 * "先补完前 6 次转职"（C7-2b）不需要单独判定。
 */
export function canAdvance(rank: number, done: number): boolean {
  return done < advancePointsAt(rank);
}

// ── 属性成长与敌人加成 ──

/** 职业每级成长率的允许区间（C7-4）。具体值在职业表，P7 哨兵查越界 */
export const HERO_GROWTH_BAND = [0.05, 0.1] as const;
/** 敌人每级关卡上限的加成（C7-4a） */
export const ENEMY_GROWTH = 0.05;

/** 英雄的军衔乘区：最终生命与最终伤害各乘一次（C7-4b），复利。 */
export function heroRankMul(rank: number, growth: number): number {
  return (1 + growth) ** (rank - 1);
}

/** 敌人加成挂在关卡的军衔上限上（C7-4a）。 */
export function enemyRankMul(rankCap: number): number {
  return (1 + ENEMY_GROWTH) ** (rankCap - 1);
}

/**
 * 出战校验：人数在 1..partyCap，且**每名**队员军衔都不超过本关上限（C7-15 / 16）。
 * 全队都超了 = 这关对这批人毕业——防刷就是这一行。
 */
export function canDeploy(ranks: number[], rankCap: number, partyCap: number): boolean {
  return ranks.length >= 1 && ranks.length <= partyCap && ranks.every((r) => r <= rankCap);
}

/**
 * 战术动作（地雷 / 陷阱 / 工事 / 堡垒 / 炮火）。第二轮挂在军衔上；
 * 军衔不再给行为之后，它们在 P4 并入技能表、由职业持有。表先留着当素材。
 */
export type TacticId = 'fortify' | 'mine' | 'trap' | 'bastion' | 'artillery';

export interface Tactic {
  id: TacticId;
  name: string;
  cooldown: number;
  /** AI 触发条件，一句话 */
  trigger: string;
  /** 放下去的障碍（复用 OBSTACLES 的 id） */
  builds?: 'sandbag' | 'woodwall';
  /** 给玩家的文字提示。{hero} 替换为队员名 */
  callout: string;
  note: string;
}

export const TACTICS: Record<TacticId, Tactic> = {
  fortify: {
    id: 'fortify', name: '构筑工事', cooldown: 40,
    trigger: '原地交战超过 8 秒，且正面敌人 ≥ 6', builds: 'sandbag', callout: '{hero} 构筑工事',
    note: '正面放一排沙袋。挡人不挡弹——远程在后面照打，近战怪被拦在外面',
  },
  mine: {
    id: 'mine', name: '布设地雷', cooldown: 30,
    trigger: '突进 / 自爆僵尸从同一方向接近', callout: '{hero} 布设地雷',
    note: '来路上埋 3 颗雷。对突进与自爆是提前量，对慢速重甲几乎无效',
  },
  trap: {
    id: 'trap', name: '埋设陷阱', cooldown: 35,
    trigger: '卡口 / 走廊地形，且敌人正在排队通过', callout: '{hero} 埋设陷阱',
    note: '减速网 + 短时定身。定身吃抗冻判定（freezeRes），减速永远生效',
  },
  bastion: {
    id: 'bastion', name: '架设堡垒', cooldown: 90,
    trigger: '护送 / 守护任务进行中，或 BOSS 战开始', builds: 'woodwall', callout: '{hero} 架设堡垒',
    note: '三面木墙围出据点，什么都挡，耐久 900——"原地死守"的物质形态',
  },
  artillery: {
    id: 'artillery', name: '呼叫炮火', cooldown: 120,
    trigger: '视野内有精英，或 ≥ 12 只僵尸聚在 5 格内', callout: '{hero} 呼叫炮火——3 秒后落点',
    note: '3 秒延迟的大范围轰炸。延迟就是它的平衡：AI 要预判"将要在那里"的怪',
  },
};

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
// 四、跨关卡继承什么
// ─────────────────────────────────────────────

/**
 * 存档 v4。**只有这里的东西跨关卡继承**：名册（每人的职业 / 荣誉 / 已转次数 / 配置）、金钱、军械库、星级。
 * 战意、临时武器、拾取的增益都是局内的，每关重置。
 */
export interface Soldier {
  /** 当前职业 id（职业表在 P2） */
  classId: string;
  honor: number;
  /** 已转次数 0-7；可用转职点 = advancePointsAt(rankAt(honor)) - advances */
  advances: number;
  loadout: Loadout;
}

export interface Profile {
  version: 4;
  money: number;
  roster: Record<string, Soldier>;
  owned: { weapons: WeaponId[]; items: BuffId[] };
  /** key = `${关卡 id}@${难度}` */
  stars: Record<string, 0 | 1 | 2 | 3>;
}

/** 名册上限（C7-14） */
export const ROSTER_CAP = 64;

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
