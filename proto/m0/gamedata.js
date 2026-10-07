// 试玩期的单一数据源：battle.html / tuning.html / editor.html 共用。默认值摘自 src/data/*.ts，距离与速度单位是「格」（×G.cell 换成米）。
// 调参页只把「改过的路径 → 值」存进 localStorage['gs.tuning']；各页面加载时、以及另一个窗口保存时（storage 事件）原地覆盖，
// 所以开着战斗页去调参页改数，战斗里立刻生效（已经在场上的单位按新表结算，只有生命上限要等下一只）。
//
// C7-24：数值不再手抄，直接 import src/data/*.ts（经 Vite；用 python -m http.server 起不来）。
// 这份文件现在只剩两类东西——
//   ① 映射：src 的字段名 → 原型在用的短名
//   ② 原型独有：src 里没有对应物的表现层与手感层（kind/grip/cleave/pass、ZB、burst、OB、PROPS、TILES、SCENES、G 的大部）
// src 多出来、原型暂时用不上的字段（armorType/regen/points/money/behavior/special/tag、武器的 magazine/reload/critBonus 等）没有映射过来，
// 第二步要用时在下面的映射表里补一行即可。
// 流场、地形掩码、关卡生成仍然住在这里，它们与数据源无关。
import { ZOMBIES as SRC_Z } from '../../src/data/zombies.ts';
import { WEAPONS as SRC_W } from '../../src/data/weapons.ts';
import { STAGES as SRC_STAGES } from '../../src/data/run.ts';
import { HEROES_BY_ID, SQUAD_COMMANDS } from '../../src/data/characters.ts';

// 下标即身份：ZIDS[i] 对应 assets/vox_z_*.glb 载入顺序、battle.html 的 ZGV[i]。
// src 的 key 顺序与原型不同，也随时可能被重排，所以顺序只由这里这两行说了算。第二步补新僵尸／武器时改这里。
export const ORDER_Z = ['normal', 'runner', 'brute', 'toxic', 'bomber', 'splitter', 'leaper', 'ward', 'spitter', 'spawnling'];
export const ORDER_W = ['greatsword', 'sword', 'spear', 'pistol', 'smg', 'sniper', 'grenade', 'flamer', 'freezer', 'boomerang', 'laser'];

const pick = (o, m) => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, typeof s === 'function' ? s(o) : o[s]]));

// 名号一律用原型自己的叫法：src 的僵尸名是正式全称（普通僵尸/铁甲僵尸/毒液僵尸…）、武器名也不同字
// （巨剑/大刀、长剑/剑、冰冻枪/冷冻器、激光/激光枪）。名号出现在出怪面板、调参台、HUD 上，换名是可见的
// UI 变化。等单独一步再统一，那时改这两张表即可。
const Z_NAME = { normal: '普通', runner: '奔跑', brute: '高防胖', toxic: '毒液', bomber: '自爆', splitter: '分裂', leaper: '跳跃', ward: '护盾', spitter: '喷吐', spawnling: '小分裂' };
const W_NAME = { greatsword: '巨剑', sword: '长剑', spear: '长枪', pistol: '手枪', smg: '冲锋枪', sniper: '狙击枪', grenade: '手雷', flamer: '喷火器', freezer: '冰冻枪', boomerang: '回旋镖', laser: '激光' };

// src 僵尸字段 → 原型短名。src 加了字段而这里没补，新字段就到不了原型。
const ZT = Object.fromEntries(ORDER_Z.map((id) => [id, { name: Z_NAME[id], ...pick(SRC_Z[id], {
  hp: 'hp', spd: 'speed', armor: 'armor', atk: 'atk', ai: 'atkInterval', r: 'radius', stab: 'stab',
  fr: 'freezeRes', cun: 'cunning', kn: 'knock', th: 'threat',
  sa: (z) => (z.superArmor ? 1 : 0),   // src 是布尔，原型与调参页按 0/1 用
  dr: (z) => z.resist.physRes,         // 原型只有一个减伤值，取物理那一系
}) }]));

// src 武器字段 → 原型短名
const pickW = (w) => { const r = {}; for (const [k, s] of Object.entries({ dmg: 'base', rate: 'rate', range: 'range', knock: 'knockback', aoe: 'aoe' })) if (w[s]) r[k] = w[s]; return r; };
// 表现参数：原型独有。kind 决定怎么开火、grip 决定握持动画、cleave 是近战横扫目标数、pass 是子弹可穿透几个敌人
// （src 的 `pierce` 是【削弱目标护甲】0-100，与穿透计数同名不同义，第二步接破甲时才用得上）
const W_SHOW = {
  greatsword: { kind: 'melee', grip: 'heavy', cleave: 3 },
  sword:      { kind: 'melee', grip: 'melee', cleave: 2 },
  spear:      { kind: 'melee', grip: 'thrust', cleave: 2 },
  pistol:     { kind: 'bullet', grip: 'onehand' },
  smg:        { kind: 'bullet', grip: 'onehand' },
  sniper:     { kind: 'bullet', grip: 'rifle', pass: 1 },
  grenade:    { kind: 'grenade', grip: 'throw' },
  flamer:     { kind: 'flame', grip: 'rifle' },
  freezer:    { kind: 'freeze', grip: 'rifle' },
  boomerang:  { kind: 'boomerang', grip: 'throw' },
  laser:      { kind: 'laser', grip: 'rifle', chain: 2 },
};
const W = Object.fromEntries(ORDER_W.map((id) => [id, { name: W_NAME[id], ...pickW(SRC_W[id]), ...W_SHOW[id] }]));

