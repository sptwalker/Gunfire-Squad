const R = new URL('../../src/data/', import.meta.url).href;
const { CLASS_TREES, expandTree } = await import(R + 'classes.ts');
const m = new Map(), hit = new Map();
for (const t of Object.values(CLASS_TREES)) for (const c of expandTree(t))
  for (const s of c.slots) {
    const prev = m.get(s.name);
    if (prev && prev !== s.skill) hit.set(t.key, (hit.get(t.key) ?? 0) + 1);
    m.set(s.name, s.skill);
  }
console.log('各树撞名数：', [...hit].map(([k, n]) => `${k}=${n}`).join(' ') || '无');
