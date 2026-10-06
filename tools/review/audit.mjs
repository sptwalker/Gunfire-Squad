// 审计 sw 树：① 五星的 [流派][光环][号令] 索引是否指向文案里说的那两个技能；② 「…」引用的技能名是否真实存在。
const R = new URL('../../src/data/', import.meta.url).href;
const { CLASS_TREES } = await import(R + 'classes.ts');
const t = CLASS_TREES.swordsman;
const A5 = t.axes[2].sides.map((s) => s.name), A6 = t.axes[3].sides.map((s) => s.name);
const all = new Set([...Object.values(t.skillA).map((s) => s[0]), ...t.styles.flatMap((p) => p.flatMap((a) => [a.skill[0], ...a.variants.map((v) => v.skill[0]), ...a.aura.map((s) => s[0]), ...a.order.map((s) => s[0]), ...a.ultimates.map((s) => s[0])]))]);
let n = 0;
t.styles.forEach((pair) => pair.forEach((a) => {
  const V = a.variants.map((v) => v.name);
  a.ultimates.forEach((s, i) => {
    const a4 = (i >> 2) & 1, a5 = (i >> 1) & 1, a6 = i & 1;
    const [wantA, wantO] = [a.aura[a4 * 2 + a5][0], a.order[a4 * 2 + a6][0]];
    const txt = [s[1], s[3]].filter(Boolean).join(' ');
    const tag = `${a.title} ★${i}「${s[0]}」 = ${V[a4]}×${A5[a5]}×${A6[a6]}`;
    if (!txt.includes(wantA)) { n++; console.log(`✗ ${tag} 文案没提光环「${wantA}」`); }
    if (!txt.includes(wantO)) { n++; console.log(`✗ ${tag} 文案没提号令「${wantO}」`); }
    // 幻影名：文案里「」包着的名字如果不在全树技能表里，就是引用了不存在的技能
    for (const [, q] of txt.matchAll(/「([^」]+)」/g)) {
      if (!all.has(q)) { n++; console.log(`✗ ${tag} 引用了不存在的技能名「${q}」`); }
    }
  });
}));
console.log(n ? `\n共 ${n} 处` : '\n✓ 全绿');