// 阶段：名号、威胁速率、出怪构成全取自 src（src 的 spawnTable 与原型 mix 是同一份东西，只是写法不同）。
// burst = 进阶段瞬间额外补一批怪，src 的 Stage 里没有这个字段，是原型独有的节奏手段。
const BURST = [null, { bomber: 3, splitter: 3 }, { brute: 3 }];
export const STAGES = SRC_STAGES.map((s, i) => ({
  name: s.name, r0: s.threatRateStart, r1: s.threatRateEnd,
  mix: Object.fromEntries(s.spawnTable.map((g) => [g.zombie, g.weight])),
  burst: BURST[i] ?? null,
}));

export const T = {
  // 全局规则
  G: {
    heroSpd: 2.8,    // 队员移速 m/s
    heroStab: 40,    // 队员稳固
    respawn: 6,      // 队员阵亡后复活秒数（0 = 不复活）
    armorK: 200,     // 护甲减伤：伤害 × K / (K + 护甲)
    knockK: 1.4,     // 击退命中率 = min(上限, k × 击退力 / (击退力 + 稳固))
    knockCap: .9,
    kb: 2,           // 击退强度：只放大队员打僵尸
    zspd: .6,        // 僵尸移速倍率（蹒跚节奏）
    meleeMul: .25,   // 僵尸普攻伤害 = 攻击 × 该倍率
    markBonus: .35,  // 被标记增伤
    vulnBonus: .5,   // 易伤增伤
    burnDps: 40,     // 灼烧每秒
    poolDps: 30,     // 毒池地块每秒（对队员）
    mudMul: .6,      // 泥地移速倍率（敌我都吃）
  },
  // 僵尸（生命/移速/护甲/攻击/攻击间隔/半径/稳固/抗冻/狡诈/击退力/霸体/减伤/威胁值）与武器、阶段见文件顶部，全部映自 src/data
  ZT,
  // 僵尸特殊行为参数（距离 m）——表现层，src 无对应物
  ZB: {
    bomber:   { desc: '贴近 0.6 m 开始膨胀，动画放完自爆；半径内队员按距离衰减吃攻击力伤害并必定被推开，顺带炸伤身边僵尸', r: 2.2, knock: 140, splash: 150, splashR: 1.6 },
    leaper:   { desc: '距离 2–6 m 时扑向目标，落地范围伤害 = 攻击 × 倍率', cd: 5, min: 2, max: 6, mul: .4, r: 1.3, knock: 60 },
    spitter:  { desc: '站在射程外吐酸液弹，落点 1 m 内伤害 = 攻击 × 倍率', range: 6, mul: .3 },
    splitter: { desc: '死亡时裂成 n 只小分裂', n: 3 },
    toxic:    { desc: '死亡留下毒池，队员站在里面每秒掉血', r: 1.25, dps: 30, dur: 8 },
    ward:     { desc: '正面 ±60° 伤害先扣护盾；盾破后易伤若干秒', shield: 500, vuln: 3 },
  },
  // 武器（伤害/攻速/射程/击退/表现类型/横扫数/穿透/爆炸半径/链跳）见文件顶部，数值映自 src/data
  W,
  // 队员：名 / 武器 / 生命 / [低级, 高级] 技能。技能里除 name / cd / desc 外都是该技能函数读的参数（距离 m、时长 s）
  // stand: 1 = 站定类技能，AI 何时放由 AIProfile.holdPolicy 决定
  HERO: {
    // ── 测试职业（V2 走廊）：ron / ironbull / vera / lian / shaman 复用模型，技能换成职业树 L4 样板，验证朝向 / 范围 / 站定 ──
    ron: { name: '巨剑御者', weapon: 'greatsword', hp: 1800, sk: [
      { name: '巨剑化', cd: 14, desc: '飞剑合成一把巨剑，沿敌阵最密的方向直线贯穿（densestSpot 定方向）', dmg: 420, knock: 140, range: 14, w: 1.6 },
      { name: '剑城', cd: 24, desc: '朝敌人来袭的主方向（threatBearing）插下一排巨剑高墙，只留正面开口：墙挡路，敌人只能挤开口', dur: 10, n: 6, gap: 1.2, dist: 3.5, hole: 2 }] },
    gwen: { name: '格温', weapon: 'spear', hp: 1300, sk: [
      { name: '穿刺阵列', cd: 16, desc: '前方一排地刺依次刺出', dmg: 180, knock: 60, n: 8, gap: .8 },
      { name: '万枪归一', cd: 20, desc: '掷出一杆贯穿全线的长枪', dmg: 600, knock: 90, range: 20 }] },
    kai: { name: '凯', weapon: 'sword', hp: 1200, sk: [
      { name: '疾风连斩', cd: 12, desc: '自身攻速与移速提升', rate: 1, move: .4, dur: 3 },
      { name: '残影斩', cd: 15, desc: '闪到目标身后连斩 n 次', dmg: 160, knock: 30, hits: 3, r: 1.8 }] },
    ironbull: { name: '堡垒兵', weapon: 'greatsword', hp: 1800, sk: [
      { name: '裂地斩', cd: 14, desc: '原地重砸，范围伤害并易伤', dmg: 350, knock: 160, r: 2.5, vuln: 2 },
      { name: '扎根', cd: 20, desc: '原地扎根成为堡垒：不能移动、减伤、嘲讽周围敌人（engaged：贴脸也不断）', dur: 6, dr: .6, tauntR: 6, stand: 1 }] },
    vera: { name: '守望射手', weapon: 'sniper', hp: 1000, sk: [
      { name: '据守', cd: 16, desc: '原地站定：射程提高、受到的伤害降低；一移动或被贴脸就解除（safe）', dur: 8, rangeMul: .5, dr: .3, stand: 1 },
      { name: '穿甲狙击', cd: 20, desc: '先亮一条直线预警，蓄力后一发无视护甲、穿透全线（朝敌最密的直线）', dmg: 2000, knock: 80, range: 40, aim: .8 }] },
    jet: { name: '杰特', weapon: 'smg', hp: 1000, sk: [
      { name: '弹幕压制', cd: 15, desc: '自身攻速提升，子弹附带减速', rate: .4, slow: .3, dur: 5 },
      { name: '弹雨覆盖', cd: 20, desc: '在怪最密处落下持续弹雨', dps: 160, r: 2.5, dur: 6, slow: .3 }] },
    ella: { name: '艾拉', weapon: 'freezer', hp: 1000, sk: [
      { name: '绝对零度', cd: 22, desc: '冻结身边所有僵尸', dmg: 80, frz: 3, r: 7 },
      { name: '寒霜新星', cd: 26, desc: '扩散冰环，伤害、冻结并推开', dmg: 200, frz: 4, r: 8, knock: 30 }] },
    bom: { name: '博姆', weapon: 'grenade', hp: 1000, sk: [
      { name: '连环爆破', cd: 18, desc: '向怪群连扔 n 颗重雷', dmg: 400, knock: 110, r: 2, n: 3, slow: .4 },
      { name: '定点轰炸', cd: 24, desc: '指定区域落下 n 发炮弹', dmg: 450, knock: 120, n: 10, r: 3, blast: 1.6 }] },
    lian: { name: '军医', weapon: 'pistol', hp: 1100, sk: [
      { name: '战地急救', cd: 12, desc: '冲到最需要帮助的队友身边（neediestAlly：倒地 > 缺血比例 > 被围）打一针：回血并套盾，倒地的直接扶起', heal: .45, shield: 300, dashSpd: 14, range: 16 },
      { name: '圣愈领域', cd: 28, desc: '队伍脚下展开治疗领域，并减伤', hps: 80, r: 3.5, dur: 8, dr: .3 }] },
    shaman: { name: '星象家', weapon: 'flamer', hp: 1100, sk: [
      { name: '星图', cd: 18, desc: '朝敌人来袭的主方向（threatBearing）横跨来路落下一排星，连成星座线；敌人越线时整条线亮起、伤害并减速；站在星点上的队友回血', n: 5, gap: 1.6, dist: 5, dur: 12, dmg: 160, slow: .4, hps: 40 },
      { name: '熔岩图腾', cd: 26, desc: '在怪最密处造熔岩，持续灼烧减速', dps: 180, r: 2.5, dur: 10, slow: .3 }] },
    nox: { name: '诺克斯', weapon: 'boomerang', hp: 1000, sk: [
      { name: '骸骨傀儡', cd: 26, desc: '召唤 n 只小傀儡替队伍挡怪', n: 2, hp: 1500, dmg: 90, life: 10, scale: .6 },
      { name: '骸骨巨像', cd: 30, desc: '召唤一只巨像', n: 1, hp: 5000, dmg: 260, life: 15, scale: 1.05 }] },
    sif: { name: '西芙', weapon: 'laser', hp: 1000, sk: [
      { name: '纳米蜂群', cd: 16, desc: '激光链跳数增加', chain: 5, dur: 6 },
      { name: '蜂群风暴', cd: 22, desc: '链跳数大增并加攻速', chain: 12, rate: .5, dur: 6 }] },
  },
};
export const CELL = .5;   // 1 格 = 0.5 m（src 全程按格算，没有这个常量，是原型的显示单位）
export const PICK0 = ['ron', 'vera', 'ella', 'bom', 'sif'];
// AIProfile 直接读 src/data/characters.ts（原型读 holdPolicy / engageDistanceMul / targetPriority /
// aggroRange / retreatHpPct，见 battle.html 的 AI 段）
export const AI = Object.fromEntries(Object.keys(T.HERO).map((id) => [id, HEROES_BY_ID[id].ai]));
// 职业定位与血量也从 src 读：role 决定站哪一层（= 该层的拴绳），maxHp 是 1 级派生血量（attributes.ts derive）。
// 血量与 prototype 自己的伤害刻度（19 血僵尸 / 短 TTK）不是一套，先不接，只把 role 接上。
export const ROLE = Object.fromEntries(Object.keys(T.HERO).map((id) => [id, HEROES_BY_ID[id].role]));
// 阵型参数的同源导出：ORDERS 的站位半径与拴绳就是 SQUAD_COMMANDS 的 rings，不允许原型自己写一份。
// 剑士/辅助/机械三棵树各取一名英雄的 ring 顺序（MELEE / BACK / CORE），戒指按树角色的职业层排。
export const RINGS = Object.fromEntries(SQUAD_COMMANDS.map((c) => [c.id, c.rings]));
export const TETHER = Object.fromEntries(SQUAD_COMMANDS.map((c) => [c.id, c.rings[0].tether]));
export const CMD_OVER = Object.fromEntries(SQUAD_COMMANDS.map((c) => [c.id, c.overrides]));
export const ZIDS = ORDER_Z, HIDS = Object.keys(T.HERO), WIDS = ORDER_W;
export const MIX0 = { normal: 50, runner: 20, brute: 5, toxic: 10, bomber: 10, splitter: 10, leaper: 10, ward: 5, spitter: 10, spawnling: 0 };

