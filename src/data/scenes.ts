/**
 * 挑战维度 · 世界地图 · 子关卡阶梯。
 *
 * 这是本轮架构调整的核心。旧版把整个游戏压成"一局 15 分钟"，`run.ts` 里写死
 * 3 个阶段 / 3 个 BOSS / 3 元素刷怪倍率数组，`stageMods()` 在 stage 4 静默截断。
 * 新版是：世界地图 → 6 个场景 → 每场景 13-15 个子关卡（合计 82 关），
 * 子关卡沿【挑战维度】逐层加深，单局时长仍是 15 分钟（C1）。
 *
 * ── 设计顺序是倒过来的，这一点很重要 ──
 * 用户原话："我们需要在不同场景结合地形和僵尸构筑出不同的挑战类型和维度，
 * 然后再设计玩家的小队角色和武器。"
 * 所以这个文件不引用任何角色数据。挑战维度先立起来，`characters.ts` 里的
 * `answers` 是【对着这张表】填的，不是反过来。
 *
 * ── 维度的定义 ──
 * 维度 = 压力【来源】，不是数值档位。判据有两条，缺一不可：
 *   1. 破解它需要【特定种类】的能力，而不是更高的数字
 *   2. 至少有 3 个不同定位的角色能回答它（见 `characters.ts` 的
 *      `Hero.answers`，由哨兵 §9 做覆盖矩阵校验）
 * 第二条是"每种挑战不止有单一阵容方案"这句话的机械保证——没有它，
 * "多套阵容"就只是文案。
 */

import { ZOMBIE_LIST, type ZombieId } from './zombies.ts';

// ────────────────────────────────────────────────────────────
// 挑战维度
// ────────────────────────────────────────────────────────────

export type DimensionId =
  // F1 数量与节奏
  | 'swarm'        // 潮涌：海量低血小僵尸
  | 'rush'         // 突进：高速近身，压缩反应时间
  | 'eliteHunt'    // 围猎：BOSS/精英与小怪同时压上
  // F2 抗性与反制
  | 'heavyArmor'   // 重甲：高护甲单位阻挡推进
  | 'split'        // 分裂：死亡分裂惩罚无脑 AOE
  | 'shielded'     // 精英护盾：需破盾窗口，吃不吃控
  | 'ctrlResist'   // 控制抗性：霸体免疫位移、抗冻、狡诈，逼你换一种控制手段
  // F3 地形与空间
  | 'choke'        // 卡口：走廊强制单线接战
  | 'open'         // 开阔：无掩体，四面来敌
  | 'sluggish'     // 迟滞：沼泽/水域/冰面改变移动与站位
  // F4 持续与区域
  | 'poison'       // 毒区：地面持续伤害封锁走位
  | 'suicide'      // 自爆：逼迫走位，惩罚站桩
  | 'suppress';    // 远程压制：远程僵尸惩罚静止阵地

/** 维度家族。同一族内的维度要求【同类】能力，跨族才要求不同的能力。 */
export type DimensionFamily = 'tempo' | 'resist' | 'space' | 'attrition';

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
  // ── 第二轮新增的三种可破坏障碍，语义与数值见下方 OBSTACLES ──
  | 'sandbag'    // 沙袋：挡人不挡子弹
  | 'wire'       // 铁丝网：挡人不挡子弹，附带减速
  | 'woodwall';  // 木墙：什么都挡，但可以被炸开

export interface Dimension {
  id: DimensionId;
  name: string;
  family: DimensionFamily;
  /** 一句话说明这个维度在战场上是什么感觉 */
  feels: string;
  /** 破解它需要什么【种类】的能力——不是需要多少数值 */
  needs: string;
  /** 表达这个维度需要的地形要素；空数组表示纯靠僵尸构成 */
  terrain: TerrainTag[];
  /** 能贡献这个维度的僵尸 */
  zombies: ZombieId[];
}

