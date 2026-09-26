/**
 * 7 种僵尸。
 *
 * 设计原则：每种僵尸必须能用一个【行为动词】概括，否则它就只是一个换皮的血包。
 *   普通=数量  高速=冲刺  胖=阻挡  毒=区域封锁  爆炸=逼迫走位  分裂=清场惩罚  跳跃=无视地形
 * 七种动词互不重叠，这样玩家在战场上一眼能读出战术含义。
 *
 * 数值上：胖僵尸 HP 1400 是普通僵尸的 7 倍，但速度只有一半——
 * 它的作用是逼玩家处理，而不是造成伤害。
 */

import type { ArmorType } from './damage.ts';

export type ZombieId =
  | 'normal'
  | 'runner'
  | 'brute'
  | 'toxic'
  | 'bomber'
  | 'splitter'
  | 'leaper'
  | 'spawnling';

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
  /** 特殊行为说明 */
  special: string;
  /** 抗性/弱点备注，仅文档用 */
  tag: string;
}

export const ZOMBIES: Record<ZombieId, Zombie> = {
  normal: {
    id: 'normal', name: '普通僵尸', hp: 200, speed: 2.2, armor: 30,
    armorType: 'none', atk: 90, atkInterval: 1.2, radius: 0.45,
    points: 1, money: 3, threat: 1,
    special: '无', tag: '基础单位，构成战场底噪',
  },
  runner: {
    id: 'runner', name: '高速僵尸', hp: 120, speed: 5.0, armor: 15,
    armorType: 'none', atk: 70, atkInterval: 0.8, radius: 0.4,
    points: 2, money: 4, threat: 1.2,
    special: '冲刺突进，命中打断换弹', tag: '惩罚站桩与长换弹武器',
  },
  brute: {
    id: 'brute', name: '高防胖僵尸', hp: 1400, speed: 1.2, armor: 220,
    armorType: 'heavy', atk: 260, atkInterval: 2.0, radius: 0.9,
    points: 6, money: 12, threat: 3,
    special: '减伤 60%，缓慢推挤玩家', tag: '必须用穿刺/爆炸/火焰处理',
  },
  toxic: {
    id: 'toxic', name: '毒液僵尸', hp: 350, speed: 2.0, armor: 60,
    armorType: 'light', atk: 110, atkInterval: 1.5, radius: 0.5,
    points: 3, money: 6, threat: 1.8,
    special: '死亡留下毒池，5 格 / 8 秒持续伤害', tag: '区域封锁，逼玩家放弃阵地',
  },
  bomber: {
    id: 'bomber', name: '爆炸僵尸', hp: 400, speed: 2.6, armor: 100,
    armorType: 'medium', atk: 550, atkInterval: 99, radius: 0.6,
    points: 5, money: 8, threat: 2,
    special: '靠近后自爆，范围 2.5 格', tag: '迫使玩家主动拉开距离',
  },
  splitter: {
    id: 'splitter', name: '分裂僵尸', hp: 300, speed: 2.2, armor: 40,
    armorType: 'none', atk: 100, atkInterval: 1.2, radius: 0.55,
    points: 4, money: 7, threat: 2,
    special: '死亡分裂为 3 只分裂小僵尸', tag: 'AOE 武器在这里是负收益，单体武器反而更优',
  },
  leaper: {
    id: 'leaper', name: '跳跃僵尸', hp: 250, speed: 3.0, armor: 45,
    armorType: 'none', atk: 140, atkInterval: 1.4, radius: 0.5,
    points: 4, money: 9, threat: 2,
    special: '跳跃越过障碍，落地 AOE', tag: '无视地形，让掩体战术失效',
  },
  spawnling: {
    id: 'spawnling', name: '分裂小僵尸', hp: 80, speed: 3.2, armor: 10,
    armorType: 'none', atk: 55, atkInterval: 1.0, radius: 0.3,
    points: 1, money: 1, threat: 0,
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
 */
export const STAGE_HP_MUL = [1.0, 1.7, 2.8];
/** 每阶段僵尸伤害倍率 */
export const STAGE_DMG_MUL = [1.0, 1.5, 2.2];

export function stageMods(stage: number): { hp: number; dmg: number } {
  const i = Math.min(stage, 3) - 1;
  return { hp: STAGE_HP_MUL[i], dmg: STAGE_DMG_MUL[i] };
}
