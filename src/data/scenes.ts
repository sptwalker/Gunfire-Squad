/**
 * 挑战维度 · 答案词表 · 世界地图 · 子关卡阶梯。
 *
 * ── 第三轮：维度的定义换了一套 ──
 * 旧版对维度的描述是"这个维度要求什么数值"，于是 15 个维度里有一半（卡口、分裂、
 * 护盾、重甲……）落在同一种压力上：输出够不够。玩家在战场上分不出它们。
 *
 * 新版每个维度由【五件事】定义，缺一不可（判据见文件末尾的 §判据）：
 *   lock  锁     —— 它施加的规则是什么（是一条规则，不是一个更大的数字）
 *   keys  钥匙   —— 让那条规则【不再适用】的能力。缺了它当场卡住
 *   alts  替代   —— 硬扛它的能力。绕过规则，但要付代价
 *   floor 地板   —— 它自带的弱点窗口。任何锁都不许没有出口
 *   cue   信号   —— 一眼可辨识的视觉表现。玩家看不见的维度等于不存在
 *
 * 【钥匙】与【替代】的区别，是这一轮最重要的一条设计区分：
 *   钥匙 = 把锁【打开】。潮涌来了一百只 → 范围清场一次扫掉三十只。
 *   替代 = 把锁【扛过去】。嘲讽住前排，让它们既打不出伤害又堵住后面的路。
 * 钥匙是"这个维度必须有人带"，替代是"没有钥匙也能活，但要付代价"。
 * 两者都是答案，但只有钥匙是硬需求——所以每个维度至少要有 1 把钥匙，
 * 而钥匙的供给由 `MIN_TREES_PER_KEY` 保证不会只有一条路。
 *
 * ── 设计顺序是倒过来的，这一点很重要 ──
 * 用户原话："我们需要在不同场景结合地形和僵尸构筑出不同的挑战类型和维度，
 * 然后再设计玩家的小队角色和武器。"
 * 所以这个文件不引用任何角色数据，也不引用职业树。挑战维度先立起来，
 * `characters.ts` 的 `answers` 与五棵职业树的技能标注都是【对着这张表】填的。
 */

import { ZOMBIE_LIST, type ZombieId } from './zombies.ts';

// ────────────────────────────────────────────────────────────
// 挑战维度
// ────────────────────────────────────────────────────────────

export type DimensionId =
  // ── F1 数量与节奏（tempo）──
  | 'swarm'      // 潮涌：海量低血小僵尸
  | 'rush'       // 突进：高速近身，压缩反应时间
  | 'suicide'    // 自爆：走过来然后炸掉，逼迫走位
  | 'command'    // 号令：光环单位躲在后方给全队加成
  | 'revive'     // 招魂：尸体被反复拉起来
  // ── F2 抗性与恢复（defense）──
  | 'physRes'    // 物抗：只挡物理
  | 'magicRes'   // 魔抗：只挡法术
  | 'field'      // 电磁场：完全吸收电磁
  | 'regen'      // 再生：回血快过你的持续输出
  // ── F3 感知与位面（plane）──
  | 'stealth'    // 隐形：不能被选中
  | 'burrow'     // 遁地：在地下移动，普通攻击打不到
  | 'air'        // 空中：近战与地面范围打不到
  // ── F4 区域与心智（mind）──
  | 'poison'     // 毒区：地面持续伤害封锁走位
  | 'suppress'   // 远程压制：远程僵尸惩罚静止阵地
  | 'mental';    // 精神：恐惧与混乱打乱阵型

/**
 * 维度家族。同一族内的维度要求【同类】能力，跨族才要求不同的能力。
 *
 * 第三轮的改动：`resist`→`defense`、`space`→`plane`、`attrition`→`mind`。
 * 改名的理由是三个旧名都在描述【效果】，新名在描述【这是什么性质的压力】：
 *   tempo    节奏——压力来自对方比你快或比你多
 *   defense  抗性——压力来自你打不动它
 *   plane    位面——压力来自你【根本碰不到它】（不是打不动，是够不着）
 *   mind     心智——压力来自环境与对方的行为规则，而不是它的身体
 * 尤其 plane 与 defense 的分开是关键：隐形和遁地不是"减伤"，把它们
 * 和物抗放在同一族会让人误以为答案也是"换个伤害系别"。
 */
export type DimensionFamily = 'tempo' | 'defense' | 'plane' | 'mind';

/** 地形要素。维度靠这些地形要素在关卡里【被表达出来】。 */
export type TerrainTag =
  | 'building'   // 建筑：绝对阻挡
  | 'corridor'   // 走廊/峡谷：强制单线
  | 'openField'  // 开阔地：无掩体
  | 'marsh'      // 沼泽：减速
  | 'water'      // 水域：仅特定单位可通行
  | 'ice'        // 冰面：打滑/减速
  | 'pool'       // 毒洼：持续伤害地面
  | 'barrel'     // 可引爆物
  | 'crate'      // 可破坏补给
  | 'sandbag'    // 沙袋：挡人不挡子弹
  | 'wire'       // 铁丝网：挡人不挡子弹，附带减速
  | 'woodwall';  // 木墙：什么都挡，但可以被炸开

export interface Dimension {
  id: DimensionId;
  name: string;
  family: DimensionFamily;
  /** 锁：它施加的规则。必须是一条规则，不能是"更高的数值" */
  lock: string;
  /** 信号：玩家第一眼看到什么就知道是它。看不见的维度等于不存在 */
  cue: string;
  /** 地板：硬扛它的办法，或者它自带的弱点窗口。任何锁都不许没有出口 */
  floor: string;
  /** 一句话说明这个维度在战场上是什么感觉 */
  feels: string;
  /** 表达这个维度需要的地形要素；空数组表示纯靠僵尸构成 */
  terrain: TerrainTag[];
}

/**
 * 15 个维度。
 *
 * 顺序 = 玩家遇到它们的顺序 = 难度引入顺序：先节奏，再抗性，再位面，最后心智。
 * 位面与心智放在后面，是因为它们要求玩家【先认得清战场】再谈应对；
 * 一个还没学会看怪群构成的玩家，给他隐形和尖啸只会变成随机挨打。
 */
