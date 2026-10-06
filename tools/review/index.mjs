// 职业树首页：node index.mjs > docs/review/index.html（各树页面在 out/<key>.html）
const R = new URL('../../src/data/', import.meta.url).href;
const { CLASS_TREES, expandTree } = await import(R + 'classes.ts');
const { WEAPON_CLASS_NAME } = await import(R + 'weapons.ts');
const { existsSync, readFileSync } = await import('node:fs');
const ORDER = [['sw', '近战'], ['mg', '法术'], ['ar', '远程'], ['md', '辅助'], ['te', '科技']];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const trees = [];
for (const [k, role] of ORDER) {
  const t = Object.values(CLASS_TREES).find((x) => x.key === k) ?? (existsSync(`trees/${k}.ts`) ? (await import(`./trees/${k}.ts`)).TREE : null);
  const html = existsSync(new URL(`../../docs/review/${k}.html`, import.meta.url)) ? readFileSync(new URL(`../../docs/review/${k}.html`, import.meta.url), 'utf8') : '';
  trees.push({ k, role, t, cards: (html.match(/<article class="card/g) ?? []).length, draft: !CLASS_TREES[t?.id] });
}
const card = ({ k, role, t, cards, draft }) => !t ? `<article class="tc off"><h2>${k}</h2><p>未生成</p></article>` : `
<article class="tc">
  <header><span class="role">${role}</span><h2><a href="${k}.html">${esc(t.name)}</a></h2><span class="st ${draft ? 'd' : ''}">${draft ? '草案 · 待评审' : '样板 · 已入库'}</span></header>
  <p class="wp">基础武器 ${t.weapons.map((w) => WEAPON_CLASS_NAME[w]).join(' / ')} · ${expandTree(t).length} 个职业 · ${cards} 个评审单元</p>
  <ol class="dirs">${t.names.core.map((d, i) => `<li><b>${esc(d)}方向</b><span>${t.styles[i].map((a) => `${esc(a.title)}<i>${esc(a.family)}</i>`).join('')}</span></li>`).join('')}</ol>
  <footer><a class="go" href="${k}.html">打开评审表 →</a><span class="pg" data-k="${k}" data-n="${cards}"></span></footer>
</article>`;
console.log(`<title>职业树评审</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@700;900&display=swap">
<style>
:root{--bg:#f3f4f2;--paper:#fbfbf9;--ink:#1d2228;--ink2:#4a535d;--mute:#7b848d;--line:#d9dcd8;--acc:#8a5a1c;--acc-soft:#f1e6d4;--steel:#2f5470;--steel-soft:#e3ebf1}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#15181b;--paper:#1c2024;--ink:#e6e8e6;--ink2:#b3b9bf;--mute:#838b93;--line:#30363c;--acc:#d9a35c;--acc-soft:#332a1d;--steel:#8fb6d4;--steel-soft:#1f2b35}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#15181b;--paper:#1c2024;--ink:#e6e8e6;--ink2:#b3b9bf;--mute:#838b93;--line:#30363c;--acc:#d9a35c;--acc-soft:#332a1d;--steel:#8fb6d4;--steel-soft:#1f2b35}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1400px;margin:0 auto;padding-inline:20px;padding-block:32px 80px}
h1,h2{font-family:"Noto Serif SC","Songti SC",serif;margin:0;line-height:1.3;text-wrap:balance}h1{font-size:2.2rem;font-weight:900}
.eyebrow{font-size:.75rem;letter-spacing:.14em;color:var(--acc);font-weight:500}
.top{border-bottom:2px solid var(--ink);padding-bottom:20px;margin-bottom:24px}.lede{color:var(--ink2);max-width:72ch}
.chain{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:12px 0 0;font-size:.85rem}
.chain li{background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:2px 8px}.chain li i{font-style:normal;color:var(--mute);margin-right:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:20px}
.tc{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.tc.off{opacity:.5}.tc header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.tc h2 a{color:var(--ink);text-decoration:none}.tc h2 a:hover{color:var(--acc)}
.role{font-size:.72rem;background:var(--acc);color:var(--paper);padding:1px 8px;border-radius:3px;letter-spacing:.06em}
.st{margin-left:auto;font-size:.75rem;color:var(--steel)}.st.d{color:var(--acc)}
.wp{margin:0;font-size:.85rem;color:var(--ink2)}
.dirs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:.88rem}
.dirs li{display:grid;grid-template-columns:7.5em 1fr;gap:8px;border-top:1px solid var(--line);padding-top:6px}
.dirs span{display:flex;flex-wrap:wrap;gap:4px 14px}.dirs i{font-style:normal;color:var(--mute);font-size:.75rem;margin-left:4px}
footer{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:6px}
.go{color:var(--steel);font-weight:700;text-decoration:none}.pg{font-size:.8rem;color:var(--mute);font-variant-numeric:tabular-nums}
.dims{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin-bottom:20px;padding:12px 18px;background:var(--steel-soft);border:1px solid var(--steel);border-radius:6px;color:var(--steel);text-decoration:none}.dims b{font-family:"Noto Serif SC",serif;font-size:1.1rem}.dims span{font-size:.85rem}.dims:hover{background:var(--paper)}
</style>
<div class="wrap">
<header class="top"><div class="eyebrow">Gunfire Squad · 第三轮 P2 · 职业树评审</div><h1>五棵职业树</h1>
<p class="lede">每棵树 191 个职业，五树合计 955 个。剑士是样板，其余四棵是按同一格式出的草案，逐棵评审。各页填写内容只存在本浏览器，填完在该页点「复制全部反馈」粘回对话。</p>
<ol class="chain"><li><i>入门</i>基础</li><li><i>1 转</i>基础职业</li><li><i>2 转</i>基础职业方向</li><li><i>3 转</i>特色职业分线</li><li><i>4 转</i>职业流派</li><li><i>5 转</i>职业专精</li><li><i>6 转</i>英雄角色</li><li><i>五星</i>号令强化</li></ol></header>
<a class="dims" href="dims.html"><b>对抗维度设计图</b><span>13 个挑战维度 × 15 个答案标签 · 场景签名 · 各树答案供给 →</span></a>
<a class="dims" href="dims-v2.html"><b>对抗维度 v3 提案（待审核）</b><span>15 个维度 · 18 把钥匙 × 9 个替代答案 · 三系伤害与电磁场 · 18 种僵尸 · 场景签名 →</span></a>
<main class="grid">${trees.map(card).join('')}</main></div>
<script>
// 读各页的本地填写进度（各页 localStorage 键：sw-review-v1 / <key>-review-v1）
for (const el of document.querySelectorAll('.pg')) {
  let s = {}; try { s = JSON.parse(localStorage.getItem(el.dataset.k === 'sw' ? 'sw-review-v1' : el.dataset.k + '-review-v1') || '{}'); } catch {}
  const done = new Set(Object.entries(s).filter(([, v]) => String(v).trim()).map(([id]) => id.replace(/-(s\d|fb)$/, '')));
  el.textContent = '已填写 ' + done.size + ' / ' + el.dataset.n;
}
</script>`);
