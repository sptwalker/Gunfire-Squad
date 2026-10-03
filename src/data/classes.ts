/**
 * 职业树（第三轮 P2，`00` §C7-1/2/3/11/25）。
 *
 * ── 一个职业 = 一路选过的边（path） ──
 * 第 k 次转职 = 在第 k 条轴上二选一，每树 1+2+4+8+16+32+64+64 = 191 个职业。
 * 但轴不是全树共用的：
 *   第 1 转 基础职业（锋/盾）× 第 2 转 基础职业方向（轻/重）→ 全树共用，4 个方向
 *   第 3 转     每个方向有自己的两条【特色职业分线】→ 8 条，分线 = 一种独有机制（分身 / 巨人化 / 虚化 …）
 *   第 4 转     每条分线有自己的两个【职业流派】→ 16 个
 *   第 5 转 职业专精（光环 进取/守护）× 第 6 转 英雄角色（号令 授/令）→ 全树共用，内容由分线决定
 *
 * ── 技能越往上越团队化（替换制，C7-3）──
 *   A 自身技  第 1 转开、第 2 转升     只作用于自己
 *   B 分线技  第 3 转开、第 4 转升         本职业的招牌机制，决定玩起来像什么
 *   C 光环    第 5 转开                 被动，范围内队友 / 敌人
 *   D 号令    第 6 转开                 主动，全队
 *   D+ 五星   五星                     每位英雄的号令单独强化（64 个各不相同）
 *
 * 答案标签挂在技能上（C7-19），职业标签 = 身上技能标签的并集。
 * 技能只写行为不写数字——倍率 / CD 在 P4 技能表定，走模拟器。
 */

import type { Primary } from './attributes.ts';
import type { AnswerTag } from './scenes.ts';
import type { WeaponClass } from './weapons.ts';
import { ADVANCE_RANKS } from './progression.ts';

export type TreeId = 'swordsman' | 'mage' | 'archer' | 'medic' | 'tech';

/** [名字, 行为, 答案标签] */
export type SkillDef = [name: string, text: string, tags: AnswerTag[]];

export interface AxisSide {
  name: string;
  /** 新增可用武器类别 */
  weapons?: WeaponClass[];
  /** 属性增减，和必须为 0 */
  attr: Partial<Primary>;
  note: string;
}

export interface Axis {
  name: string;
  sides: [AxisSide, AxisSide];
}

/** 第 4 转的职业流派：B 槽升级成什么 */
export interface Variant extends AxisSide {
  title: string;
  skill: SkillDef;
}

/** 第 3 转的特色职业分线：一个独有机制，从 B 槽一路长到五星 */
export interface Archetype extends AxisSide {
  title: string;
  /** 机制家族，跨树复用（P2 第二步其余四树从同一张家族表里取） */
  family: string;
  skill: SkillDef;
  variants: [Variant, Variant];
  /** 第 5 转职业名，下标 a4*2+a5 */
  t5: [string, string, string, string];
  /** C 槽：[进取, 守护] */
  aura: [SkillDef, SkillDef];
  /** D 槽：[授, 令] */
  order: [SkillDef, SkillDef];
  /** 五星：每位英雄的号令单独强化，下标同 heroes（a4*4+a5*2+a6） */
  ultimates: SkillDef[];
  /** 第 6 转 8 个「称号·名字|五星称号」，下标 a4*4+a5*2+a6 */
  heroes: string[];
}

export type SlotId = 'A' | 'B' | 'C' | 'D';

/** `axes` = 决定槽里是哪个技能的转（下标从 0 起），也就是技能 key 的位。 */
export const SKILL_SLOTS: { id: SlotId; opens: number; upgrades: number[]; axes: number[]; scope: string }[] = [
  { id: 'A', opens: 1, upgrades: [2], axes: [0, 1], scope: '自身' },
  { id: 'B', opens: 3, upgrades: [4], axes: [0, 1, 2, 3], scope: '分线机制' },
  { id: 'C', opens: 5, upgrades: [], axes: [0, 1, 2, 4], scope: '光环（被动，范围）' },
  { id: 'D', opens: 6, upgrades: [7], axes: [0, 1, 2, 5], scope: '号令（主动，全队）' },
];

export interface ClassTree {
  id: TreeId;
  /** 两字前缀，用于职业 id */
  key: string;
  name: string;
  weapons: WeaponClass[];
  primary: Primary;
  /** 军衔成长率，按第 1 轴分（C7-4：5–10%，按职业） */
  growth: [number, number];
  /** 全树共用的轴：第 1、2、5、6 转 */
  axes: [Axis, Axis, Axis, Axis];
  /** 第 1 转名 [a1]、第 2 转名 [a1*2+a2] */
  names: { t1: [string, string]; core: [string, string, string, string] };
  /** A 槽：key = 第 1–2 转的边 */
  skillA: Record<string, SkillDef>;
  /** 4 个基础职业方向各两条特色职业分线，下标 a1*2+a2 */
  styles: [Archetype, Archetype][];
}