export const DIMENSIONS: Dimension[] = [
  // ── F1 数量与节奏 ──
  {
    id: 'swarm', name: '潮涌', family: 'tempo',
    lock: '对方数量远超过你的单人处理速度。单只不疼，但你只有 5 个人',
    cue: '一眼望不到边的小僵尸，从所有方向同时渗出来',
    floor: '允许你拿前排当墙：只要让打头的几只既打不出伤害又堵住后面的路，人再多也只是一条队列',
    feels: '一眼望不到边的小僵尸，单个不疼，但你只有 5 个人',
    terrain: [],
  },
  {
    id: 'rush', name: '突进', family: 'tempo',
    lock: '对方的接近速度快过你的反应时间。你还没开始处理它，它已经贴脸了',
    cue: '跑姿明显不一样——身体前倾、几乎不转向，轨迹是一条直线',
    floor: '它血很少。任何一次成功的减速/定身都会把它变成一只普通僵尸',
    feels: '跑得比你快的僵尸，从你反应不过来的时候就已经贴脸了',
    terrain: [],
  },
  {
    id: 'suicide', name: '自爆', family: 'tempo',
    lock: '它的伤害不看你的护甲，只看它有没有走到你身边',
    cue: '身上有闪烁的红光与滴答声，走路时会绕过障碍而不是撞上去',
    floor: '从它点火到爆炸有一段时间，足够打死它或者走开；打死它不会引爆',
    feels: '它们不咬你，它们只是走过来然后炸掉',
    terrain: ['barrel'],
  },
  {
    id: 'command', name: '号令', family: 'tempo',
    lock: '只要它活着，场上所有僵尸都变强——你不能只处理眼前这一只',
    cue: '一个明显比周围小、却举着旗/发出声波的单位，周围僵尸身上带着一层光晕',
    floor: '它本体极脆、永远躲在最后排，点杀一个目标就能一次性清掉全场加成',
    feels: '你打得挺好的，直到发现对面每一只都比该有的样子硬了四成',
    terrain: [],
  },
  {
    id: 'revive', name: '招魂', family: 'tempo',
    lock: '你打赢的每一场局部战斗都会被撤销——尸体不会留在原地',
    cue: '场上有一具尸体被一层绿光托起来，或者地面有持续旋转的符文圈',
    floor: '被拉起来的只有残血版本，而且召唤者每拉一次都会原地停顿，那一下就是集火窗口',
    feels: '刚清干净的空地上，又站起来了三只',
    terrain: [],
  },

  // ── F2 抗性与恢复 ──
  {
    id: 'physRes', name: '物抗', family: 'defense',
    lock: '物理伤害被固定比例削掉。堆攻击力和穿透都撬不动它',
    cue: '厚重的金属外壳、关节处有铁锈色的液压管，被打中时跳白字',
    floor: '它慢。它挡得住子弹，但追不上你；而且它对你的法术与电磁伤害毫无抗性',
    feels: '打上去全是白字，它们走得很慢但你拦不住',
    terrain: [],
  },
  {
    id: 'magicRes', name: '魔抗', family: 'defense',
    lock: '法术伤害被固定比例削掉。这一维和物抗是同一把锁的两面',
    cue: '浮在身前的符文盾，颜色偏向冷紫/冰蓝，法术打到盾上会散开',
    floor: '物理一碰就碎。它扛的只是你【没有换系别】这件事',
    feels: '你的火球砸上去只掉一点血，它连躲都不躲',
    terrain: [],
  },
  {
    id: 'field', name: '电磁场', family: 'defense',
    lock: '电磁伤害被完全吸收。这是全项目唯一一处允许的完全免疫',
    cue: '周身跳动的蓝色电弧、空气扭曲，靠近时画面有扫描线',
    floor: '这层壳只挡电磁。任何物理或法术攻击都能照常打进去——它的地板是【外置】的',
    feels: '你的激光打上去连数字都不跳',
    terrain: [],
  },
  {
    id: 'regen', name: '再生', family: 'defense',
    lock: '它的回血速度高于你的持续输出，所以打不死不是因为打得不够疼，是因为打得不够快',
    cue: '身上有不断蠕动的肉芽组织，伤口会肉眼可见地合上',
    floor: '被重创期间回血几乎归零；它的血总量也不高，集火窗口内可以秒掉',
    feels: '你把它打到三成血，一转头它又是满的',
    terrain: [],
  },

  // ── F3 感知与位面 ──
  {
    id: 'stealth', name: '隐形', family: 'plane',
    lock: '它不能被选中。AI 自动索敌直接跳过它，你的很多技能根本没有合法目标',
    cue: '空气有一点扭曲，走近时能看到脚印与扬尘',
    floor: '它【出手的瞬间】会现形。贴到极近距离也会现形，所以它必须主动送上门',
    feels: '你的队伍打得好好的，后排突然有人倒下了',
    terrain: [],
  },
  {
    id: 'burrow', name: '遁地', family: 'plane',
    lock: '它在地下移动时，一切普通攻击都碰不到它',
    cue: '地面上有一条隆起的土线在快速移动',
    floor: '出土的那一下会把它自己顶出来，而且出土点是可以被嘲讽/位移改变的',
    feels: '你的火力全打在空地上，它从你身后钻了出来',
    terrain: ['marsh'],
  },
  {
    id: 'air', name: '空中', family: 'plane',
    lock: '它在空中。近战武器与地面范围伤害够不到它',
    cue: '影子投在地上而本体在天上——这是最容易被忽略的一个信号，所以影子要做得很明显',
    floor: '它俯冲攻击的瞬间必须贴地，那一瞬间所有近战都够得着',
    feels: '你砍空气，因为它根本不在你砍的高度上',
    terrain: [],
  },

  // ── F4 区域与心智 ──
  {
    id: 'poison', name: '毒区', family: 'mind',
    lock: '地本身有伤害。你被迫离开最舒服的站位，而它不需要做任何事',
    cue: '地上有颜色不对的洼地/雾，队伍走过去会持续掉血',
    floor: '毒是【区域】不是【锁定】，只要往前推或者退出去就没有了',
    feels: '地上全是不能踩的东西，你被一点一点挤到墙角',
    terrain: ['pool', 'marsh'],
  },
  {
    id: 'suppress', name: '远程压制', family: 'mind',
    lock: '它站在原地就有输出，而且你被动挨打时它是安全的',
    cue: '它明显站在怪群后面，攻击有抛物线或蓄力动作',
    floor: '它的转身与弹道都很慢，主动前压的一次冲锋就能把它扯进近战',
    feels: '站着不动就一直在挨打，可前面又有一堆东西挡路',
    terrain: [],
  },
  {
    id: 'mental', name: '精神', family: 'mind',
    lock: '它在打的不是你的血条，是你的【控制权】——队伍会自己往回跑、自己打错人',
    cue: '一个仰头张口、身上有紫色声波圈的单位，吟唱时周围有波纹',
    floor: '吟唱要 2 秒，可以被任何一次打断取消；意志（魔抗）也能降低中招率',
    feels: '你的队伍突然不听你的了',
    terrain: [],
  },
];