// ── 调参覆盖层 ──
const KEY = 'gs.tuning';
export const DEF = structuredClone(T);
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function set(o, p, v) { const ks = p.split('.'), last = ks.pop(); const t = ks.reduce((a, k) => a?.[k], o); if (t && last in t) t[last] = v; }
function restore(o, d) { for (const k in d) if (d[k] && typeof d[k] === 'object') restore(o[k], d[k]); else o[k] = d[k]; }
export const readOver = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export function writeOver(over) { try { localStorage.setItem(KEY, JSON.stringify(over)); } catch {} applyTuning(over); }
export function applyTuning(over = readOver()) { restore(T, DEF); for (const p in over) set(T, p, over[p]); return T; }
export const defOf = (p) => get(DEF, p);
applyTuning();
// 别的窗口（调参页）一保存，这边原地覆盖
if (typeof addEventListener === 'function') addEventListener('storage', (e) => e.key === KEY && applyTuning());

// ── 场景物件：名 / 碰撞宽 / 碰撞深（m，模型局部 x / z）/ 障碍类 ──
// 障碍类语义摘自 src/data/scenes.ts OBSTACLES：mv 挡人、shot 挡子弹、hp 耐久（0 = 不可破坏）
// ponytail: 耐久只做展示，原型里还不能打掉障碍；M2 core/terrain.ts 接上破坏
export const OB = {
  building: { name: '建筑', mv: 1, shot: 1, hp: 0, color: '#6d6a63' },
  woodwall: { name: '木墙', mv: 1, shot: 1, hp: 900, color: '#8a6a44' },
  cover:    { name: '矮掩体', mv: 1, shot: 0, hp: 320, color: '#8e8c6a' },
  wire:     { name: '铁丝网', mv: 1, shot: 0, hp: 180, color: '#9aa0a8' },
  barrel:   { name: '油桶', mv: 1, shot: 0, hp: 60, color: '#c0563a' },
  crate:    { name: '补给箱', mv: 1, shot: 0, hp: 120, color: '#b89a52' },
  tree:     { name: '树干', mv: 1, shot: 0, hp: 0, color: '#4f7a3c' },
  none:     { name: '装饰', mv: 0, shot: 0, hp: 0, color: '#5b7a50' },
};
export const PROPS = {
  ruin: ['残楼', 4.7, 5.4, 'building'], shop: ['临街铺面', 5, 3.6, 'building'], bunker: ['碉堡', 3.6, 2.4, 'building'], mesa: ['砂岩台地', 3.1, 2, 'building'],
  partition: ['走廊隔断', 4, .4, 'building'], woodwall: ['木墙', 2.4, .8, 'woodwall'],
  sandbag: ['沙袋墙', 3, .6, 'cover'], car: ['废弃轿车', 2.2, 4.4, 'cover'], fence: ['铁栅栏', 3, .2, 'cover'], rubble: ['碎石堆', 1.4, 1.4, 'cover'],
  hay: ['草垛', 1.2, 1.2, 'cover'], rock_moss: ['苔石', 1.8, 1.2, 'cover'], rock_ice: ['冻岩', 1.3, 1.6, 'cover'], snowpile: ['雪堆', 1.6, 1.6, 'cover'],
  stump: ['空心树桩', 1.6, 1, 'cover'], cactus: ['柱仙人掌', .9, .3, 'cover'], cactus_ball: ['球仙人掌', .9, .6, 'cover'],
  wire: ['铁丝网', 3, .8, 'wire'], barrel: ['油桶', .6, .7, 'barrel'], crate: ['补给箱', .8, .86, 'crate'], ammo: ['弹药箱', 1.4, .76, 'crate'],
  tree: ['阔叶树', .6, .6, 'tree'], palm: ['棕榈', .5, .5, 'tree'], pine: ['雪松', .6, .6, 'tree'], deadtree: ['枯树', .6, .6, 'tree'],
  grass: ['草丛', .76, .66, 'none'],
};
// 地块：0 地面 / 1 道路 / 2 毒池（队员掉血）/ 3 泥地（敌我减速）
export const TILES = [['地面', null], ['道路', '#2c2e2e'], ['毒池', '#4f8a2a'], ['泥地', '#4a3a28']];