// ─────────────────────────────────────────────
// 剑士树（样板）
// ─────────────────────────────────────────────

const SWORDSMAN: ClassTree = {
  id: 'swordsman', key: 'sw', name: '剑士',
  weapons: ['blade'],
  primary: { str: 28, agi: 25, tgh: 27, int: 20, luk: 22, con: 28 },
  growth: [0.08, 0.06],
  axes: [
    {
      name: '攻 / 守', sides: [
        { name: '锋', attr: { str: 6, tgh: -6 }, note: '主手双持，平砍不停' },
        { name: '盾', weapons: ['shield'], attr: { tgh: 8, str: -4, agi: -4 }, note: '举盾减伤，替后排吃第一波' },
      ],
    },
    {
      name: '轻 / 重', sides: [
        { name: '轻', attr: { agi: 6, con: -6 }, note: '冲刺、翻滚、贴脸换位' },
        { name: '重', weapons: ['hammer'], attr: { str: 6, agi: -6 }, note: '重剑 / 重锤，砸碎护甲' },
      ],
    },
    {
      name: '光环：进取 / 守护', sides: [
        { name: '进取', attr: { luk: 4, tgh: -4 }, note: '光环放大队友的输出' },
        { name: '守护', attr: { tgh: 4, luk: -4 }, note: '光环替队友挡伤害' },
      ],
    },
    {
      name: '号令：授 / 令', sides: [
        { name: '授', attr: { con: 4, str: -4 }, note: '把自己的分线能力分给全队' },
        { name: '令', attr: { int: 4, luk: -4 }, note: '一次改变战场的大号令' },
      ],
    },
  ],
  names: {
    t1: ['精锐剑士', '刀盾手'],
    core: ['双剑士', '重剑士', '游盾卫', '塔盾兵'],
  },
  skillA: {
    '0': ['连斩', '短时间内攻速提高，平砍变三连击', ['sustainedDps']],
    '1': ['举盾', '正面受到的伤害降低，持续数秒', ['mitigate']],
    '00': ['疾风连斩', '连斩期间每次击杀后冲向下一个目标', ['sustainedDps', 'mobility']],
    '01': ['裂甲重斩', '连斩换成重斩，每次命中削减目标护甲，可叠加', ['sustainedDps', 'armorShred']],
    '10': ['援护盾冲', '冲到被围攻的队友身边举盾，替对方分担伤害', ['mitigate', 'mobility']],
    '11': ['破甲盾击', '举盾期间反击，盾击削减面前敌人的护甲', ['mitigate', 'armorShred']],
  },
  styles: [
    // ── 双剑士（锋·轻）──
    [
      {
        name: '剑影', title: '影剑士', family: '分身', attr: { agi: 4, con: -4 }, note: '召出影子分身，手越多刀越多',
        skill: ['影分身', '召出 2 个影子分身复制你的攻击，持续数秒；分身挨打会消散', ['summon', 'sustainedDps']],
        variants: [
          { name: '环刃', title: '环刃影武士', attr: { agi: 4, int: -4 }, note: '分身围成剑环',
            skill: ['环刃剑阵', '分身不再跟随，而是绕你高速旋转成一圈剑环，碰到的敌人都被切开', ['summon', 'aoeClear']] },
          { name: '瞬影', title: '瞬影刺客', attr: { luk: 4, con: -4 }, note: '分身瞬移合击',
            skill: ['影袭', '分身瞬移到被标记目标的身后同时出手，打完你与其中一个分身交换位置', ['summon', 'burst']] },
        ],
        t5: ['千刃舞者', '残影舞者', '追魂刺客', '幻身刺客'],
        aura: [
          ['影随', '光环内队友每次攻击有几率带出一道影子，把这次攻击再打一遍', ['sustainedDps']],
          ['残影', '光环内队友挨打时留下残影，附近敌人会转去打残影', ['mitigate']],
        ],
        order: [
          ['影卫号令', '给每名队友召出一个影子分身，复制他们的攻击，持续数秒', ['summon']],
          ['群影猎杀', '标记一个精英，你和所有影子瞬移到它四周同时出手', ['singleTarget', 'burst']],
        ],
        ultimates: [
          ['万刃回环', '影卫号令召出的分身也绕队友旋转成剑环；剑环里每触发一次影随，就多分出一道剑刃', ['summon', 'aoeClear']],
          ['无双乱舞', '群影猎杀不再一击结束：你带着剑环在精英之间连续瞬移切割，每次击杀刷新一次瞬移', ['singleTarget', 'aoeClear']],
          ['天影剑网', '影卫号令的分身与队友的残影连成剑网，被残影吸过去的敌人穿过剑网时被切开', ['summon', 'control']],
          ['影坠星', '群影猎杀落点时剑环从天而降，在精英四周砸出一圈，把周围小怪震开', ['burst', 'aoeClear']],
          ['无影随行', '影卫号令期间，队友的分身会自动瞬移到队友所打目标的身后合击', ['summon', 'burst']],
          ['瞬狱', '群影猎杀斩杀目标后，你和所有影子立即瞬移到下一个精英再杀一次，直到场上没有精英或计时结束', ['singleTarget', 'burst']],
          ['斩首令', '影卫号令期间，队友的残影被攻击时，分身瞬移到攻击者身后反斩', ['summon', 'mitigate']],
          ['噬天影', '群影猎杀前先在原地留下全队残影吸引仇恨，围杀完成后真身与残影换位撤回', ['singleTarget', 'mitigate']],
        ],
        heroes: ['影幕·艾伦|万刃', '孤刃·凯|无双', '残月·琳|天阵', '千面·塞拉|坠星', '影杀·夜|无影', '追魂·刹那|瞬狱', '鬼步·狄恩|斩首', '分光·维克|噬天'],
      },
      {
        name: '御剑', title: '御剑士', family: '武器驾驭', weapons: ['thrown'], attr: { int: 6, con: -6 }, note: '以气御剑，剑离手飞行',
        skill: ['飞剑', '放出数把幻影飞剑环绕自身，自动飞向附近敌人再飞回', ['ranged', 'sustainedDps']],
        variants: [
          { name: '万剑', title: '万剑御者', attr: { int: 4, str: -4 }, note: '剑多成雨',
            skill: ['万剑诀', '飞剑数量大增，抬手化作剑雨落向一片区域', ['ranged', 'aoeClear']] },
          { name: '巨剑', title: '巨剑御者', attr: { str: 4, int: -4 }, note: '剑合成一把巨剑',
            skill: ['巨剑化', '所有飞剑合成一把放大数倍的巨剑，沿直线贯穿敌阵', ['ranged', 'pierce']] },
        ],
        t5: ['剑雨客', '剑幕客', '断天客', '镇岳客'],
        aura: [
          ['剑意', '光环内队友的攻击附带一道小剑气，射程更远，能打到飞行怪', ['ranged']],
          ['护身剑', '光环内每名队友身边绕着一把飞剑，自动拦截飞来的投射物', ['mitigate']],
        ],
        order: [
          ['授剑', '把全队的武器幻化放大数秒，攻击范围与伤害区域大幅增加', ['burst', 'aoeClear']],
          ['剑冢', '在一片区域插满巨剑，区域内敌人被剑林刺穿并减速', ['control', 'aoeClear']],
        ],
        ultimates: [
          ['神风剑雨', '授剑期间队友每次攻击都向目标落下一柄小飞剑，剑意剑气可以命中飞行怪', ['ranged', 'aoeClear']],
          ['天穹剑冢', '剑冢扩大成覆盖大片战场的剑林，插地飞剑持续更久，队友的剑气穿过剑林时会分裂', ['aoeClear', 'control']],
          ['天幕剑障', '授剑期间每名队友头顶展开一面飞剑剑幕，拦截所有来袭的投射物', ['mitigate', 'ranged']],
          ['流光剑冢', '剑冢里的剑会拦截飞经区域的投射物，并把它们反射回发射者', ['mitigate', 'control']],
          ['天雷巨剑', '授剑期间队友的放大武器每打三下就劈出一道直线剑气，贯穿一列敌人', ['pierce', 'burst']],
          ['灭日', '剑冢中央落下一柄巨剑，砸地后向四个方向裂出四道贯穿剑气', ['pierce', 'aoeClear']],
          ['永固剑壁', '授剑把一柄巨剑横在每名队友身前当盾挡下正面攻击，结束时巨剑向前冲出贯穿敌阵', ['mitigate', 'pierce']],
          ['剑圣领域', '剑冢变成以你为中心的领域，你每挥一剑，领域内所有插地剑同步斩向同一方向', ['pierce', 'control']],
        ],
        heroes: ['剑雨·凯恩|神风', '星落·泽恩|天穹', '剑幕·莉娅|天幕', '流光·塞恩|光年', '断天·雷克斯|天雷', '开岳·阿克|灭日', '镇岳·岩|永固', '剑心·布兰|剑圣'],
      },
    ],
    // ── 重剑士（锋·重）──
    [
      {
        name: '巨人', title: '巨人剑士', family: '变身', attr: { con: 6, agi: -6 }, note: '变身巨人，慢，但一下一片',
        skill: ['巨人化', '变身巨人数秒：体型、生命和击退大增，移速和攻速降低，免疫击退', ['control', 'mitigate']],
        variants: [
          { name: '撼地', title: '撼地巨人', attr: { str: 4, luk: -4 }, note: '每一步都在震地',
            skill: ['撼地', '巨人形态的每一步都震地，落锤掀起冲击波，把一圈敌人掀飞', ['control', 'aoeClear']] },
          { name: '擎天', title: '擎天巨人', weapons: ['thrown'], attr: { agi: 4, int: -4 }, note: '抓起敌人当炮弹',
            skill: ['擎天投掷', '巨人形态可以抓起敌人掷出，被掷的敌人变成炮弹，落地爆炸', ['explosive', 'control']] },
        ],
        t5: ['山崩巨人', '磐石巨人', '流星巨人', '城门巨人'],
        aura: [
          ['巨力', '光环内队友的攻击力和击退提高，普攻也能把小怪推开', ['control']],
          ['坚岩', '光环内队友不会被击退或打出硬直，护甲提高', ['mitigate']],
        ],
        order: [
          ['群巨号令', '全队一起巨人化数秒，效果减半', ['control', 'mitigate']],
          ['人肉炮弹', '抓起一名队友掷进敌群，队友落地放出冲击波，并短暂无敌', ['mobility', 'burst']],
        ],
        ultimates: [
          ['撼岳群步', '群巨号令期间全队步伐同步，每走几步一起震地，冲击波叠成一圈大地震', ['control', 'aoeClear']],
          ['开天一击', '人肉炮弹改成你自己跃起砸向敌群中心，落地掀飞大片敌人并留下减速裂地', ['control', 'burst']],
          ['群山列阵', '群巨号令期间巨人队友排成一线，全员免疫击退，站在线后的队友免疫投射物', ['mitigate', 'control']],
          ['镇狱巨像', '被人肉炮弹扔出的队友落地后变成小巨人数秒，站定不被击退并嘲讽周围敌人', ['taunt', 'mitigate']],
          ['碎空投', '群巨号令期间全队都能抓怪投掷，被投出的怪撞到的敌人也会被掀飞', ['explosive', 'control']],
          ['陷城连投', '人肉炮弹一次抛出全部近战队友，几个落点的冲击波连成一片', ['burst', 'aoeClear']],
          ['巨神门', '群巨号令时你变成更大的巨人立成一道城门，敌人只能从你两侧绕过', ['control', 'taunt']],
          ['天怒坠', '抓起一名精英掷上天空，数秒后它带着火球砸回敌群最密处', ['explosive', 'singleTarget']],
        ],
        heroes: ['崩山·铁牛|撼岳', '断岳·格雷|开天', '磐石·哥顿|山岳', '不动·托尔|镇狱', '流星·加隆|碎空', '投石·马格|陷城', '巨门·泰坦|巨神', '擎岳·伍尔夫|天怒'],
      },
      {
        name: '狂战', title: '狂战士', family: '狂暴', attr: { str: 6, tgh: -6 }, note: '血越少越强，打得越狠回得越多',
        skill: ['狂暴', '进入狂暴：生命越低攻击和攻速越高，造成的伤害按比例回血', ['burst', 'sustain']],
        variants: [
          { name: '血怒', title: '血怒狂战士', attr: { str: 4, con: -4 }, note: '拿血换范围',
            skill: ['血怒斩', '狂暴中消耗生命挥出巨斩，消耗越多范围越大', ['burst', 'aoeClear']] },
          { name: '不死', title: '不死狂战士', attr: { con: 4, int: -4 }, note: '狂暴期间不会倒',
            skill: ['不死狂怒', '狂暴期间生命不会降到 1 以下，结束时按造成的伤害回血', ['sustain', 'burst']] },
        ],
        t5: ['血宴狂战士', '血誓狂战士', '战神狂战士', '不灭狂战士'],
        aura: [
          ['血战', '光环内队友生命越低，伤害越高', ['burst']],
          ['嗜血', '光环内队友造成的伤害按比例回复生命', ['sustain']],
        ],
        order: [
          ['战嚎', '全队陷入狂热：攻速与移速提高并吸血，期间持续掉血', ['sustainedDps', 'sustain']],
          ['血祭', '献出自己大半生命，按比例治疗全队并清除负面状态', ['sustain']],
        ],
        ultimates: [
          ['血山崩', '战嚎期间全队掉的血都累积起来，号令结束时你挥出一记以累积量决定范围的血怒斩', ['burst', 'aoeClear']],
          ['屠神血刃', '血祭献出的生命凝成一柄血刃：接下来几次血怒斩不再耗血，范围翻倍', ['burst', 'aoeClear']],
          ['战神长嚎', '战嚎不再掉血，改为全队每次击杀都延长狂热时间', ['sustainedDps', 'sustain']],
          ['狼王血契', '血祭治疗量的一部分转为全队数秒内的吸血率提高', ['sustain']],
          ['血王不朽', '战嚎期间全队生命不会降到 1 以下，结束时按造成的伤害回血；每局一次', ['sustain', 'burst']],
          ['永誓', '血祭不再立即扣血：你先进入不死狂怒，结束时才付出献祭的生命', ['sustain', 'burst']],
          ['铁魂战嚎', '战嚎期间吸血溢出的部分转为护盾', ['sustain', 'mitigate']],
          ['狂神降世', '血祭后你进入无上限狂暴：你的生命每低一成，全队攻速再提高一档', ['burst', 'sustainedDps']],
        ],
        heroes: ['血岩·巴洛|血山', '屠夫·戈尔|屠神', '狂宴·贝奥|战神', '怒潮·芬里|狼王', '血誓·罗兰|血王', '不屈·哈根|永誓', '钢脊·伊万|铁魂', '战狼·维京|狂神'],
      },
    ],
    // ── 游盾卫（盾·轻）──
    [
      {
        name: '幻影', title: '幻影卫', family: '虚化', attr: { agi: 6, tgh: -6 }, note: '放弃实体，换伤害和穿行',
        skill: ['虚化', '化为灵体数秒：免疫伤害、可以穿过敌人、伤害提高，但无法格挡和嘲讽', ['mitigate', 'burst']],
        variants: [
          { name: '虚空', title: '虚空行者', attr: { luk: 4, con: -4 }, note: '穿过去就是一刀',
            skill: ['虚空步', '灵体状态下穿过敌人会留下斩痕，虚化结束时所有斩痕一起爆开', ['burst', 'aoeClear']] },
          { name: '替身', title: '替身守卫', attr: { con: 4, agi: -4 }, note: '把虚化让给队友',
            skill: ['灵魂替身', '与一名队友换位并让他化为灵体，你的空盾壳留在原地吸引敌人', ['mitigate', 'taunt']] },
        ],
        t5: ['虚刃行者', '虚隐行者', '灵契守卫', '灵护守卫'],
        aura: [
          ['影蚀', '光环内的敌人被侵蚀，受到全队的伤害提高', ['debuff']],
          ['虚身', '光环内队友有几率让攻击直接穿体而过', ['mitigate']],
        ],
        order: [
          ['全员虚化', '全队化为灵体数秒：免疫伤害、穿过敌人、伤害提高', ['mitigate', 'burst']],
          ['幻境', '在战场放出整支小队的幻象，敌人会追着幻象打', ['taunt', 'control']],
        ],
        ultimates: [
          ['斩痕虚界', '全员虚化期间队友穿过敌人也会留下斩痕，结束时全队的斩痕一起爆开', ['burst', 'aoeClear']],
          ['虚神幻境', '幻境里的幻象小队也会虚空步穿行，留下的斩痕在幻象消失时爆开', ['burst', 'taunt']],
          ['星轮', '全员虚化结束后队友保留虚身数秒，期间受到的攻击必定穿体', ['mitigate', 'mobility']],
          ['晓锋', '幻境中敌人每攻击一次幻象，你就瞬移到它身后补一刀', ['burst', 'singleTarget']],
          ['圣心盾像', '全员虚化时你留下的空盾壳化为巨大盾像，嘲讽全场，攻击它的敌人受到的伤害提高', ['taunt', 'debuff']],
          ['换魂幻阵', '幻境中你可以与任一幻象换位，被换掉的幻象爆开，周围敌人易伤', ['mobility', 'debuff']],
          ['永守灵契', '全员虚化期间受到致命伤的队友不会倒下，结束后带着少量生命复原；每人每局一次', ['sustain', 'mitigate']],
          ['圣镜', '幻境的幻象替队友承受攻击：敌人打幻象时，对应的真身回血', ['sustain', 'taunt']],
        ],
        heroes: ['残影·诺娃|无影', '虚刃·席恩|虚神', '幽步·米拉|星轮', '雾隐·薇薇|晓锋', '灵契·艾丽|圣心', '换魂·卢克|天盾', '守魂·贝拉|永守', '镜心·格温|圣镜'],
      },
      {
        name: '附魔', title: '附魔盾卫', family: '元素', weapons: ['magic'], attr: { int: 6, con: -6 }, note: '剑与盾燃起火焰或缠上雷电',
        skill: ['附火', '剑与盾附上火焰数秒，命中的敌人被点燃', ['explosive']],
        variants: [
          { name: '烈焰', title: '烈焰盾卫', attr: { int: 4, agi: -4 }, note: '点燃整群',
            skill: ['焚原', '附火期间每次盾击都在地上留下一片火海，点燃整群敌人', ['explosive', 'aoeClear']] },
          { name: '雷霆', title: '雷霆盾卫', attr: { agi: 4, int: -4 }, note: '火换成雷，麻痹整群',
            skill: ['雷殛', '附魔改为雷电，命中后在敌人之间连锁跳跃并麻痹它们', ['control', 'aoeClear']] },
        ],
        t5: ['焚天盾卫', '炎甲盾卫', '雷鸣盾卫', '雷甲盾卫'],
        aura: [
          ['元素共鸣', '光环内队友的攻击也带上你的元素（点燃 / 麻痹），效果较弱', ['explosive']],
          ['元素护甲', '光环内队友身上覆盖元素护甲，近身打他们的敌人被灼烧或麻痹', ['mitigate', 'control']],
        ],
        order: [
          ['元素灌注', '全队武器灌注你的元素数秒，伤害提高，命中必定点燃或麻痹', ['burst']],
          ['元素风暴', '召来覆盖大片区域的风暴：火雨点燃或雷暴麻痹范围内所有敌人', ['aoeClear', 'control']],
        ],
        ultimates: [
          ['炎皇灌注', '元素灌注期间队友每点燃一个敌人，就在它脚下留下一小片火海', ['explosive', 'aoeClear']],
          ['日冕', '火雨的落点汇聚成一轮烈日，风暴结束时烈日爆炸，点燃大片区域', ['explosive', 'burst']],
          ['血蔷薇', '元素灌注期间队友的元素护甲燃起火焰荆棘，近身敌人被持续点燃并击退', ['explosive', 'mitigate']],
          ['火神之环', '火雨改为绕着队伍落成一圈火墙，穿过火墙的敌人都被点燃', ['explosive', 'control']],
          ['英灵雷枪', '元素灌注期间队友的麻痹命中会在敌人之间连锁跳跃', ['control', 'aoeClear']],
          ['雷神降临', '雷暴中心降下雷神，每秒向场上最强的敌人劈一道落雷', ['singleTarget', 'control']],
          ['雷盾', '元素灌注时同时给全队套上雷甲，近身攻击队友的敌人被放电麻痹', ['control', 'mitigate']],
          ['破晓雷罚', '雷暴期间任何攻击队友的敌人都会被雷击并短暂麻痹', ['control', 'mitigate']],
        ],
        heroes: ['焚天·莉娜|炎皇', '烈阳·奥拉|日冕', '炎心·罗莎|血蔷薇', '火誓·托比|火神', '雷鸣·希尔达|英灵', '惊雷·阿尔|雷神', '雷甲·萨姆|雷盾', '电光·马克|破晓'],
      },
    ],
    // ── 塔盾兵（盾·重）──
    [
      {
        name: '盾阵', title: '盾阵兵', family: '阵列分身', attr: { con: 6, agi: -6 }, note: '召出盾兵幻影列阵',
        skill: ['盾阵', '召出一排盾兵幻影立在身前，挡住来路并嘲讽撞上来的敌人', ['summon', 'taunt']],
        variants: [
          { name: '龟甲', title: '龟甲阵卫', attr: { tgh: 4, str: -4 }, note: '围成圈护住队友',
            skill: ['龟甲阵', '盾兵围成一圈，圈内队友不受投射物伤害', ['summon', 'mitigate']] },
          { name: '枪林', title: '枪林阵卫', weapons: ['polearm'], attr: { str: 4, int: -4 }, note: '盾墙变枪阵',
            skill: ['枪林阵', '盾兵手持长枪，盾墙变成枪阵，向前一列持续刺穿', ['summon', 'pierce']] },
        ],
        t5: ['玄武阵卫', '铁桶阵卫', '拒马阵卫', '长戟阵卫'],
        aura: [
          ['军阵', '光环内队友攻速提高；挨着盾兵站的队友伤害也提高', ['sustainedDps']],
          ['坚守', '光环内队友受到的伤害降低', ['mitigate']],
        ],
        order: [
          ['万盾结界', '盾兵围住整支小队形成环阵，敌人进不来，持续数秒', ['mitigate', 'taunt']],
          ['冲阵', '全部盾兵列成横阵向前推进，推开并践踏一路敌人', ['control', 'aoeClear']],
        ],
        ultimates: [
          ['不落军阵', '万盾结界内队友攻速提高，且可以隔着盾兵射击', ['sustainedDps', 'mitigate']],
          ['玄武推进', '冲阵改为龟甲阵整体向前推进，阵内队友不受投射物伤害', ['mitigate', 'control']],
          ['长城', '万盾结界持续时间翻倍，盾兵被打碎后在原地留下一段矮墙', ['mitigate', 'control']],
          ['圣护卫队', '冲阵结束后盾兵原地转身，各自护住一名队友直到被击碎', ['mitigate', 'summon']],
          ['天枪结界', '万盾结界的盾兵持枪向外刺，进入范围的敌人被持续刺穿', ['pierce', 'mitigate']],
          ['神铁拒马', '冲阵结束后盾兵原地变成拒马，冲向拒马的敌人被刺穿并停下', ['pierce', 'control']],
          ['破军枪列', '万盾结界向前破开一面，所有盾兵从缺口列成一排枪阵刺出', ['pierce', 'burst']],
          ['王卫冲锋', '你站在冲阵的阵首，阵型推过的区域内队友减伤', ['control', 'mitigate']],
        ],
        heroes: ['铁壁·罗恩|不落', '龟甲·汉斯|玄武', '城墙·奥斯|长城', '守护·马丁|圣护', '枪城·索恩|天枪', '拒马·洛克|神铁', '冲阵·兰斯|破军', '铁卫·亚瑟|王卫'],
      },
      {
        name: '堡垒', title: '堡垒兵', family: '要塞化', attr: { tgh: 6, agi: -6 }, note: '原地扎根，自己变成工事',
        skill: ['扎根', '原地扎根成为堡垒数秒：不能移动，护甲大增，嘲讽周围敌人', ['taunt', 'mitigate']],
        variants: [
          { name: '荆棘', title: '荆棘卫', attr: { con: 4, luk: -4 }, note: '打它就是打自己',
            skill: ['荆棘堡垒', '堡垒长满尖刺，攻击你的敌人受到反伤', ['taunt', 'aoeClear']] },
          { name: '城塞', title: '城塞卫', attr: { int: 4, str: -4 }, note: '升起石墙造窄口',
            skill: ['城塞', '扎根时向两侧升起石墙，把敌人挤进一个窄口', ['taunt', 'control']] },
        ],
        t5: ['钢刺堡垒', '荆冠堡垒', '雄关堡垒', '长垣堡垒'],
        aura: [
          ['荆棘', '光环内队友挨打时把一部分伤害反弹给攻击者', ['aoeClear']],
          ['迟滞', '光环内的敌人移动与攻击变慢', ['control']],
        ],
        order: [
          ['不落城', '全队原地扎根数秒：不能移动，受到的伤害大幅降低并反弹', ['mitigate']],
          ['筑城', '在指定位置升起一圈城墙，围出只有一个入口的阵地', ['taunt', 'control']],
        ],
        ultimates: [
          ['永恒荆城', '不落城期间全队反弹的伤害汇集到你身上，结束时一次性向四周爆发', ['burst', 'aoeClear']],
          ['碾世刺城', '筑城的城墙长满尖刺，敌人攻城时受到反伤，城墙被打得越狠，反伤越重', ['aoeClear', 'taunt']],
          ['金刚不坏', '不落城期间靠近的敌人被减速，越靠近越慢，直至停下', ['control', 'mitigate']],
          ['破城倾墙', '筑城结束时城墙向外倒塌，压伤并击退墙外的敌人', ['control', 'burst']],
          ['霸王关', '不落城时你两侧升起石墙，全队成为窄口后的守军，射程提高', ['ranged', 'control']],
          ['天垣推进', '筑城的城墙会随你缓慢向前推进，把敌人一路挤压', ['control', 'mitigate']],
          ['钢神行城', '不落城期间你可以移动，全队的扎根点跟着你一起平移', ['mobility', 'mitigate']],
          ['天崩城头', '筑城时队友可以站上城头，射程与伤害提高', ['ranged', 'mitigate']],
        ],
        heroes: ['荆冠·布洛克|永恒', '钢刺·戈德|碾世', '磐垒·杜克|金刚', '不倒·巴克|破城', '雄关·凯撒|霸王', '长垣·泰隆|天垣', '筑城·莱恩|钢神', '铁关·犀|天崩'],
      },
    ],
  ],
};

