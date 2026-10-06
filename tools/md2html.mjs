// 策划文档 Markdown → HTML。
// 一次性迁移：node tools/md2html.mjs docs/00-决策清单.md …  → 同名 .html（之后 HTML 就是真源，直接改 HTML）。
// class-doc.ts 也 import 这里的 page()，把生成的职业树渲成 HTML。
import { marked } from 'marked';
import { readFileSync, writeFileSync } from 'node:fs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.replace(/<[^>]+>/g, '').trim().toLowerCase().replace(/[\s·、，,。：:（）()「」"'`/]+/g, '-').replace(/^-|-$/g, '');

/** md 文本 → 完整 HTML 页面。title 取第一个 # 标题。 */
export function page(md, { back = 'index.html' } = {}) {
  const toc = [];
  const used = new Map();
  const r = new marked.Renderer();
  // 正文里出现的 <subject> 之类是占位符不是标签，统一转义；只放行 <br>。
  r.html = ({ text }) => text.replace(/<br\s*\/?>/gi, '\u0000').split('\u0000').map(esc).join('<br>');
  r.heading = function ({ tokens, depth }) {
    const html = this.parser.parseInline(tokens);
    let id = slug(html) || 'h';
    const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) id += '-' + n;
    if (depth === 2 || depth === 3) toc.push({ depth, id, html: html.replace(/<a [^>]*>|<\/a>/g, '') });
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}">#</a>${html}</h${depth}>\n`;
  };
  r.table = function (t) { return `<div class="tbl">${marked.Renderer.prototype.table.call(this, t)}</div>\n`; };
  // 文档之间的 .md 链接改指向 .html
  r.link = function (t) { t.href = t.href.replace(/\.md(#|$)/, '.html$1'); return marked.Renderer.prototype.link.call(this, t); };
  const body = marked.parse(md.replace(/\r/g, '').replace(/(\d\d-[^\s`）)]+)\.md/g, '$1.html'), { renderer: r, gfm: true });
  const title = (md.match(/^# (.+)$/m)?.[1] ?? 'Gunfire Squad').replace(/[`*]/g, '');
  const nav = toc.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${h.html}</a></li>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="doc.css">
</head>
<body>
<div class="layout">
<nav class="toc" aria-label="目录"><a class="home" href="${back}">← 策划文档首页</a><ol>${nav}</ol></nav>
<main class="doc">
${body}</main>
</div>
</body>
</html>
`;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  for (const f of process.argv.slice(2)) {
    writeFileSync(f.replace(/\.md$/, '.html'), page(readFileSync(f, 'utf8')));
    console.log('→', f.replace(/\.md$/, '.html'));
  }
}
