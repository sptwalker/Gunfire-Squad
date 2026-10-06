// ponytail: 临时诊断，用完删。
import { CLASSES } from './src/data/classes.ts';
const m = new Map<string, Set<string>>();
for (const c of CLASSES) for (const s of c.slots) {
  if (!m.has(s.name)) m.set(s.name, new Set());
  m.get(s.name)!.add(s.skill);
}
for (const [n, ks] of m) if (ks.size > 1) console.log(n, '→', [...ks].join('  '));