export const DIMENSIONS: Dimension[] = [
  // ── F1 数量与节奏 ──
  {
    id: 'swarm', name: '潮涌', family: 'tempo',
    feels: '一眼望不到边的小僵尸，单个不疼，但你只有 5 个人',
    needs: '范围清场：一次攻击覆盖多个目标',
    terrain: [],
    zombies: ['normal', 'spawnling'],
  },
  {
    id: 'rush', name: '突进', family: 'tempo',
    feels: '跑得比你快的僵尸，从你反应不过来的时候就已经贴脸了',
    needs: '控制/减速 + 近距爆发，或高攻速快速点掉',
    terrain: [],
    zombies: ['runner'],
  },
  {
    id: 'eliteHunt', name: '围猎', family: 'tempo',
    feels: 'BOSS 或精英在正面，小怪同时从侧面压上来',
    needs: '分火能力，或一个能扛住正面让全队集火的支点',
    terrain: [],
    zombies: ['ward', 'spitter'],
  },

  // ── F2 抗性与反制 ──
  {
    id: 'heavyArmor', name: '重甲', family: 'resist',
    feels: '打上去全是白字，它们走得很慢但你拦不住',
    needs: '穿透或爆炸/火焰——靠堆攻击力没用',
    terrain: [],
    zombies: ['brute'],
  },
  {
    id: 'split', name: '分裂', family: 'resist',
    feels: '你一发 AOE 打死了三只，场上反而多了九只',
    needs: '单体点杀，或先控住再逐个处理',
    terrain: [],
    zombies: ['splitter', 'spawnling'],
  },
  {
    id: 'shielded', name: '精英护盾', family: 'resist',
    feels: '怎么打都不掉血，直到某个瞬间它突然变得很脆',
    needs: '破盾手段 + 集火窗口，AOE 磨盾是浪费',
    terrain: [],
    zombies: ['ward'],
  },
  {
    id: 'ctrlResist', name: '控制抗性', family: 'resist',
    feels: '推不动、冻不住、嘲讽不灵——你最顺手的那一招突然不响了',
    needs: '换一种控制手段，或者干脆放弃控制用点杀与续航硬吃。**加大力度没有用**',
    terrain: ['sandbag', 'wire'],
    zombies: ['brute', 'ward', 'toxic', 'leaper'],
  },

  // ── F3 地形与空间 ──
  {
    id: 'choke', name: '卡口', family: 'space',
    feels: '只有一条路，僵尸排队进来，你的五个人挤在一起',
    needs: '直线穿透或堵口能力，把走廊变成绞肉机',
    terrain: ['building', 'corridor'],
    zombies: ['brute', 'toxic'],
  },
  {
    id: 'open', name: '开阔', family: 'space',
    feels: '没有墙，没有掩体，四个方向同时来人',
    needs: '持续输出 + 全域索敌，或者能自己创造阵地的召唤物',
    terrain: ['openField'],
    zombies: ['runner', 'leaper'],
  },
  {
    id: 'sluggish', name: '迟滞', family: 'space',
    feels: '脚下的地不让你好好走，走位这件事突然变得很贵',
    needs: '机动力，或者干脆不依赖走位的远程输出',
    terrain: ['marsh', 'water', 'ice'],
    zombies: ['leaper'],
  },

  // ── F4 持续与区域 ──
  {
    id: 'poison', name: '毒区', family: 'attrition',
    feels: '地上全是不能踩的东西，你被一点一点挤到墙角',
    needs: '续航治疗，或能在毒区外解决战斗的射程',
    terrain: ['pool', 'marsh'],
    zombies: ['toxic'],
  },
  {
    id: 'suicide', name: '自爆', family: 'attrition',
    feels: '它们不咬你，它们只是走过来然后炸掉',
    needs: '远程点杀或击退，把爆炸挡在接触距离之外',
    terrain: ['barrel'],
    zombies: ['bomber'],
  },
  {
    id: 'suppress', name: '远程压制', family: 'attrition',
    feels: '站着不动就一直在挨打，可前面又有一堆东西挡路',
    needs: '主动前压的突进手段，或者比它更长的射程',
    terrain: [],
    zombies: ['spitter'],
  },
];