// ponytail: 其余四棵树等剑士样板格式确认后再铺（P2 第二步）
export const CLASS_TREES: Partial<Record<TreeId, ClassTree>> = { swordsman: SWORDSMAN };

// ─────────────────────────────────────────────
// 生成
// ─────────────────────────────────────────────

export interface ClassDef {
  /** `${key}` / `${key}-0110` / 五星 `${key}-010101+` */
  id: string;
  tree: TreeId;
  /** 0 = 基础，1–6 = 第几转，7 = 五星 */
  tier: number;
  path: number[];
  name: string;
  /** 解锁军衔（C7-17：军衔到了就解锁这一层） */
  rank: number;
  weaponClasses: WeaponClass[];
  primary: Primary;
  growth: number;
  /** 已开的槽：等级（1 / 2）、技能 key（P4 技能表按 key 落数值）、名字、行为、标签 */
  slots: { slot: SlotId; level: number; skill: string; name: string; text: string; tags: AnswerTag[] }[];
  tags: AnswerTag[];
}

/** path 前缀所在的特色职业分线（第 3 转之后才有） */
export const archetypeOf = (t: ClassTree, path: number[]): Archetype => t.styles[path[0] * 2 + path[1]][path[2]];

/** 第 k 转（0 起）面对的那条轴——第 3、4 转随前面的选择而变。 */
export function axisAt(t: ClassTree, path: number[], k: number): Axis {
  switch (k) {
    case 0: case 1: return t.axes[k];
    case 2: return { name: '特色职业分线', sides: t.styles[path[0] * 2 + path[1]] };
    case 3: { const a = archetypeOf(t, path); return { name: a.name + '·职业流派', sides: a.variants }; }
    default: return t.axes[k - 2];
  }
}

