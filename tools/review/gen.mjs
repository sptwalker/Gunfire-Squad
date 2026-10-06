// 职业评审表生成器：node gen.mjs <树 key：sw/mg/ar/md/te> > docs/review/<key>.html
// 技能 / 属性 / 武器从 classes.ts 读；设计思路与自评写在 N 里。
const R = new URL('../../src/data/', import.meta.url).href;
const { CLASS_TREES, expandTree } = await import(R + 'classes.ts');
const { RANKS, ADVANCE_RANKS } = await import(R + 'progression.ts');
const { WEAPON_CLASS_NAME } = await import(R + 'weapons.ts');
const { PRIMARY_KEYS, PRIMARY_LABEL } = await import(R + 'attributes.ts');
const K = process.argv[2] ?? 'sw';
const { N, LATE, LINE, EXAMPLE } = await import('./notes/' + K + '.mjs');
const { HIST } = await import('./hist.mjs');
// 未进仓库的树草案放在 trees/<key>.ts
const t = Object.values(CLASS_TREES).find((x) => x.key === K) ?? (await import('./trees/' + K + '.ts')).TREE;
const CLASS_BY_ID = Object.fromEntries(expandTree(t).map((c) => [c.id, c]));
const TN = t.name;

const { ANSWERS } = await import(R + 'scenes.ts');
const TAG = Object.fromEntries(ANSWERS.map((a) => [a.tag, a.name]));
const DIMS = ['核心能力', '团队能力', '体验独特性', '成长连贯性'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rk = (lv) => RANKS[lv - 1].code;
const tags = (g) => g.map((x) => `<span class="tag">${TAG[x]}</span>`).join('');
const skill = (lab, [n, x, g, l]) => `<li><span class="slot">${lab}</span><b>${esc(n)}</b><span class="sx">${esc(x)}</span>${tags(g)}${l ? `<span class="lk"><b>协同</b>${esc(l)}</span>` : ''}</li>`;
const attrs = (c) => PRIMARY_KEYS.map((k) => `<span><i>${PRIMARY_LABEL[k]}</i>${c.primary[k]}</span>`).join('');

const cards = [];
const SELF = Object.fromEntries(Object.entries(N).map(([k, v]) => [k, v[0]]));
function card(id, { kind, title, sub, meta = '', skills, extra = '', n, dl: dlx }) {
  const [sc, core, team, exp, risk] = n ? [n[0], n[1], null, null, n[2]] : N[id];
  SELF[id] = sc;
  cards.push({ id, title, kind });
  const rows = DIMS.map((d, i) => sc[i] ? `<tr><th>${d}</th><td><span class="pips" style="--v:${sc[i]}">${'<i></i>'.repeat(5)}</span><b>${sc[i]}</b></td>` +
    `<td><select id="${id}-s${i}" data-k="${id}" data-d="${d}" aria-label="${title} ${d} 设计师评分"><option value="">—</option>${[1, 2, 3, 4, 5].map((v) => `<option>${v}</option>`).join('')}</select></td></tr>` : '').join('');
  const dl = dlx ?? (n ? `<dt>设计思路</dt><dd>${esc(core)}</dd>${risk ? `<dt class="warn">风险与自查</dt><dd>${esc(risk)}</dd>` : ''}`
    : `<dt>核心能力</dt><dd>${esc(core)}</dd><dt>团队能力</dt><dd>${esc(team)}</dd><dt>体验设计</dt><dd>${esc(exp)}</dd><dt class="warn">风险与自查</dt><dd>${esc(risk)}</dd>`);
  return `<article class="card ${kind}" id="${id}" data-title="${esc(title)}">
  <header><div><span class="kind">${kind === 'late' ? '专精 → 英雄 → 五星 · 按流派分 4 + 4 + 8' : kind === 'struct' ? '结构' : sub}</span><h3>${esc(title)}</h3></div><div class="meta">${meta}</div></header>
  <div class="body">
    <div class="desc">
      <dl>${dl}</dl>
      ${skills ? `<ul class="skills">${skills}</ul>` : ''}${extra}
    </div>
    <div class="review">
      <table><thead><tr><th>维度</th><th>自评</th><th>设计师</th></tr></thead><tbody>${rows}</tbody></table>
      <label for="${id}-fb">反馈与调整建议</label>
      <textarea id="${id}-fb" data-k="${id}" rows="4" placeholder="例如：保留 / 改名 / 换机制 / 强度太高……"></textarea>
      ${hist(id)}
    </div>
  </div>
</article>`;
}

/**
 * 修改历史面板。轮次来自 hist.mjs（我按意见改完写进去的），
 * 用户在页面上的新留言由 app.js 追加成"待处理"条目——不落盘，交回对话后归并进 hist.mjs。
 */
function hist(id) {
  const n = (HIST[id] ?? []).length;
  const rows = (HIST[id] ?? []).map((r) => `<li>
    <div class="hh"><span class="hn">第 ${r.n} 次修改</span><time>${esc(r.t)}</time>
      <span class="hs">已改：${r.fb.match(/→\s*「([^」]+)」/)?.[1] ?? '见反馈'}</span></div>
    <p class="hc"><b>设计师意见</b>${esc(r.c)}</p>
    <p class="hf"><b>修改反馈</b>${esc(r.fb)}</p>
  </li>`).join('');
  // 没有历史的卡也留一个隐藏容器：app.js 才能把该卡上的新留言挂成"待处理"。
  return `<details class="hist"${rows ? ' open' : ' hidden'}><summary>修改历史 · 已改 ${n} 次</summary><ol>${rows}</ol></details>`;
}

const meta = (c) => `<code>${c.id}</code><span class="rk">${rk(c.rank)}</span><span class="wp">${c.weaponClasses.map((w) => WEAPON_CLASS_NAME[w]).join(' · ')}</span><span class="at">${attrs(c)}</span>`;
const slotsOf = (c) => c.slots.map((s) => skill(s.slot + s.level, [s.name, s.text, s.tags, s.link])).join('');

const nm = (id) => CLASS_BY_ID[id].name;
const spc = (id) => nm(id).slice(0, 2) + '专精'; // ponytail: 第 5 转职业名前两字即专精名，改名不合此规则时再加映射
const sections = [];
// 早期
{
  const ids = [K, ...['0', '1', '00', '01', '10', '11'].map((p) => K + '-' + p)];
  const sub = ['入门', '第 1 转 · 基础职业', '第 1 转 · 基础职业', '第 2 转 · 基础职业方向', '第 2 转 · 基础职业方向', '第 2 转 · 基础职业方向', '第 2 转 · 基础职业方向'];
  sections.push(`<section id="early"><h2>前期：基础职业与基础职业方向</h2><p class="lede">E-1 到 E-9。第 1 转选基础职业（${t.axes[0].sides.map((s) => s.name).join(" / ")}），第 2 转选基础职业方向（${t.axes[1].sides.map((s) => s.name).join(" / ")}），全树共用，各开 A 槽自身技。</p>` +
    ids.map((id, i) => { const c = CLASS_BY_ID[id]; return card(id, { kind: 'early', title: c.name, sub: sub[i], meta: meta(c), skills: slotsOf(c) || '<li class="none">无技能，仅平砍</li>' }); }).join('') + '</section>');
}
// 特色职业分线
const SN = t.names.core;
t.styles.forEach((pair, i) => {
  const a1 = i >> 1, a2 = i & 1;
  let h = `<section id="st${i}"><h2>${SN[i]}方向的两条特色职业分线</h2>`;
  pair.forEach((a, j) => {
    const pid = `${K}-${a1}${a2}${j}`;
    const c = CLASS_BY_ID[pid];
    h += `<div class="school"><div class="school-h"><span class="fam">${a.family}</span><h2 class="sh">${a.title}</h2><p>${esc(a.note)}</p></div>`;
    const L = LINE[pid];
    const route = a.variants.map((v, k) => { const b = pid + k;
      return `<li><b>${esc(L.sub[k][0])}</b>：${esc(v.title)} → ${[0, 1].map((a5) => esc(nm(b + a5))).join(' / ')} → ${[0, 1].flatMap((a5) => [0, 1].map((a6) => esc(nm(b + a5 + a6)))).join(' / ')} → ${[0, 1].flatMap((a5) => [0, 1].map((a6) => '★' + esc(nm(b + a5 + a6 + '+').split('·')[0]))).join(' / ')}</li>`; }).join('');
    const lineDl = `<dt>分线本体</dt><dd>${esc(N[pid][1])}</dd><dt>分线定位</dt><dd>${esc(L.pos)}</dd><dt>核心规则</dt><dd>${esc(L.rule)}</dd>` +
      `<dt>成长路径</dt><dd>${esc(L.grow)}<ul class="route">${route}</ul></dd>` +
      L.sub.map(([sn, sx]) => `<dt>${esc(sn)}</dt><dd>${esc(sx)}</dd>`).join('') +
      `<dt>团队角色</dt><dd>${esc(L.team)}</dd><dt>体验目标</dt><dd>${esc(L.exp)}</dd><dt>边界</dt><dd>${esc(L.edge)}</dd>` +
      `<dt class="warn">风险与自查</dt><dd>${esc(N[pid][4])}</dd><dt class="ask">待你拍板</dt><dd><ol class="ask">${L.ask.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></dd>`;
    h += card(pid, { kind: 'school line', title: `${L.name} · ${c.name}`, sub: `第 3 转 · 特色职业分线 · ${a.family}`, meta: meta(c), skills: skill('B1', a.skill), dl: lineDl });
    a.variants.forEach((v, k) => {
      const vc = CLASS_BY_ID[pid + k];
      const school = L.sub[k][0];
      h += card(pid + k, { kind: 'variant', title: `${school} · ${vc.name}`, sub: '第 4 转 · 职业流派', meta: meta(vc), skills: skill('B2', v.skill) });
      // 第 5 转职业专精（流派 × 光环）→ 第 6 转英雄角色（专精 × 号令）→ 五星
      [0, 1].forEach((a5) => {
        const c5 = CLASS_BY_ID[pid + k + a5], [s5, x5, r5] = LATE[pid].C[k][a5];
        const spec = spc(c5.id);
        h += card(c5.id, { kind: 't5', title: `${spec} · ${c5.name}`, sub: `第 5 转 · 职业专精 · ${school} + ${a.aura[k * 2 + a5][0]}光环`, meta: meta(c5), skills: slotsOf(c5),
          n: [s5, `${school}学${spec}，选${t.axes[2].sides[a5].name}光环「${a.aura[k * 2 + a5][0]}」。${x5}`, r5] });
        [0, 1].forEach((a6) => {
          const c6 = CLASS_BY_ID[c5.id + a6], u = CLASS_BY_ID[c6.id + '+'], [s6, x6, r6] = LATE[pid].D[k][a6];
          h += card(c6.id, { kind: 't6', title: c6.name, sub: `第 6 转 · 英雄角色 · ${spec} + ${a.order[k * 2 + a6][0]} → 五星 ${u.name}`, meta: meta(c6),
            skills: slotsOf(c6) + skill('★五星', [u.slots[3].name, u.slots[3].text, u.slots[3].tags]),
            n: [s6, `成长路线：基础职业选${nm(pid.slice(0, 4))}，练${nm(pid.slice(0, 5))}方向，${L.name}转${school}，学${spec}，最后出${c6.name.split('·')[1]}。${spec}出英雄后选${t.axes[3].sides[a6].name}号令「${a.order[k * 2 + a6][0]}」，身上保留「${a.aura[k * 2 + a5][0]}」光环。${x6}五星升为「${u.name}」，特性「${u.slots[3].name}」是在「${a.order[k * 2 + a6][0]}」上的单独强化。`, r6] });
        });
      });
    });
    h += card(pid + '-late', {
      kind: 'late', title: `${L.name} 后段总评`, meta: `<span class="rk">${rk(ADVANCE_RANKS[4])} → ${rk(ADVANCE_RANKS[6])}</span>`,
      // C 按 [流派][光环] 4 条，D 按 [流派][号令] 4 条，五星按 [流派][光环][号令] 8 条 —— 见 §C7-25 修订。
      skills: a.aura.map((s, i) => skill(`C·${L.sub[i >> 1][0].replace(/流$/, '')}·${t.axes[2].sides[i & 1].name}`, s)).join('') +
        a.order.map((s, i) => skill(`D·${L.sub[i >> 1][0].replace(/流$/, '')}·${t.axes[3].sides[i & 1].name}`, s)).join('') +
        a.ultimates.map((u, i) => skill('★' + a.heroes[i].split('|')[1], u)).join(''),
    });
    h += '</div>';
  });
  sections.push(h + '</section>');
});
sections.push(`<section id="struct"><h2>整体结构</h2>` + card('structure', { kind: 'struct', title: '转职与技能槽结构' }) + '</section>');

// 左侧职业树：入门 → 基础职业 → 基础职业方向 → 特色职业分线 → 职业流派 → 职业专精 → 英雄角色
const leaf = (id, label, sub = '', kids = '') => `<li><a href="#${id}" data-id="${id}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</a>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
const ult = (id) => '★' + nm(id + '+').split('·')[0];
const sub3 = (id) => { const p = id.slice(3); const a = t.styles[+p[0] * 2 + +p[1]][+p[2]]; return leaf(id, LINE[id].name, a.family,
  [0, 1].map((k) => leaf(id + k, LINE[id].sub[k][0], nm(id + k),
    [0, 1].map((a5) => { const i5 = id + k + a5; return leaf(i5, spc(i5), a.aura[k * 2 + a5][0],
      [0, 1].map((a6) => leaf(i5 + a6, nm(i5 + a6), ult(i5 + a6))).join('')); }).join(''))).join('') +
  leaf(id + '-late', '后段总评', '按流派分 4+4+8')); };
const sub2 = (id) => leaf(id, nm(id) + '方向', rk(CLASS_BY_ID[id].rank), sub3(id + '0') + sub3(id + '1'));
const sub1 = (id) => leaf(id, nm(id), rk(CLASS_BY_ID[id].rank), sub2(id + '0') + sub2(id + '1'));
const nav = `<a class="home side-home" href="index.html">← 返回职业树首页</a><div class="tree-h">职业树<span>点击定位</span></div><ul class="tree">${leaf(K, nm(K), 'E-1', sub1(K + '-0') + sub1(K + '-1'))}</ul>` +
  `<div class="extra-links"><a href="#structure" data-id="structure">整体结构</a><a href="#extra">补充建议</a></div>`;

const css = await (await import('node:fs/promises')).readFile(new URL('./style.css', import.meta.url), 'utf8');
const js = await (await import('node:fs/promises')).readFile(new URL('./app.js', import.meta.url), 'utf8');
console.log(`<title>${TN}职业评审表</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@700;900&family=JetBrains+Mono:wght@500&display=swap">
<style>${css}</style>
<div class="wrap">
<header class="top">
  <div class="eyebrow">Gunfire Squad · 第三轮 P2 · ${TN}树</div>
  <a class="home" href="index.html">← 返回职业树首页</a><h1>${TN}职业评审表</h1>
  <p class="lede">共 ${cards.length} 个评审单元。成长术语：第 1 转基础职业 → 第 2 转基础职业方向 → 第 3 转特色职业分线 → 第 4 转职业流派 → 第 5 转职业专精 → 第 6 转英雄角色 → 五星。例：${EXAMPLE}。每格左侧是我的设计说明与自评（1–5），右侧留给你打分和写调整建议。填写内容自动保存在本浏览器；全部填完后点「复制全部反馈」，粘贴回对话即可。</p>
  <div class="legend"><span><b>核心能力</b> 自身机制是否清楚、够强</span><span><b>团队能力</b> 对队友的贡献</span><span><b>体验独特性</b> 玩起来和别的职业差多少</span><span><b>成长连贯性</b> 和前后转职是否接得上</span></div>
</header>
<div class="layout">
<nav class="side" aria-label="章节">${nav}<div class="prog"><span id="prog">0</span> / ${cards.length} 已填写</div></nav>
<main>
${sections.join('\n')}
<section id="extra"><h2>补充建议</h2><p class="lede">不针对单个职业的意见：结构、命名、和其他四棵树的分工、想新增或删掉的机制等。</p>
<textarea id="extra-fb" data-k="extra" rows="10" placeholder="补充建议……"></textarea>
<div class="actions"><button id="copy" type="button">复制全部反馈</button><button id="show" type="button" class="ghost">显示导出文本</button><span id="msg" role="status"></span></div>
<textarea id="out" rows="12" readonly hidden aria-label="导出文本"></textarea>
</section>
</main></div></div>
<script>const TREE=${JSON.stringify(K)},TN=${JSON.stringify(TN)};const CARDS=${JSON.stringify(cards.map(({ id, title }) => ({ id, title })))};const DIMS=${JSON.stringify(DIMS)};const SELF=${JSON.stringify(SELF)};
${js}</script>`);
