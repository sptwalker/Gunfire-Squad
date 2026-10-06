// 挑战维度 × 答案设计图：node dims.mjs > docs/review/dims.html（数据全部从仓库 scenes.ts / zombies.ts / 各职业树读）
const R = new URL('../../src/data/', import.meta.url).href;
const { DIMENSIONS, ANSWER_DIMS, ANSWER_LIST, MIN_ANSWERS_PER_DIM, SCENES, OBSTACLES } = await import(R + 'scenes.ts');
const { ZOMBIES } = await import(R + 'zombies.ts');
const { CLASS_TREES, expandTree } = await import(R + 'classes.ts');
const { RANKS } = await import(R + 'progression.ts');
const { existsSync } = await import('node:fs');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*/g, '');
const FAM = { tempo: ['F1', '数量与节奏'], resist: ['F2', '抗性与反制'], space: ['F3', '地形与空间'], attrition: ['F4', '持续与区域'] };
const TAG = {
  aoeClear: '范围清场', singleTarget: '单体点杀', sustainedDps: '持续输出', burst: '爆发窗口', pierce: '直线穿透',
  explosive: '爆炸灼烧', armorShred: '破甲腐蚀', control: '控制减速', taunt: '堵口嘲讽', mitigate: '减伤护盾',
  sustain: '续航治疗', ranged: '远程射程', mobility: '机动突进', summon: '召唤物', debuff: '标记易伤',
};
// ponytail: 答案的一句话说明照抄 scenes.ts 的行尾注释，那里改了这里要跟
const TAG_NOTE = {
  aoeClear: '一次攻击覆盖多个目标', singleTarget: '高单体效率，不制造额外目标', sustainedDps: '不需要窗口，一直在打',
  burst: '短时间把伤害集中砸出去', pierce: '无视部分护甲，且吃站位', explosive: '高额定值伤害，不吃护甲减免',
  armorShred: '把目标护甲降下来给全队用', control: '限制移动', taunt: '把敌人固定在一点', mitigate: '降低全队承伤',
  sustain: '续航治疗', ranged: '在威胁范围外解决战斗', mobility: '走位成本对你更低', summon: '用编制外的单位分摊', debuff: '为全队制造集火窗口',
};
const TERRAIN = { building: '建筑', corridor: '走廊', openField: '开阔地', marsh: '沼泽', water: '水域', ice: '冰面', pool: '毒洼', barrel: '油桶', crate: '补给箱', sandbag: '沙袋', wire: '铁丝网', woodwall: '木墙' };

const answersOf = (d) => ANSWER_LIST.filter((a) => ANSWER_DIMS[a].includes(d));
const famIds = Object.keys(FAM);

// 各职业树：每个答案标签最早在哪一级出现、有多少职业带
const ORDER = [['sw', '剑士'], ['mg', '法师'], ['ar', '射手'], ['md', '辅助师'], ['te', '技师']];
const trees = [];
for (const [k] of ORDER) {
  const t = Object.values(CLASS_TREES).find((x) => x.key === k) ?? (existsSync(`trees/${k}.ts`) ? (await import(`./trees/${k}.ts`)).TREE : null);
  if (!t) continue;
  const cs = expandTree(t), first = {}, cnt = {};
  for (const c of cs) for (const g of c.tags) { first[g] = Math.min(first[g] ?? 99, c.rank); cnt[g] = (cnt[g] ?? 0) + 1; }
  trees.push({ k, name: t.name, n: cs.length, first, cnt });
}
const rk = (lv) => RANKS[lv - 1].code;