export const DIMENSION_BY_ID: Record<DimensionId, Dimension> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, d]),
) as Record<DimensionId, Dimension>;

/**
 * 维度 → 贡献它的僵尸。
 *
 * **从僵尸侧推导，不在这里手写。** 旧版 `Dimension.zombies` 和 `Zombie.dims`
 * 是同一份关系各写一遍，两处必然漂移（改了一边，另一边静默失真，而哨兵查不出来）。
 * 僵尸的 `dims` 是事实来源，这里只是它的一个索引。
 */
export const ZOMBIES_OF_DIM: Record<DimensionId, ZombieId[]> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, ZOMBIE_LIST.filter((z) => z.dims.includes(d.id)).map((z) => z.id)]),
) as Record<DimensionId, ZombieId[]>;

/** 权重表：维度 → 该维度在关卡里的活跃程度（0 或缺失 = 不活跃） */
export type DimWeights = Partial<Record<DimensionId, number>>;

// ────────────────────────────────────────────────────────────
// 答案词表
// ────────────────────────────────────────────────────────────

/**
 * 答案 = 能力的【形状】，不是能力的强度。
 *
 * 为什么不直接让技能写 `answers: DimensionId[]`：那样"两套阵容解同一个维度"
 * 这件事就不可见了。`aoeClear` 和 `slow` 都能回答潮涌，但前者怕分散、后者怕免疫；
 * `magic` 和 `shred` 都能回答物抗，但一个吃职业构成一个吃集火。用【形状】做标签，
 * 多解性才是数据，而不是文档里的一句声称。
 *
 * ── 编号是给玩家看的 ──
 * K01-K18 是钥匙，A01-A09 是替代。职业技能的文案里直接写 `[K02 减速]`，
 * 于是"这个技能到底能不能解某个维度"在技能本身上就能读出来，
 * 不需要玩家去翻一张对照表。**编号一经发布绝不重用**，删掉的编号保持空缺。
 */
export type AnswerTag =
  // ── 钥匙 K01-K18（把锁打开）──
  | 'aoeClear'      // K01 范围清场
  | 'slow'          // K02 减速
  | 'root'          // K03 定身石化
  | 'charm'         // K04 魅惑混乱
  | 'block'         // K05 拦截拒马
  | 'detonate'      // K06 诱爆
  | 'dispel'        // K07 驱散
  | 'physical'      // K08 物理伤害
  | 'magic'         // K09 法术伤害
  | 'electric'      // K10 电磁伤害
  | 'shred'         // K11 破抗
  | 'antiHeal'      // K12 重创
  | 'detect'        // K13 侦测
  | 'seismic'       // K14 震地
  | 'antiAir'       // K15 对空
  | 'cleanse'       // K16 净化
  | 'calm'          // K17 宁神
  | 'deflect'       // K18 弹幕拦截
  // ── 替代答案 A01-A09（硬扛过去）──
  | 'singleTarget'  // A01 单体点杀
  | 'burst'         // A02 爆发窗口
  | 'control'       // A03 控制打断
  | 'taunt'         // A04 嘲讽
  | 'mitigate'      // A05 减伤护盾
  | 'sustain'       // A06 续航治疗
  | 'ranged'        // A07 远程射程
  | 'mobility'      // A08 机动突进
  | 'summon';       // A09 召唤物

export type AnswerKind = 'key' | 'alternative';

export interface AnswerDef {
  tag: AnswerTag;
  /** 编号。技能文案里引用的就是它 */
  code: string;
  name: string;
  kind: AnswerKind;
  /**
   * 是否【依赖 AI 的目标选择】才能生效。
   *
   * 标 ◎ 的答案有个共同的脆弱点：它的价值取决于"队伍打对了目标"。
   * 嘲讽打在杂兵身上、点杀打在血最厚的怪身上，技能本身再好也白搭。
   * 这正是第三轮把【索敌智能】做成军衔特性的理由（见 `progression.ts`）——
   * 它是让这一整类答案从"看运气"变成"可建造"的那把钥匙。
   */
  needsTargeting?: boolean;
  /** 它能回答哪些维度 */
  dims: DimensionId[];
}

/**
 * 全部 27 个答案。**这是唯一的表**——`ANSWER_DIMS`、`KEY_LIST` 全部由它派生，
 * 不再各写一份。
 *
 * 排列顺序就是编号顺序，所以新增答案只能【追加】，不能插队：
 * 插队会让所有已发布的编号整体错位，而技能文案里引用的正是编号。
 */
