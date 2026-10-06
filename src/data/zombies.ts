/**
 * 18 种僵尸。
 *
 * 设计原则：每种僵尸必须能用一个【行为动词】概括，否则它就只是一个换皮的血包。
 *   普通=数量  高速=冲刺  铁甲=硬扛  毒液=封锁  爆炸=自爆  分裂=增殖
 *   跳跃=跃扑  咒盾=吸法  喷吐=压制  磁暴=屏障  增生=再生
 *   潜影=潜伏  掘地=钻地  蝠翼=盘旋  尖啸=尖啸  传令=号令  召唤=招魂
 *   小僵尸=分裂产物
 * 动词互不重叠，玩家在战场上一眼能读出战术含义。
 *
 * ── 第三轮：从「一条护甲轴」改成「三条抗性轴」 ──
 * 旧版每只僵尸只有 `armor`，于是"打不动"永远只是"输出不够"。
 * 现在每只僵尸带 `resist`（physRes / magicRes / energyField），
 * 它才是挑战维度真正挂靠的地方——`armor` 退化成 ±15% 的手感微调。
 * 三系闭环见 `damage.ts` 的文件头。
 *
 * 数值上：铁甲僵尸 HP 1400 是普通僵尸的 7 倍，但速度只有一半——
 * 它的作用是逼玩家处理，而不是造成伤害。
 *
 * 每只僵尸带 `dims`（贡献哪些挑战维度）与 `behavior`（机械行为标签）。
 * 这两个字段是场景层构筑关卡组合的原料：场景的挑战维度 → 该维度的僵尸池
 * → 加权混合成刷怪表，全部由数据推导，不手写 80 张表。
 */

import type { ArmorType, Resistances } from './damage.ts';
import type { DimensionId } from './scenes.ts';

export type ZombieId =
  // ── 保留（9）──
  | 'normal'
  | 'runner'
  | 'brute'
  | 'toxic'
  | 'bomber'
  | 'splitter'
  | 'leaper'
  | 'ward'
  | 'spitter'
  | 'spawnling'
  // ── 新增（8）──
  | 'herald'      // 号令
  | 'summoner'    // 招魂
  | 'tesla'       // 电磁场
  | 'regenerator' // 再生
  | 'stalker'     // 隐形
  | 'burrower'    // 遁地
  | 'flyer'       // 空中
  | 'screamer';   // 精神

/**
 * 机械行为标签。
 *
 * `special` 是给人看的散文，`behavior` 是给模拟器和游戏用的枚举。
 * 上一轮的教训：僵尸与技能的关键机制只写在文案里，导致"这套阵容能不能破解这个挑战"
 * 这类问题无法计算，只能靠嘴说。这一轮把机制变成数据。
 */
export type ZombieBehavior =
  | 'none'
  | 'charge'        // 冲刺突进，打断换弹
  | 'block'         // 缓慢推挤，阻挡推进
  | 'poisonTrail'   // 死亡留下毒池
  | 'suicide'       // 靠近自爆
  | 'split'         // 死亡分裂
  | 'leap'          // 跳跃越过障碍
  | 'shielded'      // 需要先破掉一层壳才能有效伤害（咒盾只挡法术，磁暴只挡电磁）
  | 'ranged'        // 远程攻击，不进接触
  // ── 第三轮新增（7）──
  | 'herald'        // 光环：给范围内僵尸加速加抗，本体脆
  | 'summon'        // 持续复活场上尸体
  | 'regen'         // 高额回血，被重创时失效
  | 'stealth'       // 隐形，不能被选中
  | 'burrow'        // 地下移动，普通攻击打不到
  | 'flying'        // 空中，近战与地面范围打不到
  | 'scream';       // 吟唱范围恐惧 / 混乱

