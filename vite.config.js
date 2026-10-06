import { defineConfig } from 'vite';

// proto/m0 的测试台页面直接 import src/data/*.ts（C7-24：删掉手抄的数值副本）。
// root = 仓库根，这样页面里的 ../../src/data/x.ts 与 node_modules 里的 three 都能直接解析。
export default defineConfig({
  root: '.',
  server: { port: 5199, open: '/proto/m0/home.html' },
});
