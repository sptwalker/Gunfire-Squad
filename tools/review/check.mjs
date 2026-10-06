// 树草案自检（同 balance-check §14）：node check.mjs <key>
const R = new URL('../../src/data/', import.meta.url).href;
const { expandTree, CLASSES } = await import(R + 'classes.ts');
const { POINT_TOTAL, PRIMARY_KEYS, pointBudget } = await import(R + 'attributes.ts');
const { HERO_GROWTH_BAND } = await import(R + 'progression.ts');
const { WEAPON_CLASS_NAME } = await import(R + 'weapons.ts');
const { ANSWER_DIMS } = await import(R + 'scenes.ts');
const K = process.argv[2];
const t = (await import('./trees/' + K + '.ts')).TREE;
const cs = expandTree(t), T = (k) => cs.filter((c) => c.tier === k), by = Object.fromEntries(cs.map((c) => [c.id, c]));
const names = cs.map((c) => c.name), heroNames = T(6).map((c) => c.name.split('·')[1]);
const swNames = new Set(CLASSES.map((c) => c.name)), swHeroes = new Set(CLASSES.filter((c) => c.tier === 6).map((c) => c.name.split('·')[1]));
const SL = [0, 1, 1, 2, 2, 3, 4, 4];
const allSides = [...t.axes.flatMap((a) => a.sides), ...t.styles.flat(), ...t.styles.flat().flatMap((a) => a.variants)];
const checks = [
  ['191 个职业', cs.length === 191],
  ['职业名全树不重复', new Set(names).size === names.length],
  ['64 名英雄名不重复', new Set(heroNames).size === 64],
  ['职业名不和已有树重名', names.every((n) => !swNames.has(n))],
  ['英雄名不和已有树重名', heroNames.every((n) => !swHeroes.has(n))],
  ['每条边属性增减和为 0', allSides.every((s) => Object.values(s.attr).reduce((a, b) => a + b, 0) === 0)],
  ['属性合计 ' + POINT_TOTAL + '，单项 ≥ 1', cs.every((c) => pointBudget(c.primary) === POINT_TOTAL && PRIMARY_KEYS.every((k) => c.primary[k] >= 1))],
  ['成长率在区间内', cs.every((c) => c.growth >= HERO_GROWTH_BAND[0] && c.growth <= HERO_GROWTH_BAND[1])],
  ['武器类别合法', cs.every((c) => c.weaponClasses.every((w) => WEAPON_CLASS_NAME[w]))],
  ['技能数按阶', cs.every((c) => c.slots.length === SL[c.tier])],
  ['兄弟职业技能不完全相同', cs.filter((c) => c.tier >= 1 && c.tier <= 6).every((c) => {
    const sib = by[t.key + '-' + c.path.slice(0, -1).join('') + (1 - c.path.at(-1))];
    return c.slots.some((s, i) => s.skill !== sib.slots[i].skill); })],
  ['8 条分线机制家族不同', new Set(t.styles.flat().map((a) => a.family)).size === 8],
  ['同名技能只对应一个 key', (() => { const m = new Map(); return cs.every((c) => c.slots.every((s) => (m.get(s.name) ?? s.skill) === s.skill && m.set(s.name, s.skill))); })()],
  ['每个技能都带合法答案标签', cs.every((c) => c.slots.every((s) => s.tags.length > 0 && s.tags.every((g) => ANSWER_DIMS[g])))],
  ['64 个五星特性各不相同', new Set(T(7).map((u) => u.slots[3].name)).size === 64 && new Set(T(7).map((u) => u.slots[3].text)).size === 64],
];
for (const [n, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${n}`);
const first = new Map();
for (const c of cs) for (const g of c.tags) first.set(g, Math.min(first.get(g) ?? 99, c.rank));
console.log('本树没有的标签：' + Object.keys(ANSWER_DIMS).filter((g) => !first.has(g)).join(' '));
process.exitCode = checks.every((c) => c[1]) ? 0 : 1;