export function className(t: ClassTree, path: number[], ultimate = false): string {
  if (path.length >= 3) {
    const a = archetypeOf(t, path);
    const [, , , a4, a5, a6] = path;
    if (path.length === 3) return a.title;
    if (path.length === 4) return a.variants[a4].title;
    if (path.length === 5) return a.t5[a4 * 2 + a5];
    const [hero, ult] = a.heroes[a4 * 4 + a5 * 2 + a6].split('|');
    return ultimate ? `${ult}·${hero.split('·')[1]}` : hero;
  }
  return path.length === 0 ? t.name : path.length === 1 ? t.names.t1[path[0]] : t.names.core[path[0] * 2 + path[1]];
}

function slotSkill(t: ClassTree, path: number[], slot: SlotId, level: number): SkillDef {
  if (slot === 'A') return t.skillA[path.slice(0, level).join('')];
  const a = archetypeOf(t, path);
  if (slot === 'B') return level === 1 ? a.skill : a.variants[path[3]].skill;
  if (slot === 'C') return a.aura[path[4]];
  const o = a.order[path[5]];
  if (level === 1) return o;
  const [un, ut, ug] = a.ultimates[path[3] * 4 + path[4] * 2 + path[5]];
  return [un, ut, [...new Set([...o[2], ...ug])]];
}