// ── 场景主题：地面色 + 生成器用的物件池（摘自 src/data/scenes.ts 的地形签名）──
export const SCENES = {
  city:     { name: '城市废墟', ground: '#3b3e3c', build: ['ruin', 'shop', 'partition'], cover: ['car', 'sandbag', 'fence', 'rubble'], deco: ['barrel', 'rubble', 'crate'] },
  jungle:   { name: '原始丛林', ground: '#2f4527', build: ['tree', 'palm', 'tree'], cover: ['hay', 'rock_moss', 'grass'], deco: ['grass', 'grass', 'crate'], pools: 3 },
  swamp:    { name: '沼泽疫地', ground: '#353d2f', build: ['deadtree', 'stump'], cover: ['rock_moss', 'stump'], deco: ['rock_moss', 'crate'], pools: 4, mud: 4 },
  desert:   { name: '荒漠废土', ground: '#8f7752', build: ['mesa'], cover: ['cactus', 'cactus_ball', 'hay'], deco: ['barrel', 'cactus_ball'] },
  snow:     { name: '雪原冻土', ground: '#a9b4ba', build: ['pine', 'rock_ice'], cover: ['snowpile', 'rock_ice'], deco: ['crate', 'snowpile'], mud: 2 },
  military: { name: '军事禁区', ground: '#4d5140', build: ['bunker', 'woodwall'], cover: ['sandbag', 'wire', 'sandbag'], deco: ['crate', 'ammo', 'barrel'] },
};

