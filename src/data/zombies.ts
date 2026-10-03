/**
 * 9 种僵尸。
 *
 * 设计原则：每种僵尸必须能用一个【行为动词】概括，否则它就只是一个换皮的血包。
 *   普通=数量  高速=冲刺  胖=阻挡  毒=区域封锁  爆炸=逼迫走位  分裂=清场惩罚
 *   跳跃=无视地形  护盾=破防检查  喷吐=远程压制
 *   九种动词互不重叠，这样玩家在战场上一眼能读出战术含义。
 *
 * 数值上：胖僵尸 HP 1400 是普通僵尸的 7 倍，但速度只有一半——
 * 它的作用是逼玩家处理，而不是造成伤害。
 *
 * 每只僵尸带 `dims`（贡献哪些挑战维度）与 `behavior`（机械行为标签）。
 * 这两个字段是场景层构筑关卡组合的原料：场景的挑战维度 → 该维度的僵尸池
 * → 加权混合成刷怪表，全部由数据推导，不手写 80 张表。
 */

import type { ArmorType } from './damage.ts';
import type { DimensionId } from './scenes.ts';

export type ZombieId =
  | 'normal'
  | 'runner'
  | 'brute'
  | 'toxic'
  | 'bomber'
  | 'splitter'
  | 'leaper'
  | 'ward'
  | 'spitter'
  | 'spawnling';

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
  | 'shielded'      // 自带护盾，需先破盾才能有效伤害
  | 'ranged';       // 远程攻击，不进接触

export interface Zombie {
  id: ZombieId;
  name: string;
  hp: number;
  /** 移动速度，格/秒 */
  speed: number;
  armor: number;
  armorType: ArmorType;
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

export const ZOMBIES: Record<ZombieId, Zombie> = {
  normal: {
    id: 'normal', name: '普通僵尸', hp: 200, speed: 2.2, armor: 30,
    armorType: 'none', atk: 90, atkInterval: 1.2, radius: 0.45,
    points: 1, money: 3, threat: 1, behavior: 'none', dims: ['swarm'],
    stab: 36, superArmor: false, freezeRes: 0.0, cunning: 0.0,
    knock: 25, knockKind: 'knockback',
    special: '无', tag: '基础单位，构成战场底噪',
  },
  runner: {
    id: 'runner', name: '高速僵尸', hp: 120, speed: 5.0, armor: 15,
    armorType: 'none', atk: 70, atkInterval: 0.8, radius: 0.4,
    points: 2, money: 4, threat: 1.2, behavior: 'charge', dims: ['rush', 'open'],
    stab: 32, superArmor: false, freezeRes: 0.0, cunning: 0.0,
    knock: 18, knockKind: 'knockback',
    special: '冲刺突进，命中打断换弹', tag: '惩罚站桩与长换弹武器',
  },
  brute: {
    id: 'brute', name: '高防胖僵尸', hp: 1400, speed: 1.2, armor: 220,
    armorType: 'heavy', atk: 260, atkInterval: 2.0, radius: 0.9,
    points: 6, money: 12, threat: 3, behavior: 'block', dims: ['heavyArmor', 'choke'],
    stab: 90, superArmor: true, freezeRes: 0.2, cunning: 0.0,
    knock: 60, knockKind: 'knockdown',
    special: '减伤 60%，缓慢推挤玩家', tag: '必须用穿刺/爆炸/火焰处理',
  },
  toxic: {
    id: 'toxic', name: '毒液僵尸', hp: 350, speed: 2.0, armor: 60,
    armorType: 'light', atk: 110, atkInterval: 1.5, radius: 0.5,
    points: 3, money: 6, threat: 1.8, behavior: 'poisonTrail', dims: ['poison', 'choke'],
    stab: 52, superArmor: false, freezeRes: 0.6, cunning: 0.0,
    knock: 20, knockKind: 'knockback',
    special: '死亡留下毒池，5 格 / 8 秒持续伤害', tag: '区域封锁，逼玩家放弃阵地',
  },
  bomber: {
    id: 'bomber', name: '爆炸僵尸', hp: 400, speed: 2.6, armor: 100,
    armorType: 'medium', atk: 550, atkInterval: 99, radius: 0.6,
    points: 5, money: 8, threat: 2, behavior: 'suicide', dims: ['suicide'],
    stab: 40, superArmor: false, freezeRes: 0.15, cunning: 0.0,
    knock: 30, knockKind: 'knockback',
    special: '靠近后自爆，范围 2.5 格', tag: '迫使玩家主动拉开距离',
  },
  splitter: {
    id: 'splitter', name: '分裂僵尸', hp: 300, speed: 2.2, armor: 40,
    armorType: 'none', atk: 100, atkInterval: 1.2, radius: 0.55,
    points: 4, money: 7, threat: 2, behavior: 'split', dims: ['split'],
    stab: 34, superArmor: false, freezeRes: 0.1, cunning: 0.15,
    knock: 15, knockKind: 'knockback',
    special: '死亡分裂为 3 只分裂小僵尸', tag: 'AOE 武器在这里是负收益，单体武器反而更优',
  },
  leaper: {
    id: 'leaper', name: '跳跃僵尸', hp: 250, speed: 3.0, armor: 45,
    armorType: 'none', atk: 140, atkInterval: 1.4, radius: 0.5,
    points: 4, money: 9, threat: 2, behavior: 'leap', dims: ['sluggish', 'open'],
    stab: 36, superArmor: false, freezeRes: 0.1, cunning: 0.6,
    knock: 22, knockKind: 'knockback',
    special: '跳跃越过障碍，落地 AOE', tag: '无视地形，让掩体战术失效',
  },
  ward: {
    id: 'ward', name: '护盾僵尸', hp: 900, speed: 1.8, armor: 160,
    armorType: 'medium', atk: 180, atkInterval: 1.8, radius: 0.7,
    points: 7, money: 14, threat: 3.5, behavior: 'shielded', dims: ['shielded', 'eliteHunt'],
    stab: 120, superArmor: true, freezeRes: 0.35, cunning: 0.3,
    knock: 45, knockKind: 'knockdown',
    special: '正面护盾吸收固定伤害，破盾后 3 秒虚弱（受伤 +50%）',
    tag: '不吃控、只能靠破盾窗口集火，惩罚无爆发阵容',
  },
  spitter: {
    id: 'spitter', name: '喷吐僵尸', hp: 600, speed: 1.6, armor: 90,
    armorType: 'light', atk: 200, atkInterval: 2.4, radius: 0.55,
    points: 8, money: 15, threat: 3, behavior: 'ranged', dims: ['suppress', 'eliteHunt'],
    stab: 48, superArmor: false, freezeRes: 0.2, cunning: 0.25,
    knock: 35, knockKind: 'knockback',
    special: '在 12 格外远程喷吐，不进入接触距离',
    tag: '站在原地就有输出，逼玩家主动前压而不是龟缩',
  },
  spawnling: {
    id: 'spawnling', name: '分裂小僵尸', hp: 80, speed: 3.2, armor: 10,
    armorType: 'none', atk: 55, atkInterval: 1.0, radius: 0.3,
    points: 1, money: 1, threat: 0, behavior: 'none', dims: ['swarm', 'split'],
    stab: 20, superArmor: false, freezeRes: 0.0, cunning: 0.0,
    knock: 8, knockKind: 'knockback',
    special: '由分裂僵尸产生', tag: '不接受预算刷怪，只由分裂产生',
  },
};

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
