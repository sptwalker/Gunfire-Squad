/**
 * 【单场景基线】一局 15 分钟的结构：3 阶段 × 5 分钟，每 5 分钟 BOSS，15 分钟关底。
 *
 * ── 定位（架构调整后）──
 * 这个文件不再是全局唯一真源。分工是：
 *   `scenes.ts`  决定【打哪一关、有多难】——维度构成、威胁预算、地形、难度档
 *   本文件       决定【一局 15 分钟长什么样】——阶段划分、出怪节奏、BOSS 锚点
 * 两个轴是正交的：一个子关卡 = 一次 15 分钟 run，所以阶段永远只有 3 段，
 * 场景层的深度体现在【关卡数】和【维度构成】上，不体现在阶段数上。
 *
 * 于是关卡之间不靠阶段倍率拉开差距，靠的是威胁预算（同场景内 ×2.05）与
 * 维度构成（1 维 → 3 维全开）。这是"不堆数值"在数值层的实现。
 *
 * BOSS 是数值配平的【锚点】，不是难度装饰。
 * 逻辑链条：定 BOSS 血量 → 反推小队必须在 N 秒内击杀 → 得出小队 DPS 目标
 *          → 反推单角色 DPS → 反推武器伤害 → 反推僵尸血量。
 * 所以 BOSS 血量是第一个该定的数，也是最后一个该动的数。
 */

import type { ZombieId } from './zombies.ts';

export interface SpawnGroup {
  zombie: ZombieId;
  /** 权重，同阶段内按权重随机 */
  weight: number;
}

export interface Stage {
  index: number;
  name: string;
  /** 阶段起始时间，秒 */
  start: number;
  /** 阶段时长，秒 */
  duration: number;
  /** 开局威胁值/秒 */
  threatRateStart: number;
  /** 阶段结束时的威胁值/秒（线性增长） */
  threatRateEnd: number;
  /** 本阶段出怪表 */
  spawnTable: SpawnGroup[];
}

/**
 * 阶段刷新速率（威胁值/秒）。
 *
 * 这两个数是【定量校准】出来的，不是手感调的。方法：
 *   1. 算加权平均僵尸血量（按出怪权重）→ 得到"清怪速率 = 小队 DPS ÷ 平均血量"
 *   2. 让刷新速率 = 清怪速率 ÷ 目标余量系数
 *   3. 余量系数定在 1.25 —— 小队清怪比刷怪快 25%，守得住线但不轻松
 *
 * 实测数据（均衡阵容，含 AOE 收益）：
 *   阶段1 清怪 ≈ 5.8 只/s   → 刷新定 4.4 只/s（威胁 4.6/s）
 *   阶段2 清怪 ≈ 8.4 只/s   → 刷新定 6.5 只/s（威胁 9.0/s）
 *   阶段3 清怪 ≈ 7.4 只/s   → 刷新定 5.7 只/s（威胁 9.5/s）
 *
 * 走过的两个弯路，都记在这里避免重犯：
 *   - 最初用 9.0 威胁/s：堆到 153 只，小队必灭（刷新远超清怪能力）
 *   - 修正后压到 1.4：余量 783%，小队屠杀空气，全程无人掉血（过度保守）
 */
/**
 * 基线三段。场景层不替换它，而是通过 `SubLevel.threatBudget` 缩放刷新速率、
 * 通过 `SubLevel.spawnTable` 替换出怪构成——阶段结构本身保持不变。
 * 每个场景的终关之所以更难，是因为三维同时活跃 + 预算翻倍，不是因为多了一段。
 */
export const STAGES: Stage[] = [
  {
    index: 1, name: '接触', start: 0, duration: 300,
    threatRateStart: 3.0, threatRateEnd: 4.0,
    spawnTable: [
      { zombie: 'normal', weight: 75 },
      { zombie: 'runner', weight: 25 },
    ],
  },
  {
    index: 2, name: '压制', start: 300, duration: 300,
    threatRateStart: 4.5, threatRateEnd: 6.0,
    spawnTable: [
      { zombie: 'normal', weight: 45 },
      { zombie: 'runner', weight: 18 },
      { zombie: 'toxic', weight: 14 },
      { zombie: 'splitter', weight: 12 },
      { zombie: 'bomber', weight: 11 },
    ],
  },
  {
    index: 3, name: '狂潮', start: 600, duration: 300,
    threatRateStart: 4.2, threatRateEnd: 4.8,
    spawnTable: [
      { zombie: 'normal', weight: 32 },
      { zombie: 'runner', weight: 16 },
      { zombie: 'brute', weight: 14 },
      { zombie: 'toxic', weight: 12 },
      { zombie: 'splitter', weight: 10 },
      { zombie: 'bomber', weight: 9 },
      { zombie: 'leaper', weight: 7 },
    ],
  },
];