export interface Zombie {
  id: ZombieId;
  name: string;
  hp: number;
  /** 移动速度，格/秒 */
  speed: number;
  armor: number;
  armorType: ArmorType;
  /**
   * 三系抗性。**维度挂在这里**，不挂在 `armor` 上。
   *
   * 三者都是减免比例 0-1。`energyField = 1` 是全项目唯一允许的完全免疫，
   * 它只吸收电磁伤害，物理与法术照常打进去——地板是外置的。
   */
  resist: Resistances;
  /** 每秒回血（再生维度的载体）。0 = 不回血。被重创时按 `antiHeal` 削减。 */
  regen: number;
  /** 接触攻击伤害 */
  atk: number;
  /** 攻击间隔，秒 */
  atkInterval: number;
  /** 攻击/受击判定半径，格 */
  radius: number;
  /** 击杀获得积分 */
  points: number;
  /** 击杀获得金钱 */
  money: number;
  /** 刷新消耗的威胁预算 */
  threat: number;
  /** 机械行为标签 */
  behavior: ZombieBehavior;

  // ── 以下六个是第二轮新增的【控制对抗】字段 ──
  /**
   * 稳固。守方值，与英雄的 `Derived.stab` 同量纲。
   * 对方的击退力 / 自己的稳固 决定自己被推开的概率，见 `sim/combat.ts`。
   * 它也是英雄端"稳固"属性存在的理由——只给英雄加稳固、僵尸这边没有对应值，
   * 那条属性就永远只在自己人之间比大小，没有战场意义。
   *
   * ── 量纲必须咬住英雄的击退力 ──
   * 英雄击退力实测跨度是 7.7（喷火器）到 96.8（大刀，5 级满阶），
   * 所以这张表的稳定段定在 **32-90**——落在英雄跨度之内，两端才都够得着：
   *   喷火器 7.7  vs 36 → 4%   （火力压制型本来就不该推得动谁）
   *   冲锋枪 11.5 vs 36 → 9%   （同上，它的设计定位就是"几乎推不动"）
   *   激光 19.4   vs 36 → 23%
   *   长枪 62     vs 36 → 72%
   *   大刀 96.8   vs 90 → 56%  （"最抗推的普通怪"身上也只有一半）
   *
   * 第一版把稳定段定在 8-20（照抄英雄端 TGH×1.0 的量纲），结果是
   * **任何一把像样的武器对任何一只非霸体僵尸都恒为 0.84**——
   * "控制抗性"这一维根本没有咬合，玩家感觉不到稳固的存在。
   * 数值轴要能被感觉到，两端的尺度必须先对齐。
   */
  stab: number;
  /**
   * 霸体。**只免疫位移**（击退 + 击倒）。
   *
   * 刻意不免疫冻结/嘲讽/减速——那三类各有独立的对抗属性
   * （`freezeRes` / `cunning`，减速故意不设，见 `attributes.ts` 的地板原则）。
   * 霸体做成"免一切控制"是最省事也最糟的写法：它会让整个控制流一次性作废，
   * 于是玩家学到的教训是"别带控制"，而不是"换一种控制"。
   */
  superArmor: boolean;
  /** 抗冻 0-1：按概率抵抗冻结，并削减冻结时长 */
  freezeRes: number;
  /** 狡诈 0-1：按概率抵抗嘲讽 */
  cunning: number;
  /**
   * 僵尸施加的击退力。英雄端的稳固靠它才有意义——
   * 这是"僵尸也反推英雄"的那一半。
   */
  knock: number;
  /**
   * 近战单位偏【击倒】（短暂失去行动，不位移），远程单位偏【击退】（位移）。
   * 前者惩罚站桩，后者打乱阵型，两者都过 `superArmor` 这一关。
   */
  knockKind: 'knockback' | 'knockdown' | 'none';
  /** 这只僵尸给关卡贡献哪些挑战维度（决定它被哪些场景招募） */
  dims: DimensionId[];
  /** 特殊行为说明 */
  special: string;
  /** 抗性/弱点备注，仅文档用 */
  tag: string;
}

/** 无抗性。绝大多数僵尸用不上三系抗性，用这个常量写明"我确实没有"。 */
const NONE: Resistances = { physRes: 0, magicRes: 0, energyField: 0 };