export const ANSWERS: AnswerDef[] = [
  // ── 钥匙 ──
  { tag: 'aoeClear', code: 'K01', name: '范围清场', kind: 'key',
    dims: ['swarm', 'suicide', 'revive', 'stealth'] },
  { tag: 'slow', code: 'K02', name: '减速', kind: 'key', dims: ['swarm', 'rush', 'suicide'] },
  { tag: 'root', code: 'K03', name: '定身石化', kind: 'key', dims: ['swarm', 'rush'] },
  { tag: 'charm', code: 'K04', name: '魅惑混乱', kind: 'key', dims: ['swarm'] },
  { tag: 'block', code: 'K05', name: '拦截拒马', kind: 'key', dims: ['swarm', 'rush'] },
  { tag: 'detonate', code: 'K06', name: '诱爆', kind: 'key', dims: ['suicide'] },
  { tag: 'dispel', code: 'K07', name: '驱散', kind: 'key', dims: ['command', 'revive'] },
  { tag: 'physical', code: 'K08', name: '物理伤害', kind: 'key', dims: ['magicRes', 'field'] },
  { tag: 'magic', code: 'K09', name: '法术伤害', kind: 'key', dims: ['physRes', 'field'] },
  { tag: 'electric', code: 'K10', name: '电磁伤害', kind: 'key',
    dims: ['physRes', 'magicRes'],
  },
  { tag: 'shred', code: 'K11', name: '破抗', kind: 'key', dims: ['physRes', 'magicRes'] },
  { tag: 'antiHeal', code: 'K12', name: '重创', kind: 'key', dims: ['regen'] },
  { tag: 'detect', code: 'K13', name: '侦测', kind: 'key', dims: ['stealth'] },
  { tag: 'seismic', code: 'K14', name: '震地', kind: 'key', dims: ['burrow'] },
  { tag: 'antiAir', code: 'K15', name: '对空', kind: 'key', dims: ['air'] },
  { tag: 'cleanse', code: 'K16', name: '净化', kind: 'key', dims: ['poison'] },
  { tag: 'calm', code: 'K17', name: '宁神', kind: 'key', dims: ['mental'] },
  { tag: 'deflect', code: 'K18', name: '弹幕拦截', kind: 'key', dims: ['suppress'] },

  // ── 替代答案 ──
  { tag: 'singleTarget', code: 'A01', name: '单体点杀', kind: 'alternative', needsTargeting: true,
    dims: ['command', 'revive', 'regen'],
    },
  { tag: 'burst', code: 'A02', name: '爆发窗口', kind: 'alternative', needsTargeting: true,
    dims: ['command', 'revive', 'regen'] },
  { tag: 'control', code: 'A03', name: '控制打断', kind: 'alternative', needsTargeting: true,
    dims: ['swarm', 'rush', 'mental'] },
  { tag: 'taunt', code: 'A04', name: '嘲讽', kind: 'alternative',
    dims: ['swarm', 'rush', 'burrow'] },
  { tag: 'mitigate', code: 'A05', name: '减伤护盾', kind: 'alternative',
    dims: ['swarm', 'rush', 'suicide', 'burrow', 'air', 'suppress'] },
  { tag: 'sustain', code: 'A06', name: '续航治疗', kind: 'alternative', dims: ['poison'] },
  { tag: 'ranged', code: 'A07', name: '远程射程', kind: 'alternative',
    dims: ['suicide', 'poison', 'suppress', 'mental'] },
  { tag: 'mobility', code: 'A08', name: '机动突进', kind: 'alternative', needsTargeting: true,
    dims: ['command', 'poison', 'suppress'] },
  { tag: 'summon', code: 'A09', name: '召唤物', kind: 'alternative',
    dims: ['swarm', 'rush', 'suicide', 'air', 'suppress'] },
];

export const ANSWER_BY_TAG: Record<AnswerTag, AnswerDef> = Object.fromEntries(
  ANSWERS.map((a) => [a.tag, a]),
) as Record<AnswerTag, AnswerDef>;

/**
 * 答案 → 它能回答哪些维度。
 * 一个答案通常覆盖多个维度，这正是"不同阵容解同一个维度"的来源。
 */
export const ANSWER_DIMS: Record<AnswerTag, DimensionId[]> = Object.fromEntries(
  ANSWERS.map((a) => [a.tag, a.dims]),
) as Record<AnswerTag, DimensionId[]>;

export const ANSWER_LIST: AnswerTag[] = ANSWERS.map((a) => a.tag);
export const KEY_LIST: AnswerTag[] = ANSWERS.filter((a) => a.kind === 'key').map((a) => a.tag);
export const ALT_LIST: AnswerTag[] = ANSWERS.filter((a) => a.kind === 'alternative').map((a) => a.tag);

/** 反向索引：维度 → 能回答它的钥匙 / 替代答案。UI 与文档共用，不各算一遍。 */
export const DIM_KEYS: Record<DimensionId, AnswerTag[]> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, KEY_LIST.filter((k) => ANSWER_DIMS[k].includes(d.id))]),
) as Record<DimensionId, AnswerTag[]>;

export const DIM_ALTS: Record<DimensionId, AnswerTag[]> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, ALT_LIST.filter((a) => ANSWER_DIMS[a].includes(d.id))]),
) as Record<DimensionId, AnswerTag[]>;

/**
 * 覆盖门槛。
 *
 * ── 第三轮改过的门槛，以及为什么 ──
 * 旧版是"每维度 ≥3 个答案、≥2 个不同定位"。问题在于它只数【答案个数】，
 * 数不到【钥匙够不够】——一个维度完全可以有 4 个替代答案和 0 把钥匙，
 * 旧门槛照过，但玩家会发现自己只能硬扛，打不出"破解"的手感。
 *
 * 新门槛分三层，每一层堵一个具体的洞：
 *   MIN_ANSWERS_PER_DIM = 2  一个维度至少两种解法（否则它是个死局）
 *   MIN_KEYS_PER_DIM    = 1  至少一把【钥匙】（否则玩家永远在硬扛）
 *   MIN_TREES_PER_KEY   = 3  每把钥匙至少 3 棵树能提供（否则"带钥匙"等于"带某一个职业"）
 *
 * 硬锁维度（电磁场 / 隐形 / 再生）故意贴着下限走：它们只有 1-2 把钥匙、
 * 0 个替代答案。这不是遗漏，是判据 5——**简单维度给多把钥匙，硬锁只给一两把**。
 * 潮涌有 9 个答案是因为它是本作最常见的场景；电磁场只有 2 个是因为它一旦好解
 * 就不再是"锁"。
 */
export const MIN_ANSWERS_PER_DIM = 2;
export const MIN_KEYS_PER_DIM = 1;
export const MIN_TREES_PER_KEY = 3;

// ────────────────────────────────────────────────────────────
// 难度三档（C4）
// ────────────────────────────────────────────────────────────

export type DifficultyId = 'normal' | 'hard' | 'nightmare';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** 威胁预算倍率 */
  threatMul: number;
  /** 权重上移档数：把次级维度的权重往上抬，改变的是【构成】而不是预算 */
  weightShift: number;
  /** 环境修正：这一档独有的场景改动，噩梦档才有 */
  envMod: string;
  note: string;
}

/**
 * 三档难度故意不是同一条曲线乘系数。
 *
 * 困难改的是【构成】（威胁预算 + 次级维度权重上移），
 * 噩梦额外加【环境修正】——同一个关卡在三档下要玩出不同的手感，
 * 而不是"同一场战斗多挨几下"。
 */