/**
 * BOSS 战期间的刷怪倍率，**按阶段分别定**。
 *
 * 为什么不能用同一个数：刷怪预算是按【威胁值】计的，而三个阶段的出怪表
 * 单位威胁对应的【身体数】完全不同——
 *   阶段 2 是数量型（普通/高速，威胁 1.0-1.2）→ 同样预算堆出更多只
 *   阶段 3 是质量型（胖僵尸威胁 3.0）→ 同样预算只有一半的只数
 * 实测：三个阶段都用 0.35 时，关底战最低血量 96%，而第二场 BOSS 只有 55%——
 * **难度峰跑到了第二场**，关底反而成了过场。分阶段之后曲线单调递增。
 *
 * 定这组数的方法不是拍脑袋，是【反解出想要的场上只数】：
 *   场上只数 ≈ 威胁速率 × 倍率 ÷ 该阶段平均威胁值
 * 三个 BOSS 战的目标只数定成递增的 3 / 4.5 / 6——
 * 越到后面越挤，这是玩家能直接看见的难度表达，比数字上的血量更直观。
 * 注意阶段 3 的倍率【比阶段 2 高 3.7 倍】，但它对应的只数只多 33%——
 * 因为阶段 3 每只僵尸的威胁值是阶段 2 的 1.8 倍。倍数骗人，只数不骗人。
 */
export const BOSS_PHASE_SPAWN_MUL = [0.18, 0.15, 0.70] as const;

export interface Boss {
  stage: number;
  name: string;
  /** 出现时间，秒 */
  at: number;
  hp: number;
  armor: number;
  speed: number;
  atk: number;
  radius: number;
  /** 目标击杀时间，秒 —— 这是配平的核心约束 */
  targetKillTime: number;
  note: string;
}

/**
 * BOSS 血量锚点。**现在是 BOSS 池，不是时间表。**
 *
 * 旧版这里按 `at` 字段对应"第 300/600/900 秒登场的那个 BOSS"，一局三个顺序固定。
 * 新版每个场景用自己的 `bossStages: [number, number, number]` 从池里选三个
 * （见 `scenes.ts`），所以同一个 BOSS 在不同场景里的登场时机不同，顺序也不同。
 * `at` 现在只是"它在基线一局里的默认登场时刻"，不是全局唯一的时刻表。
 *
 * 血量这些数字不是设计出来的，是【校准出来的】——跑 balance-check.ts 的第 4b 节，
 * 用实测小队 DPS × 目标击杀秒数反推。手填的第一版（6万/18万/48万）
 * 比实测需求高 3-6 倍，结果第 1 个 BOSS 就全灭。
 *
 * 修改规则：只在小队 DPS 公式或成长曲线变动后才重跑校准，不要凭手感改这里。
 */
export const BOSSES: Boss[] = [
  {
    stage: 1, name: '腐化重装兵', at: 300,
    hp: 48500, armor: 200, speed: 2.0, atk: 260, radius: 1.6,
    targetKillTime: 30,
    note: '纯数值检查。不要求走位，只要求小队 30 秒内打掉 2.2 万血',
  },
  {
    stage: 2, name: '毒母·薇丝', at: 600,
    hp: 70000, armor: 320, speed: 2.2, atk: 380, radius: 2.0,
    targetKillTime: 45,
    note: '周期性召唤毒液僵尸 + 地面毒池，迫使队伍不断转移阵地',
  },
  {
    stage: 3, name: '尸潮之主·卡俄斯', at: 900,
    hp: 94000, armor: 480, speed: 2.4, atk: 520, radius: 2.6,
    targetKillTime: 60,
    note: '关底。三阶段全类型僵尸混合刷新，同时本体高伤近战',
  },
];

/** 每场 BOSS 战持续时间上限，超时视为失败 */
export const BOSS_TIMEOUT = 90;

/**
 * 常规阶段总时长（3 × 5 分钟）。
 * 注意：这【不是】关卡终点。关底 BOSS 在 900 秒登场，此时还要打一场，
 * 所以模拟与游戏的循环都要多跑 BOSS_TIMEOUT 的窗口。
 * 早期版本把 RUN_DURATION 当终点，结果关底 BOSS 刚落地就结算通关，
 * 最后的决战根本没发生过。
 */
export const RUN_DURATION = 900;

/** 循环真正该跑到的时间：常规阶段 + 关底决战窗口 */
export const RUN_END = RUN_DURATION + BOSS_TIMEOUT;

/**
 * 积分 → 角色等级。关卡内临时，不带出关卡。
 *
 * 校准依据：15 分钟全程约产出 1800 积分，所以满级阈值定在 1400，
 * 让玩家在 12 分钟前后满级——留出 3 分钟的"完全体"体验期。
 * 早期版本把阈值定在 520，结果 4:30 就满级了，占整局 1/3 都不到，
 * 成长曲线后半程完全空转。
 */
export const LEVEL_COST = [0, 150, 400, 800, 1400];

export function levelForPoints(points: number): number {
  let lv = 1;
  for (let i = 1; i < LEVEL_COST.length; i++) {
    if (points >= LEVEL_COST[i]) lv = i + 1;
  }
  return lv;
}

/** 增益道具 */
export type BuffId = 'shield' | 'haste' | 'power' | 'heal' | 'cdr';

export interface Buff {
  id: BuffId;
  name: string;
  duration: number;
  /** 效果描述 */
  effect: string;
}

export const BUFFS: Buff[] = [
  { id: 'shield', name: '防御盾', duration: 15, effect: '受到伤害 -50%' },
  { id: 'haste', name: '加速', duration: 15, effect: '移动速度 +60%' },
  { id: 'power', name: '增伤', duration: 15, effect: '造成伤害 +40%' },
  { id: 'heal', name: '加血', duration: 15, effect: '立即回复 40% 最大生命' },
  { id: 'cdr', name: '冷却缩减', duration: 15, effect: '技能冷却 -40%' },
];
