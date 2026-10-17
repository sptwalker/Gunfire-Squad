/**
 * P4 技能数值表：给 classes.ts 里 790 个技能 key 各配一套可执行数值。
 *
 * 不手填，按公式出：
 *   · 类型（kind）取技能标签里优先级最高的那个——召唤 > 治疗 > 嘲讽 / 减伤 > 控制 > 群伤 > 位移 > 单体
 *   · 强度看技能第一次出现的转数 lv（1…7，7 = 五星），所有数随 lv 线性涨
 *   · 槽位定冷却与范围：A 自身短 CD、B 分线机制、C 被动光环（无 CD）、D 全队号令长 CD
 * 原型（proto/m0/battle.html）和以后的 core 都按 kind 跑同一个执行器，所以改公式 = 改全部技能。
 *
 * ponytail: 公式一刀切，个别技能要特调时在 OVERRIDE 里按 key 覆盖，不要改公式去迁就一个技能。
 */
import { CLASSES, type SlotId } from './classes.ts';
import type { AnswerTag } from './scenes.ts';

export type SkillKind = 'summon' | 'heal' | 'guard' | 'control' | 'aoe' | 'dash' | 'single' | 'aura';

export interface SkillNum {
  key: string;
  name: string;
  slot: SlotId;
  /** 第一次出现的转数（7 = 五星） */
  lv: number;
  kind: SkillKind;
  /** 冷却 s（光环 0） */
  cd: number;
  /** 持续 s（0 = 瞬发） */
  dur: number;
  /** 伤害倍率（× 武器单发伤害） */
  mul: number;
  /** 作用半径 m */
  r: number;
  /** 召唤数 / 段数 */
  n: number;
  /** 每秒回复：最大生命的比例 */
  heal: number;
  /** 减伤比例 */
  dr: number;
  /** 减速比例 */
  slow: number;
  /** 定身 / 冻结 s */
  frz: number;
  /** 嘲讽 s */
  taunt: number;
  /** 破甲比例（shred） */
  pierce: number;
  /** 1 = 全队生效（D 号令） */
  team: number;
  /** 站定类：施放期间原地不动 */
  stand: number;
  tags: AnswerTag[];
}

const has = (t: AnswerTag[], ...k: AnswerTag[]) => k.some((x) => t.includes(x));
export function kindOf(slot: SlotId, t: AnswerTag[]): SkillKind {
  if (slot === 'C') return 'aura';
  if (has(t, 'summon')) return 'summon';
  if (has(t, 'sustain', 'cleanse')) return 'heal';
  if (has(t, 'taunt', 'mitigate', 'block', 'deflect')) return 'guard';
  if (has(t, 'control', 'slow', 'root', 'charm', 'calm')) return 'control';
  if (has(t, 'aoeClear', 'detonate', 'seismic')) return 'aoe';
  if (has(t, 'mobility')) return 'dash';
  return 'single';
}

const CD: Record<SlotId, number> = { A: 12, B: 16, C: 0, D: 30 };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function skillNum(key: string, name: string, slot: SlotId, lv: number, tags: AnswerTag[], text = ''): SkillNum {
  const kind = kindOf(slot, tags), ult = key.endsWith('+');
  return {
    key, name, slot, lv, kind, tags,
    cd: ult ? 24 : CD[slot] + (kind === 'summon' ? 6 : 0),
    dur: kind === 'aura' ? 0 : r2(4 + 0.5 * lv),
    mul: r2(kind === 'single' ? 1.5 + 0.35 * lv : kind === 'aoe' ? 1 + 0.25 * lv : kind === 'dash' ? 1.2 + 0.2 * lv : 0.6 + 0.1 * lv),
    r: r2((slot === 'C' ? 5 : slot === 'D' ? 8 : 2.5) + 0.3 * lv),
    n: kind === 'summon' ? 1 + Math.floor(lv / 3) + (slot === 'D' ? 2 : 0) : kind === 'single' ? 3 : 1,
    heal: has(tags, 'sustain') ? r2(0.03 + 0.008 * lv) : 0,
    dr: has(tags, 'mitigate', 'block', 'deflect') ? r2(Math.min(0.5, 0.2 + 0.04 * lv)) : 0,
    slow: has(tags, 'slow', 'control', 'calm') ? r2(Math.min(0.7, 0.3 + 0.04 * lv)) : 0,
    frz: has(tags, 'root', 'charm') ? r2(1 + 0.2 * lv) : 0,
    taunt: has(tags, 'taunt') ? r2(2.5 + 0.25 * lv) : 0,
    pierce: has(tags, 'shred') ? r2(Math.min(0.6, 0.2 + 0.05 * lv)) : 0,
    team: slot === 'D' ? 1 : 0,
    stand: /站定|原地/.test(text) ? 1 : 0,
  };
}

/** 按 key 特调（只放公式算不对的个例） */
export const OVERRIDE: Record<string, Partial<SkillNum>> = {};

export const SKILLS: Record<string, SkillNum> = {};
for (const c of [...CLASSES].sort((a, b) => a.tier - b.tier))
  for (const s of c.slots) SKILLS[s.skill] ??= { ...skillNum(s.skill, s.name, s.slot, c.tier, s.tags, s.text), ...OVERRIDE[s.skill] };

export const skillOf = (key: string): SkillNum | undefined => SKILLS[key];
