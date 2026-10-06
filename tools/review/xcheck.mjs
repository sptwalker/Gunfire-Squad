// 跨树查重：职业名、英雄名
const R = new URL('../../src/data/', import.meta.url).href;
const { CLASSES, expandTree } = await import(R + 'classes.ts');
const all = [...CLASSES];
for (const k of ['mg', 'ar', 'md', 'te']) all.push(...expandTree((await import('./trees/' + k + '.ts')).TREE));
const dup = (xs) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
console.log('职业名重复：', dup(all.map((c) => c.name)).join(' ') || '无');
console.log('英雄名重复：', dup(all.filter((c) => c.tier === 6).map((c) => c.name.split('·')[1])).join(' ') || '无');
console.log('职业总数：', all.length);
