const h = require('fs').readFileSync('out/sw.html', 'utf8');
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const m = h.match(/<article class="card late" id="sw-000-late"[\s\S]*?<\/article>/);
console.log(m ? strip(m[0]).slice(0, 2200) : '找不到');
console.log('\n--- 各分线总评卡 ---');
console.log([...h.matchAll(/<article class="card late" id="([^"]+)"/g)].map((x) => x[1]).join('  '));
