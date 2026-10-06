const KEY = TREE === 'sw' ? 'sw-review-v1' : TREE + '-review-v1';
const fields = [...document.querySelectorAll('select[id], textarea[data-k], input[data-k]')];
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
for (const f of fields) if (saved[f.id] != null) f.value = saved[f.id];

function refresh() {
  let n = 0;
  for (const c of CARDS) {
    const el = document.getElementById(c.id);
    const done = [...el.querySelectorAll('select,textarea,input')].some((f) => f.value.trim());
    el.classList.toggle('done', done);
    document.querySelector(`.side a[data-id="${c.id}"]`)?.classList.toggle('done', done);
    if (done) n++;
  }
  document.getElementById('prog').textContent = n;
  for (const i of document.querySelectorAll('input[data-t]'))
    document.querySelector(`.side a[data-id="${i.dataset.k}"]`)?.classList.toggle('done', !!i.value.trim());
  for (const s of document.querySelectorAll('select')) s.classList.toggle('set', !!s.value);
}

document.addEventListener('input', (e) => {
  if (!e.target.id) return;
  saved[e.target.id] = e.target.value;
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
  if (e.target.id.endsWith('-fb')) pend(e.target.dataset.k);
  refresh();
});

/**
 * 把卡上还没处理的新留言显示成一条"待处理"。
 * 它只是提示，不写进 hist.mjs——留言原本就在 localStorage 里，
 * 重生成页面后我会把它归并进 hist.mjs 成为正式的一轮记录。
 */
function pend(id) {
  const el = document.getElementById(id);
  const det = el?.querySelector('.hist');
  if (!det) return;
  det.querySelector('.pend')?.remove();
  const v = document.getElementById(`${id}-fb`)?.value.trim();
  if (!v) { det.hidden = !det.querySelector('li:not(.pend)'); return; }
  const li = document.createElement('li');
  li.className = 'pend';
  li.innerHTML = `<div class="hh"><span class="hn">待处理 · 第 ${(+det.querySelector('summary').textContent.match(/已改 (\d+) 次/)?.[1] || 0) + 1} 次</span></div>`;
  const p = document.createElement('p');
  p.className = 'hc';
  p.innerHTML = '<b>本次意见</b>';
  p.append(v);
  li.append(p);
  det.querySelector('ol').append(li);
  det.hidden = false;
  det.open = true;
}

function exportText() {
  const L = ['# ' + TN + '职业评审反馈', ''];
  for (const c of CARDS) {
    const sc = DIMS.map((d, i) => {
      const s = document.getElementById(`${c.id}-s${i}`);
      return s && s.value ? `${d} ${SELF[c.id][i]}→${s.value}` : null;
    }).filter(Boolean);
    const fb = document.getElementById(`${c.id}-fb`).value.trim();
    const rows = [...document.getElementById(c.id).querySelectorAll('input[data-t]')]
      .filter((i) => i.value.trim()).map((i) => `- ${i.dataset.t}（${i.dataset.k}）：${i.value.trim()}`);
    if (!sc.length && !fb && !rows.length) continue;
    L.push(`## ${c.title}（${c.id}）`);
    if (sc.length) L.push('评分（自评→设计师）：' + sc.join('，'));
    if (fb) L.push(fb);
    if (rows.length) L.push('单个职业：', ...rows);
    L.push('');
  }
  const ex = document.getElementById('extra-fb').value.trim();
  L.push('## 补充建议', ex || '（无）');
  return L.join('\n');
}

const out = document.getElementById('out');
const msg = document.getElementById('msg');
function show() { out.value = exportText(); out.hidden = false; out.focus(); out.select(); }
document.getElementById('show').addEventListener('click', show);
document.getElementById('copy').addEventListener('click', async () => {
  const txt = exportText();
  try { await navigator.clipboard.writeText(txt); msg.textContent = '已复制，粘贴回对话即可'; }
  catch { show(); msg.textContent = '浏览器不允许直接复制，已选中下方文本，请手动复制'; }
});
refresh();
// 已存在的新留言（上次会话留下的）也要显示成待处理
for (const c of CARDS) pend(c.id);

// 滚动时高亮树上当前卡片，并把它滚进侧栏可视区
const side = document.querySelector('.side');
let cur;
const io = new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    const a = side.querySelector(`a[data-id="${e.target.id}"]`);
    if (!a || a === cur) continue;
    cur?.classList.remove('cur'); a.classList.add('cur'); cur = a;
    const r = a.getBoundingClientRect(), s = side.getBoundingClientRect();
    if (r.top < s.top || r.bottom > s.bottom) side.scrollTop += r.top - s.top - s.height / 3;
  }
}, { rootMargin: '-30% 0px -60% 0px' });
document.querySelectorAll('.card, tr.t5, tr.t6').forEach((c) => io.observe(c));
