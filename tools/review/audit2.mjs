const R = new URL('../../src/data/', import.meta.url).href;
const { CLASS_TREES } = await import(R + 'classes.ts');
const t = CLASS_TREES.swordsman;
const A5 = t.axes[2].sides.map((s) => s.name), A6 = t.axes[3].sides.map((s) => s.name);
console.log('光环轴(C/第5转):', A5.join(' / '), '| 号令轴(D/第6转):', A6.join(' / '));
t.styles.forEach((pair) => pair.forEach((a) => {
  console.log(`\n### ${a.title}  C槽(${a.aura.length}) D槽(${a.order.length}) 五星(${a.ultimates.length})`);
  a.aura.forEach((s, i) => console.log(`  C${i} = ${a.variants[i >> 1].name}流 × ${A5[i & 1]} → 「${s[0]}」`));
  a.order.forEach((s, i) => console.log(`  D${i} = ${a.variants[i >> 1].name}流 × ${A6[i & 1]} → 「${s[0]}」`));
  a.ultimates.forEach((s, i) => console.log(`  ★${i} = ${a.variants[(i >> 2) & 1].name}流 × ${A5[(i >> 1) & 1]} × ${A6[i & 1]} → 「${s[0]}」 文案: ${s[1]}`));
}));