export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'normal', name: '普通',
    threatMul: 1.0, weightShift: 0, envMod: '无',
    note: '基线。维度按设计节奏引入，给玩家认识每个维度的空间',
  },
  {
    id: 'hard', name: '困难',
    threatMul: 1.25, weightShift: 1, envMod: '无',
    note: '威胁预算 +25%，次级维度权重上移一档——同一关的构成变了，不是单纯变肉',
  },
  {
    id: 'nightmare', name: '噩梦',
    threatMul: 1.5, weightShift: 2,
    envMod: '毒池不消失 / 无补给箱 / BOSS 提前 60 秒登场（按场景取其一）',
    note: '威胁预算 +50%，次级维度权重连抬两档，且下一段的维度提前半权重进场——第 1 关就有两个维度，没有平稳的开场',
  },
];

export const DIFFICULTY_BY_ID: Record<DifficultyId, Difficulty> = Object.fromEntries(
  DIFFICULTIES.map((d) => [d.id, d]),
) as Record<DifficultyId, Difficulty>;

// ────────────────────────────────────────────────────────────
// 场景
// ────────────────────────────────────────────────────────────

export type SceneId = 'city' | 'jungle' | 'swamp' | 'desert' | 'snow' | 'military';

/**
 * 可破坏障碍。
 *
 * 三种新障碍带来的**新语义只有两条**，其余都能被已有的地形要素解释：
 *   1. **子弹穿得过去，人过不去**（沙袋 / 铁丝网）——创造"能打不能走"的掩体，
 *      于是远程在这里白拿一段射程，而近战必须绕路或先把障碍拆了。
 *   2. **木墙可以被打开**（与建筑的唯一区别就是 `destructible`）——
 *      让玩家有一次"这条路不通，那我把它打通"的选择权。
 *
 * 建筑作为对照留在表里，是为了让"可破坏"这个维度有一个确定的另一端：
 * 只要看见建筑，就知道这一格的答案永远是【绕开】，不是【拆掉】。
 *
 * 摆放仍归 M2 的 `core/terrain.ts`，本表只定义语义与耐久，不定义坐标。
 */
export interface Obstacle {
  id: string;
  name: string;
  /** 能否被摧毁。false 的障碍对阵容的要求是"绕开"而不是"打开" */
  destructible: boolean;
  /** 阻挡通行 */
  blocksMovement: boolean;
  /** 阻挡射击（子弹会被挡下） */
  blocksShots: boolean;
  /** 阻挡视线与索敌（AI 看不见对面） */
  blocksSight: boolean;
  /** 摧毁所需的有效伤害，0 = 不可摧毁 */
  hp: number;
  /** 摧毁后的残留：none 完全清空，rubble 留下可通行但不提供掩体的废墟 */
  residue: 'none' | 'rubble';
  note: string;
}

export const OBSTACLES: Record<string, Obstacle> = {
  sandbag: {
    id: 'sandbag', name: '沙袋',
    destructible: true, blocksMovement: true, blocksShots: false, blocksSight: false,
    hp: 320, residue: 'rubble',
    note: '新语义①。挡人不挡子弹：远程站在后面是纯赚，近战被挡在外面。拆它最便宜，所以它也是"拆开一条路"的默认选项',
  },
  wire: {
    id: 'wire', name: '铁丝网',
    destructible: true, blocksMovement: true, blocksShots: false, blocksSight: false,
    hp: 180, residue: 'none',
    note: '与沙袋同族但血更少——拆得最快，代价是它拦人的时间也最短。敌我双方都受影响',
  },
  woodwall: {
    id: 'woodwall', name: '木墙',
    destructible: true, blocksMovement: true, blocksShots: true, blocksSight: true,
    hp: 900, residue: 'rubble',
    note: '新语义②。什么都挡，但可以被炸开——它把"这条路不通"从绝对事实变成一次有代价的选择。耐久 900 要求真投入，随口打两枪拆不掉',
  },
  building: {
    id: 'building', name: '建筑',
    destructible: false, blocksMovement: true, blocksShots: true, blocksSight: true,
    hp: 0, residue: 'none',
    note: '对照组。**不可摧毁**是它与木墙的唯一区别，也正是这个区别让"绕开"和"打开"成为两种可学的反应',
  },
  barrel: {
    id: 'barrel', name: '油桶',
    destructible: true, blocksMovement: true, blocksShots: false, blocksSight: false,
    hp: 60, residue: 'none',
    note: '一打就炸的伤害源，不是掩体。原先散落在场景表里，现在收进本表统一表述',
  },
  crate: {
    id: 'crate', name: '补给箱',
    destructible: true, blocksMovement: true, blocksShots: false, blocksSight: false,
    hp: 120, residue: 'none',
    note: '打碎给增益道具。是"停下来打点东西"的诱因，与掩体职责相反',
  },
};

/** 语义自查用：四种代表性障碍，哨兵按这四个检查布尔组合是否只有两类。 */
export const OBSTACLE_KINDS = ['sandbag', 'wire', 'woodwall', 'building'] as const;

/** 地形对战斗的修正。由场景声明，子关卡继承。 */
export interface TerrainMods {
  /** 单位移动倍率。<1 = 迟滞地形（沼泽/冰面/水域） */
  moveMul: number;
  /** 是否生成持续伤害地面区域（毒池） */
  hazardPools: boolean;
  /** 掩体密度 0-1：影响接战跨度，越高越容易被卡成单线 */
  coverDensity: number;
  /** 可引爆物数量等级 0-2 */
  explosives: number;
  /**
   * 木墙密度 0-1。与 `coverDensity` 分开是因为两者管的不是一件事：
   *   `coverDensity`    管【沙袋/铁丝网】——挡人不挡子弹，影响接战跨度
   *   `blockerDensity`  管【木墙】——什么都挡，影响"能不能看见/打到"
   * 合成一个字段会让"这条走廊是被掩体切成段、还是被墙堵死"无法表达，
   * 而这两者对阵容的要求完全不同（前者要穿透，后者要爆破）。
   */
  blockerDensity: number;
}

