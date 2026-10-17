import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

// 评审页的存盘端点：页面 POST 原始 JSON，落到 tools/review/live/<key>.json，我直接读文件，
// 不用再等人复制粘贴。只活在 dev server 里，构建产物里没有这回事。
function reviewSink() {
  return {
    name: 'review-sink',
    configureServer(s) {
      s.middlewares.use('/__rev', (req, res) => {
        if (req.method !== 'POST') return res.writeHead(405).end();
        const key = decodeURIComponent(req.url).replace(/[^\w.-]/g, ''); // 白名单字符，顺带堵掉 ../
        if (!key) return res.writeHead(400).end();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            mkdirSync('tools/review/live', { recursive: true });
            writeFileSync(`tools/review/live/${key}.json`, body);
            console.log(`[review-sink] ${key}.json ← ${body.length}B`);
            res.writeHead(204).end();
          } catch (e) {
            console.error('[review-sink]', e.message);
            res.writeHead(500).end();
          }
        });
      });
    },
  };
}

// proto/m0 的测试台页面直接 import src/data/*.ts（C7-24：删掉手抄的数值副本）。
// root = 仓库根，这样页面里的 ../../src/data/x.ts 与 node_modules 里的 three 都能直接解析。
export default defineConfig({
  root: '.',
  plugins: [reviewSink()],
  server: { port: 5199, open: '/proto/m0/home.html' },
});