// ── 1. 维度卡 ──
const dimCards = famIds.map((f) => {
  const ds = DIMENSIONS.filter((d) => d.family === f);
  return `<section class="fam f-${f}"><h3><span>${FAM[f][0]}</span>${FAM[f][1]}</h3>${ds.map((d) => {
    const as = answersOf(d.id);
    return `<article class="dim" id="d-${d.id}">
  <header><h4>${esc(d.name)}</h4><code>${d.id}</code></header>
  <p class="feels">“${esc(d.feels)}”</p>
  <dl><dt>破解</dt><dd>${esc(d.needs)}</dd>
  <dt>僵尸</dt><dd>${d.zombies.map((z) => esc(ZOMBIES[z].name)).join('、')}</dd>
  <dt>地形</dt><dd>${d.terrain.length ? d.terrain.map((x) => TERRAIN[x] ?? x).join('、') : '<span class="mute">纯靠僵尸构成</span>'}</dd>
  <dt>答案 ${as.length}</dt><dd class="chips">${as.map((a) => `<span class="chip">${TAG[a]}</span>`).join('')}</dd></dl>
</article>`; }).join('')}</section>`;
}).join('');

// ── 2. 关系图（SVG 二分图）──
const dimsSorted = famIds.flatMap((f) => DIMENSIONS.filter((d) => d.family === f));
const W = 900, rowA = 36, H = ANSWER_LIST.length * rowA + 40;
const rowD = (H - 40) / dimsSorted.length;
const yD = (i) => 20 + rowD * (i + 0.5), yA = (i) => 20 + rowA * (i + 0.5);
const xL = 230, xR = W - 230;
const edges = [];
dimsSorted.forEach((d, i) => ANSWER_LIST.forEach((a, j) => {
  if (!ANSWER_DIMS[a].includes(d.id)) return;
  const y1 = yD(i), y2 = yA(j), mx = (xL + xR) / 2;
  edges.push(`<path class="e f-${d.family}" data-d="${d.id}" data-a="${a}" d="M${xL} ${y1.toFixed(1)} C${mx} ${y1.toFixed(1)} ${mx} ${y2.toFixed(1)} ${xR} ${y2.toFixed(1)}"/>`);
}));
const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="挑战维度与答案标签的对应关系图">
<g class="edges">${edges.join('')}</g>
${dimsSorted.map((d, i) => `<g class="n nd f-${d.family}" data-d="${d.id}" tabindex="0"><circle cx="${xL}" cy="${yD(i).toFixed(1)}" r="6"/><text x="${xL - 14}" y="${yD(i).toFixed(1)}" text-anchor="end">${esc(d.name)}<tspan class="cnt"> ${answersOf(d.id).length}</tspan></text></g>`).join('')}
${ANSWER_LIST.map((a, j) => `<g class="n na" data-a="${a}" tabindex="0"><rect x="${xR - 6}" y="${(yA(j) - 6).toFixed(1)}" width="12" height="12" rx="2"/><text x="${xR + 14}" y="${yA(j).toFixed(1)}">${TAG[a]}<tspan class="cnt"> ${ANSWER_DIMS[a].length}</tspan></text></g>`).join('')}
<text class="ax" x="${xL}" y="12" text-anchor="end">挑战维度（压力来源）</text><text class="ax" x="${xR}" y="12">答案标签（能力形状）</text>
</svg>`;

// ── 3. 覆盖矩阵 ──
const matrix = `<table class="mx"><thead><tr><th class="corner">答案 ＼ 维度</th>${dimsSorted.map((d) => `<th class="f-${d.family}"><span>${esc(d.name)}</span></th>`).join('')}<th>覆盖</th></tr></thead><tbody>
${ANSWER_LIST.map((a) => `<tr><th><b>${TAG[a]}</b><small>${TAG_NOTE[a]}</small></th>${dimsSorted.map((d) => `<td>${ANSWER_DIMS[a].includes(d.id) ? `<i class="dot f-${d.family}" title="${TAG[a]} → ${esc(d.name)}"></i>` : ''}</td>`).join('')}<td class="num">${ANSWER_DIMS[a].length}</td></tr>`).join('')}
</tbody><tfoot><tr><th>答案数（门槛 ≥ ${MIN_ANSWERS_PER_DIM}）</th>${dimsSorted.map((d) => { const n = answersOf(d.id).length; return `<td class="num ${n < MIN_ANSWERS_PER_DIM ? 'low' : ''}">${n}</td>`; }).join('')}<td></td></tr></tfoot></table>`;

// ── 4. 场景签名 ──
const scenes = `<table class="sc"><thead><tr><th>场景</th><th>签名维度</th><th>关卡</th><th>地形</th><th>一句话</th></tr></thead><tbody>
${SCENES.map((s) => `<tr><th>${esc(s.name)}</th><td class="chips">${s.signature.map((id) => { const d = DIMENSIONS.find((x) => x.id === id); return `<a class="chip f-${d.family}" href="#d-${id}">${esc(d.name)}</a>`; }).join('')}</td><td class="num">${s.ladder.reduce((n, p) => n + p.levels, 0)}</td><td>${s.terrain.map((x) => TERRAIN[x] ?? x).join('、')}</td><td class="brief">${esc(s.brief)}</td></tr>`).join('')}
</tbody></table>`;

// ── 5. 各职业树对每个答案的供给 ──
const supply = `<table class="sp"><thead><tr><th>答案</th>${trees.map((t) => `<th>${esc(t.name)}<small>${t.k}</small></th>`).join('')}</tr></thead><tbody>
${ANSWER_LIST.map((a) => `<tr><th>${TAG[a]}</th>${trees.map((t) => t.first[a] ? `<td><span class="rk">${rk(t.first[a])}</span><span class="c">${t.cnt[a]}</span></td>` : '<td class="none">—</td>').join('')}</tr>`).join('')}
</tbody></table>`;

const dimN = DIMENSIONS.length, ansN = ANSWER_LIST.length, edgeN = edges.length;
console.log(`<title>挑战维度设计图</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@700;900&family=JetBrains+Mono:wght@500&display=swap">
<style>
:root{--bg:#f3f4f2;--paper:#fbfbf9;--ink:#1d2228;--ink2:#4a535d;--mute:#7b848d;--line:#d9dcd8;--line2:#e8eae6;
  --acc:#8a5a1c;--acc-soft:#f1e6d4;--steel:#2f5470;--steel-soft:#e3ebf1;--warn:#a2412c;--warn-soft:#f6e4de;--focus:#2f5470;
  --tempo:#b5562d;--resist:#5a4b9a;--space:#2f7a5b;--attrition:#9a7a12}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#15181b;--paper:#1c2024;--ink:#e6e8e6;--ink2:#b3b9bf;--mute:#838b93;--line:#30363c;--line2:#262b30;
  --acc:#d9a35c;--acc-soft:#332a1d;--steel:#8fb6d4;--steel-soft:#1f2b35;--warn:#e8876f;--warn-soft:#3a231d;--focus:#8fb6d4;
  --tempo:#e88a5f;--resist:#a99be6;--space:#6cc59d;--attrition:#d9b84a}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#15181b;--paper:#1c2024;--ink:#e6e8e6;--ink2:#b3b9bf;--mute:#838b93;--line:#30363c;--line2:#262b30;
  --acc:#d9a35c;--acc-soft:#332a1d;--steel:#8fb6d4;--steel-soft:#1f2b35;--warn:#e8876f;--warn-soft:#3a231d;--focus:#8fb6d4;
  --tempo:#e88a5f;--resist:#a99be6;--space:#6cc59d;--attrition:#d9b84a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding-inline:20px;padding-block:32px 80px;display:flex;flex-direction:column;gap:44px}
h1,h2,h3,h4{font-family:"Noto Serif SC","Songti SC",serif;margin:0;line-height:1.3;text-wrap:balance}
h1{font-size:2.2rem;font-weight:900}h2{font-size:1.45rem;padding-bottom:6px;border-bottom:1px solid var(--line)}
code,.rk,.num{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
code{font-size:.75rem;color:var(--mute)}
.eyebrow{font-size:.75rem;letter-spacing:.14em;color:var(--acc);font-weight:500}
.top{border-bottom:2px solid var(--ink);padding-bottom:20px}.lede{color:var(--ink2);max-width:72ch;margin:8px 0 0}
.home{display:inline-flex;margin:10px 0 12px;padding:6px 14px;border:1px solid var(--steel);border-radius:4px;background:var(--steel-soft);color:var(--steel);font-weight:700;font-size:.88rem;text-decoration:none}
.home:hover{background:var(--steel);color:var(--paper)}
.stats{display:flex;flex-wrap:wrap;gap:8px 28px;margin-top:14px;font-size:.9rem;color:var(--ink2)}.stats b{font-size:1.3rem;color:var(--ink);margin-right:4px;font-family:"JetBrains Mono",monospace}
section.part{display:flex;flex-direction:column;gap:14px}
.f-tempo{--fc:var(--tempo)}.f-resist{--fc:var(--resist)}.f-space{--fc:var(--space)}.f-attrition{--fc:var(--attrition)}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:.85rem;color:var(--ink2)}
.legend span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--fc);margin-right:6px;vertical-align:-1px}
/* 维度卡 */
.fams{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:18px;align-items:start}
.fam{display:flex;flex-direction:column;gap:10px}
.fam h3{font-size:1.1rem;display:flex;align-items:baseline;gap:8px;color:var(--fc);padding-bottom:4px;border-bottom:3px solid var(--fc)}
.fam h3 span{font-family:"JetBrains Mono",monospace;font-size:.78rem}
.dim{background:var(--paper);border:1px solid var(--line);border-left:4px solid var(--fc);border-radius:5px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;scroll-margin-top:16px}
.dim:target{box-shadow:0 0 0 3px var(--steel-soft)}
.dim header{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.dim h4{font-size:1.1rem}
.feels{margin:0;color:var(--ink2);font-size:.9rem}
dl{display:grid;grid-template-columns:4.6em 1fr;gap:4px 10px;margin:0;font-size:.86rem}
dt{color:var(--steel);font-weight:700;font-size:.78rem;padding-top:2px}dd{margin:0}
.mute{color:var(--mute)}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:.75rem;padding:0 8px;border:1px solid var(--line);border-radius:10px;color:var(--ink2);text-decoration:none;white-space:nowrap}
a.chip{border-color:var(--fc);color:var(--fc)}
/* 关系图 */
.graph{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:12px;overflow-x:auto}
.graph svg{display:block;width:100%;min-width:640px;height:auto;font-size:14px}
.graph text{fill:var(--ink);dominant-baseline:middle}.graph .cnt{fill:var(--mute);font-family:"JetBrains Mono",monospace;font-size:11px}
.graph .ax{fill:var(--mute);font-size:12px;letter-spacing:.06em}
.e{fill:none;stroke:var(--fc);stroke-width:1.4;opacity:.38;transition:opacity .15s,stroke-width .15s}
.nd circle{fill:var(--fc)}.na rect{fill:var(--paper);stroke:var(--ink2);stroke-width:1.5}
.n{cursor:pointer;outline:none}.n:focus-visible text{text-decoration:underline}
svg.hl .e{opacity:.06}svg.hl .e.on{opacity:.95;stroke-width:2.6}svg.hl .n{opacity:.3}svg.hl .n.on{opacity:1}
.hint{font-size:.82rem;color:var(--mute);margin:0}
/* 表格 */
.tw{overflow-x:auto;background:var(--paper);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:.86rem}
th,td{padding:6px 8px;border-bottom:1px solid var(--line2);text-align:left;font-weight:400;vertical-align:middle}
thead th{font-size:.78rem;color:var(--ink2)}
tbody th{font-weight:400}tbody th b{font-weight:700;display:block}tbody th small{color:var(--mute);font-size:.74rem}
.mx thead th:not(.corner):not(:last-child){border-top:4px solid var(--fc);text-align:center;min-width:3.4em}
.mx thead th span{writing-mode:vertical-rl;letter-spacing:.1em;display:inline-block;min-height:4.5em}
.mx td{text-align:center}.mx tbody tr:hover{background:var(--steel-soft)}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--fc)}
.num{text-align:center}.low{color:var(--warn);background:var(--warn-soft);font-weight:700}
tfoot th,tfoot td{border-top:2px solid var(--line);border-bottom:0;font-size:.8rem}
.sc .brief{color:var(--ink2);max-width:46ch}.sc th{white-space:nowrap;font-weight:700}
.sp td{white-space:nowrap}.sp thead th small{display:block;color:var(--mute);font-family:"JetBrains Mono",monospace;font-size:.7rem}
.rk{font-size:.75rem;background:var(--steel-soft);color:var(--steel);padding:1px 6px;border-radius:3px}
.sp .c{margin-left:8px;color:var(--mute);font-family:"JetBrains Mono",monospace;font-size:.78rem}
.none{color:var(--warn)}
</style>
<div class="wrap">
<header class="top">
  <div class="eyebrow">Gunfire Squad · 挑战维度 × 答案</div>
  <a class="home" href="index.html">← 返回职业树首页</a>
  <h1>对抗维度设计图</h1>
  <p class="lede">维度是压力的<b>来源</b>，答案是能力的<b>形状</b>。一个维度至少要有 ${MIN_ANSWERS_PER_DIM} 种答案能解，才保证"不止一套阵容"。全部数据从 scenes.ts / zombies.ts / 各职业树直接读出，不手填。</p>
  <div class="stats"><span><b>${dimN}</b>挑战维度</span><span><b>${famIds.length}</b>维度家族</span><span><b>${ansN}</b>答案标签</span><span><b>${edgeN}</b>条对应关系</span><span><b>${SCENES.length}</b>场景</span></div>