/**
 * 重创（K12）把目标回血压到原值的这个比例。
 *
 * **不能是 0。** 完全断掉回血等于让钥匙把这个维度删掉，
 * 玩家学到的就会是"带重创＝这关不存在"，而不是"带重创＝这关打得动"。
 * 20% 让增生僵尸从打不死变成打得死，但它仍然是一只需要有人专门盯的怪——
 * 钥匙打开的是通路，不是跳过按钮。
 *
 * 这个数原本只写在 `special` 的散文里，于是"被重创后还剩多少回血"
 * 无法被计算、只能靠嘴说。数字必须住在数据里，哨兵 §11d 直接读它。
 */
export const ANTI_HEAL_MUL = 0.2;

export const ZOMBIES: Record<ZombieId, Zombie> = {
  // ── 潮涌 ──
  normal: {
    id: 'normal', name: '普通僵尸', hp: 200, speed: 2.2, armor: 30,
    armorType: 'none', resist: NONE, regen: 0, atk: 90, atkInterval: 1.2, radius: 0.45,
    points: 1, money: 3, threat: 1, behavior: 'none', dims: ['swarm'],
    stab: 36, superArmor: false, freezeRes: 0.0, cunning: 0.0,
    knock: 25, knockKind: 'knockback',
    special: '无', tag: '基础单位，构成战场底噪',
  },
  splitter: {
    id: 'splitter', name: '分裂僵尸', hp: 300, speed: 2.2, armor: 40,
    armorType: 'none', resist: NONE, regen: 0, atk: 100, atkInterval: 1.2, radius: 0.55,
    points: 4, money: 7, threat: 2, behavior: 'split', dims: ['swarm'],
    stab: 34, superArmor: false, freezeRes: 0.1, cunning: 0.15,
    knock: 15, knockKind: 'knockback',
    special: '死亡分裂为 3 只分裂小僵尸',
    tag: '第三轮并入潮涌：它是"死了会变多"的又一种表达，不再单独占一个维度',
  },
  spawnling: {
    id: 'spawnling', name: '分裂小僵尸', hp: 80, speed: 3.2, armor: 10,
    armorType: 'none', resist: NONE, regen: 0, atk: 55, atkInterval: 1.0, radius: 0.3,
    points: 1, money: 1, threat: 0, behavior: 'none', dims: ['swarm'],
    stab: 20, superArmor: false, freezeRes: 0.0, cunning: 0.0,
    knock: 8, knockKind: 'knockback',
    special: '由分裂僵尸产生', tag: '不接受预算刷怪，只由分裂产生',
  },

  // ── 突进 ──
  runner: {
    id: 'runner', name: '高速僵尸', hp: 120, speed: 5.0, armor: 15,
    armorType: 'none', resist: NONE, regen: 0, atk: 70, atkInterval: 0.8, radius: 0.4,
    points: 2, money: 4, threat: 1.2, behavior: 'charge', dims: ['rush'],
    stab: 32, superArmor: false, freezeRes: 0.0, cunning: 0.0,
    knock: 18, knockKind: 'knockback',
    special: '冲刺突进，命中打断换弹', tag: '惩罚站桩与长换弹武器',
  },
  leaper: {
    id: 'leaper', name: '跳跃僵尸', hp: 250, speed: 3.0, armor: 45,
    armorType: 'none', resist: NONE, regen: 0, atk: 140, atkInterval: 1.4, radius: 0.5,
    points: 4, money: 9, threat: 2, behavior: 'leap', dims: ['rush'],
    stab: 36, superArmor: false, freezeRes: 0.1, cunning: 0.6,
    knock: 22, knockKind: 'knockback',
    special: '跳跃越过障碍，落地 AOE',
    tag: '第三轮并入突进：它和高速僵尸是同一种压力（反应时间不够），只是路径不同',
  },

  // ── 自爆 ──
  bomber: {
    id: 'bomber', name: '爆炸僵尸', hp: 400, speed: 2.6, armor: 100,
    armorType: 'medium', resist: NONE, regen: 0, atk: 550, atkInterval: 99, radius: 0.6,
    points: 5, money: 8, threat: 2, behavior: 'suicide', dims: ['suicide'],
    stab: 40, superArmor: false, freezeRes: 0.15, cunning: 0.0,
    knock: 30, knockKind: 'knockback',
    special: '靠近后自爆，范围 2.5 格', tag: '迫使玩家主动拉开距离',
  },

  // ── 号令 ──
  herald: {
    id: 'herald', name: '传令僵尸', hp: 320, speed: 1.8, armor: 60,
    armorType: 'light', resist: NONE, regen: 0, atk: 100, atkInterval: 2.0, radius: 0.55,
    points: 6, money: 13, threat: 3, behavior: 'herald', dims: ['command'],
    stab: 40, superArmor: false, freezeRes: 0.2, cunning: 0.3,
    knock: 24, knockKind: 'knockback',
    special: '持续光环：半径 8 格内的僵尸移速 +25%、物理与法术抗性 +0.15。本体很脆，永远躲在怪群后方',
    tag: '钥匙是驱散（K07）：不管它站在哪，把光环清掉就行。点杀是替代答案，但要 AI 认出"该打谁"——见军衔索敌特性',
  },

  // ── 招魂 ──
  summoner: {
    id: 'summoner', name: '亡者召唤师', hp: 900, speed: 1.4, armor: 130,
    armorType: 'medium', resist: NONE, regen: 0, atk: 150, atkInterval: 2.2, radius: 0.7,
    points: 9, money: 18, threat: 4, behavior: 'summon', dims: ['revive'],
    stab: 70, superArmor: true, freezeRes: 0.4, cunning: 0.4,
    knock: 38, knockKind: 'knockdown',
    special: '每 4 秒把场上最近的尸体复活成一只满血 40% 的僵尸，同时自己停顿 1.5 秒（霸体，免疫位移）',
    tag: '复活的僵尸血量只有本体的一部分，且召唤师每复活一次都会停顿——这就是它的地板',
  },

  // ── 物抗 ──
  brute: {
    id: 'brute', name: '铁甲僵尸', hp: 1400, speed: 1.2, armor: 220,
    armorType: 'heavy',
    // 原「高防胖僵尸」。旧版的"减伤 60%"现在落在 physRes 上，
    // 而且只挡物理——法术与电磁照常打得进去。这就是它从"堆穿透"变成"换系别"的地方。
    resist: { physRes: 0.6, magicRes: 0, energyField: 0 },
    regen: 0, atk: 260, atkInterval: 2.0, radius: 0.9,
    points: 6, money: 12, threat: 3, behavior: 'block', dims: ['physRes'],
    stab: 90, superArmor: true, freezeRes: 0.2, cunning: 0.0,
    knock: 60, knockKind: 'knockdown',
    special: '物理减伤 60%，缓慢推挤玩家。对法术与电磁伤害没有任何减免',
    tag: '钥匙是换系别（法术 / 电磁）或破抗，不是堆穿透',
  },

  // ── 魔抗 ──
  ward: {
    id: 'ward', name: '咒盾僵尸', hp: 900, speed: 1.8, armor: 160,
    armorType: 'medium',
    // 原「护盾僵尸」。旧版护盾吸收固定伤害（考验爆发），现在它只吃法术——
    // 物理一碰就进去，所以"打不动"从"输出够不够"变成"你有没有带物理"。
    resist: { physRes: 0, magicRes: 0.6, energyField: 0 },
    regen: 0, atk: 180, atkInterval: 1.8, radius: 0.7,
    points: 7, money: 14, threat: 3.5, behavior: 'shielded', dims: ['magicRes'],
    stab: 120, superArmor: true, freezeRes: 0.35, cunning: 0.3,
    knock: 45, knockKind: 'knockdown',
    special: '浮在身前的符文盾吸收 60% 法术伤害，对物理与电磁完全无效',
    tag: '物抗的镜像：法术阵容打不动，物理一碰就碎',
  },

  // ── 电磁场 ──
  tesla: {
    id: 'tesla', name: '磁暴僵尸', hp: 800, speed: 1.6, armor: 120,
    armorType: 'medium',
    // 全项目唯一允许的完全免疫：energyField = 1。
    // 它的地板不在自己身上——任何物理或法术攻击都能照常打进去（见 damage.ts 文件头）。
    resist: { physRes: 0, magicRes: 0, energyField: 1 },
    regen: 0, atk: 200, atkInterval: 1.8, radius: 0.7,
    points: 7, money: 14, threat: 3.5, behavior: 'shielded', dims: ['field'],
    stab: 80, superArmor: true, freezeRes: 0.3, cunning: 0.2,
    knock: 40, knockKind: 'knockdown',
    special: '周身跳动的蓝色电弧完全吸收电磁伤害。对物理与法术伤害没有任何减免，破抗也撬不开它',
    tag: '电磁是万能解（无视物抗魔抗），所以必须有专门挡它的壳——代价是这层壳对物理法术完全无效',
  },

  // ── 再生 ──
  regenerator: {
    id: 'regenerator', name: '增生僵尸', hp: 700, speed: 1.8, armor: 100,
    armorType: 'light', resist: NONE,
    // 回血速度按"小队单人 DPS 的 1/3"量级定：低于它，单人永远打不死，全队集火可以。
    regen: 90, atk: 160, atkInterval: 1.6, radius: 0.6,
    points: 6, money: 11, threat: 3, behavior: 'regen', dims: ['regen'],
    stab: 60, superArmor: false, freezeRes: 0.2, cunning: 0.0,
    knock: 28, knockKind: 'knockback',
    special: `每秒回血 90（约等于一只普通僵尸的血量在 2.2 秒内回满）。被重创（K12）期间回血降到 ${ANTI_HEAL_MUL * 100}%`,
    tag: '钥匙只有重创一把——回血速度超过你的持续输出，堆伤害就永远打不死',
  },

  // ── 隐形 ──
  stalker: {
    id: 'stalker', name: '潜影僵尸', hp: 400, speed: 2.8, armor: 50,
    armorType: 'none', resist: NONE, regen: 0,
    atk: 320, atkInterval: 1.5, radius: 0.5,
    points: 5, money: 10, threat: 2.5, behavior: 'stealth', dims: ['stealth'],
    stab: 30, superArmor: false, freezeRes: 0.0, cunning: 0.4,
    knock: 20, knockKind: 'knockback',
    special: '隐形：不能被选中，AI 自动索敌直接无视它。出手的瞬间与贴到 1.5 格内会短暂现形。背刺伤害翻倍',
    tag: '钥匙只有侦测（K13）一把。范围清场是替代答案——不需要选中目标就能打到',
  },

  // ── 遁地 ──
  burrower: {
    id: 'burrower', name: '掘地僵尸', hp: 600, speed: 2.4, armor: 90,
    armorType: 'none', resist: NONE, regen: 0,
    atk: 240, atkInterval: 1.8, radius: 0.6,
    points: 6, money: 11, threat: 3, behavior: 'burrow', dims: ['burrow'],
    stab: 45, superArmor: false, freezeRes: 0.1, cunning: 0.0,
    knock: 35, knockKind: 'knockdown',
    special: '在地下移动时任何普通攻击都打不到它，会一直钻到队伍后排才出土，出土时把周围 2 格掀飞',
    tag: '钥匙是震地（K14）。地面有隆起痕迹，嘲讽可以把出土点拉到前排',
  },

  // ── 空中 ──
  flyer: {
    id: 'flyer', name: '蝠翼僵尸', hp: 350, speed: 3.4, armor: 40,
    armorType: 'none', resist: NONE, regen: 0,
    atk: 180, atkInterval: 1.3, radius: 0.5,
    points: 5, money: 10, threat: 2.5, behavior: 'flying', dims: ['air'],
    stab: 28, superArmor: false, freezeRes: 0.1, cunning: 0.2,
    knock: 22, knockKind: 'knockback',
    special: '持续在空中盘旋，近战武器与地面范围伤害打不到它。俯冲攻击的瞬间贴地，近战可以打到',
    tag: '远程投射物自动带对空，所以钥匙（K15）只对近战阵容是硬需求',
  },

  // ── 精神 ──
  screamer: {
    id: 'screamer', name: '尖啸僵尸', hp: 500, speed: 1.5, armor: 70,
    armorType: 'light', resist: NONE, regen: 0,
    atk: 120, atkInterval: 2.5, radius: 0.6,
    points: 6, money: 12, threat: 3, behavior: 'scream', dims: ['mental'],
    stab: 50, superArmor: false, freezeRes: 0.3, cunning: 0.5,
    knock: 26, knockKind: 'knockback',
    special: '吟唱 2 秒后尖啸：半径 7 格内的英雄有 60% 概率恐惧（往回跑）或混乱（攻击随机目标），持续 3 秒。可被打断',
    tag: '钥匙是宁神（K17）。意志（魔抗）降低中招概率与时长，但有 50% 上限，不能完全免疫',
  },

  // ── 毒区 ──
  toxic: {
    id: 'toxic', name: '毒液僵尸', hp: 350, speed: 2.0, armor: 60,
    armorType: 'light', resist: NONE, regen: 0, atk: 110, atkInterval: 1.5, radius: 0.5,
    points: 3, money: 6, threat: 1.8, behavior: 'poisonTrail', dims: ['poison'],
    stab: 52, superArmor: false, freezeRes: 0.6, cunning: 0.0,
    knock: 20, knockKind: 'knockback',
    special: '死亡留下毒池，5 格 / 8 秒持续伤害', tag: '区域封锁，逼玩家放弃阵地',
  },

  // ── 远程压制 ──
  spitter: {
    id: 'spitter', name: '喷吐僵尸', hp: 600, speed: 1.6, armor: 90,
    armorType: 'light', resist: NONE, regen: 0, atk: 200, atkInterval: 2.4, radius: 0.55,
    points: 8, money: 15, threat: 3, behavior: 'ranged', dims: ['suppress'],
    stab: 48, superArmor: false, freezeRes: 0.2, cunning: 0.25,
    knock: 35, knockKind: 'knockback',
    special: '在 12 格外远程喷吐，不进入接触距离',
    tag: '站在原地就有输出，逼玩家主动前压而不是龟缩',
  },
};