/**
 * 阶梯的一段。子关卡不手写——由这几段推导出整条 12-15 关的曲线。
 * 想看"这个场景第 9 关长什么样"，读 `expandScene()` 的输出，不要翻表格。
 */
export interface LadderPhase {
  /** 这一段包含几关 */
  levels: number;
  /** 这一段活跃的维度与权重 */
  dims: DimWeights;
  /** 相对上一关的威胁预算增长率 */
  threatGrowth: number;
  /** 这一段的关卡名后缀，用于生成关卡标题 */
  tag: string;
  note: string;
}

export interface Scene {
  id: SceneId;
  name: string;
  /** 场景签名：三个维度，决定这个场景"要什么阵容" */
  signature: DimensionId[];
  /** 一句话描述玩家在这里会遭遇什么 */
  brief: string;
  terrain: TerrainTag[];
  mods: TerrainMods;
  /** 阶梯。段数 × 每段关数 = 该场景的子关卡总数 */
  ladder: LadderPhase[];
  /** 本场景使用的 BOSS（全局 BOSSES 池里的下标，按关卡段映射） */
  bossStages: [number, number, number];
}

/**
 * 6 个场景。
 *
 * ── 第三轮的签名换过一轮，理由逐条写下 ──
 * 场景签名的作用是"这个场景要什么阵容"，所以签名必须选**这个场景独有的那句话**。
 * 旧签名里有一半（卡口、迟滞、围猎、精英护盾）挂的是已被删除的维度，
 * 剩下的一半也不再是各自最独特的挑战，所以整组重排：
 *
 *   城市废墟  自爆 / 号令 / 遁地    —— 街道与下水道：脚下会钻人，楼顶有旗手
 *   原始丛林  潮涌 / 隐形 / 精神    —— 看不见的敌人 + 喊散你阵型的尖啸
 *   沼泽疫地  毒区 / 再生 / 招魂    —— 打不死 + 站起来，与"毒"叠加成消耗战
 *   荒漠废土  遁地 / 空中 / 突进    —— 立体攻势：沙下、天上、地面三路同时来
 *   雪原冻土  隐形 / 魔抗 / 压制    —— 雪盲里摸近，冰晶挡住法术，远处还在挨打
 *   军事禁区  物抗 / 电磁场 / 空中 —— 工业化的三重门：只有换系别才打得动
 *
 * 每个场景都是"先教一个维度，再叠第二第三个，最后三个同时顶格"的同一条曲线；
 * 变的只是这段曲线的三个主角。所以玩家在 6 个场景里学的是同一件事的六种说法：
 * **看出来这是哪一种锁，然后换那把钥匙**。
 *
 * 注意"位面族"的三个维度（隐形/遁地/空中）分散在三个不同的场景里，不集中——
 * 集中会让某一个场景变成"位面专精关"，而位面族的答案彼此完全不同
 * （侦测 / 震地 / 对空），堆在一起只会变成一串互相无关的硬检查。
 */