</header>

<section class="part"><h2>一、对抗关系图</h2>
  <div class="legend">${famIds.map((f) => `<span class="f-${f}">${FAM[f][0]} ${FAM[f][1]}</span>`).join('')}</div>
  <p class="hint">鼠标悬停或键盘聚焦任一节点，高亮它的全部连线。数字 = 连线数。</p>
  <div class="graph">${svg}</div>
</section>

<section class="part"><h2>二、${dimN} 个挑战维度</h2><div class="fams">${dimCards}</div></section>

<section class="part"><h2>三、覆盖矩阵</h2><p class="hint">行 = 答案，列 = 维度。底行低于门槛的格子标红。</p><div class="tw">${matrix}</div></section>

<section class="part"><h2>四、场景签名</h2><p class="hint">每个场景由 3 个签名维度决定"要什么阵容"。点维度跳到对应卡片。</p><div class="tw">${scenes}</div></section>

<section class="part"><h2>五、五棵职业树的答案供给</h2><p class="hint">每格：最早出现该答案的军衔 + 全树带该标签的职业数（每树 191 个）。“—”表示本树没有。</p><div class="tw">${supply}</div></section>
</div>
<script>
// 关系图悬停高亮
const svg = document.querySelector('.graph svg');
const on = (g) => {
  const d = g.dataset.d, a = g.dataset.a;
  svg.classList.add('hl');
  svg.querySelectorAll('.e').forEach((e) => e.classList.toggle('on', d ? e.dataset.d === d : e.dataset.a === a));
  const hit = new Set([...svg.querySelectorAll('.e.on')].flatMap((e) => ['d:' + e.dataset.d, 'a:' + e.dataset.a]));
  svg.querySelectorAll('.n').forEach((n) => n.classList.toggle('on', n === g || hit.has(n.dataset.d ? 'd:' + n.dataset.d : 'a:' + n.dataset.a)));
};
const off = () => svg.classList.remove('hl');
svg.querySelectorAll('.n').forEach((g) => { g.addEventListener('mouseenter', () => on(g)); g.addEventListener('focus', () => on(g)); g.addEventListener('mouseleave', off); g.addEventListener('blur', off); });
</script>`);