export const DIMENSION_BY_ID: Record<DimensionId, Dimension> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, d]),
) as Record<DimensionId, Dimension>;

/** 权重表：维度 → 该维度在关卡里的活跃程度（0 或缺失 = 不活跃） */
export type DimWeights = Partial<Record<DimensionId, number>>;

// ────────────────────────────────────────────────────────────
// 答案标签
// ────────────────────────────────────────────────────────────

/**
 * 答案 = 能力的【形状】，不是能力的强度。
 *
 * 为什么不直接让角色写 `answers: DimensionId[]`：那样"两套阵容解同一个维度"
 * 这件事就不可见了。`aoeClear` 和 `explosive` 都能回答潮涌，但前者怕分裂、
 * 后者怕贴身；`pierce` 和 `armorShred` 都能回答重甲，但一个吃站位一个吃集火。
 * 用【形状】做标签，多解性才是数据，而不是文档里的一句声称。
 *
 * 词表放在这个文件（维度知识），赋值放在 `characters.ts`（角色知识）。
 * 这样 scenes.ts 仍然不引用任何角色数据，"先维度后角色"的设计顺序没被打破。
 */
export type AnswerTag =
  | 'aoeClear'      // 范围清场：一次攻击覆盖多个目标
  | 'singleTarget'  // 单体点杀：高单体效率，不制造额外目标
  | 'sustainedDps'  // 持续输出：不需要窗口，一直在打
  | 'burst'         // 爆发窗口：短时间把伤害集中砸出去
  | 'pierce'        // 直线穿透：无视部分护甲，且吃站位
  | 'explosive'     // 爆炸灼烧：高额定值伤害，不吃护甲减免
  | 'armorShred'    // 破甲腐蚀：把目标护甲降下来给全队用
  | 'control'       // 控制减速：限制移动
  | 'taunt'         // 堵口嘲讽：把敌人固定在一点
  | 'mitigate'      // 减伤护盾：降低全队承伤
  | 'sustain'       // 续航治疗
  | 'ranged'        // 远程射程：在威胁范围外解决战斗
  | 'mobility'      // 机动突进：走位成本对你更低
  | 'summon'        // 召唤物：用编制外的单位分摊
  | 'debuff';       // 标记易伤：为全队制造集火窗口

/**
 * 答案 → 它能回答哪些维度。
 *
 * 一个答案通常覆盖多个维度，这正是"不同阵容解同一个维度"的来源。
 * 反向查询（每个维度有几个答案、来自几个定位）由哨兵 §9 打印成覆盖矩阵——
 * 那个矩阵里任何一格低于 3 个答案或 2 个定位，就说明设计有洞。
 */
export const ANSWER_DIMS: Record<AnswerTag, DimensionId[]> = {
  aoeClear: ['swarm'],
  // 硬解点杀：不去控它，直接把它打掉。
  singleTarget: ['split', 'shielded', 'ctrlResist'],
  // 潮涌的第三种解法：不是一次打多个，而是【单位时间打得足够快】。
  // 和 aoeClear 是不同形状——扫/炸吃站位，高射速吃持续站桩。
  sustainedDps: ['open', 'eliteHunt', 'swarm'],
  // 分裂的第三种解法：在它分裂出孩子之前把母体连着孩子一起秒掉。
  burst: ['eliteHunt', 'shielded', 'rush', 'split', 'ctrlResist'],
  pierce: ['heavyArmor', 'choke'],
  explosive: ['heavyArmor', 'choke', 'swarm'],
  // 破甲不看霸体，也不看抗冻——它根本不是控制。
  armorShred: ['heavyArmor', 'shielded', 'eliteHunt', 'ctrlResist'],
  // 减速是全游戏唯一【不设对抗属性】的控制，所以它永远是控制抗性那扇没关的门。
  // 这不是漏洞，是地板：任何一层控制都能被完全免疫的话，控制流整体作废。
  control: ['rush', 'suicide', 'split', 'ctrlResist'],
  // 霸体只免位移，嘲讽照常生效；挡它的是狡诈。
  taunt: ['choke', 'eliteHunt', 'ctrlResist'],
  mitigate: ['rush', 'poison', 'suppress'],
  // 续航硬吃：不动控，靠治疗扛住被推挤与冻不住的代价。
  sustain: ['poison', 'sluggish', 'ctrlResist'],
  // 射程同时回答四件事：够得着远程、点得掉自爆、不用踩毒、不用走位
  ranged: ['suppress', 'suicide', 'sluggish', 'poison'],
  // 机动同理：躲开自爆、离开毒区、脱离迟滞、在开阔地重新站位
  mobility: ['sluggish', 'poison', 'suppress', 'open', 'suicide'],
  // 召唤物是编制外的单位，能堵一个方向，也能顶住突进
  summon: ['rush', 'suppress', 'eliteHunt', 'choke', 'open'],
  debuff: ['eliteHunt', 'shielded'],
};