export const SCENES: Scene[] = [
  {
    id: 'city', name: '城市废墟',
    signature: ['suicide', 'command', 'burrow'],
    brief: '街道被楼体切成一条条走廊，爆炸僵尸从拐角后面走出来，旗手在楼顶给全城加buff，地面下还有东西在跟着你走。',
    terrain: ['building', 'corridor', 'barrel'],
    mods: { moveMul: 1.0, hazardPools: false, coverDensity: 0.8, explosives: 2, blockerDensity: 0.5 },
    bossStages: [0, 1, 2],
    ladder: [
      { levels: 3, dims: { suicide: 10 }, threatGrowth: 1.06, tag: '街区',
        note: '只有自爆。教会玩家"爆炸僵尸不会引爆自己，先打死它再说"' },
      { levels: 3, dims: { suicide: 8, command: 4 }, threatGrowth: 1.06, tag: '塌陷区',
        note: '号令加入。玩家第一次发现"我明明在打同一只怪，它却变硬了"' },
      { levels: 4, dims: { suicide: 8, command: 6, burrow: 5 }, threatGrowth: 1.05, tag: '封锁线',
        note: '遁地进场。三个维度同时在场：脚下、楼顶、拐角各有一条威胁线' },
      { levels: 4, dims: { suicide: 7, command: 7, burrow: 8 }, threatGrowth: 1.04, tag: '核心区',
        note: '遁地权重压过自爆。出土点会一直落在后排，逼玩家把阵型收拢' },
      { levels: 1, dims: { suicide: 6, command: 6, burrow: 10 }, threatGrowth: 1.0, tag: '市政厅',
        note: '场景终关。BOSS 与遁地群同时压上，旗手站在最后面' },
    ],
  },
  {
    id: 'jungle', name: '原始丛林',
    signature: ['swarm', 'stealth', 'mental'],
    brief: '树冠遮住视线，小僵尸像潮水一样从每一丛灌木里渗出来，看不见的东西从侧面摸上来，尖啸声把阵型喊散。',
    terrain: ['marsh', 'pool', 'openField'],
    mods: { moveMul: 0.9, hazardPools: true, coverDensity: 0.35, explosives: 0, blockerDensity: 0.15 },
    bossStages: [0, 1, 2],
    ladder: [
      { levels: 3, dims: { swarm: 10 }, threatGrowth: 1.07, tag: '丛林边缘',
        note: '纯潮涌。玩家的第一课是"范围伤害不是可选项"' },
      { levels: 3, dims: { swarm: 8, stealth: 4 }, threatGrowth: 1.06, tag: '腐叶层',
        note: '隐形进场。怪群当掩护，你看不见的那只在数你的后排' },
      { levels: 3, dims: { swarm: 8, stealth: 5, mental: 4 }, threatGrowth: 1.05, tag: '暗林',
        note: '精神加入。三个维度都在做同一件事：让你指挥不动自己的队伍' },
      { levels: 5, dims: { swarm: 8, stealth: 7, mental: 6 }, threatGrowth: 1.04, tag: '深林',
        note: '三维全开且权重接近。这是本场景的"标准解"区间' },
      { levels: 1, dims: { swarm: 10, stealth: 6, mental: 6 }, threatGrowth: 1.0, tag: '母巢',
        note: '场景终关。潮涌权重顶格，清场速率是唯一的活路' },
    ],
  },
  {
    id: 'swamp', name: '沼泽疫地',
    signature: ['poison', 'regen', 'revive'],
    brief: '每走一步都在往下陷，脚底下是毒水；好容易打死的东西在长回来，打死的还在被拉起来。',
    terrain: ['marsh', 'water', 'pool'],
    mods: { moveMul: 0.6, hazardPools: true, coverDensity: 0.2, explosives: 0, blockerDensity: 0.0 },
    bossStages: [1, 2, 0],
    ladder: [
      { levels: 3, dims: { poison: 10 }, threatGrowth: 1.06, tag: '浅滩',
        note: '纯毒区。教会玩家"有些地是不能站的"' },
      { levels: 3, dims: { poison: 8, regen: 4 }, threatGrowth: 1.06, tag: '疫水',
        note: '再生加入。第一次遇到"打不死的怪"，玩家会本能地加大火力——没用' },
      { levels: 3, dims: { poison: 7, regen: 5, revive: 4 }, threatGrowth: 1.05, tag: '腐沼',
        note: '招魂补上。击杀不再等于减员，玩家必须开始处理"尸体"这件事' },
      { levels: 3, dims: { poison: 7, regen: 7, revive: 6 }, threatGrowth: 1.04, tag: '瘴气深处',
        note: '权重拉平，考验阵容对"持续消耗"的整体答案' },
      { levels: 1, dims: { poison: 8, regen: 8, revive: 8 }, threatGrowth: 1.0, tag: '疫源',
        note: '场景终关。三维等权，没有可以牺牲的短板' },
    ],
  },
  {
    id: 'desert', name: '荒漠废土',
    signature: ['burrow', 'air', 'rush'],
    brief: '一眼平到底，没有一处掩体。威胁从三个高度同时来：沙下、天上、地面。',
    terrain: ['openField', 'barrel'],
    mods: { moveMul: 1.0, hazardPools: false, coverDensity: 0.05, explosives: 1, blockerDensity: 0.1 },
    bossStages: [0, 2, 1],
    ladder: [
      { levels: 3, dims: { burrow: 10 }, threatGrowth: 1.06, tag: '戈壁',
        note: '纯遁地。第一次没有墙可以靠，也没有一个可以站定的方向' },
      { levels: 3, dims: { burrow: 8, rush: 4 }, threatGrowth: 1.06, tag: '风口',
        note: '突进加入。地下的慢，地面的快，两个速度差把队形撕开' },
      { levels: 3, dims: { burrow: 7, rush: 5, air: 4 }, threatGrowth: 1.05, tag: '盐碱地',
        note: '空中进场。三个高度全开，本场景的签名第一次完整出现' },
      { levels: 3, dims: { burrow: 8, rush: 6, air: 6 }, threatGrowth: 1.04, tag: '废墟带',
        note: '权重拉平。需要一个能自己创造阵地的阵容' },
      { levels: 1, dims: { burrow: 10, rush: 7, air: 7 }, threatGrowth: 1.0, tag: '沙暴眼',
        note: '场景终关。遁地权重顶格，站位纪律是唯一答案' },
    ],
  },
  {
    id: 'snow', name: '雪原冻土',
    signature: ['stealth', 'magicRes', 'suppress'],
    brief: '白得看不见边界，雪盲里总有东西在贴近；冰晶咒盾把法术弹开，而远处那个东西一直在朝你吐。',
    terrain: ['ice', 'openField', 'crate'],
    mods: { moveMul: 0.7, hazardPools: false, coverDensity: 0.25, explosives: 0, blockerDensity: 0.2 },
    bossStages: [1, 0, 2],
    ladder: [
      { levels: 3, dims: { stealth: 10 }, threatGrowth: 1.06, tag: '冻土',
        note: '纯隐形。白背景是最难看见脚印的地形，所以这里的潜影最凶' },
      { levels: 3, dims: { stealth: 8, magicRes: 4 }, threatGrowth: 1.06, tag: '风雪线',
        note: '魔抗加入。看不见的还没解决，法术阵容又被挡了一道' },
      { levels: 3, dims: { stealth: 7, magicRes: 5, suppress: 4 }, threatGrowth: 1.05, tag: '冰裂谷',
        note: '远程压制进场。三个维度都在惩罚"原地不动"' },
      { levels: 3, dims: { stealth: 6, magicRes: 7, suppress: 7 }, threatGrowth: 1.04, tag: '永冻层',
        note: '压过隐形，考验"法术被挡 + 站着挨打"的双重压力' },
      { levels: 1, dims: { stealth: 7, magicRes: 9, suppress: 9 }, threatGrowth: 1.0, tag: '极冠',
        note: '场景终关。全游戏对"换系别 + 主动前压"要求最高的一关' },
    ],
  },
  {
    id: 'military', name: '军事禁区',
    signature: ['physRes', 'field', 'air'],
    brief: '装甲实验体推得又稳又慢，电磁屏障把激光整个吃掉，试验体在天上绕着你转。铁丝网与沙袋把路切成一段段。',
    terrain: ['building', 'corridor', 'crate', 'barrel', 'sandbag', 'wire', 'woodwall'],
    mods: { moveMul: 1.0, hazardPools: false, coverDensity: 0.7, explosives: 2, blockerDensity: 0.6 },
    bossStages: [2, 1, 0],
    ladder: [
      { levels: 3, dims: { physRes: 10 }, threatGrowth: 1.06, tag: '外围哨所',
        note: '纯物抗。堆攻击力和穿透是唯一能想到的解法，而它们都不管用' },
      { levels: 3, dims: { physRes: 8, field: 4 }, threatGrowth: 1.06, tag: '装甲库',
        note: '电磁场加入。刚换成法术打铁甲，马上发现有东西完全免疫电磁' },
      { levels: 3, dims: { physRes: 7, field: 5, air: 4 }, threatGrowth: 1.05, tag: '指挥环',
        note: '空中进场。三系闭环在这里第一次完整咬合：每换一次系别都撞上一个新壳' },
      { levels: 3, dims: { physRes: 8, field: 6, air: 6 }, threatGrowth: 1.04, tag: '地下层',
        note: '权重拉平，本作配平精度的压力测试点' },
      { levels: 1, dims: { physRes: 10, field: 8, air: 7 }, threatGrowth: 1.0, tag: '发射井',
        note: '全游戏最后一关。三系抗性同时顶格，阵容里如果少一个系别就过不去' },
    ],
  },
];