// ── 阶段出怪：见文件顶部 STAGES（威胁值/秒 从 r0 涨到 r1）──
// 加权平均威胁值：威胁速率 ÷ 它 = 每秒只数
export const avgThreat = (mix) => { let w = 0, t = 0; for (const k in mix) { w += mix[k]; t += mix[k] * (T.ZT[k]?.th ?? 1); } return w ? t / w : 1; };
// 字符串 ⇄ 构成表：'normal:75 runner:25'
export const mixStr = (m) => (m ? Object.entries(m).map(([k, v]) => `${k}:${v}`).join(' ') : '');
export const parseMix = (s) => { const m = {}; for (const p of String(s).split(/[\s,，]+/)) { const [k, v] = p.split(/[:：]/); if (k && T.ZT[k] && +v > 0) m[k] = +v; } return m; };

// ── 关卡存取：本地库 localStorage['gs.levels'] = { 名字: 关卡 } ──
const LKEY = 'gs.levels';
export const listLevels = () => { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { return {}; } };
export function saveLevel(lv) { const all = listLevels(); all[lv.name] = lv; localStorage.setItem(LKEY, JSON.stringify(all)); }
export function deleteLevel(name) { const all = listLevels(); delete all[name]; localStorage.setItem(LKEY, JSON.stringify(all)); }
// ?level=名字（本地库）或 ?levelUrl=路径（JSON 文件）
export async function levelFromURL(q = new URLSearchParams(location.search)) {
  if (q.get('level')) return listLevels()[q.get('level')] ?? null;
  if (q.get('levelUrl')) return (await fetch(q.get('levelUrl'))).json();
  return null;
}

// ── 地形网格：1 m 一格，(0,0) 在地图中心。mv 挡人 / shot 挡子弹；边界一圈算墙 ──
// 物件是旋转矩形（OBB），格心落进矩形（挡人的再外扩 pad）就算占用
export function propBoxes(level) {
  const out = [];
  for (const [id, x, z, ry = 0] of level.props) {
    const p = PROPS[id]; if (!p) continue; const ob = OB[p[3]];
    out.push({ id, x, z, ry, hw: p[1] / 2, hd: p[2] / 2, c: Math.cos(ry), s: Math.sin(ry), mv: ob.mv, shot: ob.shot, ob: p[3] });
  }
  return out;
}
// 点在盒子局部坐标里（模型局部 x = 宽、z = 深；three.js 绕 y 转 ry）
export const local = (b, x, z) => { const dx = x - b.x, dz = z - b.z; return [dx * b.c - dz * b.s, dx * b.s + dz * b.c]; };
export function buildMask(level, pad = .3) {
  const N = level.size, half = N / 2, mv = new Uint8Array(N * N), shot = new Uint8Array(N * N), boxes = propBoxes(level);
  for (const b of boxes) {
    if (!b.mv && !b.shot) continue;
    const R = Math.hypot(b.hw, b.hd) + 1, i0 = Math.max(0, Math.floor(b.x - R + half)), i1 = Math.min(N - 1, Math.floor(b.x + R + half));
    const j0 = Math.max(0, Math.floor(b.z - R + half)), j1 = Math.min(N - 1, Math.floor(b.z + R + half));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [lx, lz] = local(b, i - half + .5, j - half + .5), ax = Math.abs(lx), az = Math.abs(lz), hw = Math.max(b.hw, .51), hd = Math.max(b.hd, .51);   // 薄墙至少占一排格
      if (b.mv && ax < hw + pad && az < hd + pad) mv[j * N + i] = 1;
      if (b.shot && ax < hw && az < hd) shot[j * N + i] = 1;
    }
  }
  for (let k = 0; k < N; k++) mv[k] = mv[(N - 1) * N + k] = mv[k * N] = mv[k * N + N - 1] = 1;
  return { N, half, mv, shot, boxes };
}
export const cellOf = (m, x, z) => { const i = Math.floor(x + m.half), j = Math.floor(z + m.half); return i < 0 || j < 0 || i >= m.N || j >= m.N ? -1 : j * m.N + i; };
// 流场：从目标格 BFS 出步数距离；dir 指向 8 邻里距离最小的那格（不切墙角）。-1 = 到不了
export function flowField(m, targets, out) {
  const { N, mv } = m, dist = out?.dist ?? new Int32Array(N * N), q = out?.q ?? new Int32Array(N * N);
  dist.fill(-1); let h = 0, t = 0;
  for (const [x, z] of targets) { const c = cellOf(m, x, z); if (c >= 0 && dist[c] < 0) { dist[c] = 0; q[t++] = c; } }
  while (h < t) {
    const c = q[h++], i = c % N, d = dist[c] + 1;
    for (const n of [i > 0 ? c - 1 : -1, i < N - 1 ? c + 1 : -1, c - N, c + N]) if (n >= 0 && n < N * N && dist[n] < 0 && !mv[n]) { dist[n] = d; q[t++] = n; }
  }
  return { dist, q };
}
// 某个位置沿流场往下走的方向（单位向量）；null = 不在场内或到不了
export function flowDir(m, f, x, z) {
  const c = cellOf(m, x, z); if (c < 0) return null;
  const { N } = m, i = c % N, j = (c / N) | 0, D = f.dist, mv = m.mv;
  let best = D[c] < 0 ? 1e9 : D[c], bx = 0, bz = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
    const n = jj * N + ii; if (D[n] < 0) continue;
    if (di && dj && (mv[j * N + ii] || mv[jj * N + i])) continue;
    const v = D[n] + (di && dj ? .4 : 0); if (v < best) { best = v; bx = di; bz = dj; }
  }
  if (!bx && !bz) return null; const l = Math.hypot(bx, bz); return [bx / l, bz / l];
}

