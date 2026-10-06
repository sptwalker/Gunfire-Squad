// 生成 V2 走廊测试关：线性道路 + 两侧建筑 + 多级收窄关口（沿僵尸进攻方向由宽到窄）。
// 关口宽度必须由地形掩码量出来——1 m 一格 + 挡人判定外扩 0.3，手算必错。
// 用法：node proto/m0/tools/level-corridor.mjs      （写 levels/v2-corridor.json，并自检）
import { writeFileSync } from 'node:fs';
import { buildMask, flowField, cellOf, unreachable } from '../gamedata.js';

const N = 64, HALF = N / 2;
const WALL_X = 7;                          // 两侧墙中线，走廊净宽 ≈ 12 格
const GATES = [                            // z 从北到南，缺口一格一格收窄
  { z: 22, x: 6.2 },
  { z: 13, x: 5.2 },
  { z: 4, x: 4.2 },
  { z: -5, x: 3.2 },
];
const START = [0, -14];
const SPAWN = { x: 0, z: 27, r: 2.5 };

const props = [];
const r2 = (v) => Math.round(v * 100) / 100;
const put = (id, x, z, ry = 0) => props.push([id, r2(x), r2(z), r2(ry)]);

// 1 两侧建筑墙：partition（4 m 一段）沿 z 密排，两端压进地图边界 → 走廊侧向全封
for (let z = 29.5; z >= -30.5; z -= 4) {
  put('partition', WALL_X, z, Math.PI / 2);
  put('partition', -WALL_X, z, Math.PI / 2);
}
// 2 关口：每道 3 段木墙叠成约 4 m 厚的墙，中央留缺口
for (const g of GATES) for (const dz of [-1.2, 0, 1.2]) {
  put('woodwall', g.x, g.z + dz, 0);
  put('woodwall', -g.x, g.z + dz, 0);
}
// 3 两侧建筑（走廊外面，纯观感）：交替 ruin / shop
for (let i = 0; i < 8; i++) {
  const z = 26 - i * 7, id = i % 2 ? 'shop' : 'ruin';
  put(id, 9.6, z, 0);
  put(id, -9.6, z, 0);
}
// 4 走廊内的掩体与杂物（贴着墙放，不额外收窄通道）
for (const [id, x, z, ry] of [
  ['car', 5.6, 18.5, 0.3], ['car', -5.6, 9, 1.9], ['rubble', 5.8, 0.5, 2.1],
  ['car', -5.6, -9.5, 0.8], ['sandbag', 6.2, 25.5, Math.PI / 2], ['sandbag', -6.2, 16.5, Math.PI / 2],
  ['sandbag', 6.2, 7.5, Math.PI / 2], ['sandbag', -6.2, -1.5, Math.PI / 2],
  ['barrel', -6.4, 27.5, 0], ['barrel', 6.4, 13.5, 0], ['crate', -6.4, 4.5, 0], ['crate', 6.4, -5.5, 0],
  ['barrel', 6.4, -20, 0], ['barrel', -6.4, -22, 0], ['crate', 6.4, -26, 0], ['rubble', -6.2, -18, 0],
]) put(id, x, z, ry);

// 5 道路地块：走廊正下方一条
const tiles = new Uint8Array(N * N);
for (let j = 1; j <= 62; j++) for (let i = 25; i <= 38; i++) tiles[j * N + i] = 1;

const lv = {
  name: '城市废墟 · 卡口走廊 V2',
  scene: 'city', size: N, seed: 2,
  tiles: Array.from(tiles).join(''),
  props,
  spawns: [SPAWN],
  start: START,
  squad: ['ron', 'vera', 'ella', 'bom', 'sif'],
  cap: 120, threatMul: 1,
  stages: [
    { name: '接触', r0: 3, r1: 4, mix: { normal: 75, runner: 25 }, burst: null, dur: 300 },
    { name: '压制', r0: 4.5, r1: 6, mix: { normal: 45, runner: 18, toxic: 14, splitter: 12, bomber: 11 }, burst: { bomber: 3, splitter: 3 }, dur: 300 },
    { name: '狂潮', r0: 4.2, r1: 4.8, mix: { normal: 32, runner: 16, brute: 14, toxic: 12, splitter: 10, bomber: 9, leaper: 7 }, burst: { brute: 3 }, dur: 300 },
  ],
};

// ── 自检 ────────────────────────────────────────────────────────────────
const m = buildMask(lv);
const runAt = (j) => {                       // 该行里包含通道中心的那一段可走格
  let s = -1, best = null;
  for (let i = 0; i <= N; i++) {
    const free = i < N && !m.mv[j * N + i];
    if (free && s < 0) s = i;
    if (!free && s >= 0) { if (s <= 32 && i - 1 >= 31) best = [s, i - 1]; s = -1; }
  }
  return best ? best[1] - best[0] + 1 : 0;
};
const widthAtZ = (z) => Math.min(...[...Array(5)].map((_, k) => runAt(Math.floor(z + HALF) - 2 + k)));
const got = GATES.map((g) => widthAtZ(g.z));
const want = [10, 8, 6, 4];
console.log('关口净宽（格）：', got.join(' / '), ' 目标：', want.join(' / '));

let min = 99, minZ = 0;                      // 关口之外不许出现更窄的意外卡点
for (let j = 0; j < N; j++) { const w = runAt(j); if (w && w < min) { min = w; minZ = j - HALF + 0.5; } }
console.log('走廊最窄处：', min, '格 @ z =', minZ);

const bad = unreachable(lv);
const f = flowField(m, [START]);
const d = f.dist[cellOf(m, SPAWN.x, SPAWN.z)];   // 刷怪点 → 出生点的格步数
console.log('刷怪点可达：', bad.length === 0, ' 单程格步：', d, `(${(d * 0.5).toFixed(1)} m)`);

writeFileSync(new URL('../levels/v2-corridor.json', import.meta.url), JSON.stringify(lv));
console.assert(got.every((w, i) => w === want[i]), '关口宽度不符', got);
console.assert(min === Math.min(...got), '关口之外的卡点更窄', min, minZ);
console.assert(bad.length === 0 && f.dist[cellOf(m, SPAWN.x, SPAWN.z)] >= 0, '刷怪点走不到出生点');
