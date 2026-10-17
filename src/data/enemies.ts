/**
 * 敌对目标扩展：精英僵尸（17）+ 变异生物（5）。
 *
 * 和 `zombies.ts` 分开放：ZOMBIES / ZOMBIE_LIST 被平衡模拟、刷怪表、关卡预算全链路引用，
 * 精英和变异生物还没进刷怪预算，混进去会让 balance-check 的基线漂移。
 * 字段沿用 `Zombie`，所以 `sim/combat.ts` 的 EHP / DPS / TTK / 控制抗性可以直接算它们。
 *
 * ── 精英 = 基础种 × 统一倍率 + 一条专属能力 ──
 * 倍率一刀切（ELITE_MUL），专属能力按种写（ELITE_SKILL）。改倍率 = 改全部精英。
 * 精英不是"更厚的血包"：每只精英的能力都放大它基础种的行为动词，而不是另起一个。
 *   例：高速 = 冲刺 → 精英高速连续冲刺两次；咒盾 = 吸法 → 精英咒盾把盾套到身边的同伴身上。
 * AI 上精英统一多一层：优先挑后排 / 残血目标（cunning 抬高后嘲讽也更难拉住）。
 *
 * ponytail: 分裂小僵尸是分裂产物，不单独出精英——精英分裂僵尸死后裂出的是普通小僵尸 ×4。
 */
import type { Zombie, ZombieId, ZombieBehavior } from './zombies.ts';
import { ZOMBIES } from './zombies.ts';
import type { DimensionId } from './scenes.ts';

/** 精英统一倍率 */
export const ELITE_MUL = {
  hp: 3.5, atk: 1.4, armor: 1.3, speed: 1.1,
  /** 稳固 / 抗冻 / 狡诈：加法 */
  stab: 25, freezeRes: 0.15, cunning: 0.2,
  /** 威胁预算与奖励 */
  threat: 4, reward: 5,
  /** 模型放大 */
  scale: 1.18,
} as const;

/** 敌对目标扩展条目：Zombie 字段 + 外形 / AI / 技能的文案（评审页与展示页用） */
export type Enemy = Omit<Zombie, 'id' | 'behavior'> & {
  id: string;
  behavior: ZombieBehavior | 'pack' | 'dive' | 'throw';
  /** 基础种（精英才有） */
  base?: ZombieId;
  /** 设计思路 */
  idea: string;
  /** 外形描述 */
  look: string;
  /** AI 行为特点 */
  ai: string;
  /** 技能：[名字, 描述] */
  skills: [string, string][];
  /** 技能参数（原型 battle.html 读这里），距离 m、时间 s */
  p: Record<string, number>;
};

type EliteSkill = { name: string; skill: [string, string]; ai: string; look: string; p: Record<string, number> };

