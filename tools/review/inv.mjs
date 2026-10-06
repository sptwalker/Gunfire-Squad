const R = new URL('../../src/data/', import.meta.url).href;
const { CLASS_TREES, expandTree } = await import(R + 'classes.ts');
for (const t of Object.values(CLASS_TREES)) {
  const cs = expandTree(t), T = (n) => cs.filter((c) => c.tier === n);
  const g5 = new Map(), g6 = new Map();
  for (const c of T(5)) { const k = c.path.slice(0, 3).join(''); g5.set(k, [...(g5.get(k) ?? []), c.slots[2].name]); }
  for (const c of T(6)) { const k = c.path.slice(0, 3).join(''); g6.set(k, [...(g6.get(k) ?? []), c.slots[3].name]); }
  const cOk = [...g5.values()].every((v) => new Set(v).size === 4);
  const dOk = [...g6.values()].every((v) => new Set(v).size === 4);
  // 新增槽位才有协同：tier5=C(第3槽) tier6=D(第4槽) tier7=★(第4槽)
  const lOk = T(5).every((c) => c.slots[2].link) && T(6).every((c) => c.slots[3].link) && T(7).every((c) => c.slots[3].link);
  const cN = new Set(T(5).map((c) => c.slots[2].name)).size;
  console.log(`${t.key}: C名去重=${cN}/32 ${cOk ? '✓' : '✗'}  D差异=${dOk ? '✓' : '✗'}  新槽有协同=${lOk ? '✓' : '✗'}`);
}