// 圆（半径 r）推出挡人的盒子：精确到 OBB，不吃 1 m 网格的锯齿。m.cb[格] = 可能碰到该格的盒子（首次调用时建）
export function pushOut(m, p, r) {
  const { N, half } = m;
  if (!m.cb) {
    m.cb = new Array(N * N).fill(null);
    for (const b of m.boxes) if (b.mv) {
      const R = Math.hypot(b.hw, b.hd) + 2, i0 = Math.max(0, Math.floor(b.x - R + half)), i1 = Math.min(N - 1, Math.floor(b.x + R + half));
      const j0 = Math.max(0, Math.floor(b.z - R + half)), j1 = Math.min(N - 1, Math.floor(b.z + R + half));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const [lx, lz] = local(b, i - half + .5, j - half + .5);
        if (Math.abs(lx) < b.hw + 1.4 && Math.abs(lz) < b.hd + 1.4) (m.cb[j * N + i] ??= []).push(b);
      }
    }
  }
  const lim = half - 1 - r; p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim, p.z));
  const list = m.cb[cellOf(m, p.x, p.z)]; if (!list) return false;
  let hit = false;
  for (const b of list) {
    let [lx, lz] = local(b, p.x, p.z);
    const cx = Math.max(-b.hw, Math.min(b.hw, lx)), cz = Math.max(-b.hd, Math.min(b.hd, lz)), dx = lx - cx, dz = lz - cz, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d > 1e-6) { lx = cx + dx / d * r; lz = cz + dz / d * r; }
    else if (b.hw - Math.abs(lx) < b.hd - Math.abs(lz)) lx = (Math.sign(lx) || 1) * (b.hw + r);   // 圆心在盒子里：从穿得浅的那边推出去
    else lz = (Math.sign(lz) || 1) * (b.hd + r);
    p.x = b.x + lx * b.c + lz * b.s; p.z = b.z - lx * b.s + lz * b.c; hit = true;
  }
  return hit;
}

// ── 刷怪流程：按时间取当前阶段、威胁速率 → 每秒只数 ──
export const flowLen = (lv) => lv.stages.reduce((s, st) => s + st.dur, 0);
export function stageAt(lv, t) {
  let t0 = 0;
  for (let i = 0; i < lv.stages.length; i++) { const st = lv.stages[i]; if (t < t0 + st.dur) return { i, st, k: (t - t0) / st.dur, t0 }; t0 += st.dur; }
  return null;
}
export const rateAt = (lv, t) => { const s = stageAt(lv, t); return s ? (s.st.r0 + (s.st.r1 - s.st.r0) * s.k) * (lv.threatMul ?? 1) / avgThreat(s.st.mix) : 0; };