export const SCENE_BY_ID: Record<SceneId, Scene> = Object.fromEntries(
  SCENES.map((s) => [s.id, s]),
) as Record<SceneId, Scene>;

// ────────────────────────────────────────────────────────────
// 子关卡展开
// ────────────────────────────────────────────────────────────

/** 一个子关卡 = 一次 15 分钟的单局（C1） */
export interface SubLevel {
  /** 全局唯一 id，例如 `jungle-09` */
  id: string;
  /** 在场景内的序号，1 起 */
  index: number;
  name: string;
  scene: SceneId;
  difficulty: DifficultyId;
  /** 本关活跃的维度与权重 */
  dims: DimWeights;
  /** 基础威胁预算（威胁/秒），未乘难度系数。难度系数在 threatMul 里另给 */
  threatBudget: number;
  threatMul: number;
  /** 由 dims × 僵尸池推导出来的刷怪表 */
  spawnTable: { zombie: ZombieId; weight: number }[];
  /** 本关的 BOSS（全局 BOSSES 下标） */
  bossStage: number;
  /** 本关生效的地形修正（= 场景地形 × 难度修正） */
  terrain: TerrainMods;
  /** 环境修正，仅噩梦档 */
  envMod: string;
}

const BASE_THREAT = 3.0;

/**
 * 按维度权重推导刷怪表。
 *
 * 这一步是"挑战维度由地形和僵尸构筑"的机械实现：
 * 关卡声明它要哪些维度 → 每只僵尸按自己贡献的维度累加权重。
 * 所以不存在"手写 81 张刷怪表"这件事，改一个权重，所有下游关卡跟着变。
 */
export function spawnTableFor(dims: DimWeights): { zombie: ZombieId; weight: number }[] {
  const out: { zombie: ZombieId; weight: number }[] = [];
  for (const z of ZOMBIE_LIST) {
    let w = 0;
    for (const d of z.dims) w += dims[d] ?? 0;
    if (w > 0) out.push({ zombie: z.id, weight: Math.round(w * 10) / 10 });
  }
  return out;
}

/**
 * 权重上移：把非最高权重的维度整体抬升，缩小主次差距。
 * 难度档用它改变【构成】——困难档下原本的配角维度会更活跃，
 * 玩家面对的是不同的战场，而不是同一场战斗里更肉的同一种僵尸。
 */
function shiftWeights(dims: DimWeights, shift: number): DimWeights {
  if (shift === 0) return dims;
  const entries = Object.entries(dims) as [DimensionId, number][];
  if (entries.length === 0) return dims;
  const max = Math.max(...entries.map(([, v]) => v));
  const out: DimWeights = {};
  for (const [id, v] of entries) {
    // 权重越低的维度被抬得越多，最重的那个不动
    const gap = max - v;
    out[id] = Math.round((v + (gap / Math.max(max, 1)) * shift * 2) * 10) / 10;
  }
  return out;
}

/**
 * 噩梦档的【引入期压缩】：把下一段的维度按半权重提前放进当前段。
 *
 * 于是噩梦档第 1 关就已经有两个维度同时在场，而不是到第 4 关才见到第二个。
 * 用「提前引入」而不是「删掉几关」来实现压缩，是因为删关卡会让同一个
 * 关卡 id 在不同难度下指向不同内容——`jungle-13` 在普通档是深林中段、
 * 在噩梦档是终关，同名不同关。存档、进度、玩家之间对关卡的指代全部失准，
 * 这个代价比"引入期不够短"大得多。关数恒定 82 关，三档一致。
 */
function promote(dims: DimWeights, next: DimWeights | undefined): DimWeights {
  if (!next) return dims;
  const out: DimWeights = { ...dims };
  for (const [id, v] of Object.entries(next) as [DimensionId, number][]) {
    out[id] = Math.max(out[id] ?? 0, Math.round((v / 2) * 10) / 10);
  }
  return out;
}

/**
 * 把一个场景展开成完整的子关卡列表。
 *
 * 威胁预算只做温和增长（每关约 +4%~7%），难度增长主要来自【维度构成】。
 * 这是"不堆数值"在数值层的具体实现：到场景终关，威胁预算大约只涨了 2 倍出头，
 * 但活跃维度从 1 个变成 3 个且权重全开。
 *
 * 三档难度的关数完全一致（82 关），差别全在构成上：权重上移、引入期提前、
 * 环境修正。所以"同一关三档"指的一定是同一份关卡设计。
 */
export function expandScene(scene: Scene, difficulty: DifficultyId = 'normal'): SubLevel[] {
  const diff = DIFFICULTY_BY_ID[difficulty];
  const out: SubLevel[] = [];
  let threat = BASE_THREAT;
  let index = 0;

  for (const [pi, phase] of scene.ladder.entries()) {
    // 噩梦档先把下一段的维度拉进来一半，再走统一的权重上移
    const raw =
      difficulty === 'nightmare' ? promote(phase.dims, scene.ladder[pi + 1]?.dims) : phase.dims;
    for (let k = 0; k < phase.levels; k++) {
      index += 1;
      const dims = shiftWeights(raw, diff.weightShift);
      // BOSS 段落：场景的 3 个 BOSS 按关卡进度分派
      const band = index <= 5 ? 0 : index <= 10 ? 1 : 2;
      out.push({
        id: `${scene.id}-${String(index).padStart(2, '0')}`,
        index,
        name: `${scene.name} ${String(index).padStart(2, '0')} · ${phase.tag}`,
        scene: scene.id,
        difficulty,
        dims,
        threatBudget: Math.round(threat * 100) / 100,
        threatMul: diff.threatMul,
        spawnTable: spawnTableFor(dims),
        bossStage: scene.bossStages[band],
        terrain: scene.mods,
        envMod: diff.envMod,
      });
      threat *= phase.threatGrowth;
    }
  }
  return out;
}

/** 全部场景 × 普通难度的子关卡。难度档按需展开，不预先展开 3 倍数据。 */
export const SUB_LEVELS: SubLevel[] = SCENES.flatMap((s) => expandScene(s, 'normal'));

/** 关卡总数，用于文档与哨兵输出 */
export const TOTAL_LEVELS = SCENES.reduce(
  (n, s) => n + s.ladder.reduce((m, p) => m + p.levels, 0),
  0,
);