/** 参与威胁预算的僵尸。`spawnling` 只由分裂产生，不占预算，所以排除。 */
export const ZOMBIE_LIST: Zombie[] = Object.values(ZOMBIES).filter(
  (z) => z.id !== 'spawnling',
);

/**
 * 每阶段僵尸血量倍率。
 *
 * 必须跟着【小队输出成长】走，否则后期会堆怪崩盘：
 *   小队输出成长 = 等级 1→5（×2.0，每级 25%）× 武器 0→2 阶（×1.7）≈ ×3.4
 * 所以阶段血量倍率定在 1.0 / 1.7 / 2.8，略低于输出成长，
 * 让玩家越打越轻松，把压力集中到 BOSS 和刷新密度上。
 * 早期版本用了 4.5，僵尸血量涨得比小队伤害快，阶段 3 场上堆到 80+ 只。
 *
 * 注意：这三个倍率是【一局之内三段】的曲线，不是关卡难度表。
 * 一个子关卡 = 一次 15 分钟 run，所以永远是 3 段，这里是闭环的。
 * 关卡之间的难度差由 `scenes.ts` 的 `SubLevel.threatBudget`（刷新速率）
 * 与 `SubLevel.spawnTable`（出怪构成）承担，不要在这里加第四段。
 */
export const STAGE_HP_MUL = [1.0, 1.7, 2.8];
/** 每阶段僵尸伤害倍率 */
export const STAGE_DMG_MUL = [1.0, 1.5, 2.2];

/**
 * 一局之内第 stage 段的僵尸修正。
 *
 * 旧版在 `Math.min(stage, 3)` 处静默截断——stage 4 会无声地拿到 stage 3 的倍率，
 * 这种"看起来对、实际抄了上一段"的退化是最难查的一类 bug，所以改成显式抛错。
 * 子关卡永远是 3 段（一局 15 分钟），所以这里只可能收到 1..3。
 */
export function stageMods(stage: number): { hp: number; dmg: number } {
  if (!Number.isInteger(stage) || stage < 1 || stage > STAGE_HP_MUL.length) {
    throw new RangeError(
      `stage 必须是 1..${STAGE_HP_MUL.length} 的整数，收到 ${stage}。` +
        '一局固定 3 段，超出说明调用方把"关卡序号"当成"阶段序号"传进来了。',
    );
  }
  return { hp: STAGE_HP_MUL[stage - 1], dmg: STAGE_DMG_MUL[stage - 1] };
}