export const ANSWER_LIST = Object.keys(ANSWER_DIMS) as AnswerTag[];

/** 单个答案在覆盖矩阵里的门槛：至少 3 个答案、至少 2 个不同定位 */
export const MIN_ANSWERS_PER_DIM = 3;
export const MIN_ROLES_PER_DIM = 2;

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
 * 场景名沿用 `05-资产清单.md` §5 已经预算过资产的那 6 个地形，
 * 但含义全变了：旧版是"6 张地形不同、机制微调的地图"，新版是
 * "6 个要什么阵容各不相同的挑战签名"。旧版"草原"并入"原始丛林"。
 */
export const SCENES: Scene[] = [
  {
    id: 'city', name: '城市废墟',
    signature: ['choke', 'suicide', 'heavyArmor'],
    brief: '街道被楼体切成一条条走廊，爆炸僵尸从拐角后面走出来，胖僵尸堵住唯一的出口。',
    terrain: ['building', 'corridor', 'barrel'],
    mods: { moveMul: 1.0, hazardPools: false, coverDensity: 0.8, explosives: 2, blockerDensity: 0.5 },
    bossStages: [0, 1, 2],
    ladder: [
      { levels: 3, dims: { choke: 10 }, threatGrowth: 1.06, tag: '街区',
        note: '只有卡口。教会玩家"别把五个人挤在一条线上"' },
      { levels: 3, dims: { choke: 8, suicide: 4 }, threatGrowth: 1.06, tag: '塌陷区',
        note: '加入自爆。玩家学会在被逼进走廊前先点掉爆源' },
      { levels: 4, dims: { choke: 8, suicide: 6, heavyArmor: 5 }, threatGrowth: 1.05, tag: '封锁线',
        note: '三个维度同时在场。重甲堵口 + 自爆逼走位 = 走廊里的两难' },
      { levels: 4, dims: { choke: 7, suicide: 7, heavyArmor: 8 }, threatGrowth: 1.04, tag: '核心区',
        note: '重甲权重压过卡口，穿透/爆炸成为硬性检查' },
      { levels: 1, dims: { choke: 6, suicide: 6, heavyArmor: 10 }, threatGrowth: 1.0, tag: '市政厅',
        note: '场景终关。BOSS 与重甲群同时压上' },
    ],
  },
  {
    id: 'jungle', name: '原始丛林',
    signature: ['swarm', 'poison', 'rush'],
    brief: '树冠遮住视线，小僵尸像潮水一样从每一丛灌木里渗出来，毒液僵尸死在你退无可退的地方。',
    terrain: ['marsh', 'pool', 'openField'],
    mods: { moveMul: 0.9, hazardPools: true, coverDensity: 0.35, explosives: 0, blockerDensity: 0.15 },
    bossStages: [0, 1, 2],
    ladder: [
      { levels: 3, dims: { swarm: 10 }, threatGrowth: 1.07, tag: '丛林边缘',
        note: '纯潮涌。玩家的第一课是"范围伤害不是可选项"' },
      { levels: 3, dims: { swarm: 8, poison: 4 }, threatGrowth: 1.06, tag: '腐叶层',
        note: '毒区进场。清得慢 → 死得多 → 地上毒越多，形成正反馈' },
      { levels: 3, dims: { swarm: 8, poison: 5, rush: 4 }, threatGrowth: 1.05, tag: '毒雾带',
        note: '突进加入。潮涌拖住你，高速僵尸负责在毒区里补刀' },
      { levels: 5, dims: { swarm: 8, poison: 7, rush: 6 }, threatGrowth: 1.04, tag: '深林',
        note: '三维全开且权重接近。这是本场景的"标准解"区间' },
      { levels: 1, dims: { swarm: 10, poison: 6, rush: 6 }, threatGrowth: 1.0, tag: '母巢',
        note: '场景终关。潮涌权重顶格，清场速率是唯一的活路' },
    ],
  },
  {
    id: 'swamp', name: '沼泽疫地',
    signature: ['sluggish', 'poison', 'suppress'],
    brief: '每走一步都在往下陷，喷吐僵尸站在你够不到的地方慢慢磨，脚下还在掉血。',
    terrain: ['marsh', 'water', 'pool'],
    mods: { moveMul: 0.6, hazardPools: true, coverDensity: 0.2, explosives: 0, blockerDensity: 0.0 },
    bossStages: [1, 2, 0],
    ladder: [
      { levels: 3, dims: { sluggish: 10 }, threatGrowth: 1.06, tag: '浅滩',
        note: '纯迟滞。教会玩家"走位不再是免费资源"' },
      { levels: 3, dims: { sluggish: 8, suppress: 4 }, threatGrowth: 1.06, tag: '疫水',
        note: '远程压制加入。走不动 + 站着挨打 = 必须主动前压' },
      { levels: 3, dims: { sluggish: 7, suppress: 5, poison: 4 }, threatGrowth: 1.05, tag: '腐沼',
        note: '毒区补上。三个维度都在惩罚"原地不动"' },
      { levels: 3, dims: { sluggish: 7, suppress: 7, poison: 6 }, threatGrowth: 1.04, tag: '瘴气深处',
        note: '权重拉平，考验阵容对"持续消耗"的整体答案' },
      { levels: 1, dims: { sluggish: 8, suppress: 8, poison: 8 }, threatGrowth: 1.0, tag: '疫源',
        note: '场景终关。三维等权，没有可以牺牲的短板' },
    ],
  },
  {
    id: 'desert', name: '荒漠废土',
    signature: ['open', 'suppress', 'rush'],
    brief: '没有一处掩体，四个方向同时来人，跑得最快的和最远的同时在打你。',
    terrain: ['openField', 'barrel'],
    mods: { moveMul: 1.0, hazardPools: false, coverDensity: 0.05, explosives: 1, blockerDensity: 0.1 },
    bossStages: [0, 2, 1],
    ladder: [
      { levels: 3, dims: { open: 10 }, threatGrowth: 1.06, tag: '戈壁',
        note: '纯开阔。第一次没有墙可以靠，考验全域索敌' },
      { levels: 3, dims: { open: 8, rush: 4 }, threatGrowth: 1.06, tag: '风口',
        note: '突进加入。没有卡口可以借，高速僵尸直冲后排' },
      { levels: 3, dims: { open: 7, rush: 5, suppress: 4 }, threatGrowth: 1.05, tag: '盐碱地',
        note: '远程压制加入。开阔 + 远程 = 被迫在不利地形上进攻' },
      { levels: 3, dims: { open: 8, rush: 6, suppress: 6 }, threatGrowth: 1.04, tag: '废墟带',
        note: '权重拉平。需要一个能自己创造阵地的阵容' },
      { levels: 1, dims: { open: 10, rush: 7, suppress: 7 }, threatGrowth: 1.0, tag: '沙暴眼',
        note: '场景终关。开阔权重顶格，站位纪律是唯一答案' },
    ],
  },
  {
    id: 'snow', name: '雪原冻土',
    signature: ['sluggish', 'eliteHunt', 'shielded'],
    brief: '冰面上刹不住脚，精英护盾僵尸顶在最前面，小怪趁你打不动它的时候围上来。',
    terrain: ['ice', 'openField', 'crate'],
    mods: { moveMul: 0.7, hazardPools: false, coverDensity: 0.25, explosives: 0, blockerDensity: 0.2 },
    bossStages: [1, 0, 2],
    ladder: [
      { levels: 3, dims: { sluggish: 10 }, threatGrowth: 1.06, tag: '冻土',
        note: '纯迟滞，但地面是冰——这次是打滑而不是下陷' },
      { levels: 3, dims: { sluggish: 8, shielded: 4 }, threatGrowth: 1.06, tag: '风雪线',
        note: '护盾僵尸加入。走不动 + 打不动 = 必须安排破盾窗口' },
      { levels: 3, dims: { sluggish: 7, shielded: 5, eliteHunt: 4 }, threatGrowth: 1.05, tag: '冰裂谷',
        note: '围猎加入。破盾的同时还要分火给侧面的小怪' },
      { levels: 3, dims: { sluggish: 6, shielded: 7, eliteHunt: 7 }, threatGrowth: 1.04, tag: '永冻层',
        note: '双精英维度加压，考验爆发窗口的调度' },
      { levels: 1, dims: { sluggish: 7, shielded: 9, eliteHunt: 9 }, threatGrowth: 1.0, tag: '极冠',
        note: '场景终关。全游戏对"爆发窗口调度"要求最高的一关' },
    ],
  },
  {
    id: 'military', name: '军事禁区',
    // 第二轮把第三个签名从 eliteHunt 换成 ctrlResist，eliteHunt 降为阶梯里的次级维度。
    // 理由：本场景是霸体僵尸（胖 / 护盾）的主场，加上铁丝网与沙袋同场出现，
    // "推不动、冻不住、路还被拦着"是本场景最独特的那句话，值得占一个签名位。
    signature: ['heavyArmor', 'ctrlResist', 'split'],
    brief: '装甲单位推进得又稳又慢，推不动也冻不住；精英在正面吸引火力，分裂僵尸逼你不能用范围武器；铁丝网与沙袋把路切成一段段。',
    terrain: ['building', 'corridor', 'crate', 'barrel', 'sandbag', 'wire', 'woodwall'],
    mods: { moveMul: 1.0, hazardPools: false, coverDensity: 0.7, explosives: 2, blockerDensity: 0.6 },
    bossStages: [2, 1, 0],
    ladder: [
      { levels: 3, dims: { heavyArmor: 10 }, threatGrowth: 1.06, tag: '外围哨所',
        note: '纯重甲。穿透/爆炸是唯一的门，堆攻击力进不来' },
      { levels: 3, dims: { heavyArmor: 8, split: 4 }, threatGrowth: 1.06, tag: '装甲库',
        note: '分裂加入。刚学会用爆炸打重甲，马上就被告知爆炸有代价' },
      { levels: 3, dims: { heavyArmor: 7, ctrlResist: 5, split: 5 }, threatGrowth: 1.05, tag: '指挥环',
        note: '控制抗性加入。胖僵尸与护盾僵尸成规模，冷冻与击退流在这里第一次失效——**加大力度没有用，要换一种控制**' },
      { levels: 3, dims: { heavyArmor: 8, ctrlResist: 6, split: 6, eliteHunt: 4 }, threatGrowth: 1.04, tag: '地下层',
        note: '围猎也压上来，权重拉平，本作配平精度的压力测试点' },
      { levels: 1, dims: { heavyArmor: 10, ctrlResist: 8, split: 7, eliteHunt: 6 }, threatGrowth: 1.0, tag: '发射井',
        note: '全游戏最后一关。四个维度同时顶格，其中控制抗性会直接废掉一整类阵容' },
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
