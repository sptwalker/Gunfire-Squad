# 五棵树的职业色谱（docs/05 §2.4「配色」）：形象出模（voxel.py）和色谱图（palette.html）共用这一份。
#   python palette.py  → ../palette.html
# 坐标：t = 转数（0 基础 … 6 英雄，7 = 五星），u = 职业在本转里从左到右的位置（0–1，= 路径二进制 / 2^t 取中点）。
# 规则：低转低饱和（灰 → 灰调 → 暗色调），转数越高饱和度越高；色相从树根往两侧散开（spread 随转数变大），
# 靠左向 hl、靠右向 hr；亮度左暗右亮。装饰色按转：铜 → 银 → 金 → 亮金 → 五星亮彩（每个五星一个色相）。
import math, json, os

def oklch(L, C, h):
    """OKLCH → '#rrggbb'；出色域时降彩度（保色相、保亮度）。"""
    while True:
        a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
        l, m, s = [(L + p * a + q * b) ** 3 for p, q in ((0.3963377774, 0.2158037573), (-0.1055613458, -0.0638541728), (-0.0894841775, -1.2914855480))]
        rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
        if all(-1e-4 <= c <= 1 + 1e-4 for c in rgb) or C <= 0: break
        C = max(0, C - 0.004)
    enc = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return '#' + ''.join('%02x' % round(255 * min(1, max(0, enc(c)))) for c in rgb)

SPREAD = [0, 0, 0.2, 0.4, 0.6, 0.8, 1, 1]
CHROMA = [0.008, 0.03, 0.055, 0.075, 0.095, 0.115, 0.135]
# 主色：h 树根色相、hl / hr 最左 / 最右能偏到的色相（度，可越过 360）、L 每转亮度、cs 五星彩度；
# belt 皮革斜挎带（射手：皮甲材质，剑士没有）；cm 主色彩度倍率（射手 .25 = 近无彩的黑 / 炭灰）；trim 本树的装饰色阶（缺省 TRIM）
# 辅助色：sh 色相（None = 无彩：黑 / 白）、sl 相对主色的亮度差（或无彩时的绝对亮度）
TREES = {
    'swordsman': dict(name='剑士', main='蓝', sub='银白', h=248, hl=268, hr=225, L=[.62, .55, .42, .44, .47, .50, .53, .86], cs=.07, sh=None, sl=.88),
    'mage':      dict(name='法师', main='红', sub='橙', h=30, hl=12, hr=62, L=[.62, .55, .48, .50, .53, .56, .59, .84], cs=.09, sh=62, sl=+.06),
    'archer':    dict(name='射手', main='黑', sub='紫', h=325, hl=310, hr=345, L=[.32, .27, .22, .22, .22, .23, .24, .26], cs=.16, cm=.25, sh=325, sl=+.22, belt='#4a3222',
                     trim=['#5e4430', '#7a5636', '#6e7076', '#8e9198', '#8c6e2a', '#a8862c', '#c9a43a']),   # 古铜 / 暗银 / 黑金：比剑士暗一档
    'medic':     dict(name='辅助', main='绿', sub='白', h=150, hl=180, hr=122, L=[.70, .67, .64, .65, .67, .69, .71, .90], cs=.08, sh=None, sl=.93),
    'tech':      dict(name='技术', main='黄', sub='青', h=100, hl=72, hr=118, L=[.66, .63, .62, .66, .70, .74, .78, .90], cs=.10, sh=205, sl=-.08),
}
TRIM = ['#8a5a3a', '#b0703f', '#9aa0a8', '#c4cad2', '#b8902c', '#d8aa30', '#f4c838']   # 0–1 铜、2–3 银、4–5 金、6 亮金；五星见 pal()
TRIM_NAME = ['铜', '铜', '银', '银', '金', '金', '亮金', '亮彩']

def pal(tree, t, u):
    T = TREES[tree]; s = SPREAD[t]
    dh = (T['hl'] - T['h']) * (1 - 2 * u) if u < 0.5 else (T['hr'] - T['h']) * (2 * u - 1)
    h = T['h'] + s * dh
    L = T['L'][t] + (u - 0.5) * 0.10 * s
    Cs = T['cs'] if t == 7 else CHROMA[t]; C = Cs * T.get('cm', 1)
    main = oklch(L, C, h)
    if T['sh'] is None: sub = oklch(T['sl'], 0.012 + C * 0.1, h)
    else: sub = oklch(min(.95, max(.12, L + T['sl'])), Cs * 0.9, T['sh'] + s * dh * 0.5)
    return dict(main=main, sub=sub, pants=oklch(max(.12, L - .17), C * 0.5, h),
                trim=oklch(.84, .17, 360 * u + 20) if t == 7 else T.get('trim', TRIM)[t],
                glow=oklch(.80, .17, h), h=round(h % 360), belt=T.get('belt'))

ACC = [oklch(.80, .16, 15 + 45 * i) for i in range(8)]   # 英雄号令件（背旗 / 令羽）：同家族 8 个英雄各一色

def u_of(path): return (int(''.join(map(str, path)) or '0', 2) + 0.5) / 2 ** len(path)

assert pal('swordsman', 0, .5)['main'] == pal('swordsman', 0, .1)['main']            # 基础 / 1 转不散色相
# 剑士全在蓝区，射手主色近黑、辅色在紫红区：两树色相至少隔 35°，主色亮度至少差 .15
assert all(222 <= pal('swordsman', t, u)['h'] <= 270 for t in range(8) for u in (0, .5, 1))
assert all(305 <= pal('archer', t, u)['h'] <= 348 and pal('swordsman', t, u)['main'] != pal('archer', t, u)['main'] for t in range(8) for u in (0, .5, 1))
assert len({pal('archer', 6, (i + .5) / 64)['glow'] for i in range(64)}) > 40          # 英雄的亮色基本两两不同

if __name__ == '__main__':
    data = {k: dict(T, rows=[[pal(k, t, (i + .5) / 2 ** min(t, 6)) for i in range(2 ** min(t, 6))] for t in range(8)]) for k, T in TREES.items()}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'palette.html')
    html = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'palette.tpl.html'), encoding='utf-8').read()
    open(out, 'w', encoding='utf-8', newline='\n').write(html.replace('/*DATA*/null', json.dumps(data, ensure_ascii=False)).replace('/*TRIM*/null', json.dumps(TRIM_NAME, ensure_ascii=False)))
    print('ok', out)