const ELITE_SKILL: Record<Exclude<ZombieId, 'spawnling'>, EliteSkill> = {
  normal: { name: '尸潮领头', skill: ['群聚', '半径 r 内每有一只普通僵尸，自己攻击 +step（上限 cap 层）'], ai: '不急着冲，等身边聚满再一起压上', look: '更高大的工装汉子，额头一道发光的绿色裂痕，背上插着锈钢筋', p: { r: 3, step: .08, cap: 6 } },
  runner: { name: '疾影', skill: ['二连冲', '冲刺命中后 gap 秒内再冲一次，第二次冲向最近的后排'], ai: '第一冲撞开前排，第二冲直奔后排射手 / 法师', look: '赤脚短裤，全身绷带，双眼拖出黄色光尾', p: { gap: 1.2, dash: 6 } },
  brute: { name: '攻城铁甲', skill: ['撼地冲锋', '每 cd 秒向前冲撞 dash m，路径上队员击倒；冲锋中霸体'], ai: '锁定前排盾位，用冲锋把阵线撞开缺口', look: '加厚铁板拼成的盔甲，肩上铆着撞角，护甲缝里透出橙色余火', p: { cd: 8, dash: 5, knock: 140 } },
  toxic: { name: '瘟疫之源', skill: ['毒径', '移动时每 every 秒在脚下留一小块毒地（dps / dur）；死亡毒池半径 × 1.5'], ai: '绕着队伍转圈，用毒径把站位切碎', look: '皮肤上长满发光毒囊，脚下一直滴绿色黏液', p: { every: 1, dps: 30, dur: 4, poolMul: 1.5 } },
  bomber: { name: '连环炸弹', skill: ['延迟三连爆', '死亡或接触后连续爆 n 次，每次间隔 gap 秒、半径递增'], ai: '专找人群最密的地方钻；被打残了会提前引爆', look: '胸口绑满三排发光雷管，背着一只滴答作响的钟', p: { n: 3, gap: .5, r: 2.5 } },
  splitter: { name: '裂殖母体', skill: ['四裂', '死亡裂成 n 只小僵尸，并且每掉 1/3 血就裂出一只'], ai: '往队伍中心挤，边挨打边下崽', look: '背上鼓着三个肉瘤，每个肉瘤里都能看到蜷缩的小僵尸轮廓', p: { n: 4, chunk: 3 } },
  leaper: { name: '断首猎手', skill: ['越顶扑杀', '跳跃距离 × jump，落地对 r m 内造成攻击 × mul 的范围伤害'], ai: '跳过前排直接落在后排中间', look: '四肢更长，背脊一排骨刺，爪子发出黄光', p: { jump: 1.6, r: 1.5, mul: 1.3 } },
  ward: { name: '咒盾祭司', skill: ['共盾', '每 cd 秒给半径 r 内 n 只同伴套一层 shield 点的正面咒盾'], ai: '躲在铁甲后面给前排套盾，自己不顶前', look: '披着破碎法袍，盾牌上刻着发光符文，头顶悬一圈紫色光环', p: { cd: 10, r: 5, n: 3, shield: 400 } },
  spitter: { name: '腐酸炮台', skill: ['散射', '每次喷吐变成 n 发扇形散射，单发攻击 × mul'], ai: '站在最远的射程边缘，专挑扎堆的队员', look: '喉囊鼓成一个巨大的发光酸袋，下颌裂到胸口', p: { n: 3, mul: .6, spread: 25 } },
  herald: { name: '战嚎统领', skill: ['冲锋号', '每 cd 秒吹一次号：半径 r 内僵尸 dur 秒移速 +spd、攻击 +atk'], ai: '永远站在怪群最后方，被近身就后撤', look: '残破的军官大衣，挂着一只锈号角，肩章发出黄光', p: { cd: 12, r: 6, dur: 5, spd: .4, atk: .25 } },
  summoner: { name: '亡灵主教', skill: ['群体招魂', '每 cd 秒复活半径 r 内 n 具尸体，复活体带精英标记（血 × hp）'], ai: '跟在尸潮后面收尸，从不主动接战', look: '高帽长袍，手持一根挂着头骨的权杖，胸口一盏青绿色魂灯', p: { cd: 6, r: 8, n: 3, hp: .6 } },
  tesla: { name: '雷暴核心', skill: ['电磁链', '每 cd 秒放一道电链，在 n 名队员之间跳跃；场内电磁伤害仍全吸收'], ai: '贴着法师 / 射手走，用电链打断施法', look: '背上焊着一台变压器，线圈在头顶持续放出青色电弧', p: { cd: 5, n: 3, mul: .8 } },
  regenerator: { name: '不朽血肉', skill: ['断肢重生', '血量首次降到 at 以下时回满 heal 比例的血（每只一次）'], ai: '硬顶前排吃伤害，逼队伍留着重创技能打第二管血', look: '外露的肌肉不断蠕动，胸前一颗跳动的发光心脏', p: { at: .3, heal: .5 } },
  stalker: { name: '无面刺客', skill: ['影袭', '背刺后立刻重新隐形，hide 秒后可以再背刺一次'], ai: '只打残血或落单的队员，打一下就走', look: '全身裹在黑布里，没有五官，只有两道青色眼缝', p: { hide: 3, back: 2.5 } },
  burrower: { name: '地脉巨蠕', skill: ['三连钻', '出土后 gap 秒再次钻地，连续冲出 n 次，每次都掀飞'], ai: '在后排之间来回钻，专门拆射手站位', look: '头部变成一只钻头般的骨甲，背上拖着碎石与泥土', p: { n: 3, gap: 2, r: 1.5 } },
  flyer: { name: '夜幕蝠王', skill: ['俯冲连击', '一次俯冲连续扑击 n 名队员再升空，俯冲期间可以被近战打到'], ai: '在头顶盘旋找残血目标，一俯冲就是连环扑', look: '翼展更大，翼膜上布满发光血管，头顶一对弯角', p: { n: 2, dive: 1.2 } },
  screamer: { name: '哀嚎女妖', skill: ['二重尖啸', '吟唱缩短到 cast 秒，半径 r m，打断后 cd 秒内还会再起一次'], ai: '躲在掩体后面吟唱，被打断就换个位置再来', look: '长发遮脸，下颌撕裂到胸口，喉咙里发出粉色光', p: { cast: 1.4, r: 4.5, cd: 4 } },
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 精英僵尸：基础种 × ELITE_MUL + 专属能力 */
export const ELITES: Record<string, Enemy> = Object.fromEntries(Object.entries(ELITE_SKILL).map(([id, e]) => {
  const z = ZOMBIES[id as ZombieId], M = ELITE_MUL;
  return [`e_${id}`, {
    ...z, id: `e_${id}`, base: z.id, name: `精英·${e.name}`,
    hp: Math.round(z.hp * M.hp), atk: Math.round(z.atk * M.atk), armor: Math.round(z.armor * M.armor), speed: r2(z.speed * M.speed),
    regen: Math.round(z.regen * M.hp),
    stab: z.stab + M.stab, freezeRes: r2(Math.min(.9, z.freezeRes + M.freezeRes)), cunning: r2(Math.min(.9, z.cunning + M.cunning)),
    threat: r2(z.threat * M.threat), points: z.points * M.reward, money: z.money * M.reward, radius: r2(z.radius * M.scale),
    idea: `${z.name}的强化版：${z.tag}。精英把它的行为放大成「${e.skill[0]}」`,
    look: e.look, ai: e.ai, skills: [e.skill], p: e.p,
    special: `${z.special}；精英：${e.skill[1]}`,
  } satisfies Enemy];
}));

const NONE = { physRes: 0, magicRes: 0, energyField: 0 };
const D = (...d: DimensionId[]) => d;

/**
 * 变异生物：病毒感染的野兽。和僵尸的区别是**快、成群、会配合**——
 * 僵尸是一个个单独的问题，变异生物是一组协同的问题。
 * 数值量级对齐僵尸表：犬 ≈ 高速、熊 ≈ 铁甲、巨猿 ≈ 小 BOSS 门槛以下。
 */
export const MUTANTS: Record<string, Enemy> = {
  dog: {
    id: 'dog', name: '变异犬', hp: 180, speed: 5.5, armor: 20, armorType: 'none', resist: NONE, regen: 0,
    atk: 80, atkInterval: .9, radius: .45, points: 3, money: 5, threat: 1.2, behavior: 'pack', dims: D('rush', 'swarm'),
    stab: 26, superArmor: false, freezeRes: 0, cunning: .3, knock: 18, knockKind: 'knockdown',
    special: '3-5 只一群刷出，围成半圆从侧翼包抄；咬中后撕扯拖拽', tag: '单只很脆，难在同时从三个方向扑上来',
    idea: '「突进」维度的群体版：高速僵尸是一条直线，变异犬是一个包围圈。逼玩家留范围技能或靠盾位兜侧翼',
    look: '皮毛脱落的大型猎犬，脊背裂开露出骨刺，嘴角咧到耳根，眼睛发黄光',
    ai: '成群行动：首领犬（第一只）选目标，其余犬绕到目标两侧再同时扑；同伴死亡过半时整群后撤再冲',
    skills: [['包抄', '冲锋前先绕行 flank m 到目标侧面'], ['撕咬拖拽', '咬中后把目标往外拖 drag m']],
    p: { pack: 4, flank: 3, drag: 1 },
  },
  bear: {
    id: 'bear', name: '变异熊', hp: 2200, speed: 1.8, armor: 260, armorType: 'heavy', resist: { physRes: .3, magicRes: 0, energyField: 0 }, regen: 0,
    atk: 340, atkInterval: 2, radius: 1.1, points: 14, money: 26, threat: 6, behavior: 'charge', dims: D('physRes'),
    stab: 90, superArmor: true, freezeRes: .3, cunning: 0, knock: 70, knockKind: 'knockdown',
    special: '血量降到一半进入狂暴：移速 ×1.5、攻击间隔 ×0.7；人立而起的拍击击倒一片', tag: '物抗 30% + 霸体，法术输出是它的钥匙',
    idea: '比铁甲僵尸更"活"的重装：铁甲是一堵墙，熊会冲过来拆墙。半血狂暴给"何时集火"一个明确时机',
    look: '肩高接近两米的棕熊，背上嵌着锈铁片和断箭，一侧前掌异化成骨刃，口鼻冒绿色腐气',
    ai: '锁定最近的前排硬顶；半血后狂暴，改为冲向输出最高的队员',
    skills: [['人立拍击', '抬身拍地，半径 r m 击倒，攻击 × mul'], ['狂暴', '血量 < rage 时移速 × spd、攻速 × 1/ai']],
    p: { r: 2, mul: 1.2, rage: .5, spd: 1.5, ai: .7 },
  },
  wolf: {
    id: 'wolf', name: '变异双头狼', hp: 650, speed: 4.2, armor: 60, armorType: 'light', resist: NONE, regen: 0,
    atk: 150, atkInterval: 1.1, radius: .6, points: 7, money: 12, threat: 3, behavior: 'herald', dims: D('rush', 'command'),
    stab: 44, superArmor: false, freezeRes: .2, cunning: .5, knock: 30, knockKind: 'knockback',
    special: '两个头各自索敌：一次攻击咬两名相邻队员；嚎叫让附近变异犬进入狂奔', tag: '狼群核心，先杀它犬群就散',
    idea: '变异犬的「传令」：自己能打，同时给犬群加速。给玩家一个"先杀谁"的优先级问题',
    look: '一身灰黑长毛的巨狼，两颗头从肩部分叉，左头眼睛黄光、右头眼睛青光，颈上挂着断链',
    ai: '在犬群后方游走；犬群接敌后从正面切入，双头同时咬前排与身后的一名队员',
    skills: [['双咬', '一次攻击同时命中 n 名相邻目标'], ['狼嚎', '每 cd 秒半径 r 内变异犬 dur 秒移速 +spd']],
    p: { n: 2, cd: 10, r: 6, dur: 4, spd: .35 },
  },
  vulture: {
    id: 'vulture', name: '变异秃鹫', hp: 300, speed: 4.6, armor: 30, armorType: 'none', resist: NONE, regen: 0,
    atk: 130, atkInterval: 1.6, radius: .5, points: 5, money: 9, threat: 2.2, behavior: 'dive', dims: D('air'),
    stab: 22, superArmor: false, freezeRes: 0, cunning: .4, knock: 16, knockKind: 'knockback',
    special: '空中盘旋，俯冲啄击后立刻升空；落到尸体上啄食回血', tag: '和蝠翼僵尸同属空中维度，但它专抢残血目标和尸体',
    idea: '空中维度的"清道夫"：蝠翼僵尸是持续骚扰，秃鹫是收割——专挑残血队员，平时吃尸体回血',
    look: '翼展两米的秃鹫，秃头上长满肉瘤，翅膀残缺露出骨架，爪子发绿光',
    ai: '优先俯冲血量最低的队员；没有残血目标时落到最近的尸体上啄食回血，这时贴地可以被近战打到',
    skills: [['俯冲啄击', '从空中俯冲 dive 秒，命中后立刻升空'], ['食腐', '落在尸体上每秒回复 heal 点，持续 dur 秒']],
    p: { dive: .7, heal: 40, dur: 3, low: .5 },
  },
  ape: {
    id: 'ape', name: '变异巨猿', hp: 3200, speed: 2.2, armor: 180, armorType: 'medium', resist: { physRes: .15, magicRes: .15, energyField: 0 }, regen: 0,
    atk: 300, atkInterval: 1.8, radius: 1.2, points: 18, money: 32, threat: 7, behavior: 'throw', dims: D('suppress', 'rush'),
    stab: 85, superArmor: true, freezeRes: .2, cunning: .3, knock: 80, knockKind: 'knockback',
    special: '远处抛掷瓦砾（落点范围伤害），近处跃起砸地；捶胸怒吼让周围僵尸攻击提升', tag: '远近都能打，逼队伍在"散开躲投掷"和"抱团扛砸地"之间二选一',
    idea: '野外小 BOSS 级精英怪：一只就能把阵型拆开。远程投掷管散开的队伍，跃击管抱团的队伍',
    look: '三米高的银背巨猿，左臂异常粗大、拖在地上，背上长出一排结晶骨刺，胸口有发光的肿块',
    ai: '距离 > far m 时投掷瓦砾；进入 far m 后跃起砸进人群；血量每掉 1/3 捶胸一次',
    skills: [['投掷瓦砾', '每 cd 秒向 far m 外的队员抛一块瓦砾，落点半径 r m'], ['跃击', '跃起砸地 jump m，落点击退'], ['捶胸怒吼', '半径 roar m 内僵尸攻击 +atk，持续 dur 秒']],
    p: { far: 6, cd: 4, r: 1.5, jump: 5, roar: 6, atk: .3, dur: 6 },
  },
};

/** BOSS 的外形 / AI / 技能文案（数值在 run.ts BOSSES，按下标对齐） */
export const BOSS_DESIGN: Pick<Enemy, 'idea' | 'look' | 'ai' | 'skills'>[] = [
  {
    idea: '第一道数值门槛：不考机制，只考小队输出是否达标。站桩打得动就过，打不动说明配装或成长出了问题',
    look: '两倍身高的重装兵尸体，全身焊满铁板，左臂整块是攻城锤，头盔裂缝里透出橙色余火',
    ai: '缓慢直线走向最近的队员，持续重拳近战；不放技能、不换目标',
    skills: [['重拳', '单体近战，攻击力即 BOSS 攻击'], ['踏步', '移动时地面震动（纯表现）']],
  },
  {
    idea: '转移阵地的考题：召唤毒液僵尸 + 脚下落毒池，站桩会被毒死。考的是队伍机动和清小怪的能力',
    look: '肿胀的女性变异体，下半身是一团拖地的毒囊，背上长出一排喷口，长发里缠着发光的毒腺',
    ai: '与队伍保持中距离，周期性召唤毒液僵尸，并在队员脚下落毒池；被近身就后退喷吐',
    skills: [['毒母召唤', '每 cd 秒召唤 n 只毒液僵尸'], ['毒雨', '在队员脚下落 pools 个毒池（半径 r、每秒 dps、持续 dur）']],
  },
  {
    idea: '关底总考：混刷全种类僵尸 + 本体高伤重砸。前两个 BOSS 分别考的输出和机动，这里一起考',
    look: '尸潮堆成的巨人，躯干里能看到挤在一起的僵尸面孔，双臂是缠满铁链的肉柱，头顶一圈紫色光冠',
    ai: '直接冲向队伍中心；周期性原地重砸，同时在身边混刷任意种类的僵尸',
    skills: [['尸潮重砸', '每 cd 秒原地重砸，半径 r、攻击 × mul、击退'], ['尸潮召唤', '每次重砸同时混刷 n 只任意种类僵尸']],
  },
];