function makeClass(t: ClassTree, path: number[], ultimate: boolean): ClassDef {
  const tier = ultimate ? 7 : path.length;
  const sides = path.map((b, k) => axisAt(t, path, k).sides[b]);
  const primary = { ...t.primary };
  for (const s of sides) for (const [k, v] of Object.entries(s.attr)) primary[k as keyof Primary] += v;
  const weaponClasses = [...new Set([...t.weapons, ...sides.flatMap((s) => s.weapons ?? [])])];
  const slots = SKILL_SLOTS.filter((s) => s.opens <= tier).map((s) => {
    const level = 1 + s.upgrades.filter((u) => u <= tier).length;
    const [name, text, tags] = slotSkill(t, path, s.id, level);
    // 五星 D 槽每位英雄单独设计，key 用完整路径
    const ult = level === 2 && s.id === 'D';
    const key = ult ? path.join('') : s.axes.filter((a) => a < path.length).map((a) => path[a]).join('');
    return { slot: s.id, level, skill: `${t.key}.${s.id}.${key}${ult ? '+' : ''}`, name, text, tags };
  });
  return {
    id: t.key + (path.length ? '-' + path.join('') : '') + (ultimate ? '+' : ''),
    tree: t.id, tier, path, name: className(t, path, ultimate),
    rank: tier === 0 ? 1 : ADVANCE_RANKS[tier - 1],
    weaponClasses, primary, growth: t.growth[path[0] ?? 0],
    slots, tags: [...new Set(slots.flatMap((s) => s.tags))],
  };
}

/** 一棵树的全部 191 个职业，按层排序。 */
export function expandTree(t: ClassTree): ClassDef[] {
  const out: ClassDef[] = [];
  for (let depth = 0; depth <= 6; depth++) {
    for (let i = 0; i < 2 ** depth; i++) {
      const path = [...Array(depth)].map((_, k) => (i >> (depth - 1 - k)) & 1);
      out.push(makeClass(t, path, false));
    }
  }
  for (let i = 0; i < 64; i++) out.push(makeClass(t, [...Array(6)].map((_, k) => (i >> (5 - k)) & 1), true));
  return out;
}

export const CLASSES: ClassDef[] = Object.values(CLASS_TREES).flatMap((t) => expandTree(t!));
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