// ── 关卡生成：场景主题 + 种子 → 关卡。保证每个刷怪点都能走到出生点（挡路的物件会被拆掉）──
export function rng(seed) { let s = (Math.abs(seed | 0) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
export const tileAt = (lv, m, x, z) => { const c = cellOf(m, x, z); return c < 0 || !lv.tiles ? 0 : lv.tiles.charCodeAt(c) - 48; };
export function generate({ scene = 'city', seed = 1, size = 64, density = 1, name = '', stageDur = 300 } = {}) {
  const R = rng(seed), S = SCENES[scene], N = size, half = N / 2, CLEAR = 6, RW = 2.5;   // 出生点留空半径 / 道路半宽
  const pick = (a) => a[(R() * a.length) | 0], tiles = new Uint8Array(N * N), props = [], placed = [];
  const roads = scene === 'city' || scene === 'military';
  const onRoad = (x, z, r = 0) => roads && (Math.abs(x) < RW + r || Math.abs(z) < RW + r);
  if (roads) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (onRoad(i - half + .5, j - half + .5)) tiles[j * N + i] = 1;
  const rad = (id) => Math.hypot(PROPS[id][1], PROPS[id][2]) / 2;
  function tryPlace(id, x, z, ry, { road = true, gap = .8 } = {}) {
    const r = rad(id);
    if (Math.abs(x) > half - 2 - r * .6 || Math.abs(z) > half - 2 - r * .6 || Math.hypot(x, z) < CLEAR + r * .6) return false;
    if (!road && onRoad(x, z, r * .7)) return false;
    for (const [px, pz, pr] of placed) if (Math.hypot(px - x, pz - z) < (r + pr) * .7 + gap) return false;
    props.push([id, +x.toFixed(2), +z.toFixed(2), +ry.toFixed(3)]); placed.push([x, z, r]); return true;
  }
  const quarter = () => ((R() * 4) | 0) * Math.PI / 2;
  // 1 大件：按 7 m 地块排，城市 / 军事对齐街道，自然场景随机朝向
  for (let x = -half + 5; x < half - 4; x += 7) for (let z = -half + 5; z < half - 4; z += 7)
    if (R() < .62 * density) tryPlace(pick(S.build), x + (R() - .5) * 3, z + (R() - .5) * 3, roads ? quarter() : R() * 6.283, { road: false });
  // 2 掩体：车可以停在路上；城市在路口外围加隔断造卡口，军事在出生点外围一圈沙袋 / 铁丝网
  const nCover = Math.round(N * N / 150 * density);
  for (let k = 0, t = 0; k < nCover && t < nCover * 20; t++) if (tryPlace(pick(S.cover), (R() - .5) * (N - 6), (R() - .5) * (N - 6), R() * 6.283, { gap: .4 })) k++;
  if (scene === 'city') for (const a of [0, 1, 2, 3]) { const d = 10 + R() * 6, rot = a * Math.PI / 2, s = R() < .5 ? 1 : -1;
    tryPlace('partition', Math.sin(rot) * d + Math.cos(rot) * s * (RW + 2.2), Math.cos(rot) * d - Math.sin(rot) * s * (RW + 2.2), rot + Math.PI / 2, { gap: 0 }); }
  if (scene === 'military') for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4 + .3, d = 9; tryPlace(a % 2 ? 'wire' : 'sandbag', Math.cos(ang) * d, Math.sin(ang) * d, -ang + Math.PI / 2, { gap: .2 }); }
  const nDeco = Math.round(N * N / 400 * density);
  for (let k = 0, t = 0; k < nDeco && t < nDeco * 20; t++) if (tryPlace(pick(S.deco), (R() - .5) * (N - 6), (R() - .5) * (N - 6), R() * 6.283, { gap: .3 })) k++;
  // 3 毒池 / 泥地：圆斑
  for (const [n, v] of [[S.pools ?? 0, 2], [S.mud ?? 0, 3]]) for (let k = 0, t = 0; k < n && t < 50; t++) {
    const cx = (R() - .5) * (N - 12), cz = (R() - .5) * (N - 12), r = 2 + R() * 2.5; if (Math.hypot(cx, cz) < CLEAR + r) continue; k++;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (Math.hypot(i - half + .5 - cx, j - half + .5 - cz) < r * (.8 + .2 * Math.sin(i * 1.3 + j))) tiles[j * N + i] = v;
  }
  // 4 刷怪点：有路 = 四个路口尽头；否则四边轮流随机 5 个
  const E = half - 3, spawns = roads ? [[0, -E], [E, 0], [0, E], [-E, 0]].map(([x, z]) => ({ x, z, r: 2 }))
    : Array.from({ length: 5 }, (_, k) => { const t = +((R() - .5) * (N - 10)).toFixed(1); return [{ x: t, z: -E }, { x: E, z: t }, { x: t, z: E }, { x: -E, z: t }][k % 4]; }).map((p) => ({ ...p, r: 2.5 }));
  const lv = { name: name || `${S.name}·${seed}`, scene, size: N, seed, tiles: Array.from(tiles).join(''), props, spawns, start: [0, 0], squad: [...PICK0],
    cap: 120, threatMul: 1, stages: STAGES.map((s) => ({ ...structuredClone(s), dur: stageDur })) };
  carve(lv); return lv;
}
// 连通：到不了出生点的刷怪点，拆掉它和出生点连线附近的物件，一轮比一轮拆得宽，最多 6 轮
export function unreachable(lv) { const m = buildMask(lv), f = flowField(m, [lv.start]); return lv.spawns.filter((s) => { const c = cellOf(m, s.x, s.z); return c < 0 || f.dist[c] < 0; }); }
export function carve(lv) {
  for (let round = 0; round < 6; round++) {
    const bad = unreachable(lv); if (!bad.length) return 0;
    for (const s of bad) {
      const [ax, az] = lv.start, dx = s.x - ax, dz = s.z - az, L = Math.hypot(dx, dz) || 1;
      lv.props = lv.props.filter(([id, x, z]) => { const t = Math.max(0, Math.min(L, ((x - ax) * dx + (z - az) * dz) / L)); return Math.hypot(ax + dx / L * t - x, az + dz / L * t - z) > Math.hypot(PROPS[id][1], PROPS[id][2]) / 2 + .8 * (round + 1); });
    }
  }
  return unreachable(lv).length;
}

// ── 参数表单：把 T 上某个对象的数值字段渲染成输入框；改动写进覆盖层（与默认相同就删掉）──
export const LABEL = { cd: '冷却 s', desc: '设计说明', dmg: '伤害', knock: '击退力', r: '半径 m', dur: '持续 s', n: '数量', dr: '减伤', tauntR: '嘲讽半径 m', taunt: '嘲讽 s',
  dashT: '冲锋时长 s', dashSpd: '冲锋速度', gap: '间距 m', range: '射程/范围', rate: '攻速', move: '移速加成', hits: '段数', vuln: '易伤 s', slow: '减速', dps: '每秒伤害', frz: '冻结 s',
  blast: '单发半径 m', heal: '回复比例', w: '宽度 m', dist: '离身距离 m', hole: '开口宽 m', stand: '站定类(1)', rangeMul: '射程加成', aim: '预警 s', hps: '每秒回复', atk: '攻击 / 增伤', life: '存在 s', scale: '体型', chain: '链跳', hp: '生命', spd: '移速 格/s', armor: '护甲', ai: '攻击间隔 s',
  stab: '稳固', fr: '抗冻', cun: '狡诈', kn: '击退力', sa: '霸体', th: '威胁值', shield: '护盾', splash: '溅射伤害', splashR: '溅射半径', min: '最近 m', max: '最远 m', mul: '伤害倍率',
  cleave: '横扫数', pass: '可穿透数', aoe: '爆炸半径 格', heroSpd: '队员移速 m/s', heroStab: '队员稳固', respawn: '复活 s（0 不复活）', armorK: '护甲常数 K', knockK: '击退系数 k',
  knockCap: '击退命中上限', kb: '击退强度', zspd: '僵尸移速倍率', meleeMul: '僵尸普攻倍率', markBonus: '标记增伤', vulnBonus: '易伤增伤', burnDps: '灼烧每秒', poolDps: '毒池每秒', mudMul: '泥地移速' };
export const getP = (p) => get(T, p);
export function paramForm(el, path, { skip = ['name'], onChange } = {}) {
  const obj = get(T, path), over = readOver(); el.innerHTML = '';
  for (const k in obj) {
    const v = obj[k], d = get(DEF, `${path}.${k}`), p = `${path}.${k}`;
    if (skip.includes(k) || (typeof v !== 'number' && k !== 'desc')) continue;
    const l = document.createElement('label'); l.className = 'pf' + (p in over ? ' mod' : '') + (k === 'desc' ? ' wide' : '');
    const inp = document.createElement(k === 'desc' ? 'textarea' : 'input'); inp.id = 'pf_' + p.replace(/\./g, '_');
    if (k !== 'desc') { inp.type = 'number'; inp.step = 'any'; } else inp.rows = 2;
    inp.value = v; inp.title = `默认 ${d}`;
    inp.onchange = () => { const o = readOver(), nv = k === 'desc' ? inp.value : +inp.value; if (nv === d) delete o[p]; else o[p] = nv; writeOver(o); l.classList.toggle('mod', p in o); onChange?.(p, nv); };
    const t = document.createElement('span'); t.textContent = LABEL[k] ?? k; l.append(t, inp); el.append(l);
  }
}

// 自检：node proto/m0/gamedata.js
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('gamedata.js')) {
  const lv = { size: 20, props: [['partition', 0, 0, 0]], stages: STAGES.map((s) => ({ ...s, dur: 10 })) };
  const m = buildMask(lv), f = flowField(m, [[0, 5]]);
  console.assert(m.mv[cellOf(m, 0, 0)] && m.shot[cellOf(m, 0, 0)] && !m.mv[cellOf(m, 0, 3)], 'mask');
  console.assert(f.dist[cellOf(m, 0, -5)] > 10, 'flow goes around wall', f.dist[cellOf(m, 0, -5)]);
  const d = flowDir(m, f, 0, -1.5); console.assert(d && Math.abs(d[0]) > .5, 'steers sideways at wall', d);
  console.assert(Math.abs(rateAt(lv, 0) - 3 / avgThreat(STAGES[0].mix)) < 1e-9 && rateAt(lv, 99) === 0, 'rate');
  const r = buildMask({ size: 20, props: [['partition', 0, 0, Math.PI / 2]] }); console.assert(r.mv[cellOf(r, 0, 1.5)] && !r.mv[cellOf(r, 1.5, 0)], 'rotated');
  const pp = { x: .1, z: .35 }; pushOut(m, pp, .3); console.assert(Math.abs(pp.z) >= .49 && Math.abs(pp.x - .1) < 1e-9, 'pushOut', pp);
  const pr = { x: .3, z: .1 }; pushOut(r, pr, .3); console.assert(Math.abs(pr.x) >= .49 && Math.abs(pr.z - .1) < 1e-9, 'pushOut rotated', pr);
  for (const sc of Object.keys(SCENES)) for (const seed of [1, 2, 3]) { const g = generate({ scene: sc, seed }); console.assert(!unreachable(g).length && g.props.length > 20, 'gen', sc, seed, g.props.length); }
  console.assert(JSON.stringify(generate({ seed: 5 })) === JSON.stringify(generate({ seed: 5 })), 'deterministic');
  console.log('gamedata ok');
}
