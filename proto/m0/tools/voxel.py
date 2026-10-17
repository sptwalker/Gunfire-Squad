# M0 Q版体素角色：部件拼装 + 刚体绑骨（替代 rig.py 的"Rodin 高精网格 + 权重投射"）。
#
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> [角色 id ...]
#   → out_dir/vox_<角色>.glb（12 名，缺省全做）  out_dir/vox_<武器>.glb（12 名用到的 11 把）
#
# 思路：
#   1. 骨架仍用 Xbot（Mixamo 骨架 + idle/run/walk）。编辑模式下只挪骨骼头的位置到 Q 版比例、
#      不改任何骨骼的朝向——局部旋转关键帧因此原样可用，不需要重定向；臀部位移按身高比例缩
#   2. 每个部件是一组体素格子（格子 = 5 cm），整块 100% 绑一根骨：没有权重混合，就没有拉丝和粘连
#   3. 颜色是逐面顶点色，没有贴图
#   4. 武器同样由格子拼（2 cm），朝向约定同 weapon.py：原点 = 握把，枪口 / 刃尖朝 Blender -Y、顶朝 +Z
#   5. 角色之间的差别全在 CHARS 表里（05 §2.1：主色 + 轮廓件），骨架与动作 12 人共用
import bpy, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Vector
import poses

args = sys.argv[sys.argv.index("--") + 1:]
donor_path, out_dir, only = args[0], args[1], set(args[2:])

# ── 体素 → 网格：同一部件内相邻格子之间的面剔掉，部件之间不剔（关节一弯就露洞）──
def voxmesh(name, parts, v, off=Vector(), shrink={}, mats={}):
    """parts = {顶点组名: {(i, j, k): '#rrggbb'}}；格子 (i,j,k) 占 [i, i+1)·v。
    组名可带 '|后缀'：同一根骨、但与同骨其他格子互不剔面（半透明壳里的内容物要用）。
    shrink = {顶点组名: (支点格坐标, 比例)}：整组绕支点等比缩放（头部用）。
    mats = {'#rrggbb': 后缀}：这些颜色的面用单独材质 <name>_<后缀>（glow 自发光 / glass 半透明，运行时按名字认）。"""
    verts, idx, faces, cols, fg, fm = [], {}, [], [], [], []
    for g, cells in parts.items():
        # 贪心合面：同一平面、同色的相邻外露面拼成一个大矩形（300 只同屏时三角面是 GPU 大头）
        planes = {}
        for c, hexc in cells.items():
            for a in range(3):
                u, w = (a + 1) % 3, (a + 2) % 3
                for s in (1, -1):
                    n = list(c); n[a] += s
                    if tuple(n) in cells: continue
                    planes.setdefault((a, s, c[a] + (s > 0)), {})[(c[u], c[w])] = hexc
        for (a, s, lay), grid in planes.items():
            u, w = (a + 1) % 3, (a + 2) % 3
            for i0, j0 in sorted(grid):
                hexc = grid.get((i0, j0))
                if hexc is None: continue
                du = 1
                while grid.get((i0 + du, j0)) == hexc: du += 1
                dw = 1
                while all(grid.get((i0 + t, j0 + dw)) == hexc for t in range(du)): dw += 1
                for t in range(du):
                    for r in range(dw): del grid[(i0 + t, j0 + r)]
                quad = [(0, 0), (du, 0), (du, dw), (0, dw)]
                if s < 0: quad.reverse()
                f = []
                for qu, qw in quad:
                    p = [0, 0, 0]; p[a] = lay; p[u] = i0 + qu; p[w] = j0 + qw
                    key = (g, tuple(p))
                    if key not in idx:
                        q = Vector(p)
                        if g in shrink: q = shrink[g][0] + (q - shrink[g][0]) * shrink[g][1]
                        idx[key] = len(verts); verts.append((q + off) * v); fg.append(g.split('|')[0])
                    f.append(idx[key])
                faces.append(f); cols.append(hexc); fm.append(mats.get(hexc))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly, hexc in zip(me.polygons, cols):
        rgb = tuple(int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
        for li in poly.loop_indices: ca.data[li].color_srgb = (*rgb, 1)
    slots = [None] + sorted({m for m in fm if m})
    for sfx in slots:
        mat = bpy.data.materials.new(name + ('_' + sfx if sfx else '')); mat.use_nodes = True
        nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
        nt.links.new(nt.nodes.new('ShaderNodeVertexColor').outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 1
        me.materials.append(mat)
    for poly, m in zip(me.polygons, fm): poly.material_index = slots.index(m)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    groups = {}
    for i, g in enumerate(fg): groups.setdefault(g, []).append(i)
    for g, ids in groups.items(): ob.vertex_groups.new(name=g).add(ids, 1, 'REPLACE')
    return ob

def box(cells, x, y, z, col):
    """x/y/z = (起, 止) 闭区间格子号。"""
    for i in range(x[0], x[1] + 1):
        for j in range(y[0], y[1] + 1):
            for k in range(z[0], z[1] + 1): cells[(i, j, k)] = col

mx = lambda r: (-1 - r[1], -1 - r[0])   # 格子号的左右镜像：i ↔ -1-i

def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode='ACTIONS', export_skins=True)

# ── 武器（2 cm 格子，格子 0 以原点为中心）──
GUN, BLK, STEEL, EDGE, GOLD, BROWN = '#2c3034', '#151515', '#b9c3ca', '#eef3f6', '#c49a3c', '#4a2e1a'
def w_sniper(c):
    WOOD, LENS = '#56663a', '#4a86c8'
    box(c, (-1, 1), (-8, 3), (0, 2), GUN)       # 机匣
    box(c, (-1, 1), (0, 1), (-4, -1), GUN)      # 握把（在手里）
    box(c, (-1, 1), (-4, -2), (-3, -1), BLK)    # 弹匣
    box(c, (-1, 1), (4, 9), (-2, 2), WOOD)      # 枪托
    box(c, (-1, 1), (10, 10), (-2, 2), BLK)     # 托底板
    box(c, (-1, 1), (-17, -9), (0, 1), WOOD)    # 护木（左手托这里，见 HANDGUARD）
    box(c, (0, 0), (-22, -9), (2, 2), GUN)      # 枪管
    box(c, (-1, 1), (-24, -23), (1, 3), BLK)    # 制退器
    box(c, (0, 0), (-6, 2), (4, 5), BLK)        # 瞄准镜
    box(c, (0, 0), (-4, -4), (3, 3), BLK); box(c, (0, 0), (0, 0), (3, 3), BLK)
    box(c, (0, 0), (-7, -7), (4, 5), LENS)
def w_sword(c):
    box(c, (0, 0), (-1, 3), (0, 0), BROWN)      # 握柄
    box(c, (-1, 1), (4, 5), (-1, 1), GOLD)      # 柄头
    box(c, (-4, 4), (-3, -2), (-1, 1), GOLD)    # 护手
    box(c, (-1, 1), (-26, -4), (0, 0), STEEL)   # 刃
    box(c, (-1, -1), (-26, -4), (0, 0), EDGE); box(c, (1, 1), (-26, -4), (0, 0), EDGE)
    box(c, (0, 0), (-27, -27), (0, 0), EDGE)
def w_greatsword(c):
    box(c, (-1, 0), (-1, 6), (-1, 0), BROWN)    # 双手长柄
    box(c, (-2, 1), (7, 8), (-2, 1), '#5a5f66')
    box(c, (-6, 5), (-4, -2), (-2, 1), '#5a5f66')   # 护手
    box(c, (-3, 2), (-36, -5), (-1, 0), '#9aa3aa')  # 宽刃
    box(c, (-4, -4), (-34, -5), (-1, 0), EDGE); box(c, (3, 3), (-34, -5), (-1, 0), EDGE)
    box(c, (-2, 1), (-38, -37), (-1, 0), EDGE)
    box(c, (-1, 0), (-30, -8), (1, 1), '#6d767d')  # 血槽
def w_spear(c):
    box(c, (0, 0), (-38, 22), (0, 0), '#6b4a2a')  # 杆（握在前 1/3）
    box(c, (-1, 1), (-40, -39), (-1, 1), GOLD)
    box(c, (-2, 2), (-46, -41), (0, 0), STEEL); box(c, (-1, 1), (-50, -47), (0, 0), STEEL)
    box(c, (0, 0), (-52, -51), (0, 0), EDGE)
    box(c, (-1, 1), (-41, -41), (1, 2), '#b83a2e')  # 红缨
    box(c, (0, 0), (23, 24), (0, 0), GOLD)
def w_pistol(c):
    box(c, (-1, 0), (-7, 2), (0, 2), GUN)
    box(c, (-1, 0), (0, 2), (-4, -1), BLK)
    box(c, (-1, 0), (-8, -8), (1, 1), BLK)
    box(c, (-1, 0), (-2, -1), (-1, -1), BLK)      # 扳机护圈
def w_smg(c):
    Y = '#e0b820'
    box(c, (-1, 1), (-11, 3), (0, 2), GUN)
    box(c, (-1, 1), (0, 1), (-4, -1), BLK)
    box(c, (-1, 0), (-6, -5), (-7, -1), BLK)      # 长弹匣
    box(c, (0, 0), (-15, -12), (1, 1), BLK)       # 枪管
    box(c, (-1, 1), (4, 7), (1, 1), BLK)          # 折叠托
    box(c, (-1, 1), (-9, -8), (3, 3), Y)          # 黄色警示条
def w_sprayer(c, tank, glow):
    box(c, (-1, 1), (-10, 3), (0, 2), GUN)
    box(c, (-1, 1), (0, 1), (-4, -1), BLK)
    box(c, (-2, 2), (-8, -2), (-5, -1), tank)     # 罐
    box(c, (-2, 2), (-8, -8), (-5, -1), BLK); box(c, (-2, 2), (-2, -2), (-5, -1), BLK)
    box(c, (-1, 1), (-17, -11), (0, 2), '#555b60')  # 喷管
    box(c, (-2, 2), (-19, -18), (-1, 3), BLK)
    box(c, (-1, 1), (-20, -20), (0, 2), glow)     # 喷口
    box(c, (-1, 1), (4, 6), (-1, 2), GUN)
def w_laser(c):
    W, G = '#e6ecef', '#3ff0d8'
    box(c, (-1, 1), (-12, 4), (0, 2), W)
    box(c, (-1, 1), (0, 1), (-4, -1), GUN)
    box(c, (-2, 2), (-12, -4), (-1, -1), GUN)     # 护木（左手）
    box(c, (-1, 1), (-5, 3), (3, 3), G)           # 能量条
    box(c, (0, 0), (-18, -13), (1, 1), GUN)
    box(c, (-1, 1), (-19, -19), (0, 2), G)
    box(c, (-1, 1), (5, 8), (0, 1), W)
def w_grenade(c):
    G = '#4c5e2e'
    box(c, (-2, 1), (-2, 1), (-2, 2), G); box(c, (-1, 0), (-1, 0), (-3, 3), G)
    box(c, (-2, 1), (-1, 0), (0, 0), '#39461f')
    box(c, (-1, 0), (-1, 0), (4, 4), '#9aa3aa'); box(c, (1, 2), (-1, -1), (4, 4), '#c9ced2')   # 引信 + 拉环
def w_boomerang(c):
    P, G2 = '#6a3c8a', '#d6c26a'
    box(c, (-1, 1), (-14, 1), (0, 0), P)          # 一翼朝前
    box(c, (-1, 14), (-1, 1), (0, 0), P)          # 一翼朝外
    box(c, (0, 0), (-14, -12), (0, 0), G2); box(c, (12, 14), (0, 0), (0, 0), G2)
WPN = {'sniper': w_sniper, 'sword': w_sword, 'greatsword': w_greatsword, 'spear': w_spear,
       'pistol': w_pistol, 'smg': w_smg, 'laser': w_laser, 'grenade': w_grenade, 'boomerang': w_boomerang,
       'flamer': lambda c: w_sprayer(c, '#c85a1e', '#ffb03a'),
       'freezer': lambda c: w_sprayer(c, '#8fd0f0', '#e8fbff')}

# ── 角色表：05 §2.1 的主色 + 轮廓件。坐标：面朝 -Y，角色左手在 +X，格子 z=0 贴地 ──
# 格子 5 cm；头按 12 格画、出网格时绕脖子缩到 HEAD_K（0.8 → 头高 0.48 m，总高 1.38 m ≈ 2.9 头身）。
# 缩放而不是重画 10 格：12 格的脸眼睛 / 高光 / 腮红才排得开。部件在 part() 里按骨骼名分组
HEAD_K = 0.8
BELT, BUCKLE, BOOT, EYE, WHITE, MOUTH = '#3b2a1c', '#c49a3c', '#1f1f22', '#1b1b22', '#ffffff', '#b0564a'
CHARS = {
    # hair: long / short / ponytail / spiky / bald / bun / hood / helmet；build: slim / normal / bulky
    'ron':      dict(skin='#e8b894', hair='#6e757c', style='helmet', top='#7d858c', top2='#4d5359', pants='#555b61',
                     glove='#2e3236', build='bulky', extra=['pads', 'shield', 'beard'], beard='#5a3a22'),
    'gwen':     dict(skin='#f3d2b4', hair='#e4c46a', style='ponytail', top='#2f4a7a', top2='#1f3256', pants='#23304a',
                     glove='#1f1f22', build='slim', extra=['pads_s']),
    'kai':      dict(skin='#eec19a', hair='#1b1b20', style='spiky', top='#c8302c', top2='#8a1f1c', pants='#2b2b30',
                     glove='#1f1f22', build='normal', extra=['headband']),
    'ironbull': dict(skin='#c98a5a', hair='#1b1b20', style='bald', top=None, top2='#8a4a1e', pants='#a0602c',
                     glove='#5a3a22', build='bulky', extra=['beard', 'strap'], beard='#1b1b20'),
    'vera':     dict(skin='#f1c6a0', hair='#8a3b22', style='long', top='#5b6b3c', top2='#46542d', pants='#46542d',
                     glove='#1f1f22', build='normal', extra=['holster']),
    'jet':      dict(skin='#e2a878', hair='#3a2a1c', style='short', top='#e8c020', top2='#a88a12', pants='#3a3a3e',
                     glove='#1f1f22', build='normal', extra=['bandolier', 'goggles']),
    'ella':     dict(skin='#f6dccb', hair='#dff2fb', style='hood', top='#7cc0e8', top2='#4a8ab8', pants='#e8f4fa',
                     glove='#4a8ab8', build='slim', extra=['backtank'], hood='#7cc0e8', eye='#2a6aa8'),
    'bom':      dict(skin='#e0b088', hair='#6a6a3a', style='helmet', top='#b09040', top2='#7a6428', pants='#6e5e30',
                     glove='#3a3020', build='bulky', extra=['beltnades']),
    'lian':     dict(skin='#f6d6c0', hair='#2a1a2a', style='bun', top='#f0f0f0', top2='#c8ccd0', pants='#e0e2e4',
                     glove='#f0f0f0', build='slim', extra=['cross', 'medkit']),
    'shaman':   dict(skin='#8a5a3a', hair='#2a1a14', style='spiky', top='#d0602a', top2='#8a3a14', pants='#5a3020',
                     glove='#3a2014', build='normal', extra=['fueltanks', 'paint'], eye='#f0a020'),
    'nox':      dict(skin='#e8dcd8', hair='#2a1e34', style='hood', top='#3a2448', top2='#1e1226', pants='#2a1a34',
                     glove='#1e1226', build='slim', extra=['robe'], hood='#2a1a34', eye='#b060e0'),
    'sif':      dict(skin='#f3cfb0', hair='#bfe8e0', style='short', top='#2aa89a', top2='#1a6e66', pants='#23343a',
                     glove='#1a6e66', build='slim', extra=['drone', 'visor']),
}
# 角色主武器（src/data/characters.ts 的 weapon 字段）
HERO_WEAPON = {'ron': 'greatsword', 'gwen': 'spear', 'kai': 'sword', 'ironbull': 'greatsword', 'vera': 'sniper',
               'jet': 'smg', 'ella': 'freezer', 'bom': 'grenade', 'lian': 'pistol', 'shaman': 'flamer',
               'nox': 'boomerang', 'sif': 'laser'}

def build_char(c):
    P = {}
    part = lambda bone: P.setdefault('mixamorig:' + bone, {})
    ex = set(c['extra'])
    bulky, slim = c['build'] == 'bulky', c['build'] == 'slim'
    top = c['top'] or c['skin']
    eye = c.get('eye', EYE)

    # 头：脸 + 发型
    head = part('Head')
    box(head, (-6, 5), (-6, 5), (18, 29), c['skin'])
    H, st = c.get('hood', c['hair']), c['style']
    if st in ('long', 'hood'):
        box(head, (-6, 5), (-6, 5), (27, 29), H)
        box(head, (-6, 5), (2, 5), (18, 29), H)
        box(head, (-6, -6), (-6, 5), (20, 29), H); box(head, (5, 5), (-6, 5), (20, 29), H)
    elif st != 'bald':
        box(head, (-6, 5), (-6, 5), (28, 29), c['hair'])
        box(head, (-6, 5), (3, 5), (19, 29), c['hair'])   # 后脑盖到脖子，否则背面露一圈肤色
        box(head, (-6, -6), (-6, 5), (24, 29), c['hair']); box(head, (5, 5), (-6, 5), (24, 29), c['hair'])
    if st == 'long':
        box(head, (-6, 5), (-6, -6), (26, 26), H)
        for r in ((-6, -4), (1, 2)): box(head, r, (-6, -6), (25, 25), H)
        box(head, (-5, 4), (2, 3), (13, 17), c['hair'])            # 披到肩后的长发
    if st == 'hood':
        box(head, (-6, 5), (-6, -6), (27, 29), H)
        box(head, (-6, -6), (-6, -6), (18, 29), H); box(head, (5, 5), (-6, -6), (18, 29), H)   # 兜帽前沿
        box(head, (-3, 2), (-6, -6), (26, 26), c['hair'])          # 露出一绺刘海
        box(head, (-2, 1), (6, 6), (22, 28), H)                    # 兜帽尖垂在后
    if st in ('short', 'ponytail', 'spiky', 'bun'):
        box(head, (-6, 5), (-6, -6), (27, 27), c['hair'])
        box(head, (-6, -5), (-6, -6), (26, 26), c['hair']); box(head, (0, 2), (-6, -6), (26, 26), c['hair'])
    if st == 'ponytail':
        box(head, (-1, 0), (6, 7), (19, 27), c['hair'])
    if st == 'spiky':
        for i in range(-6, 6, 2):
            box(head, (i, i), (-5, 4), (30, 30), c['hair'])
            box(head, (i, i), (-2, 1), (31, 31), c['hair'])
    if st == 'bun':
        box(head, (-2, 1), (2, 5), (30, 32), c['hair'])
    if st == 'bald':
        box(head, (-1, 0), (0, 1), (30, 31), c['hair'])            # 顶髻
    if st == 'helmet':
        box(head, (-6, 5), (-6, 5), (27, 29), c['hair'])
        box(head, (-6, 5), (2, 5), (19, 29), c['hair'])
        box(head, (-6, -6), (-6, 5), (22, 29), c['hair']); box(head, (5, 5), (-6, 5), (22, 29), c['hair'])
        box(head, (-7, 6), (-7, 6), (26, 26), c['top2'])            # 帽檐
    for r in ((2, 3), mx((2, 3))):
        box(head, r, (-6, -6), (21, 23), eye)
    box(head, (3, 3), (-6, -6), (23, 23), WHITE); box(head, (-3, -3), (-6, -6), (23, 23), WHITE)   # 高光
    if 'beard' in ex:
        box(head, (-5, 4), (-6, -6), (18, 19), c['beard']); box(head, (-3, 2), (-7, -7), (18, 18), c['beard'])
    else:
        box(head, (-1, 0), (-6, -6), (19, 19), MOUTH)
        box(head, (4, 4), (-6, -6), (20, 20), '#e89a88'); box(head, (-5, -5), (-6, -6), (20, 20), '#e89a88')
    if 'headband' in ex:
        box(head, (-6, 5), (-6, 5), (25, 25), top); box(head, (-1, 0), (6, 6), (22, 25), top)
    if 'goggles' in ex:
        box(head, (-6, 5), (-6, 5), (27, 27), '#2a2a2a')
        for r in ((1, 3), mx((1, 3))): box(head, r, (-7, -7), (26, 28), '#e8a030')
    if 'visor' in ex:
        box(head, (-5, 4), (-7, -7), (21, 23), '#3ff0d8')
    if 'paint' in ex:
        box(head, (-6, 5), (-6, -6), (24, 24), '#f0e0c0')

    # 躯干
    cx = (-3, 2) if slim else (-4, 3)
    cy = (-3, 2) if bulky else (-2, 1)
    chest = part('Spine2')
    box(chest, cx, cy, (12, 17), top)
    box(chest, cx, cy, (17, 17), c['top2'])                        # 领口
    if c['top']:
        box(chest, (-3, -2), (cy[0], cy[0]), (14, 15), c['top2']); box(chest, (1, 2), (cy[0], cy[0]), (14, 15), c['top2'])
    hips = part('Hips')
    box(hips, cx, cy, (9, 11), c['pants'])
    box(hips, cx, cy, (11, 11), BELT)
    box(hips, (-1, 0), (cy[0], cy[0]), (11, 11), BUCKLE)
    if 'robe' in ex:
        box(chest, (-5, 4), (-3, 2), (12, 17), top); box(chest, (-1, 0), (-3, -3), (12, 17), c['top2'])
        box(hips, (-5, 4), (-3, 2), (5, 11), top); box(hips, (-5, 4), (-3, 2), (5, 5), c['top2'])
        box(hips, (-5, 4), (-3, 2), (11, 11), c['top2'])
    if 'strap' in ex:
        for k in range(12, 18): box(chest, (k - 17 + 3, k - 17 + 3), (cy[0], cy[0]), (k, k), BELT)
    if 'bandolier' in ex:
        for k in range(12, 18):
            i = 14 - k
            box(chest, (i, i + 1), (cy[0], cy[0]), (k, k), BELT)
            box(chest, (i, i), (cy[0] - 1, cy[0] - 1), (k, k), '#d8a830')   # 弹链
        box(chest, (-4, 3), (cy[1], cy[1]), (15, 15), BELT)
    if 'cross' in ex:
        box(chest, (-1, 0), (cy[0], cy[0]), (13, 16), '#d23a3a'); box(chest, (-2, 1), (cy[0], cy[0]), (14, 15), '#d23a3a')
    if 'medkit' in ex:
        box(hips, (4, 5), (-2, 0), (8, 10), '#f0f0f0'); box(hips, (5, 5), (-1, -1), (9, 9), '#d23a3a')
    if 'beltnades' in ex:
        for i in (-4, -2, 1, 3): box(hips, (i, i), (cy[0] - 1, cy[0] - 1), (9, 10), '#4c5e2e')
    if 'backtank' in ex:
        box(chest, (-2, 1), (2, 4), (9, 16), '#dff2fb'); box(chest, (-2, 1), (2, 4), (16, 16), '#4a8ab8')
        box(chest, (-1, 0), (5, 5), (12, 14), '#8fd0f0')
    if 'fueltanks' in ex:
        for r in ((-3, -1), (0, 2)):
            box(chest, r, (2, 4), (8, 17), '#8a8f94')   # 罐体用金属灰，和焦橙衣服分开; box(chest, r, (2, 4), (17, 17), '#3a2014')
            box(chest, r, (2, 4), (12, 12), '#e05a1e')
    if 'drone' in ex:
        box(chest, (7, 9), (-1, 1), (24, 25), '#e6ecef'); box(chest, (6, 10), (0, 0), (26, 26), '#555b60')
        box(chest, (8, 8), (-2, -2), (24, 24), '#3ff0d8')

    # 四肢
    ay = (-3, 1) if bulky else (-2, 0)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        up = part(side + 'Arm')
        box(up, f((4, 6)), ay, (15, 17), top)
        if 'pads' in ex: box(up, f((4, 7)), (-3, 1), (17, 18), c['top2'])
        if 'pads_s' in ex: box(up, f((4, 6)), (-2, 0), (18, 18), c['top2'])
        fa = part(side + 'ForeArm')
        box(fa, f((7, 8)), ay, (15, 17), top); box(fa, f((8, 8)), ay, (15, 17), c['top2'])
        box(part(side + 'Hand'), f((9, 10)), (-2, 0), (15, 17), c['glove'])
        ul = part(side + 'UpLeg')
        lx = (0, 4) if bulky else (1, 3)
        box(ul, f(lx), (-2, 0), (5, 8), c['pants'])
        if 'holster' in ex: box(ul, f((4, 4)), (-1, 0), (6, 7), BELT)
        lg = part(side + 'Leg')
        box(lg, f(lx), (-2, 0), (2, 4), BOOT); box(lg, f(lx), (-2, 0), (4, 4), c['top2'])
        box(part(side + 'Foot'), f(lx), (-4, 0), (0, 1), BOOT)
    if 'shield' in ex:   # 盾挂左前臂外侧：手臂垂下时盾面朝前
        sh = part('LeftForeArm')
        box(sh, (6, 9), (-4, -3), (12, 20), '#a9b2ba'); box(sh, (6, 9), (-4, -4), (12, 12), GOLD)
        box(sh, (7, 8), (-5, -5), (15, 17), GOLD)
    return P

# ── 骨架：Xbot 的骨骼头挪到格子的关节处（世界坐标，米；右侧 = 左侧 x 取反）──
V = 0.05
JOINT = {
    'Hips': (0, -0.025, 0.5), 'Spine': (0, -0.025, 0.55), 'Spine1': (0, -0.025, 0.575), 'Spine2': (0, -0.025, 0.6),
    'Neck': (0, -0.025, 0.875), 'Head': (0, -0.025, 0.9), 'HeadTop_End': (0, -0.025, 0.9 + 0.6 * HEAD_K),
    'LeftShoulder': (0.05, -0.025, 0.825), 'LeftArm': (0.2, -0.025, 0.825), 'LeftForeArm': (0.35, -0.025, 0.825),
    'LeftHand': (0.45, -0.025, 0.825), 'LeftHandMiddle1': (0.5, -0.025, 0.825),
    'LeftUpLeg': (0.125, -0.025, 0.45), 'LeftLeg': (0.125, -0.025, 0.25), 'LeftFoot': (0.125, -0.025, 0.1),
    'LeftToeBase': (0.125, -0.125, 0.0), 'LeftToe_End': (0.125, -0.2, 0.0),
}
for k in [k for k in JOINT if k.startswith('Left')]:
    x, y, z = JOINT[k]; JOINT['Right' + k[4:]] = (-x, y, z)

def skeleton(JOINT=JOINT, keep_anims=True):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=donor_path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    for o in new:
        if o is not arm: bpy.data.objects.remove(o, do_unlink=True)
    for a in bpy.data.actions: a.use_fake_user = True
    arm.animation_data_clear()
    mw = arm.matrix_world.copy(); inv = mw.inverted()
    bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    old = {b.name: mw @ b.head for b in eb}
    new_head = {}
    def place(b):
        if b.name in new_head: return new_head[b.name]
        short = b.name.replace('mixamorig:', '')
        if short in JOINT: p = Vector(JOINT[short])
        elif b.parent: p = place(b.parent) + (old[b.name] - old[b.parent.name]) * 0.5   # 手指等：跟父骨、按半尺寸
        else: p = old[b.name]
        new_head[b.name] = p
        return p
    for b in eb: place(b)
    for b in eb:
        m = b.matrix.copy(); L = b.length
        m.translation = inv @ new_head[b.name]
        b.matrix = m; b.length = L * 0.5                   # 只挪位置，朝向（含 roll）不变
    poses.add_sockets(arm)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 动作：只留 idle/run/walk；朝向没变，旋转键原样用；位移键只留臀部，按臀高比例缩
    ratio = JOINT['Hips'][2] / old['mixamorig:Hips'].z
    for a in list(bpy.data.actions):
        if not keep_anims or a.name.split('_')[0] not in {'idle', 'run', 'walk'}: bpy.data.actions.remove(a); continue
        for fc in list(a.fcurves):
            if fc.data_path.endswith('.scale') or (fc.data_path.endswith('.location') and '"mixamorig:Hips"' not in fc.data_path):
                a.fcurves.remove(fc)
            elif fc.data_path.endswith('.location'):
                for kp in fc.keyframe_points:
                    kp.co.y *= ratio; kp.handle_left.y *= ratio; kp.handle_right.y *= ratio
        a.name = a.name.split('_')[0]
    return arm

# ── 武器：只做 12 名角色用到的 ──
bpy.ops.wm.read_factory_settings(use_empty=True)
half = Vector((-0.5, -0.5, -0.5))
for wid in sorted(set(HERO_WEAPON.values())):
    cells = {}; WPN[wid](cells)
    o = voxmesh('vox_' + wid, {'wpn': cells}, 0.02, half)
    o.vertex_groups.clear()
    export([o], os.path.join(out_dir, 'vox_%s.glb' % wid))
    print("WPN_OK", wid, len(o.data.polygons), "len_m", round(o.dimensions.y, 3))
    bpy.data.objects.remove(o)

# ── 角色 ──
poses.HANDGUARD = (0.2, 0.02)   # Q 版手臂短，护木要托得近一些才够得着
for cid, c in CHARS.items():
    if only and cid not in only: continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # 场景缺省 24 fps，程序化关键帧按 30 排：不对齐的话攻击动作全慢 1.25 倍。须在导入 Xbot 之前设，导入器按场景 fps 换算秒
    bpy.context.scene.render.fps = poses.FPS
    arm = skeleton()
    char = voxmesh('vox_' + cid, build_char(c), V, shrink={'mixamorig:Head': (Vector((0, 0, 18)), HEAD_K)})
    char.parent = arm
    char.matrix_parent_inverse = arm.matrix_world.inverted()
    char.modifiers.new('arm', 'ARMATURE').object = arm
    poses.build(arm)   # 程序化动作（攻击 / 受击 / 死亡）
    export([arm, char], os.path.join(out_dir, 'vox_%s.glb' % cid))
    print("VOX_OK", cid, len(char.data.vertices), "tris", sum(len(p.vertices) - 2 for p in char.data.polygons))


# ══════════════ 僵尸（05 §3）══════════════
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> zombies [僵尸 id ...]  → out_dir/vox_z_<僵尸>.glb
# 俯视时看得到的只有头顶和肩——所以每种的主色一律放在皮肤上（光头），衣服只是陪衬。
# 与英雄的区分：头更小（ZHEAD_K）、没有腮红和高光、眼睛是发光的黄点、衣服破洞露肉
ZHEAD_K = 0.72
ZEYE, ZMOUTH, TOOTH = '#f2e65a', '#2a1418', '#e0d8b8'
import random

def shade(h, k):
    return '#' + ''.join('%02x' % max(0, min(255, round(int(h[i:i + 2], 16) * k))) for i in (1, 3, 5))

ZOMBIES = {
    # arms / spine：覆盖 idle 与移动动作的上身；loco：移动动作（walk 蹒跚 / sprint 冲刺 / stalk 蹲伏潜行）
    # sh：肩宽加几格；lift：腿加长几格；hoff：头往前 / 往下挪几格；skills：专属动作
    'normal':   dict(skin='#8aa27a', shirt='#66707a', pants='#4d4636', hair='#34382a'),
    # mark：头顶红色 X 纹；spots：(斑点色, 哪些颜色上长斑)；k：整体放大；mouth：嘴的颜色；tank：背上的毒罐
    'runner':   dict(skin='#8aa27a', shirt=None, pants='#d8261c', slim=True, loco='sprint', mark='#e0261c', k=0.9),
    'brute':    dict(skin='#b39a3a', shirt=None, pants='#5a4726', fat=True, sh=2, arms='down', k=1.2,
                     spots=('#4d6a3a', ('#b39a3a', shade('#b39a3a', 0.92)))),
    'toxic':    dict(skin='#8a62a2', shirt='#54406a', pants='#3a3044', mouth='#a6ff3a', tank='#9a3ce0', arms='down', k=0.9),
    'bomber':   dict(skin='#d8642c', shirt=None, pants='#4a2a1a', crack='#ffd23a', skills=['swell']),
    # stripe：头顶纵向条纹；vest：背心（无袖、少破洞、肩带）；shorts：短裤（小腿露肉）
    'splitter': dict(skin='#8aa27a', shirt='#eef0ec', pants='#6c7176', stripe='#b4b8ba', vest=True, shorts=True, k=1.1, skills=['split']),
    'leaper':   dict(skin='#b4d68a', shirt=None, pants='#1e2a46', lift=4, thin=True, loco='stalk', hand='#f0e27a', claw='#f0e27a',
                     spots=('#4d6a3a', ('#b4d68a',)), skills=['leap']),
    # steady：移动时上身不晃不拧，盾才立得稳；attack：普通攻击换成盾砸
    'ward':     dict(skin='#8f969c', shirt='#5e656c', pants='#4a5058', sh=1, plate='#aab0b6', arms='block', steady=True, loco='guard',
                     attack='slam', spots=('#4d6a3a', ('#8f969c',)), skills=['block']),
    'spitter':  dict(skin='#a8864a', shirt='#6a5634', pants='#4a3a24', hoff=(-2, 0), sac='#dcb44a', arms='down',
                     spine=(0, -0.12, 1), skills=['spit']),
}
GLOW_COLS = {'#a6ff3a', '#ffd23a', ZEYE, '#f07a2a', '#7ff0ff', '#ff6a8a', '#c88aff'}

# 第三轮 8 种（zombies.ts 第三轮 / 06 §5 答案维度）：各自一个俯视能认出的大件
ZCYAN, ZPINK, ZVIO = '#7ff0ff', '#ff6a8a', '#c88aff'
def deco_herald(part, z, rnd):
    # 先驱：背后一面高举的破旗（旗面发黄光的印记）——光环怪站在后排，旗子从尸群里冒出来
    chest = part('Spine2')
    box(chest, (-1, 0), (4, 4), (10, 34), '#4a3a2a')
    box(chest, (-8, -1), (5, 5), (24, 33), '#6a2a2a')
    for i in range(-8, 0):
        for k in range(24, 24 + rnd.randint(0, 2)): chest.pop((i, 5, k), None)
    box(chest, (-6, -3), (5, 5), (28, 30), '#ffd23a'); box(chest, (-5, -4), (5, 5), (27, 31), '#ffd23a')
def deco_summoner(part, z, rnd):
    # 召唤者：兜帽长袍 + 右手骨杖（杖头发紫光）+ 袍上紫色符文
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); hz = 18
    box(head, (-7, 6), (-5, 7), (hz + 4, hz + 12), z['shirt']); box(head, (-6, 5), (-7, -6), (hz + 11, hz + 12), z['shirt'])
    box(hips, (-5, 4), (-3, 2), (3, 11), z['shirt'])
    for k in (13, 15): box(chest, (-2, 1), (-3, -3), (k, k), ZVIO)
    hand = part('RightHand'); x = -11
    box(hand, (x, x), (-1, -1), (4, 26), '#e2d6b8'); box(hand, (x - 1, x + 1), (-2, 0), (27, 29), '#e2d6b8'); hand[(x, -3, 28)] = ZVIO
def deco_tesla(part, z, rnd):
    # 特斯拉：双肩两根线圈柱（青色电弧顶）+ 背后电池组——电磁伤害全吸收
    chest = part('Spine2')
    for f in ((lambda r: r), mx):
        for k in range(18, 26): box(chest, f((5, 6)), (-1, 0), (k, k), '#b07a3a' if k % 2 else '#6a6f74')
        box(chest, f((4, 7)), (-2, 1), (26, 27), ZCYAN)
    box(chest, (-3, 2), (2, 5), (10, 18), '#4a4f53'); box(chest, (-2, 1), (6, 6), (12, 16), ZCYAN)
def deco_regenerator(part, z, rnd):
    # 再生体：外翻的粉红新肉块 + 发亮的血管纹，越打越长
    for bone in ('Spine2', 'Head', 'LeftArm', 'RightArm', 'Hips'):
        cells = part(bone)
        for c in [c for c, h in cells.items() if h == z['skin'] and rnd.random() < 0.10]: cells[c] = ZPINK
    chest = part('Spine2')
    for k in range(10, 22): chest[((k % 3) - 1, 4, k)] = ZPINK
    box(chest, (-4, 3), (3, 5), (14, 18), '#c84a5a')
def deco_stalker(part, z, rnd):
    # 潜伏者：一身近黑的破斗篷（俯视几乎融进地面）+ 前臂长刃爪
    chest, head = part('Spine2'), part('Head'); hz = 18
    box(chest, (-5, 4), (2, 4), (8, 18), '#1e2026'); box(head, (-7, 6), (-4, 7), (hz + 6, hz + 12), '#1e2026')
    for f, side in (((lambda r: r), 'Left'), (mx, 'Right')):
        box(part(side + 'Hand'), f((11, 15)), (-1, -1), (15, 15), '#d8dce0')
def deco_burrower(part, z, rnd):
    # 掘地者：背上一片碎岩壳 + 一对铲形大爪
    chest = part('Spine2')
    for i in range(-6, 6):
        for j in range(1, 6):
            if rnd.random() < 0.8: chest[(i, j, 18 + (abs(i) < 3) + rnd.randint(0, 1))] = rnd.choice(('#6a5a44', '#7a6a50', '#5a4a38'))
    for f, side in (((lambda r: r), 'Left'), (mx, 'Right')):
        box(part(side + 'Hand'), f((11, 13)), (-4, 1), (14, 18), '#8a7a5a'); box(part(side + 'Hand'), f((14, 14)), (-4, 1), (14, 14), '#d8d0b8')
def deco_flyer(part, z, rnd):
    # 飞行体：背后一对展开的蝠翼（翼骨 + 半透膜），俯视是一个大 V
    chest = part('Spine2')
    for f in ((lambda r: r), mx):
        for i in range(2, 20):
            top = 24 - abs(i - 8) // 2; bot = 14 + i // 3
            for k in range(min(bot, top), top + 1):
                chest[(f((i, i))[0], 4 + i // 4, k)] = '#3a2a3a' if k == top or i % 6 == 0 else '#6a4a6a'
def deco_screamer(part, z, rnd):
    # 尖啸者：张到下巴的大嘴（发紫光的喉咙）+ 脖子上一圈鼓起的声囊
    head = part('Head'); hz = 18
    box(head, (-5, 4), (-7, -7), (hz - 3, hz + 2), ZMOUTH); box(head, (-3, 2), (-7, -7), (hz - 2, hz + 1), ZVIO)
    for i in (-5, -3, 2, 4): head[(i, -8, hz + 2)] = TOOTH; head[(i, -8, hz - 3)] = TOOTH
    box(part('Neck'), (-5, 4), (-4, 3), (16, 18), '#9a7aa8')
ZOMBIES.update({
    'herald':      dict(skin='#a8a490', shirt='#5a4a3a', pants='#3a3028', k=0.95, eye='#ffd23a', skills=['roar'], deco=deco_herald),
    'summoner':    dict(skin='#7a8a6a', shirt='#3a2a4a', pants='#2a2034', k=1.15, eye=ZVIO, skills=['summon'], deco=deco_summoner),
    'tesla':       dict(skin='#7a8aa0', shirt='#3a404a', pants='#2a3038', sh=1, k=1.1, eye=ZCYAN, arms='down', deco=deco_tesla),
    'regenerator': dict(skin='#b07a6a', shirt=None, pants='#4a2a2a', fat=True, k=1.05, deco=deco_regenerator),
    'stalker':     dict(skin='#4a5048', shirt=None, pants='#1e2026', slim=True, thin=True, lift=2, loco='stalk', k=0.9, deco=deco_stalker),
    'burrower':    dict(skin='#8a7050', shirt=None, pants='#4a3a28', sh=1, hoff=(-2, -1), loco='sprint', spine=(0, -0.15, 1), arms='down', deco=deco_burrower),
    'flyer':       dict(skin='#7a6a8a', shirt=None, pants='#2a2030', slim=True, thin=True, loco='sprint', k=0.85, claw='#e0d8b8', skills=['leap'], deco=deco_flyer),
    'screamer':    dict(skin='#b0a0b8', shirt='#4a3a50', pants='#3a3040', slim=True, hoff=(-1, 1), mouth=ZVIO, skills=['roar'], deco=deco_screamer),
})

def build_zombie(zid, z):
    P = {}
    part = lambda bone: P.setdefault('mixamorig:' + bone, {})
    rnd = random.Random(zid)
    sk = z['skin']; top = z['shirt'] or sk
    U, sh = z.get('lift', 0), z.get('sh', 0)
    dy, dz = z.get('hoff', (0, 0))
    fat, slim = z.get('fat'), z.get('slim')

    # 头：光头 + 眉骨 + 深眼窝里的黄眼 + 咧开的嘴
    head = part('Head'); hz = 18 + U + dz
    box(head, (-6, 5), (-6 + dy, 5 + dy), (hz, hz + 11), sk)
    box(head, (-6, 5), (-7 + dy, -7 + dy), (hz + 6, hz + 6), shade(sk, 0.7))           # 眉骨
    for r in ((2, 3), mx((2, 3))): box(head, r, (-6 + dy, -6 + dy), (hz + 3, hz + 4), z.get('eye', ZEYE))
    box(head, (-4, 3), (-6 + dy, -6 + dy), (hz, hz + 1), z.get('mouth', ZMOUTH))
    if 'mouth' in z:   # 毒液：嘴角挂两道发光的涎
        for i, n in ((-3, 2), (1, 1)): box(head, (i, i), (-7 + dy, -7 + dy), (hz - n + 1, hz), z['mouth'])
    for i in (-3, 0, 2): box(head, (i, i), (-6 + dy, -6 + dy), (hz + 1, hz + 1), TOOTH)
    for _ in range(6):   # 头顶斑块：同色系深一档，俯视时让光头不是一整块纯色
        i, j = rnd.randint(-6, 4), rnd.randint(-6, 4)
        box(head, (i, i + 1), (j + dy, j + 1 + dy), (hz + 11, hz + 11), shade(sk, 0.8))
    if 'mark' in z:   # 高速：头顶两格宽的红 X
        for t in range(-6, 6):
            for i in (t, t + 1, -1 - t, -2 - t):
                if -6 <= i <= 5: head[(i, t + dy, hz + 11)] = z['mark']
    if 'stripe' in z:   # 分裂：头顶三道纵向灰纹，一直拖到后脑
        for i in (-5, -4, -1, 0, 3, 4):
            box(head, (i, i), (-6 + dy, 5 + dy), (hz + 11, hz + 11), z['stripe'])
            box(head, (i, i), (5 + dy, 5 + dy), (hz + 5, hz + 11), z['stripe'])
    if 'hair' in z:
        for _ in range(14):
            i, j = rnd.randint(-6, 5), rnd.randint(-2, 5)
            box(head, (i, i), (j + dy, j + dy), (hz + 12, hz + 12), z['hair'])
    if dy:   # 前伸的脖子：从胸口一路接到挪出去的头
        box(part('Neck'), (-2, 1), (dy - 1, 0), (16 + U + dz, 18 + U + dz), sk)

    # 躯干
    cx = (-3, 2) if slim else (-6, 5) if fat else (-4, 3)
    cy = (-4, 3) if fat else (-2, 1)
    chest, hips = part('Spine2'), part('Hips')
    box(chest, cx, cy, (12 + U, 17 + U), top)
    box(hips, cx, cy, (9 + U, 11 + U), z['pants'])
    if z['shirt']:   # 破洞：前后表面随机露肉
        for i in range(cx[0], cx[1] + 1):
            for k in range(12 + U, 18 + U):
                for j in (cy[0], cy[1]):
                    if rnd.random() < (0.06 if z.get('vest') else 0.18): chest[(i, j, k)] = sk
        box(chest, cx, cy, (17 + U, 17 + U), sk)                           # 领口敞开
        if z.get('vest'):   # 背心肩带：俯视时肩上两道白
            for i in (cx[0], cx[0] + 1, cx[1] - 1, cx[1]): box(chest, (i, i), cy, (17 + U, 17 + U), top)
    if fat:   # 胖：啤酒肚往前、往下垂（挂 Spine2：动作只转 Spine2，挂 Spine 会在上身弯腰时留在原地）
        box(chest, (-5, 4), (-5, -5), (8 + U, 14 + U), shade(sk, 0.92))
        box(chest, (-4, 3), (-6, -6), (9 + U, 13 + U), shade(sk, 0.92))
        box(hips, (-6, 5), (-4, 3), (6 + U, 8 + U), z['pants'])
    if 'tank' in z:   # 毒液：背上绑一只紫色毒罐（挂 Spine2，跟身体一起动），高出肩线；两道深色箍、灰盖、一格发光的液位窗
        tk, band = z['tank'], shade(z['tank'], 0.55)
        box(chest, (-3, 2), (2, 6), (10 + U, 21 + U), tk)
        box(chest, (-4, 3), (3, 5), (11 + U, 20 + U), tk)
        for k in (12, 18): box(chest, (-4, 3), (2, 6), (k + U, k + U), band)
        box(chest, (-2, 1), (3, 5), (22 + U, 22 + U), '#8a8f94')
        box(chest, (-1, 0), (7, 7), (14 + U, 16 + U), '#a6ff3a')
        for i in ((-4, -3), (2, 3)): box(chest, i, (-3, -3), (13 + U, 17 + U), band)   # 胸前的背带
    if 'crack' in z:   # 爆炸：身上与头顶的发光裂纹（锯齿线）
        for k in range(12 + U, 18 + U):
            i = (-2, -1, 0, -1, -2, -3)[(k - 12 - U) % 6]
            chest[(i, cy[0], k)] = z['crack']; chest[(i + 1, cy[1], k)] = z['crack']
        for i in range(cx[0], cx[1] + 1): chest[(i, cy[0], 14 + U + (i % 2))] = z['crack']
        for j in range(-6, 6): head[(j % 3 - 2, j, hz + 11)] = z['crack']
        for j in range(-6, 3): head[(3 + (j % 2), j, hz + 11)] = z['crack']
    if 'sac' in z:   # 喷吐：背上鼓起的大囊袋，高出肩线，俯视时是一个黄色的圆包
        sac = part('Spine2')
        box(sac, (-4, 3), (2, 6), (12 + U, 20 + U), z['sac'])
        box(sac, (-3, 2), (7, 7), (13 + U, 19 + U), z['sac'])
        box(sac, (-3, 2), (2, 6), (21 + U, 21 + U), z['sac'])
        box(sac, (-5, -5), (3, 5), (13 + U, 19 + U), z['sac']); box(sac, (4, 4), (3, 5), (13 + U, 19 + U), z['sac'])
        for c in ((-2, 7, 16), (1, 7, 14), (0, 4, 21), (-3, 3, 21)): sac[c[:2] + (c[2] + U,)] = shade(z['sac'], 0.7)
    if 'plate' in z:   # 护盾：方正胸甲 + 方头盔（全场唯一的硬直角）
        box(chest, (-5, 4), (-3, -3), (12 + U, 17 + U), z['plate'])
        box(chest, (-5, 4), (-3, 2), (17 + U, 18 + U), z['plate'])
        box(head, (-7, 6), (-7, 6), (hz + 7, hz + 12), z['plate'])               # 方盔，比头大一圈
        box(head, (-7, 6), (-7, -7), (hz + 4, hz + 6), z['plate'])
        box(head, (-4, 3), (-8, -8), (hz + 5, hz + 5), '#1a1c20')                 # 观察缝
        for r in ((1, 2), mx((1, 2))): box(head, r, (-8, -8), (hz + 5, hz + 5), ZEYE)

    # 四肢
    ay = (-3, 1) if fat else (-2, 0)
    lx = (0, 4) if fat else (1, 2) if z.get('thin') else (1, 3)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        a0 = 4 + sh
        box(part(side + 'Arm'), f((a0, a0 + 2)), ay, (15 + U, 17 + U), sk if fat or not z['shirt'] or z.get('vest') else top)
        box(part(side + 'ForeArm'), f((a0 + 3, a0 + 4)), ay, (15 + U, 17 + U), sk)
        box(part(side + 'Hand'), f((a0 + 5, a0 + 6)), (-2, 0), (15 + U, 17 + U), z.get('hand', shade(sk, 0.85)))
        if 'claw' in z: box(part(side + 'Hand'), f((a0 + 7, a0 + 7)), (-2, 0), (15 + U, 15 + U), z['claw'])
        if 'plate' in z:   # 方肩甲，比肩宽出两格
            box(part(side + 'Arm'), f((a0 - 1, a0 + 3)), (-4, 2), (18 + U, 19 + U), z['plate'])
            box(part(side + 'Arm'), f((a0 + 3, a0 + 3)), (-4, 2), (15 + U, 17 + U), z['plate'])
        lz = 4 + U // 2
        box(part(side + 'UpLeg'), f(lx), (-2, 0) if not z.get('thin') else (-1, 0), (lz + 1, 8 + U), z['pants'])
        box(part(side + 'Leg'), f(lx), (-2, 0) if not z.get('thin') else (-1, 0), (2, lz), sk if z.get('thin') or z.get('shorts') else z['pants'])
        box(part(side + 'Foot'), f(lx), (-4, 0), (0, 1), shade(sk, 0.7))
    if not z.get('thin') and not fat:   # 一条裤腿撕到膝盖
        box(part('RightLeg'), mx(lx), (-2, 0), (2, 3), sk)
    if 'plate' in z:   # 弧形大盾：挂左前臂外侧，中间一列最凸——横在胸前时盾面朝前
        shd = part('LeftForeArm'); a0 = 4 + sh
        box(shd, (a0 + 1, a0 + 7), (-4, -4), (8 + U, 24 + U), z['plate'])
        box(shd, (a0 + 2, a0 + 6), (-5, -5), (9 + U, 23 + U), z['shirt'])
        box(shd, (a0 + 3, a0 + 5), (-6, -6), (10 + U, 22 + U), z['plate'])
        box(shd, (a0 + 4, a0 + 4), (-7, -7), (14 + U, 18 + U), '#6a7076')   # 盾心
    if 'spots' in z:   # 斑点：随机撒种子，每颗往周围 3×3×3 染开，60 像素高时约 5 像素一块
        col, on = z['spots']
        for cells in P.values():
            for c in [c for c, h in cells.items() if h in on and rnd.random() < 0.035]:
                for d in ((a, b, e) for a in (-1, 0, 1) for b in (-1, 0, 1) for e in (-1, 0, 1)):
                    n = (c[0] + d[0], c[1] + d[1], c[2] + d[2])
                    if cells.get(n) in on: cells[n] = col
    if 'deco' in z: z['deco'](part, z, rnd)
    return P

def zjoints(z):
    J = dict(JOINT); U, sh, k = z.get('lift', 0) * V, z.get('sh', 0) * V, z.get('k', 1)
    for kk, (x, y, zz) in JOINT.items():
        b = kk.replace('Left', '').replace('Right', '')
        if b in ('Leg',): zz += U / 2
        elif b not in ('Foot', 'ToeBase', 'Toe_End'): zz += U
        if b in ('Arm', 'ForeArm', 'Hand', 'HandMiddle1'): x += sh if x > 0 else -sh
        J[kk] = (x * k, y * k, zz * k)
    J['HeadTop_End'] = (0, -0.025 * k, J['Head'][2] + 0.6 * ZHEAD_K * k)
    return J

ARM_SETS = {'down': {k: v for k, v in poses.ARMS_DOWN.items()},
            'block': {k: v for k, v in poses.BLOCK.items() if 'Arm' in k or 'Hand' in k or k == 'frame'},
            'boss': poses.B_ARMS(0)}

def zclips(z):
    Z = poses.ZCLIPS
    over = dict(ARM_SETS.get(z.get('arms'), {}))
    if 'spine' in z: over['mixamorig:Spine2'] = z['spine']
    if z.get('steady'): over.update({'mixamorig:Spine2': (0, -0.2, 1), 'twist': 0})
    w = lambda keys: [(k[0], dict(k[1], **over)) + tuple(k[2:]) for k in keys]
    loco = z.get('loco', 'walk')
    c = {'idle': w(Z['idle']), 'walk': w(Z['walk']) if loco == 'walk' else Z[loco],
         'attack': Z[z.get('attack', 'attack')], 'hit': Z['hit'], **{d: Z[d] for d in ('death', 'death2', 'death3', 'death4')}}
    if 'run' in z: c['run'] = Z[z['run']]
    if loco == 'stalk': c['idle'] = [(0, poses.ST_A, 0.62), (1, poses.ST_A, 0.62)]   # 跳跃僵尸站着也是蹲的
    for s in z.get('skills', []): c[s] = Z[s]
    return c

# ══════════════ BOSS（run.ts BOSSES）══════════════
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> bosses [id ...]  → out_dir/vox_b_<id>.glb
# 同一条僵尸管线：底子是 build_zombie，deco 往上加 BOSS 独有的部件；k 放大到 2-2.6 倍
PLATE, RUST, GOO, BONE, EMBER = '#5d646b', '#3b3f44', '#a6ff3a', '#e2d6b8', '#f07a2a'

def deco_corrupted(part, z, rnd):
    # 腐化重装兵：整身重甲 + 右手焊死的巨拳，甲缝里渗出发光的绿
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); hz, a0 = 18, 4 + z['sh']
    box(chest, (-7, 6), (-5, -5), (13, 18), PLATE); box(chest, (-6, 5), (-6, -6), (14, 17), PLATE)   # 胸甲罩住肚子上半
    box(chest, (-6, 5), (4, 5), (12, 18), PLATE)                                                    # 背甲
    box(chest, (-4, 3), (6, 7), (11, 19), RUST)                                                     # 背上的动力箱
    for i in ((-4, -3), (2, 3)):                                                                    # 两根排气管，管口冒绿光
        box(chest, i, (5, 6), (20, 23), RUST); box(chest, i, (5, 6), (24, 24), GOO)
    for t, k in enumerate(range(13, 19)): chest[(2 - t, -6 if 14 <= k <= 17 else -5, k)] = GOO      # 胸甲一道斜裂
    for c in ((-5, -6, 15), (4, -5, 13), (-6, 4, 16), (5, 5, 14), (1, -6, 16)): chest[c] = GOO      # 脓包
    box(hips, (-7, 6), (-5, 4), (10, 11), RUST); box(hips, (-1, 0), (-6, -6), (10, 11), GOO)        # 腰带 + 发光扣
    box(head, (-7, 6), (-7, 6), (hz + 6, hz + 12), PLATE); box(head, (-1, 0), (-7, 6), (hz + 13, hz + 13), RUST)   # 头盔 + 顶脊
    box(head, (-7, 6), (-8, -8), (hz, hz + 6), PLATE)                                               # 面罩
    box(head, (-5, 4), (-8, -8), (hz + 4, hz + 4), '#1a1c20')
    for r in ((1, 3), mx((1, 3))): box(head, r, (-8, -8), (hz + 4, hz + 4), GOO)                    # 观察缝里的绿眼
    for i in (-4, -2, 1, 3): head[(i, -8, hz + 1)] = RUST                                           # 呼吸格栅
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        box(part(side + 'Arm'), f((a0 - 2, a0 + 3)), (-5, 3), (18, 20), PLATE)                     # 肩甲
        box(part(side + 'Arm'), f((a0, a0 + 1)), (-2, 0), (21, 22), RUST)
        box(part(side + 'Leg'), f((0, 4)), (-3, -3), (2, 4), PLATE)                                 # 护胫
        box(part(side + 'UpLeg'), f((0, 4)), (-3, -3), (5, 6), RUST)                               # 护膝
    box(part('LeftForeArm'), (a0 + 3, a0 + 4), (-4, 2), (14, 18), PLATE)                            # 左护臂
    box(part('RightForeArm'), mx((a0 + 2, a0 + 4)), (-4, 2), (13, 19), PLATE)                       # 右手：巨拳
    box(part('RightHand'), mx((a0 + 5, a0 + 8)), (-4, 2), (13, 19), RUST)
    for j in (-3, -1, 1): box(part('RightHand'), mx((a0 + 9, a0 + 9)), (j, j), (14, 18), GOO)       # 指节上的腐化

def deco_vesse(part, z, rnd):
    # 毒母·薇丝：背上一簇发光的毒囊、肚子前也鼓着一只，长发、绿冠、长毒爪，下身是破烂长裙
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); U = z['lift']; hz, a0 = 18 + U, 4 + z['sh']
    SAC, HAIR = '#6fae3a', '#241830'
    box(chest, (-3, 2), (2, 6), (13 + U, 23 + U), SAC); box(chest, (-2, 1), (7, 7), (15 + U, 21 + U), SAC)   # 中间的大囊
    for r in ((-7, -4), mx((-7, -4))): box(chest, r, (2, 5), (12 + U, 19 + U), SAC)                        # 两边的小囊
    box(chest, (-3, 2), (-4, -3), (13 + U, 17 + U), SAC); box(chest, (-2, 1), (-5, -5), (14 + U, 16 + U), SAC)   # 孕囊
    for c in [c for c, h in chest.items() if h == SAC and rnd.random() < 0.18]: chest[c] = GOO             # 囊里透出的毒光
    box(hips, (-5, 4), (-3, 2), (4, 13), z['pants'])                                                       # 长裙，下摆撕成锯齿
    for i in range(-5, 5):
        for j in range(-3, 3):
            for k in range(4, 4 + rnd.randint(0, 3)): hips.pop((i, j, k), None)
    for i in range(-6, 6): box(head, (i, i), (6, 7), (hz - rnd.randint(3, 8), hz + 11), HAIR)              # 长发垂到背后
    box(head, (-6, 5), (-6, 5), (hz + 12, hz + 12), HAIR)
    for i in (-5, -2, 1, 4): box(head, (i, i), (-5, -5), (hz + 12, hz + 14 + (i in (-2, 1))), GOO)         # 绿冠
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        for j in (-2, 0): box(part(side + 'Hand'), f((a0 + 7, a0 + 9)), (j, j), (15 + U, 15 + U), GOO)     # 长毒爪

def deco_chaos(part, z, rnd):
    # 尸潮之主·卡俄斯：血肉巨兽，羊角、背上一排骨刺、胸口露出肋骨和发光的心，前臂粗大带骨爪
    chest, head = part('Spine2'), part('Head'); U = z['lift']; hz, a0 = 18 + U, 4 + z['sh']; sk = z['skin']
    for f in ((lambda r: r), mx):   # 羊角：从头两侧往外、往上、再往前勾
        box(head, f((6, 7)), (-2, 0), (hz + 7, hz + 9), BONE); box(head, f((8, 8)), (-2, 0), (hz + 9, hz + 12), BONE)
        box(head, f((7, 7)), (-3, -2), (hz + 13, hz + 14), BONE); box(head, f((7, 7)), (-4, -4), (hz + 15, hz + 15), BONE)
    for x, k, n in ((-4, 12, 3), (3, 12, 3), (-5, 15, 4), (4, 15, 4), (-1, 13, 5), (0, 17, 4)):   # 背刺：斜着往后上方戳
        for t in range(n): chest[(x, 4 + t, k + U + t)] = BONE
    for k in (13, 15, 17):   # 肋骨，中间夹着发光的心
        for r in ((-5, -3), mx((-5, -3))): box(chest, r, (-5, -5), (k + U, k + U), BONE)
    box(chest, (-2, 1), (-5, -5), (14 + U, 16 + U), EMBER)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        box(part(side + 'Arm'), f((a0 - 2, a0 + 3)), (-4, 2), (17 + U, 20 + U), shade(sk, 0.85))   # 隆起的肩肉
        box(chest, f((a0 - 1, a0 - 1)), (-1, -1), (19 + U, 22 + U), BONE)   # 肩刺挂胸口：挂大臂的话手一放下就横着戳出去
        box(part(side + 'ForeArm'), f((a0 + 3, a0 + 4)), (-4, 2), (14 + U, 18 + U), sk)             # 粗前臂
        box(part(side + 'ForeArm'), f((a0 + 3, a0 + 3)), (3, 3), (18 + U, 19 + U), BONE)
        box(part(side + 'Hand'), f((a0 + 5, a0 + 8)), (-4, 2), (14 + U, 18 + U), shade(sk, 0.75))   # 巨掌 + 骨爪
        for j in (-4, -1, 2): box(part(side + 'Hand'), f((a0 + 9, a0 + 11)), (j, j), (14 + U, 14 + U), BONE)

BOSSES = {
    'corrupted': dict(skin='#7d8a5c', shirt='#3f453c', pants='#3f453c', fat=True, sh=3, k=2.0, arms='boss',
                      loco='stomp', attack='smash', eye=GOO, spots=('#4d6a3a', ('#7d8a5c',)), deco=deco_corrupted),
    'vesse':     dict(skin='#8a62a2', shirt='#3a2a4a', pants='#3a2a4a', sh=1, lift=2, k=2.2, arms='boss',
                      eye=GOO, mouth=GOO, skills=['summon', 'spit'], deco=deco_vesse),
    'chaos':     dict(skin='#7a2e2a', shirt=None, pants='#2a1c1c', fat=True, sh=4, lift=1, k=2.6, arms='boss',
                      loco='stomp', attack='swipe', eye=EMBER, mouth=EMBER, crack=EMBER,
                      spots=('#4a1a1a', ('#7a2e2a',)), skills=['smash', 'roar'], deco=deco_chaos),
}

# ══════════════ 精英（src/data/enemies.ts ELITES）══════════════
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> elites [id ...]  → out_dir/vox_e_<基础种>.glb
# 精英 = 基础种的模型 × 1.18（ELITE_MUL.scale）+ 一件俯视能认出的发光标记（enemies.ts 的 look 文案）
GOLD_G = '#ffd23a'
def _hz(z): return 18 + z.get('lift', 0) + z.get('hoff', (0, 0))[1], z.get('hoff', (0, 0))[0], z.get('lift', 0)
def ed_normal(part, z, rnd):
    hz, dy, U = _hz(z); head, chest = part('Head'), part('Spine2')
    for t in range(5): head[(-1 + t % 2, -7 + dy, hz + 6 + t)] = GOO                         # 额头一道发光绿裂痕
    for x, n in ((-3, 12), (2, 9)): box(chest, (x, x), (2, 2), (14 + U, 14 + U + n), RUST)      # 背上插的钢筋
def ed_runner(part, z, rnd):
    hz, dy, U = _hz(z); chest = part('Spine2'); head = part('Head')
    for k in (12, 14, 16): box(chest, (-3, 2), (-3, 2), (k + U, k + U), '#d8d0b8')              # 绷带
    for x in (6, -7): box(head, (x, x), (-5 + dy, 8 + dy), (hz + 3, hz + 3), GOLD_G)            # 眼睛拖出的黄光尾
def ed_brute(part, z, rnd):
    chest, a0 = part('Spine2'), 4 + z.get('sh', 0)
    box(chest, (-7, 6), (-6, -6), (12, 17), PLATE)
    for t, k in enumerate(range(12, 18)): chest[(t - 3, -7, k)] = EMBER                         # 甲缝里的余火
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        box(part(side + 'Arm'), f((a0 - 1, a0 + 3)), (-4, 2), (18, 19), PLATE)
        box(part(side + 'Arm'), f((a0, a0)), (-7, -5), (19, 20), BONE)                         # 肩上的撞角
def ed_toxic(part, z, rnd):
    for bone in ('Spine2', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'):
        cells = part(bone)
        for c in [c for c, h in cells.items() if h == z['skin'] and rnd.random() < 0.12]: cells[c] = GOO   # 发光毒囊
    for side in ('Left', 'Right'):
        h = part(side + 'Hand'); x = min(c[0] for c in h) if side == 'Right' else max(c[0] for c in h)
        box(h, (x, x), (-1, -1), (11, 14), GOO)                                                # 指尖滴的黏液
def ed_bomber(part, z, rnd):
    chest = part('Spine2')
    for k in (12, 14, 16):
        for i in range(-4, 4, 2): chest[(i, -3, k)] = '#c0302a'; chest[(i, -3, k + 1)] = GOLD_G   # 三排雷管
    box(chest, (-2, 1), (2, 3), (13, 16), '#8a8f94'); chest[(0, 4, 15)] = GOLD_G               # 背后的钟
def ed_splitter(part, z, rnd):
    chest = part('Spine2')
    for x, k in ((-4, 14), (2, 13), (-1, 17)):
        box(chest, (x, x + 2), (2, 4), (k, k + 2), shade(z['skin'], 0.8)); chest[(x + 1, 5, k + 1)] = GOO   # 肉瘤 + 里面发光的小僵尸
def ed_leaper(part, z, rnd):
    chest = part('Spine2'); U = z.get('lift', 0)
    for k in range(12, 18, 2):
        for s in range(3): chest[(-1, 2 + s, k + U + s)] = BONE                                # 背脊骨刺
def ed_ward(part, z, rnd):
    hz, dy, U = _hz(z); head = part('Head')
    for i in range(-7, 7):
        for j in range(-7, 7):
            if 30 <= (i + .5) ** 2 + (j + .5) ** 2 <= 49: head[(i, j + dy, hz + 15)] = ZVIO      # 头顶紫色光环
    shd, a0 = part('LeftForeArm'), 4 + z.get('sh', 0)
    for k in (11, 15, 19): box(shd, (a0 + 3, a0 + 5), (-7, -7), (k + U, k + U), ZVIO)           # 盾面符文
def ed_spitter(part, z, rnd):
    chest = part('Spine2')
    for c in [c for c, h in chest.items() if h == z['sac'] and rnd.random() < 0.3]: chest[c] = GOO   # 发光酸袋
    box(chest, (-5, 4), (3, 6), (22, 23), z['sac']); box(chest, (-2, 1), (4, 5), (24, 24), GOO)
def ed_herald(part, z, rnd):
    chest, a0 = part('Spine2'), 4 + z.get('sh', 0)
    box(chest, (-4, 3), (2, 3), (6, 17), z['shirt'])                                           # 军官大衣的后摆（衣色 ELITE_OVR 换成军绿）
    for side, f in (('Left', lambda r: r), ('Right', mx)): box(part(side + 'Arm'), f((a0, a0 + 2)), (-2, 0), (18, 18), GOLD_G)   # 黄肩章
    hips = part('Hips'); box(hips, (4, 5), (-2, 0), (8, 10), '#c8a040'); hips[(6, -1, 10)] = '#c8a040'   # 腰上的锈号角
def ed_summoner(part, z, rnd):
    hz, dy, U = _hz(z); head, chest = part('Head'), part('Spine2')
    box(head, (-4, 3), (-3, 4), (hz + 13, hz + 18), z['shirt']); box(head, (-4, 3), (-4, -4), (hz + 15, hz + 15), ZVIO)   # 高帽
    box(chest, (-1, 0), (-3, -3), (14, 15), ZCYAN)                                             # 胸口魂灯
    part('RightHand')[(-11, -3, 28)] = ZCYAN                                                   # 杖头骷髅的眼光换青色
def ed_tesla(part, z, rnd):
    hz, dy, U = _hz(z); head, chest = part('Head'), part('Spine2')
    box(chest, (-4, 3), (2, 5), (9, 20), '#4a4f53'); box(chest, (-2, 1), (6, 6), (11, 18), ZCYAN)   # 变压器
    for t in range(8): head[(-4 + t, (t % 2) * 2 - 1 + dy, hz + 13 + (t % 3))] = ZCYAN          # 头顶电弧
def ed_regenerator(part, z, rnd):
    chest = part('Spine2'); box(chest, (-2, 1), (-7, -7), (13, 16), ZPINK); box(chest, (-1, 0), (-8, -8), (14, 15), ZPINK)   # 发光心脏
def ed_stalker(part, z, rnd):
    hz, dy, U = _hz(z); head = part('Head')
    box(head, (-6, 5), (-7 + dy, -7 + dy), (hz, hz + 11), '#1e2026')                           # 黑布蒙脸
    for r in ((-5, -2), (1, 4)): box(head, r, (-8 + dy, -8 + dy), (hz + 4, hz + 4), ZCYAN)     # 青色眼缝
def ed_burrower(part, z, rnd):
    hz, dy, U = _hz(z); head = part('Head')
    for t in range(5): box(head, (-5 + t, 4 - t), (-7 + dy - t, -7 + dy - t), (hz + t, hz + 11 - t), BONE if t % 2 else '#a89878')   # 钻头骨甲
def ed_flyer(part, z, rnd):
    hz, dy, U = _hz(z); head, chest = part('Head'), part('Spine2')
    for f in ((lambda r: r), mx):
        for i in range(20, 26): chest[(f((i, i))[0], 9, 22 - (i - 20))] = '#3a2a3a'            # 翼展加长
        for i in range(4, 20, 4): chest[(f((i, i))[0], 4 + i // 4, 20)] = ZPINK                 # 翼膜发光血管
        box(head, f((4, 5)), (-2 + dy, -1 + dy), (hz + 12, hz + 14), BONE)                      # 一对弯角
def ed_screamer(part, z, rnd):
    hz, dy, U = _hz(z); head = part('Head')
    for i in range(-6, 6): box(head, (i, i), (5 + dy, 6 + dy), (hz - rnd.randint(4, 9), hz + 12), '#1a141e')   # 长发
    for i in (-6, -5, 4, 5): box(head, (i, i), (-7 + dy, -7 + dy), (hz + 3, hz + 11), '#1a141e')               # 遮脸的两缕
ELITE_OVR = {'leaper': dict(claw=GOLD_G, hand=GOLD_G), 'stalker': dict(eye=ZCYAN), 'screamer': dict(mouth=ZPINK), 'herald': dict(shirt='#3a4a32')}

def _chain(a, b): return lambda part, z, rnd: (a and a(part, z, rnd), b(part, z, rnd))
ELITES = {zid: dict(ZOMBIES[zid], k=ZOMBIES[zid].get('k', 1) * 1.18, **ELITE_OVR.get(zid, {}),
                    deco=_chain(ZOMBIES[zid].get('deco'), globals()['ed_' + zid]))
          for zid in ZOMBIES if 'ed_' + zid in globals()}

# ══════════════ 变异生物（src/data/enemies.ts MUTANTS）══════════════
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> mutants [id ...]  → out_dir/vox_m_<id>.glb
# 四足兽 / 鸟仍用 Xbot 那副骨，只是关节摆成四足：Hips 在后腰、Spine2 在前胸、胳膊 = 前腿、腿 = 后腿（鸟：胳膊 = 翅膀）。
# aim() 只认"子骨头 - 本骨头"的方向，所以静止姿态就是四足站姿，动作只写要动的骨头。巨猿走人形僵尸管线。
L_, R_ = poses.L, poses.R
def _m(J, s): return {k: (x * V * s, y * V * s, z * V * s) for k, (x, y, z) in J.items()}
def _sym(J):
    for k in [k for k in J if k.startswith('Left')]: J['Right' + k[4:]] = (-J[k][0], *J[k][1:])
    return J

def qbody(m):
    """四足兽：身体是沿 y 的长方块（前 1/3 挂 Spine2、中段 Spine、后段 Hips），头 + 吻部挂 Head，四条腿各三段。格子坐标。"""
    P = {}; part = lambda b: P.setdefault('mixamorig:' + b, {})
    h, w, yf, yb, bz, hd, sn, lg = (m[k] for k in ('h', 'w', 'yf', 'yb', 'bz', 'hd', 'sn', 'lg'))
    z0, z1 = h, h + bz - 1
    t1, t2 = yf + (yb - yf) // 3, yf + 2 * (yb - yf) // 3
    for b, ys in (('Spine2', (yf, t1)), ('Spine', (t1 + 1, t2)), ('Hips', (t2 + 1, yb))):
        c = part(b)
        box(c, (-w, w - 1), ys, (z0, z1), m['fur'])
        box(c, (-w + 1, w - 2), ys, (z1, z1), m['back'])          # 背脊深一档：俯视看到的主要是这条
        box(c, (-w + 1, w - 2), ys, (z0, z0), m['belly'])
    hc = z1 + 1; hy0 = yf - 2 - 2 * hd                            # 头的中心高度、脸面所在的 y
    heads = m.get('heads', (0,))
    box(part('Neck'), (min(heads) - hd + 1, max(heads) + hd - 2), (yf - 2, yf - 1), (z1 - bz // 2, z1 + 1), m['fur'])
    head = part('Head')
    for ox, eye in zip(heads, m.get('eyes', (m.get('eye'),) * len(heads))):
        X = lambda r: (r[0] + ox, r[1] + ox)
        box(head, X((-hd, hd - 1)), (hy0, yf - 3), (hc - hd, hc + hd - 1), m['fur'])
        box(head, X((-hd + 1, hd - 2)), (hy0 - sn, hy0 - 1), (hc - hd, hc - 1), m.get('snout', m['fur']))
        box(head, X((-1, 0)), (hy0 - sn, hy0 - sn), (hc - 2, hc - 1), '#1a1418')                 # 鼻头
        box(head, X((-hd + 1, hd - 2)), (hy0 - sn, hy0 - 1), (hc - hd, hc - hd), ZMOUTH)         # 咧开的嘴
        for i in range(-hd + 1, hd - 1, 2): head[(i + ox, hy0 - sn, hc - hd + 1)] = TOOTH
        for r in ((1, hd - 1), mx((1, hd - 1))): box(head, X(r), (hy0 - 1, hy0 - 1), (hc + 1, hc + 1), eye)   # 发光的眼
        for r in ((hd - 2, hd - 1), mx((hd - 2, hd - 1))):
            box(head, X(r), (yf - 4, yf - 3), (hc + hd, hc + hd - 1 + m.get('ear', 2)), m['back'])   # 耳朵
    lx, fy, by = (w - lg, w - 1), (yf + 1, yf + lg), (yb - lg + 1, yb)
    zA, zB = 2 * h // 3, h // 3
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        for up, mid, low, ys in (('Arm', 'ForeArm', 'Hand', fy), ('UpLeg', 'Leg', 'Foot', by)):
            box(part(side + up), f(lx), ys, (zA, z0 - 1), m['fur'])
            box(part(side + mid), f(lx), ys, (zB, zA - 1), m['fur'])
            box(part(side + low), f(lx), (ys[0] - 1, ys[1]), (0, zB - 1), m['paw'])
            box(part(side + low), f(lx), (ys[0] - 1, ys[0] - 1), (0, 0), m.get('claw', TOOTH))   # 爪尖
    xc, yfc, ybc, zc = w - lg / 2, (fy[0] + fy[1] + 1) / 2, (by[0] + by[1] + 1) / 2, z0 + bz / 2
    J = _sym({'Hips': (0, ybc, zc), 'Spine': (0, t2, zc), 'Spine1': (0, (t1 + t2) / 2, zc), 'Spine2': (0, t1, zc),
              'Neck': (0, yf - 1, z1), 'Head': (0, yf - 3, hc), 'HeadTop_End': (0, hy0 - sn, hc),
              'LeftShoulder': (xc / 2, yfc, z0), 'LeftArm': (xc, yfc, z0), 'LeftForeArm': (xc, yfc, zA), 'LeftHand': (xc, yfc, zB),
              'LeftHandMiddle1': (xc, yfc - 1, 0), 'LeftUpLeg': (xc, ybc, z0), 'LeftLeg': (xc, ybc, zA), 'LeftFoot': (xc, ybc, zB),
              'LeftToeBase': (xc, ybc - 1, 0), 'LeftToe_End': (xc, ybc - 2, 0)})
    return P, part, J

def _add(a, b): return tuple((Vector(a) + Vector(b)).normalized())
def qclips(m, J, skills=()):
    """四足动作。L = 体长（米），lunge 按体长比例；sd = Spine2 静止时的朝向（低头 / 抬头在它上面加偏移）"""
    s = m['k']; L = (m['yb'] - m['yf']) * V * s; T = m.get('T', 0.8)
    sd = tuple((Vector(J['Neck']) - Vector(J['Spine2'])).normalized())
    H0 = {'mixamorig:Hips': (0, -1, 0)}
    TA = dict(H0, **{L_ + 'Arm': (0, -.45, -1), L_ + 'ForeArm': (0, -.2, -1), R_ + 'Arm': (0, .4, -1), R_ + 'ForeArm': (0, .25, -1),
                     R_ + 'UpLeg': (0, -.4, -1), R_ + 'Leg': (0, -.1, -1), L_ + 'UpLeg': (0, .45, -1), L_ + 'Leg': (0, .3, -1)})
    TB = dict(H0, **{L_ + 'Arm': (0, 0, -1), R_ + 'Arm': (0, -.05, -1), R_ + 'ForeArm': (0, .9, -.6),
                     L_ + 'UpLeg': (0, -.05, -1), L_ + 'Leg': (0, .9, -.6)})
    BW = {'mixamorig:Spine2': _add(sd, (0, 0, .5)), 'lunge': (-.05 * L, 0)}
    BITE = {'mixamorig:Spine2': _add(sd, (0, -.3, -.6)), 'lunge': (.3 * L, -.04 * L),
            L_ + 'Arm': (0, -.7, -1), R_ + 'Arm': (0, -.6, -1), L_ + 'UpLeg': (0, .5, -1), R_ + 'UpLeg': (0, .45, -1)}
    HITQ = {'mixamorig:Spine2': _add(sd, (0, .3, .4)), 'lunge': (-.08 * L, 0)}
    dr = (m['bz'] / 2 + 1) / (m['h'] + m['bz'] / 2)   # 倒地：身子贴地时臀高 / 站立臀高
    DEAD = dict(H0, **{'mixamorig:Spine2': _add(sd, (0, 0, -.6)), 'lunge': (-.1 * L, 0),
                       L_ + 'Arm': (1, -.4, -.3), R_ + 'Arm': (-1, -.4, -.3), L_ + 'UpLeg': (1, .4, -.3), R_ + 'UpLeg': (-1, .4, -.3)})
    DEADB = dict(DEAD, **{'mixamorig:Spine2': _add(sd, (0, 0, -.2))})
    death = [(0, {}, None), (.1, HITQ, None), (.4, DEAD, dr, 'LINEAR'), (.5, DEADB, dr + .08), (.7, DEAD, dr), (1.4, DEAD, dr)]
    # 死亡二 = 前扑：冲势带着往前栽，前腿折到胸下、嘴先着地，后半身再塌下去
    FPLANT = dict(H0, **{'mixamorig:Spine2': _add(sd, (0, 0, -.9)), 'lunge': (.35 * L, 0), L_ + 'Arm': (0, .9, -.4), R_ + 'Arm': (0, .85, -.45),
                         L_ + 'ForeArm': (0, -.9, -.3), R_ + 'ForeArm': (0, -.9, -.3)})
    FDOWN = dict(FPLANT, **{'mixamorig:Hips': (0, -1, -.25), L_ + 'UpLeg': (.4, .9, -.2), R_ + 'UpLeg': (-.3, .9, -.25), L_ + 'Leg': (0, -1, 0), R_ + 'Leg': (0, -1, 0)})
    death2 = [(0, {}, None), (.12, dict(HITQ, lunge=(.1 * L, 0)), None), (.35, FPLANT, .75, 'LINEAR'), (.55, FDOWN, dr), (.65, dict(FDOWN, lunge=(.4 * L, .05 * L)), dr + .06),
              (.8, FDOWN, dr), (1.4, FDOWN, dr)]
    # 死亡三 = 侧倒：四条腿一起甩向右边，身子往左塌（体块不会滚，靠腿和脊背的反向读出"侧躺"）
    SIDE = dict(H0, **{'mixamorig:Hips': (-.35, -1, -.1), 'mixamorig:Spine2': _add(sd, (-.7, 0, -.5)), 'lunge': (0, 0),
                       L_ + 'Arm': (1, -.2, -.1), R_ + 'Arm': (1, -.3, -.15), L_ + 'UpLeg': (1, .2, -.1), R_ + 'UpLeg': (1, .3, -.15),
                       L_ + 'ForeArm': (1, -.5, 0), R_ + 'ForeArm': (1, -.6, 0), L_ + 'Leg': (1, .4, 0), R_ + 'Leg': (1, .5, 0)})
    SIDEK = dict(SIDE, **{R_ + 'UpLeg': (1, -.3, .3), R_ + 'Leg': (.7, .7, 0)})   # 蹬一下腿
    death3 = [(0, {}, None), (.1, HITQ, None), (.3, dict(HITQ, **{'mixamorig:Spine2': _add(sd, (-.5, 0, .2))}), .9), (.55, SIDE, dr, 'LINEAR'),
              (.65, dict(SIDE, **{'mixamorig:Spine2': _add(sd, (-.7, 0, -.2))}), dr + .07), (.8, SIDE, dr), (1.0, SIDEK, dr), (1.2, SIDE, dr), (1.6, SIDE, dr)]
    # 死亡四 = 后腿先垮：中弹人立半截 → 后腿一软坐下 → 前腿撑不住趴倒，抽一下
    RSIT = {'mixamorig:Hips': (0, -.5, .85), 'mixamorig:Spine2': (0, -.6, .6), L_ + 'UpLeg': (.2, -1, -.1), R_ + 'UpLeg': (-.2, -1, -.1),
            L_ + 'Leg': (0, .9, -.4), R_ + 'Leg': (0, .9, -.4), L_ + 'Arm': (.1, -.2, -1), R_ + 'Arm': (-.1, -.2, -1)}
    RFLAT = dict(DEAD, **{L_ + 'UpLeg': (.3, -1, -.1), R_ + 'UpLeg': (-.3, -1, -.1), L_ + 'Leg': (0, .9, -.3), R_ + 'Leg': (0, .9, -.3)})
    death4 = [(0, {}, None), (.1, dict(HITQ, **{'mixamorig:Spine2': _add(sd, (0, .4, .8))}), 1.02), (.4, RSIT, .55), (.6, RSIT, .5, 'LINEAR'),
              (.8, RFLAT, dr), (.95, dict(RFLAT, **{'mixamorig:Spine2': _add(sd, (0, 0, -.25))}), dr + .05), (1.1, RFLAT, dr), (1.7, RFLAT, dr)]
    # 奔跑 = 跳跃步：前两腿 / 后两腿成对着地，脊背一伸一收；周期是走路的 0.55
    R1 = dict(H0, **{'mixamorig:Spine2': _add(sd, (0, 0, -.15)), L_ + 'Arm': (0, -.8, -.7), R_ + 'Arm': (0, -.7, -.75), L_ + 'ForeArm': (0, -.6, -.8), R_ + 'ForeArm': (0, -.5, -.85),
                     L_ + 'UpLeg': (0, .85, -.55), R_ + 'UpLeg': (0, .8, -.6), L_ + 'Leg': (0, .7, -.7), R_ + 'Leg': (0, .6, -.8)})
    R2 = dict(H0, **{'mixamorig:Spine2': _add(sd, (0, 0, .15)), L_ + 'Arm': (0, .6, -.8), R_ + 'Arm': (0, .55, -.85), L_ + 'ForeArm': (0, .8, -.6), R_ + 'ForeArm': (0, .75, -.65),
                     L_ + 'UpLeg': (0, -.75, -.65), R_ + 'UpLeg': (0, -.7, -.7), L_ + 'Leg': (0, -.2, -1), R_ + 'Leg': (0, -.15, -1)})
    RT = T * .55
    run = [(0, R1, 1.0), (RT * .25, dict(R1, **{L_ + 'Arm': (0, -.2, -1), R_ + 'Arm': (0, -.15, -1)}), .97), (RT * .5, R2, 1.0),
           (RT * .75, dict(R2, **{L_ + 'UpLeg': (0, -.1, -1), R_ + 'UpLeg': (0, -.05, -1)}), 1.06), (RT, R1, 1.0)]
    c = {'idle': [(0, {}, None), (1, {'mixamorig:Spine2': _add(sd, (0, 0, -.15))}, None), (2, {}, None)],
         'walk': [(0, TA, 1), (T / 4, TB, 1.03), (T / 2, poses.mirror(TA), 1), (3 * T / 4, poses.mirror(TB), 1.03), (T, TA, 1)],
         'attack': [(0, {}, None), (.25, BW, None), (.32, BW, None, 'LINEAR'), (.4, BITE, None), (.6, BITE, None), (.9, {}, None)],
         'hit': [(0, {}, None), (.08, HITQ, None), (.35, {}, None)], 'death': death, 'death2': death2, 'death3': death3, 'death4': death4, 'run': run}
    if 'leap' in skills:   # 扑击：伏低 → 前后腿拉直腾空 → 落地
        CR = dict(H0, **{'mixamorig:Spine2': _add(sd, (0, 0, -.3)), L_ + 'ForeArm': (0, .6, -1), R_ + 'ForeArm': (0, .6, -1), L_ + 'Leg': (0, .7, -1), R_ + 'Leg': (0, .7, -1)})
        AIR = dict(H0, **{'mixamorig:Spine2': _add(sd, (0, 0, .2)), 'lunge': (.6 * L, 0), L_ + 'Arm': (0, -1, -.2), R_ + 'Arm': (0, -1, -.25),
                          L_ + 'UpLeg': (0, 1, -.3), R_ + 'UpLeg': (0, 1, -.35)})
        c['leap'] = [(0, {}, None), (.25, CR, .8), (.35, CR, .78, 'LINEAR'), (.55, AIR, 1.5), (.75, dict(AIR, lunge=(L, 0)), 1.2),
                     (.85, dict(BITE, lunge=(L, -.04 * L)), None), (1.3, {}, None)]
    if 'smash' in skills:   # 人立：以后腰为轴把身子立起来，前爪举到胸前；roar = 人立咆哮，smash = 人立后拍地
        REAR = {'mixamorig:Hips': (0, -.4, 1), 'mixamorig:Spine2': (0, -.6, .8), L_ + 'Arm': (.3, -.7, .4), R_ + 'Arm': (-.3, -.7, .4),
                L_ + 'ForeArm': (0, -.5, .8), R_ + 'ForeArm': (0, -.5, .8), L_ + 'UpLeg': (0, .15, -1), R_ + 'UpLeg': (0, .15, -1)}
        REAR_B = dict(REAR, **{'mixamorig:Spine2': (0, -.35, 1), L_ + 'Arm': (.7, -.5, .5), R_ + 'Arm': (-.7, -.5, .5)})
        SLAM = dict(H0, **{'mixamorig:Hips': (0, -1, -.15), 'mixamorig:Spine2': _add(sd, (0, 0, -.5)), 'lunge': (.25 * L, -.04 * L),
                           L_ + 'Arm': (0, -.8, -1), R_ + 'Arm': (0, -.8, -1), L_ + 'UpLeg': (0, .5, -1), R_ + 'UpLeg': (0, .5, -1)})
        c['roar'] = [(0, {}, None), (.4, REAR, None), (.6, REAR_B, None), (.8, REAR, None), (1.0, REAR_B, None), (1.5, {}, None)]
        c['smash'] = [(0, {}, None), (.45, REAR, None), (.55, REAR, None, 'LINEAR'), (.65, SLAM, None), (.95, SLAM, None), (1.4, {}, None)]
    if 'howl' in skills:   # 坐下仰头长嚎（狼）
        SIT = {'mixamorig:Hips': (0, -.85, .5), 'mixamorig:Spine2': (0, -.5, .9), L_ + 'Arm': (0, -.2, -1), R_ + 'Arm': (0, -.2, -1),
               L_ + 'UpLeg': (0, -.9, -.2), R_ + 'UpLeg': (0, -.9, -.2), L_ + 'Leg': (0, .95, -.3), R_ + 'Leg': (0, .95, -.3)}
        c['roar'] = [(0, {}, None), (.4, SIT, .45), (.7, dict(SIT, **{'mixamorig:Spine2': (0, -.15, 1)}), .45),
                     (1.4, dict(SIT, **{'mixamorig:Spine2': (0, -.1, 1)}), .45), (1.8, {}, None)]
    return c

DOG = dict(k=1.0, h=9, w=3, yf=-8, yb=8, bz=6, hd=3, sn=3, lg=2, ear=3, T=0.5,
           fur='#7a6a5a', back='#5a4a3e', belly='#9a8a76', paw='#4a3e34', eye=GOLD_G, snout='#8a7a68')
WOLF = dict(k=1.1, h=12, w=4, yf=-10, yb=10, bz=8, hd=3, sn=3, lg=2, ear=3, T=0.6, heads=(-4, 4), eyes=(GOLD_G, ZCYAN),
            fur='#4a4a50', back='#2a2a30', belly='#6a6a70', paw='#2a2a2e')
BEAR = dict(k=1.3, h=10, w=7, yf=-12, yb=12, bz=12, hd=5, sn=3, lg=4, ear=1, T=1.3,
            fur='#6a4a32', back='#4e3624', belly='#7a5a40', paw='#3a2a1e', eye=GOLD_G, snout='#8a6a50')

def m_dog():
    P, part, J = qbody(DOG); rnd = random.Random('dog')
    for b in ('Spine2', 'Spine', 'Hips'):
        c = part(b)
        for q in [q for q, h in c.items() if h in (DOG['fur'], DOG['back']) and rnd.random() < .08]: c[q] = '#b07a6a'   # 掉毛露出的皮
    for y in range(-7, 8, 2):   # 脊背裂开露出的骨刺
        part('Spine2' if y < -2 else 'Spine' if y < 3 else 'Hips')[(-1 + (y % 4 == 1), y, 15)] = BONE
    return P, J, qclips(DOG, J, ('leap',))
def m_wolf():
    P, part, J = qbody(WOLF)
    for t in range(-4, 4): part('Neck')[(t, -12, 17 + (t % 2))] = '#8a8f94'                       # 颈上的断链
    for y in range(-9, 10):   # 长毛：背脊两侧竖起的一圈深色
        part('Spine2' if y < -3 else 'Spine' if y < 4 else 'Hips')[(-4 if y % 2 else 3, y, 20)] = WOLF['back']
    return P, J, qclips(WOLF, J, ('howl',))
def m_bear():
    P, part, J = qbody(BEAR)
    box(part('Spine2'), (-5, 4), (-12, -5), (22, 23), BEAR['back'])                                       # 肩峰
    for y0, b in ((-3, 'Spine'), (5, 'Hips')): box(part(b), (-4, 2), (y0, y0 + 3), (22, 22), RUST); part(b)[(-2, y0 + 1, 22)] = PLATE   # 嵌着的锈铁片
    for x, y, b in ((3, -2, 'Spine'), (-3, 6, 'Hips'), (1, 9, 'Hips')):                                    # 断箭
        box(part(b), (x, x), (y, y), (22, 25), '#6a4a2a'); part(b)[(x, y, 26)] = '#d8d0b8'
    box(part('RightHand'), mx((3, 6)), (-15, -13), (0, 1), BONE); box(part('RightHand'), mx((4, 5)), (-17, -16), (0, 0), BONE)   # 右前掌的骨刃
    for c in ((-1, -28, 20), (0, -29, 21), (-2, -29, 19)): part('Head')[c] = GOO                            # 口鼻冒的腐气
    return P, J, qclips(BEAR, J, ('smash',))

VULT = dict(k=1.1)
def m_vulture():
    """秃鹫：胳膊 = 翅膀（静止就是展翅），腿短；身子水平"""
    P = {}; part = lambda b: P.setdefault('mixamorig:' + b, {}); rnd = random.Random('vulture')
    F, F2, SK = '#3a2a22', '#5a4434', '#c88a7a'
    box(part('Spine2'), (-3, 2), (-6, -2), (6, 11), F); box(part('Spine2'), (-3, 2), (-7, -7), (9, 11), '#e8e0d0')   # 胸 + 白色颈羽
    box(part('Spine'), (-3, 2), (-1, 1), (6, 11), F); box(part('Hips'), (-3, 2), (2, 5), (7, 11), F)
    box(part('Hips'), (-4, 3), (6, 10), (9, 10), F2)                                                     # 尾羽
    box(part('Neck'), (-1, 0), (-9, -8), (10, 13), SK)
    head = part('Head'); box(head, (-2, 1), (-11, -8), (13, 16), SK)
    for c in ((-2, -10, 17), (1, -9, 17), (1, -11, 17)): head[c] = '#a85a5a'                             # 秃头上的肉瘤
    box(head, (-1, 0), (-13, -12), (13, 15), '#d8c890'); head[(-1, -14, 13)] = head[(0, -14, 13)] = '#d8c890'   # 钩喙
    for r in ((1, 1), mx((1, 1))): box(head, r, (-12, -12), (15, 15), GOLD_G)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        for b, x, y in (('Arm', (3, 8), (-2, 4)), ('ForeArm', (9, 14), (-1, 5)), ('Hand', (15, 21), (0, 6))):
            box(part(side + b), f(x), y, (10, 10), F); box(part(side + b), f(x), (y[0], y[0] + 1), (11, 11), F2)   # 上面一层浅色前缘
        hand = part(side + 'Hand')
        for i in range(15, 22):
            for j in range(4, 7):
                if rnd.random() < .3: hand.pop((f((i, i))[0], j, 10), None)                              # 残缺的飞羽
        box(part(side + 'ForeArm'), f((10, 13)), (2, 2), (10, 10), BONE)                                 # 破洞里露出的骨
        box(part(side + 'UpLeg'), f((1, 2)), (0, 1), (4, 5), F2); box(part(side + 'Leg'), f((1, 1)), (0, 1), (1, 3), SK)
        box(part(side + 'Foot'), f((1, 2)), (-2, 1), (0, 0), GOO)                                        # 发绿光的爪
    J = _sym({'Hips': (0, 3, 9), 'Spine': (0, 1, 9), 'Spine1': (0, 0, 9), 'Spine2': (0, -3, 9), 'Neck': (0, -7, 11), 'Head': (0, -8, 14),
              'HeadTop_End': (0, -12, 14), 'LeftShoulder': (1.5, -1, 10.5), 'LeftArm': (3, 1, 10.5), 'LeftForeArm': (9, 1, 10.5),
              'LeftHand': (15, 1, 10.5), 'LeftHandMiddle1': (21, 1, 10.5), 'LeftUpLeg': (2, 1, 6), 'LeftLeg': (2, 1, 4),
              'LeftFoot': (2, 1, 1), 'LeftToeBase': (2, 0, 0), 'LeftToe_End': (2, -1, 0)})
    sym = lambda d: dict(d, **poses.mirror(d))
    L = 12 * V * VULT['k']; sd = tuple((Vector(J['Neck']) - Vector(J['Spine2'])).normalized())
    H0 = {'mixamorig:Hips': (0, -1, .1)}
    TUCK = sym({L_ + 'UpLeg': (0, .7, -.5), L_ + 'Leg': (0, 1, 0)})
    UP = dict(H0, **TUCK, **sym({L_ + 'Arm': (1, 0, .7), L_ + 'ForeArm': (1, 0, .4), L_ + 'Hand': (1, .2, 0)}))
    DN = dict(H0, **TUCK, **sym({L_ + 'Arm': (1, 0, -.6), L_ + 'ForeArm': (1, .1, -.8), L_ + 'Hand': (1, .3, -.6)}))
    GL = dict(H0, **TUCK, **sym({L_ + 'Arm': (1, 0, .15), L_ + 'ForeArm': (1, .1, .05), L_ + 'Hand': (1, .3, -.05)}))
    FOLD = sym({L_ + 'Arm': (.35, .9, .1), L_ + 'ForeArm': (-.05, 1, 0), L_ + 'Hand': (0, 1, -.1)})
    DIVE = dict(H0, **TUCK, **sym({L_ + 'Arm': (.6, .8, .3), L_ + 'ForeArm': (.3, 1, 0), L_ + 'Hand': (0, 1, 0)}),
                **{'mixamorig:Spine2': (0, -.7, -.7), 'lunge': (.4 * L, 0)})
    LIMP = dict(sym({L_ + 'Arm': (1, .2, -.15), L_ + 'ForeArm': (1, .4, -.1), L_ + 'Hand': (1, .5, -.2), L_ + 'UpLeg': (.3, .3, -.4)}),
                **{'mixamorig:Hips': (0, -1, 0), 'mixamorig:Spine2': (0, -.7, -.7)})
    HITV = dict(UP, **{'mixamorig:Spine2': _add(sd, (0, .3, .4)), 'lunge': (-.1 * L, 0)})
    PECK = dict(FOLD, **{'mixamorig:Spine2': (0, -.6, -.8), 'mixamorig:Hips': (0, -1, -.2)})
    death = [(0, GL, 1.3), (.1, HITV, 1.3), (.5, LIMP, .5, 'LINEAR'), (.6, dict(LIMP, **{'mixamorig:Spine2': (0, -.9, -.3)}), .6), (.8, LIMP, .5), (1.4, LIMP, .5)]
    # 死亡二 = 打旋坠落：一翼收一翼张，歪着栽下去，落地一侧翅膀压在身下
    SPIN = dict(H0, **TUCK, **{L_ + 'Arm': (1, 0, .8), L_ + 'ForeArm': (1, 0, .5), L_ + 'Hand': (1, .2, .2)}, **poses.mirror({L_ + 'Arm': (.35, .9, -.2), L_ + 'ForeArm': (-.05, 1, 0)}),
                **{'mixamorig:Spine2': (.5, -.7, -.4)})
    SLUMP = dict(LIMP, **{L_ + 'Arm': (1, .2, .4), L_ + 'ForeArm': (1, .4, .2), L_ + 'Hand': (1, .3, 0)}, **poses.mirror({L_ + 'Arm': (.4, .9, -.1), L_ + 'ForeArm': (0, 1, 0)}))
    death2 = [(0, GL, 1.3), (.1, HITV, 1.32), (.35, SPIN, 1.0), (.6, dict(SPIN, **{'mixamorig:Spine2': (-.5, -.7, -.4)}), .65, 'LINEAR'), (.8, SLUMP, .5),
              (.9, dict(SLUMP, **{'mixamorig:Spine2': (0, -.9, -.2)}), .56), (1.0, SLUMP, .5), (1.5, SLUMP, .5)]
    # 死亡三 = 仰面翻倒：被打得往后翻，肚皮朝天、两爪朝上蜷着
    BACKUP = dict(H0, **{'mixamorig:Hips': (0, -.4, 1), 'mixamorig:Spine2': (0, .2, 1), 'lunge': (-.2 * L, 0)},
                  **sym({L_ + 'Arm': (1, .3, .5), L_ + 'ForeArm': (1, .5, 0), L_ + 'UpLeg': (.3, -.5, -.5)}))
    ONBACK = dict(sym({L_ + 'Arm': (1, .1, .1), L_ + 'ForeArm': (1, .3, -.1), L_ + 'Hand': (1, .4, -.15), L_ + 'UpLeg': (.2, -.2, 1), L_ + 'Leg': (.1, .6, .7)}),
                  **{'mixamorig:Hips': (0, -1, .4), 'mixamorig:Spine2': (0, .9, .3), 'lunge': (-.35 * L, 0)})
    death3 = [(0, GL, 1.3), (.1, HITV, 1.32), (.4, BACKUP, 1.0), (.65, ONBACK, .45, 'LINEAR'), (.75, dict(ONBACK, **{'mixamorig:Spine2': (0, .9, .5)}), .5),
              (.9, ONBACK, .45), (1.1, dict(ONBACK, **sym({L_ + 'Leg': (.1, .2, 1)})), .45), (1.5, ONBACK, .45)]
    # 死亡四 = 一头栽进地里：俯冲到一半没收住，滑出一段、尾巴翘着
    CRASH = dict(DIVE, **{'mixamorig:Spine2': (0, -.5, -.9), 'lunge': (.9 * L, 0)})
    SKID = dict(LIMP, **{'mixamorig:Hips': (0, -.8, .5), 'mixamorig:Spine2': (0, -.6, -.8), 'lunge': (1.2 * L, 0)},
                **sym({L_ + 'Arm': (1, .6, .2), L_ + 'ForeArm': (.8, .8, -.1)}))
    death4 = [(0, GL, 1.3), (.1, HITV, 1.3), (.3, DIVE, .95), (.5, CRASH, .55, 'LINEAR'), (.62, SKID, .45), (.8, dict(SKID, **{'mixamorig:Hips': (0, -1, .1)}), .45),
              (1.4, dict(SKID, **{'mixamorig:Hips': (0, -1, .1)}), .45)]
    # 奔跑 = 急扑翅：振幅更大、周期减半，身子前倾
    FAST = {'mixamorig:Spine2': (0, -.85, -.25)}
    run = [(0, dict(UP, **FAST, **sym({L_ + 'Arm': (1, 0, 1)})), 1.25), (.15, dict(DN, **FAST, **sym({L_ + 'Arm': (1, 0, -.9)})), 1.15), (.3, dict(UP, **FAST, **sym({L_ + 'Arm': (1, 0, 1)})), 1.25)]
    clips = {'idle': [(0, GL, 1.3), (1, dict(GL, **sym({L_ + 'Arm': (1, 0, .3)})), 1.36), (2, GL, 1.3)],
             'walk': [(0, UP, 1.3), (.3, DN, 1.2), (.6, UP, 1.3)],
             'attack': [(0, UP, 1.3), (.25, DIVE, 1.0), (.35, dict(DIVE, lunge=(.6 * L, 0)), .8, 'LINEAR'), (.6, DN, 1.0), (.9, UP, 1.3)],
             'hit': [(0, GL, 1.3), (.08, HITV, 1.25), (.35, GL, 1.3)], 'death': death, 'death2': death2, 'death3': death3, 'death4': death4, 'run': run,
             'eat': [(0, FOLD, 1), (.2, PECK, .92), (.4, FOLD, 1), (.6, PECK, .92), (.8, FOLD, 1)]}   # 食腐：收翅落地啄尸体
    return P, J, clips

def deco_ape(part, z, rnd):
    # 变异巨猿：银背、左臂异常粗大拖地、背上一排结晶骨刺、胸口发光的肿块
    chest, a0, U = part('Spine2'), 4 + z['sh'], z.get('lift', 0)
    box(chest, (-6, 5), (4, 5), (12 + U, 18 + U), '#b8bcc0')                                    # 银背
    for x, k, n in ((-4, 14, 3), (-1, 15, 4), (2, 14, 3), (-3, 18, 3), (1, 18, 3)):
        for t in range(n): chest[(x, 6 + t, k + U + t)] = ZCYAN                                  # 结晶骨刺
    box(chest, (-4, -2), (-7, -7), (14 + U, 16 + U), ZPINK); chest[(-3, -8, 15 + U)] = ZPINK     # 胸口肿块
    box(part('LeftArm'), (a0, a0 + 2), (-4, 2), (14 + U, 18 + U), z['skin'])                     # 粗左臂
    box(part('LeftForeArm'), (a0 + 3, a0 + 5), (-5, 3), (13 + U, 19 + U), z['skin'])
    box(part('LeftHand'), (a0 + 6, a0 + 9), (-5, 3), (13 + U, 19 + U), '#2a2a2e')
    box(part('RightHand'), mx((a0 + 5, a0 + 7)), (-3, 1), (14 + U, 18 + U), '#2a2a2e')
MUTANTS = {'dog': m_dog, 'wolf': m_wolf, 'bear': m_bear, 'vulture': m_vulture,
           'ape': dict(skin='#4a4a50', shirt=None, pants='#3a3a40', fat=True, sh=3, k=1.8, arms='boss', hoff=(-2, -2),
                       loco='stomp', run='sprint', attack='smash', eye=GOLD_G, skills=['roar', 'summon', 'leap'], deco=deco_ape)}
MKS = {'dog': DOG['k'], 'wolf': WOLF['k'], 'bear': BEAR['k'], 'vulture': VULT['k']}

def build_z(pre, zid, z, J=None, cells=None, clips=None):
    """一只僵尸 / BOSS / 精英 / 变异生物 → out_dir/<pre><id>.glb。四足兽传自己的 J（关节）/ cells / clips，不缩头"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = poses.FPS
    arm = skeleton(J or zjoints(z), keep_anims=False)
    hz = 18 + z.get('lift', 0) + z.get('hoff', (0, 0))[1]
    mats = {c: 'glow' for c in GLOW_COLS}
    mesh = voxmesh(pre + zid, cells or build_zombie(zid, z), V * z.get('k', 1), mats=mats,
                   shrink={} if cells else {'mixamorig:Head': (Vector((0, z.get('hoff', (0, 0))[0], hz)), ZHEAD_K)})
    mesh.parent = arm
    mesh.matrix_parent_inverse = arm.matrix_world.inverted()
    mesh.modifiers.new('arm', 'ARMATURE').object = arm
    poses.build(arm, clips or zclips(z))
    export([arm, mesh], os.path.join(out_dir, pre + zid + '.glb'))
    print("ZOM_OK", zid, len(mesh.data.vertices), "tris", sum(len(p.vertices) - 2 for p in mesh.data.polygons))

for kind, table, pre in (('zombies', ZOMBIES, 'vox_z_'), ('bosses', BOSSES, 'vox_b_'), ('elites', ELITES, 'vox_e_'), ('mutants', MUTANTS, 'vox_m_')):
    if kind not in only: continue
    for zid, z in table.items():
        if len(only) > 1 and zid not in only: continue
        if callable(z):   # 四足兽 / 鸟：自带格子、关节、动作
            P, J, clips = z(); build_z(pre, zid, {'k': MKS[zid]}, _m(J, MKS[zid]), P, clips)
        else: build_z(pre, zid, z)


# ══════════════ 场景物件（05 §4 / §5.2；src/data/scenes.ts）══════════════
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> props [id ...]  → out_dir/prop_<id>.glb
# 静态网格、不绑骨；原点 = 底面中心，正面朝 -Y。大件 10 cm 一格（楼 / 树 / 车 / 碉堡 / 岩石），小件 5 cm。
# 大面上不做逐格随机色（贪心合面就废了）：颜色按高度分带、斑块成团
import math
PGLOW = {GOO, '#ff4a3a'}   # 自发光色：毒菇、天线灯；增益图标色在 p_buff 里追加

def put(c, p, col): c[p] = col(*p) if callable(col) else col

def ell(c, ctr, r, col, z0=None):
    """椭球（格）：ctr 中心、r = (rx, ry, rz)；z0 以下不填（贴地截平）。"""
    (x, y, z), (a, b, h) = ctr, r
    for i in range(math.floor(x - a) - 1, math.ceil(x + a) + 1):
        for j in range(math.floor(y - b) - 1, math.ceil(y + b) + 1):
            for k in range(max(math.floor(z - h) - 1, -999 if z0 is None else z0), math.ceil(z + h) + 1):
                if ((i + .5 - x) / a) ** 2 + ((j + .5 - y) / b) ** 2 + ((k + .5 - z) / h) ** 2 <= 1: put(c, (i, j, k), col)

def cyl(c, r, z, col, cx=0, cy=0):
    for i in range(math.floor(cx - r) - 1, math.ceil(cx + r) + 1):
        for j in range(math.floor(cy - r) - 1, math.ceil(cy + r) + 1):
            if (i + .5 - cx) ** 2 + (j + .5 - cy) ** 2 <= r * r:
                for k in range(z[0], z[1] + 1): put(c, (i, j, k), col)

def seg(c, a, b, r, col):
    """a→b 的一根棍（树枝 / 仙人掌臂 / 木桩），r < 0.6 就是一格粗。"""
    n = int(max(abs(b[t] - a[t]) for t in range(3)) * 2) + 1
    for s in range(n + 1):
        p = [a[t] + (b[t] - a[t]) * s / n for t in range(3)]
        if r < .6: put(c, tuple(math.floor(q) for q in p), col)
        else: ell(c, p, (r, r, r), col)

def tops(c, col, rnd, p=1.0):
    """朝天的那一格换色（积雪 / 苔藓）。"""
    for q in [q for q in c if (q[0], q[1], q[2] + 1) not in c]:
        if rnd.random() < p: put(c, q, col)

def blots(c, rnd, n, r, col, only=None):
    """表面斑块：n 团、半径 r，只染已有且颜色在 only 里的格。"""
    ks = list(c)
    for _ in range(n):
        o = rnd.choice(ks)
        for q in ks:
            if sum((q[t] - o[t]) ** 2 for t in range(3)) <= r * r and (only is None or c[q] in only): c[q] = col

def heap(c, rnd, ctr, r, h, col, jit=1):
    """碎石 / 雪堆：带噪声的高度场小丘。"""
    for i in range(math.floor(ctr[0] - r), math.ceil(ctr[0] + r) + 1):
        for j in range(math.floor(ctr[1] - r), math.ceil(ctr[1] + r) + 1):
            d = ((i + .5 - ctr[0]) ** 2 + (j + .5 - ctr[1]) ** 2) / (r * r)
            if d > 1: continue
            for k in range(max(1, round(h * (1 - d) ** .6 + rnd.uniform(-jit, jit)))):
                if (i, j, k) not in c: put(c, (i, j, k), col)

def band(pal, step, rnd=None, jit=0):
    """按高度分带取色；jit 让带边缘有一两格参差。"""
    return lambda i, j, k: pal[((k + (rnd.randint(-jit, jit) if jit else 0)) // step) % len(pal)]

def rock(c, rnd, n, s, pal, cap=None, p=0.8):
    for _ in range(n):
        ell(c, (rnd.uniform(-s, s) * .6, rnd.uniform(-s, s) * .5, 0), (s * rnd.uniform(.6, 1), s * rnd.uniform(.5, .9), s * rnd.uniform(.5, .9)),
            band(pal, 3, rnd, 1), z0=0)
    if cap: tops(c, cap, rnd, p)

CON, CON2, CON3, WIN, REBAR = '#8d8a84', '#9c988f', '#6c6964', '#1c2226', '#6a3a26'
def chunks(pal, n=3, salt=0): return lambda i, j, k: pal[hash((i // n, j // n, k // 2, salt)) % len(pal)]
WOOD, WOOD2, WOOD3, IRON = '#9a6a3a', '#7a5028', '#5e3f22', '#3a3a3c'
SNOW, SNOW2, SNOW3 = '#eef4f8', '#d6e2ec', '#c2d2e0'

# ── 城市 ──
def p_ruin(c, rnd):
    # 残楼：两层、4×4 m，右前角塌成斜坡，露出楼板和钢筋；窗洞凹一层
    W, H = 40, 60
    hm = lambda i, j: min(H, int(20 + 1.25 * ((i - W) ** 2 + j ** 2) ** .5)) - (rnd.random() < .35)
    win = lambda u, k: 4 <= u % 10 <= 8 and 3 < u < W - 4 and (8 <= k <= 19 or 38 <= k <= 49)
    for i in range(W):
        for j in range(W):
            h = hm(i, j); edge = min(i, j, W - 1 - i, W - 1 - j)
            if edge < 2:
                u = i if j < 2 or j >= W - 2 else j
                for k in range(h):
                    col = CON3 if 28 <= k <= 30 else CON if k < 30 else CON2
                    if 16 <= u <= 22 and j < 2 and k < 15: continue                 # 门洞
                    if win(u, k): col = None if edge == 0 else WIN
                    if col: c[(i, j, k)] = col
                if h < H - 2 and edge == 0 and rnd.random() < .15: box(c, (i, i), (j, j), (h, h + rnd.randint(1, 4)), REBAR)
            else:
                if h > 31: box(c, (i, i), (j, j), (29, 30), CON3)                     # 二楼楼板
                if h >= H - 1: box(c, (i, i), (j, j), (H - 2, H - 1), CON3)           # 屋顶
    for _ in range(14):                                                               # 雨水冲出来的污痕
        i = rnd.randrange(W); k0 = rnd.randint(20, H - 1)
        for k in range(k0 - rnd.randint(4, 14), k0):
            if (i, 0, k) in c and c[(i, 0, k)] in (CON, CON2): c[(i, 0, k)] = CON3
    heap(c, rnd, (W - 4, -3), 11, 9, chunks([CON, CON, CON3, '#8a4b3a']))

def p_shop(c, rnd):
    # 临街铺面：红砖、卷帘门、碎掉的橱窗、红白条遮阳篷、招牌；左上角崩掉一块
    W, D, H, BR = 50, 30, 32, '#8a4b3a'
    for i in range(W):
        for j in range(D):
            if min(i, j, W - 1 - i, D - 1 - j) >= 2: continue
            for k in range(H):
                if i < 10 and k > 22 + i + rnd.randint(0, 2): continue
                c[(i, j, k)] = '#6a3a2a' if k >= H - 2 else '#74402f' if k % 4 == 0 else BR
    for i in range(2, W - 2):                                                                 # 平屋顶（塌角处跟着缺）
        for j in range(2, D - 2):
            if i >= 10 or H - 2 <= 22 + i: c[(i, j, H - 2)] = '#5a5452' if (i // 6 + j // 6) % 2 else '#625c58'
    for i in range(6, 24):
        for k in range(0, 21): c[(i, 0, k)] = '#7a8288' if k % 2 else '#5f666b'; c.pop((i, 1, k), None)
    box(c, (28, 43), (0, 1), (6, 20), WIN)
    for q in [(i, 0, k) for i in range(33, 39) for k in range(10, 17) if rnd.random() < .7]: c.pop(q)   # 橱窗碎洞
    for j in range(-6, 0):
        for i in range(4, 46): c[(i, j, 21 + (j + 6) // 2)] = '#c8372a' if (i // 4) % 2 else '#e6e0d6'
    box(c, (10, 39), (-1, -1), (25, 29), '#d8b23a')
    for i in range(13, 37, 3): box(c, (i, i + 1), (-2, -2), (27, 27), '#3a2a1e')             # 招牌字

def p_car(c, rnd):
    # 废弃轿车：褪色蓝漆 + 成团锈斑，车窗全黑，右前轮没了
    BODY, RUST_ = '#4f6d86', '#8a4a2a'
    box(c, (0, 19), (0, 43), (3, 9), BODY); box(c, (1, 18), (12, 31), (10, 15), BODY)
    for j in range(12, 32):
        for k in range(10, 15):
            if 13 <= j <= 20 or 23 <= j <= 30:
                c[(1, j, k)] = c[(18, j, k)] = WIN
    box(c, (2, 17), (12, 12), (10, 14), WIN); box(c, (2, 17), (31, 31), (10, 14), WIN)
    blots(c, rnd, 9, 2.5, RUST_, {BODY})
    box(c, (0, 19), (0, 0), (3, 4), IRON); box(c, (0, 19), (43, 43), (3, 4), IRON)
    for r in ((2, 4), (15, 17)): box(c, r, (0, 0), (7, 8), '#d8d0a0'); box(c, r, (43, 43), (7, 8), '#9a2a1e')
    for x, jc in ((-1, 8), (20, 35), (-1, 35)):
        for j in range(jc - 3, jc + 3):
            for k in range(0, 6):
                d = (j + .5 - jc) ** 2 + (k + .5 - 3) ** 2
                if d <= 9: c[(x, j, k)] = '#1b1b1d' if d > 2 else '#6b7378'

def p_fence(c, rnd):
    # 铁栅栏：3 m 一段，中间被撞断一截
    STL, POST = '#6b7378', '#4a4f53'
    for i0 in (0, 29, 58): box(c, (i0, i0 + 1), (0, 1), (0, 37), POST)
    for i in range(60):
        brk = 39 <= i <= 47
        for k in (3, 4, 33, 34):
            if not (brk and k > 30): c[(i, 0, k)] = STL
        if i % 3 == 0:
            for k in range(5, (rnd.randint(8, 20) if brk else 33)): c[(i, 0, k)] = RUST if rnd.random() < .1 else STL

def p_partition(c, rnd):
    # 走廊隔断墙：4 m 混凝土，炸穿一个洞，洞口一圈焦黑、钢筋戳出来；墙面有涂鸦
    L, T, H = 40, 3, 24
    for i in range(L):
        for j in range(T):
            for k in range(H - rnd.randint(0, 2) * (rnd.random() < .5)): c[(i, j, k)] = CON3 if k < 2 else CON
    for q in list(c):
        d = ((q[0] + .5 - 26) / 6) ** 2 + ((q[2] + .5 - 11) / 5) ** 2
        if d <= 1 + rnd.uniform(-.25, .1): del c[q]
        elif d <= 1.9 and q[1] == 0: c[q] = '#3a3836'
    for i in range(20, 33, 3): c[(i, 1, 16 + rnd.randint(-1, 0))] = REBAR
    for i in range(3, 15):
        z = 12 + (i % 4 if i % 8 < 4 else 3 - i % 4); box(c, (i, i), (-1, -1), (z, z + 2), '#b8321e')

# ── 通用（多张图复用）──
def p_barrel(c, rnd):
    # 油桶（可爆）：红桶三道箍、正面黄底危险标
    cyl(c, 6.5, (0, 16), lambda i, j, k: '#7a2014' if k in (1, 8, 15) else '#b8321e')
    cyl(c, 6.5, (17, 17), '#8a2a18'); box(c, (2, 3), (1, 2), (18, 18), IRON)
    box(c, (-2, 1), (-7, -7), (10, 13), '#e8c23a'); box(c, (-1, 0), (-8, -8), (11, 12), '#1b1b1b')

def p_crate(c, rnd):
    # 木补给箱（打碎掉增益）：木板横缝、深色包边、正面白十字
    for i in range(16):
        for j in range(16):
            for k in range(16):
                e = (i in (0, 15)) + (j in (0, 15)) + (k in (0, 15))
                c[(i, j, k)] = WOOD3 if e >= 2 else WOOD2 if k % 4 == 3 else WOOD
    box(c, (6, 9), (-1, -1), (3, 12), '#e8e0c8'); box(c, (3, 12), (-1, -1), (6, 9), '#e8e0c8')

def p_ammo(c, rnd):
    # 军用弹药箱：橄榄绿铁箱、深色箱盖、正面黄色喷码、两侧提手
    OL = '#556b3a'
    box(c, (0, 23), (0, 11), (0, 8), OL); box(c, (-1, 24), (-1, 12), (9, 10), '#46592f')
    box(c, (3, 20), (-1, -1), (3, 4), '#d8b23a')
    for i in (4, 18): box(c, (i, i + 1), (-2, -1), (6, 9), IRON)
    for i in (-2, 25): box(c, (i, i), (4, 7), (6, 7), IRON)

def p_rubble(c, rnd):
    # 碎石堆（沙袋 / 木墙 / 楼被打烂后的残留，共用一堆）
    heap(c, rnd, (0, 0), 14, 9, chunks([CON, CON, CON3, '#8a4b3a', CON2]))
    for _ in range(3):
        x, y = rnd.randint(-8, 8), rnd.randint(-8, 8)
        box(c, (x, x + rnd.randint(3, 6)), (y, y + rnd.randint(2, 4)), (0, rnd.randint(4, 8)), CON)
    for _ in range(4):
        x, y = rnd.randint(-6, 6), rnd.randint(-6, 6); seg(c, (x, y, 3), (x + rnd.randint(-4, 4), y + rnd.randint(-3, 3), 12), 0, REBAR)

# 增益：共用石台 + 一圈发光 + 漂浮平面图标（运行时整体自转、上下浮）
ICONS = {
    'shield':   ('#3a9cff', ['.#####.', '#######', '#######', '#######', '.#####.', '..###..', '...#...']),
    'speed':    ('#ffd23a', ['#..#...', '.#..#..', '..#..#.', '...#..#', '..#..#.', '.#..#..', '#..#...']),
    'damage':   ('#ff4a3a', ['...#...', '...#...', '...#...', '...#...', '.#####.', '...#...', '..###..']),
    'heal':     ('#4aff6a', ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..']),
    'cooldown': ('#b86aff', ['.#####.', '#.....#', '#..#..#', '#..##.#', '#.....#', '#.....#', '.#####.']),
}
def p_buff(kind):
    col, bmp = ICONS[kind]; lite = '#' + ''.join('%02x' % ((int(col[t:t + 2], 16) + 255) // 2) for t in (1, 3, 5))
    PGLOW.update((col, lite))
    def f(c, rnd):
        cyl(c, 6, (0, 1), '#4a4f55'); cyl(c, 5, (2, 2), '#5a6068')
        for q in [q for q in c if q[2] == 1 and (q[0] + .5) ** 2 + (q[1] + .5) ** 2 > 20]: c[q] = col
        for i in range(-3, 3):
            for j in range(-3, 3):
                for k in range(3, 9):
                    if abs(i + .5) + abs(j + .5) + abs(k - 5.5) * .8 <= 3: c[(i, j, k)] = lite
        for r, row in enumerate(bmp):
            for x, ch in enumerate(row):
                if ch == '#': c[(x - 4, 0, 16 - r)] = col
    return f

# ── 丛林 ──
LEAF, LEAF2, LEAF3, BARK, BARK2 = '#2f6424', '#3f7a2e', '#4d8c34', '#5a3e26', '#4a321e'
def p_tree(c, rnd):
    # 阔叶树：板根、四团树冠（下暗上亮分带），垂下几根藤
    for k in range(22): cyl(c, 1.6 if k > 2 else 2.8, (k, k), BARK if k % 5 else BARK2, cx=k * .08)
    for ctr, r in (((0, 0, 26), (10, 9, 6)), ((-6, 3, 22), (7, 6, 5)), ((6, -3, 23), (7, 7, 5)), ((2, 5, 30), (6, 6, 4))):
        ell(c, ctr, r, band([LEAF, LEAF2, LEAF2, LEAF3], 3, rnd, 1))
    for _ in range(7):
        i, j = rnd.randint(-8, 8), rnd.randint(-7, 7)
        ks = [q[2] for q in c if q[:2] == (i, j) and q[2] > 15]
        if ks:
            for k in range(min(ks) - rnd.randint(3, 8), min(ks)): c[(i, j, k)] = LEAF

def p_palm(c, rnd):
    # 棕榈：弯干、一圈垂下来的羽叶、椰子
    for k in range(28): box(c, (int(.012 * k * k), int(.012 * k * k) + 1), (0, 1), (k, k), '#7a5a36' if k % 3 else '#6a4a2a')
    tx = int(.012 * 27 * 27) + 1
    ell(c, (tx, 1, 28), (1.8, 1.8, 1.5), '#5a3a1e')
    for n in range(8):
        a = n * math.pi / 4 + .3
        for t in range(1, 14):
            x, y, z = tx + math.cos(a) * t, 1 + math.sin(a) * t, 29 + 2 - .045 * t * t
            w = 1 if 2 < t < 11 else 0
            for s in range(-w, w + 1):
                put(c, (math.floor(x - math.sin(a) * s), math.floor(y + math.cos(a) * s), math.floor(z)), LEAF2 if s else LEAF)

def p_grass(c, rnd):
    # 草丛：二十来根草叶，梢头发亮，有的歪
    for _ in range(22):
        a, d = rnd.uniform(0, 6.3), rnd.uniform(0, 7)
        x, y, h, lean = round(math.cos(a) * d), round(math.sin(a) * d), rnd.randint(4, 11), rnd.choice((-1, 0, 1))
        for k in range(h): c[(x + lean * (k // 4), y, k)] = '#6aa83e' if k >= h - 2 else LEAF2

def p_hay(c, rnd):
    # 草垛：圆顶、中腰一道草绳、顶上插根棍
    ell(c, (0, 0, 0), (12, 12, 13), lambda i, j, k: '#8a6a2a' if k == 5 else '#c49a3c' if k % 4 == 0 else '#d8b04a', z0=0)
    box(c, (-1, 0), (-1, 0), (13, 17), BARK)

# ── 沼泽 ──
def p_deadtree(c, rnd):
    # 枯树：歪干、几根分叉的秃枝，枝下挂着苔丝
    G = lambda *q: rnd.choice(['#4a4238', '#4a4238', '#3a342c'])
    seg(c, (0, 0, 0), (1.5, 0, 20), 1.8, G)
    for a, b, r in (((1, 0, 13), (-7, 2, 22), 1), ((1.5, 0, 18), (8, -2, 26), .9), ((1.5, 0, 20), (2, 3, 31), .8),
                    ((-7, 2, 22), (-11, 0, 25), 0), ((8, -2, 26), (12, -4, 27), 0), ((2, 3, 31), (0, 4, 34), 0)):
        seg(c, a, b, r, G)
    for d in ((4, 3), (-4, 2), (1, -4), (-2, -3)): seg(c, (.5, .5, 1), (d[0], d[1], 0), .8, G)
    for q in [q for q in c if q[2] > 12 and (q[0], q[1], q[2] - 1) not in c and rnd.random() < .3]:
        for k in range(q[2] - rnd.randint(1, 4), q[2]): c[(q[0], q[1], k)] = '#5a6a3a'

def p_stump(c, rnd):
    # 空心树桩：顶口参差、树根外张，脚下长着一簇发光毒菇
    for i in range(-4, 4):
        for j in range(-4, 4):
            d = (i + .5) ** 2 + (j + .5) ** 2
            if d > 14: continue
            for k in range(rnd.randint(7, 11) if d > 5 else 3): c[(i, j, k)] = '#4a4238' if k % 4 else '#3a342c'
    for d in ((6, 1), (-5, 3), (2, -6), (-3, -5), (5, -4)): seg(c, (.5, .5, 2), (d[0], d[1], 0), .8, '#3a342c')
    for x, y, h in ((6, -2, 2), (7, 0, 1), (-6, -1, 2)):
        box(c, (x, x), (y, y), (0, h - 1), '#d8d0b8'); box(c, (x - 1, x + 1), (y - 1, y + 1), (h, h), GOO)

def p_rock_moss(c, rnd): rock(c, rnd, 3, 7, ['#5f635c', '#6f736b', '#50544e'], '#4f6a34', .75)

# ── 荒漠 ──
CAC, CAC2 = '#5a8a3a', '#4a7a30'
def ribs(n, x=0, y=0): return lambda i, j, k: CAC if int((math.atan2(j + .5 - y, i + .5 - x) + math.pi) * n / math.pi) % 2 else CAC2

def p_cactus(c, rnd):
    # 柱仙人掌：竖棱、两条胳膊一高一低往上翘，顶上一朵粉花
    cyl(c, 3, (0, 36), ribs(4)); ell(c, (0, 0, 37), (3, 3, 2.5), CAC)
    for s, k0, top in ((1, 14, 28), (-1, 21, 32)):
        seg(c, (0, 0, k0), (s * 7, 0, k0), 2, CAC2); cyl(c, 2, (k0, top), CAC, cx=s * 7); ell(c, (s * 7, 0, top + 1), (2, 2, 1.5), CAC)
    box(c, (-1, 0), (-1, 0), (40, 40), '#e85a8a')

def p_cactus_ball(c, rnd):
    # 球仙人掌丛：三只大小不一，顶上开黄花
    for x, y, r, h in ((0, 0, 5, 7), (7, 3, 3.5, 5), (-6, 4, 3, 4)):
        ell(c, (x, y, 0), (r, r, h), ribs(5, x, y), z0=0)
        box(c, (x - 1, x), (y - 1, y), (h, h), '#e8c23a')

def p_mesa(c, rnd):
    # 砂岩：一层层收窄的台地，每层一个颜色（沉积层）
    z = 0
    for rx, ry, h, col in ((14, 10, 4, '#c08a52'), (12, 9, 4, '#a8703e'), (10, 8, 3, '#d49a60'), (7, 5, 3, '#b87c46')):
        ox, oy = rnd.uniform(-1.5, 1.5), rnd.uniform(-1, 1)
        for i in range(-15, 16):
            for j in range(-11, 12):
                if ((i + .5 - ox) / rx) ** 2 + ((j + .5 - oy) / ry) ** 2 <= 1 + rnd.uniform(-.12, 0):
                    box(c, (i, i), (j, j), (z, z + h - 1), col)
        z += h
    ell(c, (13, -7, 0), (3, 3, 2.5), '#a8703e', z0=0)

# ── 雪原 ──
def p_pine(c, rnd):
    # 雪松：五层锥、每层朝天的面盖雪
    box(c, (-1, 0), (-1, 0), (0, 5), BARK2)
    for z0, r0, h in ((4, 9, 6), (9, 7.5, 6), (14, 6, 5), (19, 4.5, 5), (23, 3, 5)):
        for k in range(z0, z0 + h): cyl(c, r0 * (1 - (k - z0) / h * .6), (k, k), '#2a4a36' if (k - z0) % 3 else '#34563e')
        rim = [q for q in c if q[2] == z0 and (q[0], q[1], z0 + 1) not in c]
        for q in rim: c[q] = SNOW if rnd.random() < .85 else SNOW2
        if z0 == 23: box(c, (-1, 0), (-1, 0), (28, 29), SNOW)

def p_snowpile(c, rnd):
    # 雪堆：起伏的雪丘，下沿发蓝，冒出几块冰
    heap(c, rnd, (0, 0), 16, 10, lambda i, j, k: SNOW3 if k < 2 else SNOW2 if k < 5 else SNOW, .35)
    for _ in range(3):
        x, y = rnd.randint(-8, 8), rnd.randint(-6, 6); box(c, (x, x + 2), (y, y + 1), (4, 9), '#a8d8f0')

def p_rock_ice(c, rnd): rock(c, rnd, 3, 7, ['#6a7580', '#7a8590', '#5a646e'], SNOW, .9)

# ── 军事 ──
SB, SB2 = '#b8a47a', '#a8946a'
def bags(c, x0, x1, y0, k0, rows, depth=1):
    """沙袋：60×30×15 cm 一只（12×6×3 格），逐排错缝，四角削圆。"""
    for r in range(rows):
        for d in range(depth if r < rows - 2 else 1):
            for n, x in enumerate(range(x0 - 6 * (r % 2), x1, 12)):
                col = SB if (n + r + d) % 2 else SB2
                for i in range(max(x, x0), min(x + 12, x1)):
                    for j in range(y0 + 6 * d, y0 + 6 * d + 6):
                        for k in range(k0 + 3 * r, k0 + 3 * r + 3):
                            if (i in (x, x + 11)) + (j in (y0 + 6 * d, y0 + 6 * d + 5)) + (k == k0 + 3 * r + 2) >= 2: continue
                            c[(i, j, k)] = col

def p_sandbag(c, rnd): bags(c, 0, 60, 0, 0, 6, 2)   # 沙袋墙：3 m 长、6 排高（0.9 m），下四排两只深

def p_wire(c, rnd):
    # 铁丝网：两头 X 形木桩，中间一卷螺旋刺网
    for i in (2, 57):
        seg(c, (i, -6, 0), (i, 6, 15), 0, '#6a4a2a'); seg(c, (i, 6, 0), (i, -6, 15), 0, '#6a4a2a')
    for t in range(0, 240):
        a = t * .35; x, y, z = t / 4, 6 * math.cos(a), 7.5 + 6 * math.sin(a)
        c[(math.floor(x), math.floor(y), math.floor(z))] = '#8a9096'
        if t % 7 == 0: c[(math.floor(x), math.floor(y * 1.2), math.floor(7.5 + (z - 7.5) * 1.2))] = '#b9c3ca'

def p_woodwall(c, rnd):
    # 木墙：尖头竖板、正面两道横撑一道斜撑，背后两根斜顶的支柱
    W, H = 48, 40
    for i in range(W):
        top = H - (2 if abs(i % 4 - 1.5) > 1 else 0)
        for k in range(top): c[(i, 0, k)] = c[(i, 1, k)] = ('#8a5e36', '#7a5230', '#946842')[(i // 4) % 3]
    for k0 in (8, 30): box(c, (0, W - 1), (-1, -1), (k0, k0 + 1), WOOD3)
    seg(c, (2, -1, 10), (W - 3, -1, 29), 0, WOOD3); seg(c, (2, -1, 11), (W - 3, -1, 30), 0, WOOD3)
    for i in range(1, W, 4):
        for k in (8, 31): c[(i, -2, k)] = IRON
    for i in (5, 42): seg(c, (i, 2, 30), (i, 14, 0), .8, WOOD2)

def p_bunker(c, rnd):
    # 碉堡：矮混凝土方墩、前面一道射击孔、顶上一排沙袋和天线（红灯发光）、背后铁门、迷彩斑
    W, D, H, BC = 36, 24, 11, '#7d8070'
    box(c, (0, W - 1), (0, D - 1), (0, H - 1), BC); box(c, (1, W - 2), (1, D - 2), (H, H), BC)
    blots(c, rnd, 8, 3, '#5d6a4a', {BC}); blots(c, rnd, 5, 2.5, '#6a6a52', {BC})
    box(c, (0, W - 1), (0, D - 1), (0, 1), '#5f6254')
    for i in range(5, 31):
        for k in (6, 7): c.pop((i, 0, k), None); c[(i, 1, k)] = WIN
    box(c, (14, 21), (D - 1, D - 1), (2, 8), '#3a3a32')
    bags(c, 1, W - 1, 1, H + 1, 1)
    box(c, (30, 30), (18, 18), (H + 1, H + 9), IRON); c[(30, 18, H + 10)] = '#ff4a3a'

PROPS = {   # id: (格子边长 m, 构建函数)
    'ruin': (.1, p_ruin), 'shop': (.1, p_shop), 'car': (.1, p_car), 'fence': (.05, p_fence), 'partition': (.1, p_partition),
    'barrel': (.05, p_barrel), 'crate': (.05, p_crate), 'ammo': (.05, p_ammo), 'rubble': (.05, p_rubble),
    'tree': (.1, p_tree), 'palm': (.1, p_palm), 'grass': (.05, p_grass), 'hay': (.05, p_hay),
    'deadtree': (.1, p_deadtree), 'stump': (.1, p_stump), 'rock_moss': (.1, p_rock_moss),
    'cactus': (.05, p_cactus), 'cactus_ball': (.05, p_cactus_ball), 'mesa': (.1, p_mesa),
    'pine': (.1, p_pine), 'snowpile': (.05, p_snowpile), 'rock_ice': (.1, p_rock_ice),
    'bunker': (.1, p_bunker), 'sandbag': (.05, p_sandbag), 'wire': (.05, p_wire), 'woodwall': (.05, p_woodwall),
    **{'buff_' + k: (.05, p_buff(k)) for k in ICONS},
}

if 'props' in only:
    for pid, (v, fn) in PROPS.items():
        if len(only) > 1 and pid not in only: continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        cells = {}; fn(cells, random.Random(pid))
        xs, ys, zs = zip(*cells)
        off = Vector((-(min(xs) + max(xs) + 1) / 2, -(min(ys) + max(ys) + 1) / 2, -min(zs)))
        o = voxmesh('prop_' + pid, {'prop': cells}, v, off, mats={h: 'glow' for h in PGLOW})
        o.vertex_groups.clear()
        export([o], os.path.join(out_dir, 'prop_%s.glb' % pid))
        print("PROP_OK", pid, "tris", sum(len(p.vertices) - 2 for p in o.data.polygons), "size_m", [round(d, 2) for d in o.dimensions])



# ══════════════ 职业形象（剑士样板链：影剑士线）══════════════
#   blender -b -P voxel.py -- <rig_donor.glb> <out_dir> looks [id ...]  → out_dir/vox_<职业 id>.glb + 新武器 vox_<武器>.glb
# 规则见 docs/05 §2.4「职业形象」。0–5 转：脸 / 发型沿用样板角色（凯），一转换一层装 + 加一个新轮廓件；
# 6 转英雄、五星：整套重画（新的人、新身形比例 lift / k / head_k、新招牌轮廓件），不在前面的件上叠。
GOLDY, VIO, VIO_D, SHD, SHD2, LIGHT = '#d4a017', '#b070ff', '#6a3fa8', '#2a2438', '#3c3354', '#ffe9a0'
LOOK_GLOW = {VIO, '#ffd23a', LIGHT, '#fff6d8'}

def w_blade(c, L, w=1, guard=4, grip=3, blade=STEEL, edge=EDGE, gcol=GOLD, wrap=BROWN, curve=0, twin=True):
    """参数化刀剑：刃长 L 格、半宽 w、护手半宽 guard；curve = 刃尖横向弯出的格数（单刃刀）。"""
    box(c, (0, 0), (-1, grip), (0, 0), wrap)
    box(c, (-1, 1), (grip + 1, grip + 2), (-1, 1), gcol)
    box(c, (-guard, guard), (-3, -2), (-1, 1), gcol)
    for j in range(4, L + 1):
        t = (j - 4) / max(1, L - 4); o = round(curve * t * t); ww = w if j < L - 1 else 0
        box(c, (o - ww, o + ww), (-j, -j), (0, 0), blade)
        c[(o + ww, -j, 0)] = edge
        if twin: c[(o - ww, -j, 0)] = edge
LOOK_WPN = {
    'blade_elite':   lambda c: w_blade(c, 28, guard=5, grip=4, blade='#c9d2da', gcol=GOLDY, wrap='#3a2a1c'),
    'blade_twin':    lambda c: w_blade(c, 22, guard=3, blade=STEEL, gcol=GOLDY, wrap='#2c3a5a'),
    'blade_shadow':  lambda c: w_blade(c, 24, guard=3, blade=SHD, edge=VIO, gcol=SHD2, wrap=BLK),
    'katana_shadow': lambda c: w_blade(c, 30, guard=2, grip=5, blade='#3a3450', edge=VIO, gcol=VIO_D, wrap='#1a1624', curve=-3, twin=False),
    'nodachi':       lambda c: w_blade(c, 40, guard=3, grip=6, blade='#1a1624', edge=VIO, gcol=GOLDY, wrap=BLK, curve=4, twin=False),
    'blade_radiant': lambda c: w_blade(c, 38, w=2, guard=6, grip=5, blade='#fff6d8', edge=LIGHT, gcol='#e8c050', wrap='#e6e8f0'),
}

def line(c, a, b, col):
    n = max(abs(round(b[i] - a[i])) for i in range(3)) or 1
    for t in range(n + 1): c[tuple(round(a[i] + (b[i] - a[i]) * t / n) for i in range(3))] = col

def scarf(chest, tails=1):
    box(chest, (-5, 4), (-3, 2), (17, 18), GOLDY)                                   # 金围巾 = 剑士树主色，0–2 转的固定件
    for x in ((-2, -1), (1, 2))[:tails]:
        for k in range(17 - 4 * tails - 3, 17): box(chest, x, (3 + (17 - k) // 3, 3 + (17 - k) // 3), (k, k), GOLDY)

def look_sw0(part, U, rnd): pass                                                  # 剑士：亚麻短褂 + 制式剑，什么都不加

def look_sw1(part, U, rnd):
    # 精锐剑士：皮甲背心 + 右肩单片肩甲 + 金围巾（不对称 = 升了一级的老兵）
    chest = part('Spine2')
    box(chest, (-4, 3), (-3, 2), (12, 16), '#7a5534'); box(chest, (-1, 0), (-3, -3), (13, 13), GOLDY)
    scarf(chest)
    up = part('RightArm'); box(up, mx((4, 7)), (-3, 1), (17, 19), '#9aa3aa'); box(up, mx((4, 7)), (-3, 1), (17, 17), GOLDY)

def look_sw2(part, U, rnd):
    # 双剑士：轻装深蓝、背后交叉双鞘露两只剑柄、围巾拖成两条长尾、白缠腕
    chest = part('Spine2')
    scarf(chest, 2)
    for k in range(11, 18):
        chest[(k - 15, 2, k)] = BELT; chest[(14 - k, 2, k)] = BELT
    for x in (-4, 3): box(chest, (x, x), (3, 3), (17, 20), BROWN); chest[(x, 3, 21)] = GOLDY
    for side, f in (('Left', lambda r: r), ('Right', mx)): box(part(side + 'ForeArm'), f((7, 7)), (-2, 0), (15, 17), '#e8e2d4')

def look_sw3(part, U, rnd):
    # 影剑士：兜帽 + 面罩 + 紫光眼；短披肩、背后下摆撕成碎条；脚边缠着发光的影子
    chest, head = part('Spine2'), part('Head')
    box(head, (-5, 4), (-7, -7), (18, 21), SHD2)
    box(chest, (-6, 5), (-3, 2), (16, 17), SHD); box(chest, (-1, 0), (-4, -4), (16, 16), GOLDY)   # 披肩 + 金扣（树色缩成一个点）
    for x in range(-5, 5): box(chest, (x, x), (3, 3), (4 + rnd.randint(0, 3), 17), SHD)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        lg = part(side + 'Leg')
        for _ in range(4): lg[(f((rnd.randint(0, 4), 0))[0], rnd.choice((-3, 1)), rnd.randint(1, 3))] = VIO

def look_sw4(part, U, rnd):
    # 环刃影武士：武士发髻 + 层叠大袖 + 袴；招牌 = 腰间悬浮的 6 刃剑环（俯视一眼认出）
    chest, head, hips = part('Spine2'), part('Head'), part('Hips')
    box(head, (-5, 4), (-7, -7), (18, 21), SHD2)
    box(head, (-1, 0), (1, 2), (30, 33), '#1b1b20'); box(head, (-6, 5), (-6, 5), (25, 25), VIO_D)
    box(chest, (-1, 0), (-3, -3), (16, 17), GOLDY)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        up = part(side + 'Arm')
        box(up, f((3, 8)), (-4, 2), (17, 18), SHD2); box(up, f((4, 8)), (-4, 2), (16, 16), SHD); box(up, f((8, 8)), (-4, 2), (16, 18), VIO_D)
    box(hips, (-5, 4), (-3, 2), (4, 11), '#221d2e'); box(hips, (-5, 4), (-3, 2), (4, 4), VIO_D)
    for i in range(6):
        a = math.radians(30 + 60 * i); cx, cy = -0.5 + 10 * math.cos(a), -0.5 + 10 * math.sin(a)
        for t in range(-2, 3):
            hips[(round(cx - t * math.sin(a)), round(cy + t * math.cos(a)), 10)] = VIO if t == 2 else '#c9c2e0'

def look_sw5(part, U, rnd):
    # 千刃舞者：剑环收成背后一扇刀翼；无袖舞衣露出带纹身的手臂，长马尾、腰后两条金飘带
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); sk = '#eec19a'
    box(head, (-1, 0), (6, 7), (14, 27), '#1b1b20')
    for r in ((2, 4), mx((2, 4))): box(head, r, (-6, -6), (20, 20), VIO_D)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        up, fa = part(side + 'Arm'), part(side + 'ForeArm')
        for d in (up, fa):
            for kk in list(d): d[kk] = sk
        box(up, f((4, 6)), (-2, 0), (17, 17), VIO); box(up, f((4, 6)), (-2, 0), (15, 15), GOLDY)
    for i in range(7):
        a = math.radians(15 + 25 * i)
        line(chest, (-0.5 + 3 * math.cos(a), 4, 16 + 3 * math.sin(a)), (-0.5 + 10 * math.cos(a), 4, 16 + 10 * math.sin(a)), '#c9c2e0')
        chest[(round(-0.5 + 11 * math.cos(a)), 4, round(16 + 11 * math.sin(a)))] = VIO
    box(chest, (-2, 1), (3, 4), (14, 17), GOLDY)
    for x in (-3, 2):
        for kk in range(2, 11): hips[(x, 3 + (11 - kk) // 3, kk)] = GOLDY

def look_hero6(part, U, rnd):
    # 影幕·艾伦（6 转英雄）：银发、金瞳、立领长风衣；招牌 = 比肩还宽的「影幕」披风，下摆一道紫光
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); COAT = '#1c1a24'
    for i in range(-6, 6, 2): box(head, (i, i), (5, 7), (22, 29), '#dfe3ea')
    box(chest, (-5, 4), (-3, 2), (17, 19), COAT); box(chest, (-3, 2), (-2, 1), (18, 19), '#f0d2b8')
    box(chest, (-5, 4), (-3, -3), (19, 19), GOLDY)
    box(hips, (-5, 4), (0, 2), (3 - U, 11), COAT)
    for x in range(-8, 8):
        bot = 1 - U + (2 if x in (-5, -1, 3) else 0)
        box(chest, (x, x), (4, 4), (bot, 18), COAT); box(chest, (x, x), (3, 3), (bot + 1, 18), VIO_D)
        chest[(x, 4, bot)] = VIO
    for x in (-8, 7): box(chest, (x, x), (4, 4), (1 - U, 18), GOLDY)
    for x in (-5, 4): chest[(x, 3, 18)] = GOLDY

def look_star7(part, U, rnd):
    # 万刃·艾伦（五星）：白金铠、剑脊王冠；招牌 = 背后 12 刃光轮（万刃）。不披斗篷——和 6 转的轮廓整个换掉
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); W, G = '#e6e8f0', '#e8c050'
    box(chest, (-5, 4), (-3, -3), (12, 17), W); box(chest, (-5, 4), (-3, -3), (17, 17), G)
    box(chest, (-1, 0), (-4, -4), (14, 15), LIGHT)
    box(chest, (-5, 4), (2, 2), (12, 17), W)
    box(head, (-1, 0), (-6, -5), (30, 34), G); box(head, (-4, -3), (-6, -5), (30, 32), G); box(head, (2, 3), (-6, -5), (30, 32), G)
    for side, f in (('Left', lambda r: r), ('Right', mx)):
        up = part(side + 'Arm')
        box(up, f((3, 8)), (-4, 2), (17, 19), W); box(up, f((3, 8)), (-4, 2), (17, 17), G); box(up, f((6, 6)), (-1, -1), (20, 22), G)
        lg = part(side + 'Leg'); box(lg, f((0, 4)), (-3, -3), (2, 4), W); box(lg, f((0, 4)), (-3, -3), (4, 4), G)
    for x0, y in (((-5, -1), -3), ((0, 4), -3), ((-5, -1), 2), ((0, 4), 2)):
        box(hips, x0, (y, y), (5 - U, 10), W); box(hips, x0, (y, y), (5 - U, 5 - U), G)
    for i in range(48):
        a = 2 * math.pi * i / 48; chest[(round(-0.5 + 7 * math.cos(a)), 6, round(21 + 7 * math.sin(a)))] = G
    for i in range(12):
        a = 2 * math.pi * i / 12
        line(chest, (-0.5 + 8 * math.cos(a), 6, 21 + 8 * math.sin(a)), (-0.5 + 12 * math.cos(a), 6, 21 + 12 * math.sin(a)), '#fff6d8')
    box(chest, (-1, 0), (3, 5), (20, 21), G)                                       # 光轮托架，免得看着悬空

KAI = dict(skin='#eec19a', hair='#1b1b20', style='spiky', glove='#1f1f22', build='normal', extra=[])

# ══════════════ 剑士树全部 191 个形象（docs/05 §2.4「量产」）══════════════
# 0–2 转按方向手写（锋轻 / 锋重 / 盾轻 / 盾重）；3–5 转每个机制家族一个招牌件函数 sig_f*(t, v)，
# 5 转加光环镶边（aura_trim）；6 转英雄 = 人物行 person() + 家族招牌件英雄形态 + 光环 + 号令标记；
# 五星 = star_suit 整套重画（光轮 / 冠冕按家族）。样板链 CHAIN 8 个仍用上面手写的函数。
import json
from palette import pal, oklch, u_of   # 职业色谱（tools/palette.py，色谱图 palette.html 同源）
SIDES = (('Left', lambda r: r), ('Right', mx))
SILV, STARG, STARW = '#c8ccd4', '#e8c050', '#e6e8f0'
CYAN, AMBER, EMBER, GHOST, GHOST_E, JADE, AZURE, FORT = '#6ff0ff', '#ffb040', '#ff6a2a', '#a8e0f0', '#d8fbff', '#4af0b0', '#8ac8ff', '#f0f070'
BONE, STONE, FUR, IRON, PAINT = '#e8e0c8', '#8a8070', '#6a5040', '#5a5f66', '#c8501e'
LOOK_GLOW |= {CYAN, AMBER, EMBER, GHOST_E, JADE, AZURE, FORT, '#ff5ac8'}
LOOK_MATS = dict({h: 'glow' for h in LOOK_GLOW}, **{GHOST: 'glass'})

def w_axe(c, head, edge, big=0, haft=BROWN):
    box(c, (0, 0), (-25 - big, 4), (0, 0), haft); box(c, (-1, 1), (5, 6), (-1, 1), head)
    for j in range(-25 - big, -15):                                                # 双刃斧头，刃口锯齿
        w = 6 + big - abs(j + 20 + big // 2) // 2
        box(c, (-w, w), (j, j), (0, 0), head)
        if j % 2: c[(w + 1, j, 0)] = edge; c[(-w - 1, j, 0)] = edge
def w_hammer(c, head, glow, big=0, haft=BROWN):
    box(c, (0, 0), (-22, 5), (0, 0), haft); box(c, (-1, 1), (6, 7), (-1, 1), head)
    box(c, (-4 - big, 3 + big), (-29 - big, -23), (-3 - big, 2 + big), head)
    box(c, (-4 - big, 3 + big), (-26, -26), (-3 - big, 2 + big), glow)
def w_lance(c, shaft, head, glow, gcol):
    box(c, (0, 0), (-40, 20), (0, 0), shaft); box(c, (0, 0), (21, 22), (0, 0), gcol)
    box(c, (-1, 1), (-42, -40), (-1, 1), gcol)
    for s in (-1, 1): line(c, (s * 2, -41, 0), (s * 6, -35, 0), gcol)             # 龙翼护手
    for j in range(43, 58): w = max(0, 3 - (j - 43) // 4); box(c, (-w, w), (-j, -j), (0, 0), head); c[(0, -j, 0)] = glow
LOOK_WPN.update({
    'blade_sky':        lambda c: w_blade(c, 26, guard=3, blade='#d8f4ff', edge=CYAN, gcol='#4a6a8a', wrap='#e8ecf2'),
    'blade_sky_star':   lambda c: w_blade(c, 36, w=2, guard=5, grip=4, blade='#f4fcff', edge=CYAN, gcol=STARG, wrap=STARW),
    'great_titan':      lambda c: w_blade(c, 44, w=3, guard=7, grip=7, blade='#8a7a6a', edge=AMBER, gcol='#4a3420', wrap=BROWN),
    'great_titan_star': lambda c: w_blade(c, 46, w=3, guard=8, grip=7, blade='#f0e8d8', edge=AMBER, gcol=STARG, wrap=STARW),
    'axe_saw':          lambda c: w_axe(c, '#5a5a60', EMBER),
    'axe_star':         lambda c: w_axe(c, '#f0e8e0', EMBER, big=2, haft=STARG),
    'blade_ghost':      lambda c: w_blade(c, 24, guard=3, blade='#bfe8f4', edge=GHOST_E, gcol='#3a5a6a', wrap='#2e4450'),
    'lance_dragon':     lambda c: w_lance(c, '#2a3a34', STEEL, JADE, '#8a6a3a'),
    'lance_star':       lambda c: w_lance(c, STARW, '#fff6d8', JADE, STARG),
    'hammer':           lambda c: w_hammer(c, IRON, FORT),
    'hammer_star':      lambda c: w_hammer(c, STARW, FORT, big=1, haft=STARG),
})

def shield(part, size, face, rim, mark):
    # 挂左前臂外侧（同 build_char 的 'shield'）：0 圆盾 / 1 鸢盾 / 2 塔盾；x 顺着前臂、z 是盾宽
    sh = part('LeftForeArm'); x, z = (((6, 9), (12, 20)), ((5, 10), (11, 21)), ((3, 11), (9, 23)))[size]
    box(sh, x, (-5, -4), z, face)
    for zz in z: box(sh, x, (-5, -4), (zz, zz), rim)
    for xx in x: box(sh, (xx, xx), (-5, -4), z, rim)
    m = (x[0] + x[1]) // 2; box(sh, (m - 1, m + 1), (-6, -6), (15, 17), mark)

def aura_trim(part, a, big=0):
    # 5 转起：光环方向写在肩线上。进取 = 外放、尖、金；守护 = 内收、圆、银（挂胸骨，不跟手臂甩）
    chest = part('Spine2')
    for side, f in SIDES:
        if a == 0:
            box(chest, f((4, 8 + big)), (-3, 1), (18, 18), GOLDY)
            for x in range(4, 9 + big, 2): box(chest, f((x, x)), (-1, -1), (19, 21 + big), GOLDY)
            box(chest, f((9 + big, 10 + big)), (-1, -1), (18, 18), GOLDY)
        else:
            box(chest, f((4, 7 + big)), (-3, 1), (18, 18), SILV); box(chest, f((5, 6 + big)), (-2, 0), (19, 19), SILV)
            for y in (-4, 2): box(chest, f((5, 6 + big)), (y, y), (16, 17), SILV)

def order_mark(part, h, col, tc=GOLDY):
    # 英雄号令件：h % 2 = 0 授 → 背旗，1 令 → 头后令羽；h >> 1 换形状（同家族 8 人两两不同），col = 本人专属色
    chest, head = part('Spine2'), part('Head'); k = h >> 1
    if h % 2 == 0:
        box(chest, (-7, -7), (5, 5), (8, 33), BROWN)
        if k == 0: box(chest, (-12, -8), (5, 5), (27, 33), col)                              # 方旗
        if k == 1:                                                                              # 燕尾旗
            box(chest, (-14, -8), (5, 5), (27, 33), col)
            for x in (-14, -13):
                for z in (29, 30, 31): chest.pop((x, 5, z))
        if k == 2:                                                                              # 三角长旗
            for x in range(-16, -7): w = (x + 17) // 3; box(chest, (x, x), (5, 5), (30 - w, 30 + w), col)
        if k == 3:                                                                              # 双杆旗
            box(chest, (6, 6), (5, 5), (8, 31), BROWN)
            box(chest, (-11, -8), (5, 5), (27, 32), col); box(chest, (7, 10), (5, 5), (25, 30), col)
        box(chest, (-10, -9), (5, 5), (29, 30), tc)
    else:
        if k == 0:                                                                              # 盔脊冠羽
            box(head, (-1, 0), (-2, 5), (30, 31), tc); box(head, (-1, 0), (3, 8), (32, 34), col)
        if k == 1:                                                                              # 双翎（V 字）
            for sx in (-1, 1): line(head, (-0.5 + sx, 5, 28), (-0.5 + sx * 6, 9, 36), col); head[(round(-0.5 + sx * 6), 9, 37)] = tc
        if k == 2:                                                                              # 扇形羽冠
            for i in range(5):
                a = math.radians(40 + 25 * i); line(head, (-0.5, 6, 27), (-0.5 + 8 * math.cos(a), 7, 27 + 8 * math.sin(a)), col)
            box(head, (-1, 0), (6, 6), (26, 28), tc)
        if k == 3:                                                                              # 后垂长翎
            for z in range(24, 36): head[(-1, 6 + (35 - z) // 3, z)] = col; head[(0, 6 + (35 - z) // 3, z)] = col
            box(head, (-1, 0), (5, 6), (33, 35), tc)

def buckle(build, tc=GOLDY):
    y = -4 if build == 'bulky' else -3
    return lambda part, U, rnd: box(part('Spine2'), (-1, 0), (y, y), (16, 17), tc)   # 3–5 转：树色缩成扣子

def hero_coat(F, tc=GOLDY):
    def f(part, U, rnd):
        chest, hips = part('Spine2'), part('Hips')
        for y in (-3, 2): box(chest, (-6, 5), (y, y), (17, 18), tc)               # 英雄：树色上到领口与铠边
        for x in (-6, 5): box(chest, (x, x), (-3, 2), (17, 18), tc)
        if F['coat']: box(hips, (-5, 4), (0, 2), (3 - U, 11), F['coat']); box(hips, (-5, 4), (2, 2), (3 - U, 3 - U), tc)
    return f

def fan_sword(c, ang, r0, L, col, guard, tip, w=0, o=(-0.5, 17), y=5):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    for d in range(-w, w + 1):
        line(c, (o[0] + r0 * ca - d * sa, y, o[1] + r0 * sa + d * ca), (o[0] + (r0 + L) * ca - d * sa, y + L // 4, o[1] + (r0 + L) * sa + d * ca), col)
    for s in (-2 - w, -1 - w, 1 + w, 2 + w): c[(round(o[0] + r0 * ca - s * sa), y, round(o[1] + r0 * sa + s * ca))] = guard
    c[(round(o[0] + (r0 + L + 1) * ca), y + L // 4, round(o[1] + (r0 + L + 1) * sa))] = tip

def sig_f0(part, t, v, U, rnd, F):
    # 影剑士（样板链之外）。v0 = 环刃英雄：腰间 8 刃剑环 + 短影披；v1 = 瞬影：面罩、背后长影巾、腿侧苦无，英雄背月牙刃
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    if v == 0:
        for i in range(8):
            a = math.radians(22.5 + 45 * i); cx, cy = -0.5 + 11 * math.cos(a), -0.5 + 11 * math.sin(a)
            for s in range(-2, 3): hips[(round(cx - s * math.sin(a)), round(cy + s * math.cos(a)), 10)] = VIO if s == 2 else '#c9c2e0'
        for x in range(-6, 6): box(chest, (x, x), (3, 3), (6 + (x % 3 == 0) * 2, 17), SHD)
        return
    box(head, (-5, 4), (-7, -7), (18, 21), SHD2)
    for i in range(1 + (t >= 5) + (t >= 6)):
        x = -0.5 + (i - (t >= 5) * 0.5 - (t >= 6) * 0.5) * 3
        for s in range(10 + 3 * n): box(chest, (round(x + s * (i - 1) * 0.15), round(x + s * (i - 1) * 0.15) + 1), (3 + s // 2, 3 + s // 2), (17 - s // 3, 17 - s // 3), VIO_D if s % 4 else VIO)
    for side, f in SIDES:
        ul = part(side + 'UpLeg'); box(ul, f((4, 4)), (-1, -1), (5, 8), BLK); ul[(f((4, 4))[0], -1, 9)] = VIO
        if t >= 5: x = f((10, 10))[0]; box(chest, (x, x), (0, 0), (7, 13), SHD); chest[(x, 0, 14)] = VIO
    if t >= 6:
        for i in range(25):
            a = math.radians(20 + 140 * i / 24); r = 9 + (1 if 6 < i < 18 else 0)
            chest[(round(-0.5 + r * math.cos(a)), 5, round(17 + r * math.sin(a)))] = VIO if i % 6 == 0 else VIO_D
            chest[(round(-0.5 + (r + 1) * math.cos(a)), 5, round(17 + (r + 1) * math.sin(a)))] = SHD2

def sig_f1(part, t, v, U, rnd, F):
    # 御剑士：背后悬浮飞剑扇。v0 万剑 = 剑越来越多；v1 巨剑 = 一把竖在背后的大剑，越往后两侧越多
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    box(hips, (-5, 4), (-3, 2), (6 - 2 * (t >= 5) - U, 11), F['top']); box(hips, (-5, 4), (-3, 2), (6 - 2 * (t >= 5) - U,) * 2, F['top2'])
    S = lambda *a, **k: fan_sword(chest, *a, col='#d8f4ff', guard=F['top2'], tip=CYAN, **k)
    if t == 3: [S(g, 5, 6) for g in (60, 90, 120)]
    elif v == 0:
        m = {4: 7, 5: 9, 6: 13}[t]
        for i in range(m): S(15 + 150 * i / (m - 1), 5 + (i % 2) * 2 * (t >= 5), 6 + 2 * (t >= 6))
    else:
        b = t - 4; S(90, -10, 22 + 4 * b, w=1 + b)
        if t >= 5: [S(g, 6, 7 + 2 * b) for g in (50, 130)]
        if t >= 6: [S(g, 6, 9, w=1) for g in (25, 155)]

def sig_f2(part, t, v, U, rnd, F):
    # 巨人剑士：巨型护臂 + 兽角盔。v0 撼地 = 角外撇、石拳；v1 擎天 = 角竖起、肩上石柱
    head, chest = part('Head'), part('Spine2'); n = t - 3
    box(head, (-7, 6), (-7, 6), (27, 30), F['top2']); box(head, (-7, 6), (-7, -7), (26, 26), AMBER)
    hl = 4 + 2 * n + (v == 1 and t >= 4) * (3 + n)
    for side, f in SIDES:
        x0, sx = f((6, 6))[0], 1 if side == 'Left' else -1
        if v == 1 and t >= 4: line(head, (x0, 0, 29), (x0 + sx * 2, 0, 29 + hl), BONE)
        else: line(head, (x0, 0, 29), (x0 + sx * hl, -1, 31 + hl // 2), BONE)
        fa = part(side + 'ForeArm'); box(fa, f((6, 9)), (-4 - n, 2 + n), (13 - n, 19 + n), F['top2']); box(fa, f((6, 6)), (-4 - n, 2 + n), (13 - n, 19 + n), AMBER)
        if t >= 4 and v == 0: box(part(side + 'Hand'), f((9, 12 + n)), (-4 - n, 2 + n), (13 - n, 19 + n), STONE)
        if t >= 4 and v == 1: box(chest, f((4, 8)), (-3, 1), (18, 21 + 2 * n), STONE); box(chest, f((4, 8)), (-3, 1), (21 + 2 * n,) * 2, AMBER)
    if t >= 5:
        box(chest, (-6, 5), (3, 4 + n), (10, 19), STONE)
        for z in range(11, 19, 3): box(chest, (-4, 3), (5 + n, 5 + n), (z, z), AMBER)

def sig_f3(part, t, v, U, rnd, F):
    # 狂战士：赤膊战纹 + 背后交叉锯齿双斧。v0 血怒 = 鸡冠头、缠臂；v1 不死 = 骷髅肩、骨翼（英雄）
    chest, head = part('Spine2'), part('Head'); n = t - 3
    for k in range(12, 17): chest[(-(17 - k) - 1, -4, k)] = PAINT; chest[(17 - k, -4, k)] = PAINT
    for r in ((1, 4), mx((1, 4))): box(head, r, (-6, -6), (20, 20), PAINT)
    for i in range(1 + (t >= 5) + (t >= 6)):
        y = 3 + i
        for s in (1, -1):
            xe = -0.5 + (6 + 2 * i) * s; line(chest, (-0.5 - 7 * s, y, 6), (xe, y, 23 + i), BROWN)
            xa = sorted((round(xe), round(xe + 3 * s))); box(chest, xa, (y, y), (21 + i, 26 + i), IRON)
            for z in range(21 + i, 27 + i, 2): chest[(round(xe + 4 * s), y, z)] = EMBER
    if t >= 4 and v == 0:
        box(head, (-1, 0), (-6, 5), (30, 32 + n), PAINT)
        for side, f in SIDES: box(part(side + 'ForeArm'), f((7, 8)), (-4, 2), (14, 18), '#5a2a1a')
    if t >= 4 and v == 1:
        for side, f in SIDES:
            if side == 'Left' or t >= 6:
                box(chest, f((4, 8)), (-4, 2), (18, 21), BONE); box(chest, f((5, 5)), (-5, -5), (19, 19), BLK); box(chest, f((7, 7)), (-5, -5), (19, 19), BLK)
        if t >= 6:
            for side, f in SIDES:
                for i in range(3): line(chest, (f((3, 3))[0], 3, 16 - 2 * i), (f((13 - i, 13 - i))[0], 6, 24 - 4 * i), BONE)
    if t >= 5: box(chest, (-7, 6), (-3, 3), (17, 19), FUR)

def sig_f4(part, t, v, U, rnd, F):
    # 幻影卫：半透明下摆 + 身后拖尾残影。v0 虚空行者 = 脚下虚空环；v1 替身守卫 = 身侧半透明替身盾 / 替身
    g, cg, hips, chest = part('Hips|g'), part('Spine2|g'), part('Hips'), part('Spine2'); n = t - 3
    box(g, (-5, 4), (-3, 2), (3 - U, 10), GHOST); box(hips, (-5, 4), (-3, 2), (3 - U,) * 2, GHOST_E)
    for i in range(1 + n): y = 4 + 3 * i; box(cg, (-4 + i, 3 - i), (y, y), (8 + 2 * i, 17 - i), GHOST)
    if t >= 4 and v == 0:
        for i in range(56):
            a = 2 * math.pi * i / 56; hips[(round(-0.5 + (8 + n) * math.cos(a)), round(-0.5 + (8 + n) * math.sin(a)), -U)] = GHOST_E
    if t >= 4 and v == 1:
        if t < 6: box(cg, (-14 - n, -12 - n), (-4, -3), (4, 20 + n), GHOST); box(chest, (-14 - n, -12 - n), (-4, -4), (21 + n, 21 + n), GHOST_E)
        else:
            for x0 in (-15, 10):   # 英雄：左右各站一个半透明替身
                box(cg, (x0, x0 + 4), (0, 2), (-U, 15), GHOST); box(cg, (x0 - 1, x0 + 5), (-1, 3), (16, 24), GHOST); box(chest, (x0 + 1, x0 + 3), (-2, -2), (20, 20), GHOST_E)
    if t >= 6 and v == 0:
        for side, f in SIDES:
            for i in range(5): line(cg, (f((2, 2))[0], 4, 16), (f((10 + i, 10 + i))[0], 7, 26 - 4 * i), GHOST)

def sig_f5(part, t, v, U, rnd, F):
    # 龙枪骑士：龙翼肩甲（三根翼骨 + 翼膜，挂胸骨）。v0 天坠 = 后掠龙盔角、翼更长；v1 贯阵 = 盔前独角
    chest, head = part('Spine2'), part('Head'); n = t - 3
    L = 5 + 2 * n + (v == 0 and t >= 4) * 3 + (t >= 6) * 4
    for side, f in SIDES:
        x0, sx = f((5, 5))[0], 1 if side == 'Left' else -1
        box(chest, f((3, 7)), (-3, 1), (18, 19), F['top2'])
        tips = [(x0 + sx * (i + 1) * L * 0.45, 3 + L * 0.4, 19 + (2 - i) * L * 0.5) for i in range(3)]
        for i in range(2):
            for s in range(6): line(chest, (x0, 2, 19), tuple(tips[i][q] + (tips[i + 1][q] - tips[i][q]) * s / 5 for q in range(3)), F['top'])
        for tp in tips: line(chest, (x0, 2, 19), tp, F['top2']); chest[tuple(round(q) for q in tp)] = JADE
    if t >= 4 and v == 0:
        for side, f in SIDES: line(head, (f((4, 4))[0], 2, 29), (f((5, 5))[0], 9 + n, 33 + n), BONE)
    if t >= 4 and v == 1: line(head, (-0.5, -7, 27), (-0.5, -11 - n, 30 + n), BONE)
    if t >= 5:
        box(chest, (-3, 2), (3, 3), (4 - U, 16), F['top'])
        for s in range(4 + 2 * n): box(chest, (-1, 0), (4 + s, 4 + s), (4 - U, 4 - U), JADE if s % 3 == 2 else F['top'])

def sig_f6(part, t, v, U, rnd, F):
    # 盾阵兵：背后立盾一列。v0 龟甲 = 盾围成弧形龟壳、越往后越多；v1 枪林 = 背后插一排长枪
    chest = part('Spine2'); n = t - 3
    if t == 3 or v == 0:
        m = {3: 3, 4: 5, 5: 7, 6: 9}[t]; R = 6 + n
        for i in range(m):
            a = math.radians((i - (m - 1) / 2) * min(26, 150 / max(1, m - 1))); x, y = round(-0.5 + R * math.sin(a)), round(R * math.cos(a)) - 1
            zt = 20 + 2 * n - abs(i - (m - 1) / 2)
            box(chest, (x - 1, x + 1), (y, y), (9 - U, round(zt)), F['top']); box(chest, (x - 1, x + 1), (y, y), (round(zt),) * 2, F['top2'])
            chest[(x, y + 1, round(zt) - 3)] = AZURE
    else:
        m = {4: 5, 5: 7, 6: 9}[t]
        for i in range(m):
            dx = (i - (m - 1) / 2) * 2.2; tilt = dx * 0.4
            line(chest, (-0.5 + dx, 3, 8), (-0.5 + dx + tilt, 4, 30 + 2 * n), BROWN)
            tip = (round(-0.5 + dx + tilt), 4, 31 + 2 * n); box(chest, (tip[0], tip[0]), (4, 4), (tip[2], tip[2] + 2), STEEL); chest[(tip[0], 4, tip[2] + 3)] = AZURE

def sig_f7(part, t, v, U, rnd, F):
    # 堡垒兵：城垛肩甲 + 扎地桩脚。v0 荆棘卫 = 满身尖刺；v1 城塞卫 = 背上一座塔楼
    chest = part('Spine2'); n = t - 3
    for side, f in SIDES:
        box(chest, f((3, 8 + n)), (-4, 2), (17, 18), F['top'])
        for x in range(3, 9 + n, 2): box(chest, f((x, x)), (-4, 2), (19, 20), F['top'])
        ft = part(side + 'Foot')
        for y in (-5, 1): box(ft, f((2, 2)), (y, y), (-2, 2), IRON); ft[(f((2, 2))[0], y, 3)] = F['top2']
    if t >= 4 and v == 0:
        for _ in range(10 + 6 * n):
            x, z = rnd.randint(-6, 5), rnd.randint(10, 21); sx = 1 if x >= 0 else -1
            line(chest, (x, 3, z), (x + sx, 5 + n, z + 1), '#5a4a2a'); chest[(x + sx, 6 + n, z + 1)] = FORT
        if t >= 6:
            for i in range(-6, 6, 2): box(part('Head'), (i, i), (-6, 5), (30, 32 + (i % 4 == 0) * 2), '#5a4a2a')
    if t >= 4 and v == 1:
        towers = [(-3, 2)] if t == 4 else [(-8, -4), (3, 7)] if t == 6 else [(-3, 2)]
        for x0, x1 in towers:
            top = 24 + 2 * n
            box(chest, (x0, x1), (3, 7), (10, top), STONE)
            for x in range(x0, x1 + 1, 2): box(chest, (x, x), (3, 7), (top + 1, top + 2), STONE)
            box(chest, ((x0 + x1) // 2, (x0 + x1) // 2 + 1), (8, 8), (top - 5, top - 3), FORT)
        if t == 5:
            for side, f in SIDES: box(chest, f((6, 8)), (-2, 0), (21, 24), STONE); chest[(f((7, 7))[0], -1, 25)] = FORT

def star_suit(fam, v, a, o, F):
    # 五星：白金整套 + 家族光轮（分身 / 御剑 / 虚化 / 跃击）或冠冕（变身 / 狂暴 / 阵列 / 要塞）；
    # 光环 = 金 / 银镶边，号令 = 授：肩侧两颗浮游光球 / 令：短披风
    def f(part, U, rnd):
        chest, head, hips = part('Spine2'), part('Head'), part('Hips'); W, G, gl = STARW, (STARG if a == 0 else SILV), F['glow']
        box(chest, (-5, 4), (-3, -3), (12, 17), W); box(chest, (-5, 4), (-3, -3), (17, 17), G); box(chest, (-1, 0), (-4, -4), (14, 15), gl)
        box(chest, (-5, 4), (2, 2), (12, 17), W)
        for side, s in SIDES:
            box(chest, s((3, 8)), (-4, 2), (17, 19), W); box(chest, s((3, 8)), (-4, 2), (17, 17), G); box(chest, s((6, 6)), (-1, -1), (20, 22 + (a == 0) * 2), G)
            lg = part(side + 'Leg'); box(lg, s((0, 4)), (-3, -3), (2, 4), W); box(lg, s((0, 4)), (-3, -3), (4, 4), G)
        for x0, y in (((-5, -1), -3), ((0, 4), -3), ((-5, -1), 2), ((0, 4), 2)):
            box(hips, x0, (y, y), (5 - U, 10), W); box(hips, x0, (y, y), (5 - U, 5 - U), G)
        if fam in (0, 1, 4, 5):
            for i in range(48):
                q = 2 * math.pi * i / 48; chest[(round(-0.5 + 7 * math.cos(q)), 6, round(21 + 7 * math.sin(q)))] = GHOST if fam == 4 else G
                if a and i % 2: chest[(round(-0.5 + 5 * math.cos(q)), 6, round(21 + 5 * math.sin(q)))] = gl
            box(chest, (-1, 0), (3, 5), (20, 21), G)
            m = 8 + 4 * v
            for i in range(m):
                q = 2 * math.pi * i / m
                if fam == 5 and math.sin(q) < -0.2: continue                       # 跃击：只留上半圈，像一对翼
                r1 = 12 + (fam == 5) * 3 + (fam == 1) * (i % 2) * 2
                line(chest, (-0.5 + 8 * math.cos(q), 6, 21 + 8 * math.sin(q)), (-0.5 + r1 * math.cos(q), 6, 21 + r1 * math.sin(q)), GHOST if fam == 4 else '#fff6d8')
                chest[(round(-0.5 + (r1 + 1) * math.cos(q)), 6, round(21 + (r1 + 1) * math.sin(q)))] = gl
                if fam == 1:
                    for s in (-1, 1): chest[(round(-0.5 + 8 * math.cos(q) - s * math.sin(q)), 6, round(21 + 8 * math.sin(q) + s * math.cos(q)))] = G
        else:
            for y in (-6, 5): box(head, (-6, 5), (y, y), (29, 30), G)
            for x in (-6, 5): box(head, (x, x), (-6, 5), (29, 30), G)
            if a: [box(head, (x, x), (6, 6), (29, 32 + (x % 4 == 0)), G) for x in range(-6, 6, 2)]   # 守护：冠冕后沿一排短齿
            h = 3 + 2 * v
            if fam == 2:
                for side, s in SIDES:
                    x0, sx = s((5, 5))[0], 1 if side == 'Left' else -1
                    line(head, (x0, 0, 30), (x0 + sx * 4, 0, 34 + h), BONE); line(head, (x0 + sx * 4, 0, 34 + h), (x0 + sx * 2, -1, 37 + h), G)
            if fam == 3:
                for i in range(-6, 6, 2): zt = 31 + h - int(abs(i + 0.5) // 3); box(head, (i, i), (-6, -6), (31, zt), G); head[(i, -6, zt + 1)] = EMBER
            if fam == 6:
                for (x0, x1), (y0, y1) in (((-2, 1), (-7, -7)), ((-2, 1), (6, 6)), ((-7, -7), (-2, 1)), ((6, 6), (-2, 1))):
                    box(head, (x0, x1), (y0, y1), (30, 33 + h), W); box(head, (x0, x1), (y0, y1), (33 + h, 33 + h), G)
                head[(-1, -8, 32)] = AZURE
            if fam == 7:
                for x in range(-6, 6, 2): box(head, (x, x), (-6, 5), (31, 32), G)
                box(head, (-2, 1), (-2, 1), (31, 34 + h), W); box(head, (-2, 1), (-2, 1), (35 + h, 35 + h), FORT)
        if o == 0:
            for x in (8, -10): box(chest, (x, x + 1), (0, 1), (22, 23), gl)
        else:
            box(chest, (-6, 5), (3, 3), (4 - U, 17), W); box(chest, (-6, 5), (3, 3), (4 - U,) * 2, G)
            for x in (-6, 5): box(chest, (x, x), (3, 3), (4 - U, 17), G)
    return f

FAM = [   # 8 个机制家族 = classes.ts styles[方向][分线]；top=None = 赤膊；style = 3 / 4 / 5 转发型；coat = 英雄长衣
    dict(top=SHD, top2='#1a1624', pants='#221d2e', glow=VIO, style=('hood', 'short', 'ponytail'), coat='#1c1a24', sig=sig_f0),
    dict(top='#e8ecf2', top2='#4a6a8a', pants='#3a4a5a', glow=CYAN, style=('bun', 'bun', 'long'), coat='#f4f6fa', sig=sig_f1),
    dict(top='#7a5a3a', top2='#4a3420', pants='#5a4030', glow=AMBER, style=('bald', 'bald', 'bald'), coat='#5a3a20', sig=sig_f2),
    dict(top=None, top2='#3a2a24', pants='#5a3a2a', glow=EMBER, style=('bald', 'spiky', 'spiky'), coat=None, sig=sig_f3),
    dict(top='#7aa8b8', top2='#3a5a6a', pants='#2e4450', glow=GHOST_E, style=('ponytail', 'hood', 'long'), coat='#2a3e4a', sig=sig_f4),
    dict(top='#3a6a5a', top2='#1f3a30', pants='#2a3a34', glow=JADE, style=('ponytail', 'short', 'long'), coat='#24463a', sig=sig_f5),
    dict(top='#5a6a82', top2='#36404e', pants='#3a4250', glow=AZURE, style=('helmet', 'helmet', 'helmet'), coat='#3a4658', sig=sig_f6),
    dict(top='#8a8478', top2='#55504a', pants='#4a4640', glow=FORT, style=('helmet', 'bald', 'helmet'), coat='#6a645a', sig=sig_f7),
]
FACE = [dict(KAI),                                                                    # 0–5 转的脸：方向样板（classes.ts TEMPLATE）
        dict(skin='#c98a5a', hair='#1b1b20', style='bald', glove='#5a3a22', build='bulky', extra=['beard'], beard='#1b1b20'),
        dict(skin='#f3d2b4', hair='#e4c46a', style='ponytail', glove='#1f1f22', build='slim', extra=[]),
        dict(skin='#e8b894', hair='#6e757c', style='helmet', glove='#2e3236', build='bulky', extra=['beard'], beard='#5a3a22')]
SKINS = ['#f0d2b8', '#e8b894', '#c98a5a', '#8a5a3a', '#f6dccb', '#e2a878', '#d8a07a']
HAIRS = ['#dfe3ea', '#1b1b20', '#8a3b22', '#e4c46a', '#3a2a1c', '#6a3fa8', '#2a5a8a', '#f4eeff', '#5a2a2a', '#2a6a5a', '#c87a3a']
STYLES = [['long', 'short', 'ponytail', 'spiky', 'bun', 'hood', 'long', 'ponytail'], ['bald', 'short', 'spiky', 'helmet', 'bun', 'long', 'bald', 'short']]
EYES = ['#ffd23a', VIO, CYAN, EMBER, JADE, AZURE, '#ff5ac8', AMBER]

def person(f, h, heavy_f=(2, 3, 6, 7), salt=0):
    # 英雄的人物行（五星沿用）：按 (家族, 英雄号) 错开取色，ponytail: 公式代替 64 行手填；瞳色 3h mod 8 保证同家族 8 人互不相同
    heavy, g = f in heavy_f, f + salt
    p = dict(skin=SKINS[(3 * g + h) % 7], hair=HAIRS[(5 * g + 3 * h) % 11], style=STYLES[heavy][h], eye=EYES[(f + 3 * h) % 8],
             build=('bulky' if h % 3 else 'normal') if heavy else ('slim' if h % 2 else 'normal'), extra=[])
    if heavy and h % 4 == 1: p.update(extra=['beard'], beard=p['hair'])
    return p

def look_weapons(f, t, v):
    if f == 0: return {(4, 1): ('blade_shadow', 'blade_shadow'), (5, 0): ('katana_shadow', 'katana_shadow'), (5, 1): ('blade_shadow', 'blade_shadow'),
                       (6, 0): ('nodachi', 'blade_shadow'), (6, 1): ('katana_shadow', 'blade_shadow'), (7, 0): ('blade_radiant', None), (7, 1): ('blade_radiant', 'blade_radiant')}[(t, v)]
    if t == 7: return (['blade_sky_star', 'great_titan_star', 'axe_star', 'blade_radiant', 'lance_star', 'lance_star' if v else 'blade_radiant', 'hammer_star'][f - 1], 'axe_star' if f == 3 else None)
    wr = [None, 'blade_sky', 'greatsword' if t < 6 else 'great_titan', 'axe_saw', 'blade_ghost', 'spear' if t == 3 else 'lance_dragon', 'spear' if v and t > 3 else 'sword', 'hammer'][f]
    return wr, 'axe_saw' if f == 3 and t >= 5 else 'blade_sky' if f == 1 and t == 6 and v == 0 else None

def gen_look(path, ult, T):
    t = 7 if ult else len(path); d = path[0] * 2 + path[1]; f = d * 2 + path[2]; F = T['fam'][f]
    v, a, o = (path + [0, 0, 0])[3:6]; h = v * 4 + a * 2 + o
    p = pal(T['tree'], t, u_of(path)); tc = p['trim']; acc = oklch(.80, .16, (45 * h + 23 * f) % 360)
    F = dict(F, top=F['top'] and p['main'], top2=p['sub'], pants=p['pants'], coat=F['coat'] and p['main'])
    S = lambda part, U, rnd: F['sig'](part, t, v, U, rnd, F)
    if t <= 5:
        L = dict(T['face'][d], top=F['top'], top2=F['top2'] if t < 5 or a == 0 else SILV, pants=F['pants'], glove=F['top2'],
                 style=F['style'][t - 3], hood=F['top2'], eye=F['glow'], k=(1.06, 1.09, 1.12)[t - 3])
        fx = [S, buckle(L['build'], tc)] + ([lambda part, U, rnd: aura_trim(part, a)] if t == 5 else [])
        sh = (F['top'] or IRON, F['top2'], F['glow'])
    elif t == 6:
        L = dict(person(f, v * 4 + a * 2 + o, T['heavy'], T['salt']), top=F['coat'], top2=tc, pants=F['pants'], glove=F['top2'], hood=F['top2'], k=1.14, lift=2, head_k=0.74)
        fx = [hero_coat(F, tc), S, lambda part, U, rnd: aura_trim(part, a, 1), lambda part, U, rnd: order_mark(part, h, acc, tc)]
        sh = (F['top'] or IRON, GOLDY, F['glow'])
    else:
        L = dict(person(f, v * 4 + a * 2 + o, T['heavy'], T['salt']), top=STARW, top2=STARG, pants=p['pants'], glove=STARG, hood=STARW, k=1.18, lift=4, head_k=0.7)
        fx = [T['star'](f, v, a, o, F)]
        sh = (STARW, STARG if a == 0 else SILV, F['glow'])
    if T['shield'] and d >= 2: fx.append(lambda part, U, rnd: shield(part, (1 if t >= 4 else 0) if f == 4 else 1 if f == 5 else 2, *sh))
    L['deco'] = lambda part, U, rnd: [g(part, U, rnd) for g in fx]
    L['wr'], L['wl'] = T['wpn'](f, t, v)
    return L

def look_sw1s(part, U, rnd):   # 刀盾手：皮甲 + 金围巾，不对称件 = 左臂的盾（extra 'shield'）
    chest = part('Spine2'); box(chest, (-4, 3), (-3, 2), (12, 16), '#7a5534'); box(chest, (-1, 0), (-3, -3), (13, 13), GOLDY); scarf(chest)
def look_sw01(part, U, rnd):   # 重剑士：铁胸甲 + 背后宽背板（重 = 加宽肩线）
    chest = part('Spine2'); box(chest, (-5, 4), (-4, -4), (12, 17), IRON); scarf(chest)
    box(chest, (-7, 6), (3, 3), (10, 18), IRON); box(chest, (-7, 6), (3, 3), (18, 18), GOLDY)
def look_sw10(part, U, rnd):   # 游盾卫：鸢盾 + 背后短披（轻 = 拖尾件）+ 两条围巾尾
    chest = part('Spine2'); scarf(chest, 2); box(chest, (-4, 3), (2, 2), (6, 17), '#24465c')
    shield(part, 1, '#a9b2ba', GOLD, GOLDY)
def look_sw11(part, U, rnd):   # 塔盾兵：塔盾 + 金围巾（盾 = 甲挡在正面、下盘宽）
    scarf(part('Spine2')); shield(part, 2, '#7d858c', '#4d5359', GOLDY)
    for side, f in SIDES: box(part(side + 'Leg'), f((0, 4)), (-3, -3), (1, 4), '#7d858c')


CHAIN = {   # 样板链：上面手写的 8 级（id = 职业 id，src/data/classes.ts）；k = 整体放大、lift = 腿加长格数（偶数）、head_k = 头缩比
    'sw':         dict(KAI, top='#c8b08a', top2='#8a7458', pants='#5a4a3a', glove='#6b4a2a', deco=look_sw0, wr='sword'),
    'sw-0':       dict(KAI, top='#c8b08a', top2='#7a5534', pants='#4a3a2c', glove='#3a2a1c', deco=look_sw1, wr='blade_elite'),
    'sw-00':      dict(KAI, top='#2c3a5a', top2='#1c2640', pants='#232a3a', build='slim', deco=look_sw2, wr='blade_twin', wl='blade_twin', k=1.03),
    'sw-000':     dict(KAI, style='hood', hood=SHD, top=SHD, top2='#1a1624', pants='#221d2e', glove=BLK, eye=VIO, build='slim',
                       deco=look_sw3, wr='blade_shadow', wl='blade_shadow', k=1.06),
    'sw-0000':    dict(KAI, style='short', top=SHD, top2='#1a1624', pants='#221d2e', glove=BLK, eye=VIO,
                       deco=look_sw4, wr='katana_shadow', k=1.09),
    'sw-00000':   dict(KAI, style='ponytail', top='#3a2458', top2=GOLDY, pants='#2a1c40', glove=BLK, eye=VIO, build='slim',
                       deco=look_sw5, wr='katana_shadow', wl='katana_shadow', k=1.12),
    'sw-000000':  dict(skin='#f0d2b8', hair='#dfe3ea', style='long', top='#1c1a24', top2=GOLDY, pants='#1c1a24', glove=SHD,
                       build='normal', extra=[], eye='#ffd23a', deco=look_hero6, wr='nodachi', wl='blade_shadow', k=1.14, lift=2, head_k=0.74),
    'sw-000000+': dict(skin='#f0d2b8', hair='#f4eeff', style='long', top='#e6e8f0', top2='#e8c050', pants='#c8ccd8', glove='#e8c050',
                       build='normal', extra=[], eye='#ffd23a', deco=look_star7, wr='blade_radiant', k=1.18, lift=4, head_k=0.7),
    # 其余三个方向的 1–2 转（每方向一套手写）
    'sw-1':  dict(KAI, top='#c8b08a', top2='#7a5534', pants='#4a3a2c', glove='#3a2a1c', extra=['shield'], deco=look_sw1s, wr='sword'),
    'sw-01': dict(FACE[1], top='#6a6e74', top2='#3a3e44', pants='#4a3a2c', glove='#3a2a1c', deco=look_sw01, wr='greatsword', k=1.03),
    'sw-10': dict(FACE[2], top='#24465c', top2='#16303f', pants='#2a3440', glove='#1f1f22', deco=look_sw10, wr='sword', k=1.03),
    'sw-11': dict(FACE[3], top='#5a6168', top2='#3a4046', pants='#4a5058', glove='#2e3236', deco=look_sw11, wr='sword', k=1.03),
}
def star_plus(FAMS):
    # 五星：白金整套 + 光轮 / 冠冕（star_suit）+ 本家族招牌件的英雄形态换成白金 → 头后 / 背后件不会比英雄小
    def mk(fam, v, a, o, F):
        base, sig, SF = star_suit(fam, v, a, o, F), FAMS[fam]['sig'], dict(F, top=STARW, top2=STARG)
        def f(part, U, rnd): base(part, U, rnd); sig(part, 6, v, U, rnd, SF)
        return f
    return mk

SW = dict(tree='swordsman', fam=FAM, face=FACE, wpn=look_weapons, star=star_plus(FAM), heavy=(2, 3, 6, 7), salt=0, shield=True)
# ══════════════ 射手树全部 191 个形象（同剑士的量产规则；key = 'ar'）══════════════
# 树色 = 浅蓝（远程）：0–2 转是左前臂的护臂 / 领巾，3–5 转缩成扣子，英雄上领口；p0 传统射具 / 现代火器，p1 机动 / 阵地
AR_TC, STICKY, ROPE, FEATH, FEATH2 = '#7fd0ff', '#b8ff4a', '#c8a868', '#6a4a2a', '#3a2a1a'
LOOK_GLOW.add(STICKY); LOOK_MATS[STICKY] = 'glow'

def w_bow(c, h, wood, wrap, string='#e8e2d4', recurve=0, tip=None, arrow='#c8b090', bend=5):
    # 弓身竖着（±z），握把在 y = -10；弦拉到右手（原点）并搭一支箭，拿在手里就是开弓
    y0 = -10; box(c, (0, 0), (y0 - 1, y0 + 1), (-3, 3), wrap)
    for z in range(4, h + 1):
        for s in (1, -1): c[(0, y0 + round(bend * (z / h) ** 2), s * z)] = wood
    yt, zt = y0 + bend, h
    if recurve:
        for s in (1, -1): line(c, (0, yt, s * h), (0, yt - recurve, s * (h + recurve)), tip or wood)
        yt, zt = yt - recurve, h + recurve
    for s in (1, -1): line(c, (0, yt, s * zt), (0, 1, 0), string)
    box(c, (-1, -1), (y0 - 6, 1), (0, 0), arrow); box(c, (-1, -1), (y0 - 8, y0 - 7), (0, 0), STEEL if arrow == '#c8b090' else arrow)
    box(c, (-1, -1), (-1, 1), (1, 1), AR_TC)
def w_xbow(c, L, span, wood, metal, glow=None):
    box(c, (-1, 0), (0, 1), (-4, -1), wood); box(c, (-1, 0), (-L, 6), (0, 1), wood); box(c, (-1, 0), (7, 8), (-1, 1), metal)
    box(c, (-1, 0), (-L, -L + 1), (-1, 2), metal)
    for x in range(1, span + 1):
        y = -L + 1 + round(3 * (x / span) ** 2); c[(x, y, 1)] = metal; c[(-1 - x, y, 1)] = metal
    line(c, (span, -L + 4, 1), (0, -3, 1), '#e8e2d4'); line(c, (-1 - span, -L + 4, 1), (-1, -3, 1), '#e8e2d4')
    box(c, (-1, -1), (-L - 3, -3), (2, 2), STEEL); c[(-1, -L - 4, 2)] = glow or EDGE
def w_lasso(c, rope, R, knot):
    for i in range(32):
        a = 2 * math.pi * i / 32
        for y in (0, 1): c[(round(3.5 * math.cos(a) - 0.5), y, round(3.5 * math.sin(a)))] = rope       # 手上一卷
        c[(round(R * math.cos(a) - 0.5), round(-10 - R + R * math.sin(a)), 0)] = rope                     # 甩出去的活套
    line(c, (0, -1, 0), (0, -10, 0), rope); box(c, (-1, 0), (-11, -10), (-1, 0), knot)
def w_hook(c, metal, rope, glow=None, big=0):
    for i in range(24):
        a = 2 * math.pi * i / 24; c[(round(3 * math.cos(a) - 0.5), 0, round(3 * math.sin(a)))] = rope
    box(c, (0, 0), (-12 - big, -1), (0, 0), metal); y, r = -12 - big, 3 + big // 2
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        line(c, (0, y, 0), (dx * r, y - 3, dz * r), metal); c[(dx * r, y - 2, dz * r)] = glow or metal
def w_boom(c, L, w, col, edge, wings=2):
    for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0))[:wings]:
        for s in range(L + 1):
            for q in range(-w, w + 1): c[(dx * s + dy * q, dy * s + dx * q, 0)] = col
        c[(dx * (L + 1), dy * (L + 1), 0)] = edge
def w_revolver(c, L, metal, grip, glow=None):
    box(c, (-1, 0), (0, 2), (-4, -1), grip); box(c, (-1, 0), (-3, 2), (0, 2), metal); box(c, (-2, 1), (-5, -3), (-1, 2), GUN)
    box(c, (-1, 0), (-L, -6), (1, 2), metal); c[(0, -L, 3)] = metal
    if glow: box(c, (-1, 0), (-L + 1, -6), (3, 3), glow)
def w_gl(c, metal, drum, glow):
    box(c, (-1, 1), (0, 1), (-4, -1), BLK); box(c, (-1, 1), (-8, 4), (0, 2), metal); box(c, (-2, 2), (-8, -3), (-2, 3), drum)
    box(c, (-2, 2), (-18, -9), (0, 3), metal); box(c, (-1, 1), (-18, -18), (1, 2), glow); box(c, (-1, 1), (5, 8), (-1, 2), metal)
def w_amr(c, metal, glow, L=34):
    box(c, (-1, 1), (-10, 3), (0, 2), metal); box(c, (-1, 1), (0, 1), (-4, -1), BLK); box(c, (-1, 1), (4, 10), (-1, 2), metal)
    box(c, (0, 0), (-L, -11), (1, 2), GUN); box(c, (-1, 1), (-L - 3, -L - 1), (0, 3), BLK)
    box(c, (0, 0), (-8, 1), (4, 5), BLK); box(c, (0, 0), (-9, -9), (4, 5), glow)
    for s in (1, -1): line(c, (0, -L + 4, 0), (s * 3, -L + 2, -6), BLK)
def w_rail(c, body, glow, L=24):
    box(c, (-1, 1), (0, 1), (-4, -1), BLK); box(c, (-1, 1), (-10, 5), (0, 2), body); box(c, (-1, 1), (6, 9), (-1, 1), body)
    for x in (-2, 2): box(c, (x, x), (-L, -6), (1, 1), body)
    box(c, (0, 0), (-L + 1, -7), (1, 1), glow)
    for y in range(-L + 2, -6, 4): box(c, (-2, 2), (y, y), (-1, 3), GUN)
LOOK_WPN.update({
    'bow':           lambda c: w_bow(c, 14, '#8a6a3a', BROWN),
    'bow_hunt':      lambda c: w_bow(c, 16, '#6a4a2a', AR_TC),
    'bow_recurve':   lambda c: w_bow(c, 16, '#5a3a22', '#2a2a2e', recurve=3, tip=BONE),
    'longbow':       lambda c: w_bow(c, 22, '#8a6a3a', BROWN, bend=4),
    'bow_star':      lambda c: w_bow(c, 22, STARW, STARG, string=LIGHT, recurve=4, tip=STARG, arrow=LIGHT),
    'beam_bow':      lambda c: w_bow(c, 18, '#e0e6ee', '#3a4a6a', string=AZURE, recurve=3, tip=AZURE, arrow=AZURE),
    'xbow':          lambda c: w_xbow(c, 14, 8, '#6a4a2a', IRON),
    'xbow_heavy':    lambda c: w_xbow(c, 18, 12, '#4a3020', '#3a3a3c', glow=EMBER),
    'xbow_star':     lambda c: w_xbow(c, 20, 13, STARW, STARG, glow=LIGHT),
    'lasso':         lambda c: w_lasso(c, ROPE, 5, '#6a7a4a'),
    'hook':          lambda c: w_hook(c, IRON, ROPE, JADE),
    'hook_star':     lambda c: w_hook(c, STARG, STARW, LIGHT, big=4),
    'boom_cross':    lambda c: w_boom(c, 9, 1, '#7a4a8a', '#ff5ac8', 4),
    'boom_war':      lambda c: w_boom(c, 16, 2, '#4a2a5a', '#ff5ac8'),
    'boom_star':     lambda c: w_boom(c, 15, 1, STARW, LIGHT, 4),
    'revolver':      lambda c: w_revolver(c, 13, '#8a8f94', '#5a3a22'),
    'revolver_star': lambda c: w_revolver(c, 15, STARW, STARG, glow=LIGHT),
    'glauncher':     lambda c: w_gl(c, '#454a28', GUN, STICKY),
    'gl_star':       lambda c: w_gl(c, STARW, STARG, LIGHT),
    'amr':           lambda c: w_amr(c, '#3a4238', CYAN),
    'sniper_star':   lambda c: w_amr(c, STARW, LIGHT, L=40),
    'railgun':       lambda c: w_rail(c, '#c8d4e4', AZURE),
    'rail_star':     lambda c: w_rail(c, STARW, LIGHT, L=30),
})

def bracer(part, col=AR_TC): box(part('LeftForeArm'), (7, 8), (-3, 1), (14, 18), col)   # 射手护臂：0–2 转的树色件
def strap(chest):
    for k in range(12, 18): chest[(k - 15, -3, k)] = BELT
def quiver(chest, m, col, fl, tall=0, y=2):
    box(chest, (-3, -1), (y, y + 1), (10, 17 + tall), col)
    for x, yy in ((-3, y), (-1, y), (-2, y + 1), (-3, y + 1), (-1, y + 1))[:m]:
        box(chest, (x, x), (yy, yy), (18 + tall, 19 + tall), '#c8b090'); chest[(x, yy, 20 + tall)] = fl
def neckerchief(chest):
    box(chest, (-4, 3), (-3, -3), (16, 17), AR_TC); box(chest, (-2, 1), (-3, -3), (14, 15), AR_TC); box(chest, (-1, 0), (-3, -3), (13, 13), AR_TC)

def look_ar0(part, U, rnd): quiver(part('Spine2'), 3, BROWN, AR_TC)                         # 射手：短褂 + 箭袋（浅蓝箭羽）+ 木弓
def look_ar1(part, U, rnd):    # 猎手：披肩 + 斜挎箭袋 + 浅蓝护臂
    chest = part('Spine2'); bracer(part); strap(chest); quiver(chest, 3, '#4a3a26', AR_TC)
    box(chest, (-5, 4), (-3, 2), (16, 17), '#5a4a32'); box(chest, (-1, 0), (-4, -4), (16, 16), AR_TC)
def look_ar1g(part, U, rnd):   # 枪手：夹克 + 浅蓝领巾 + 右腿枪套
    chest, hips = part('Spine2'), part('Hips'); neckerchief(chest)
    ul = part('RightUpLeg'); box(ul, mx((4, 4)), (-2, 1), (5, 8), BELT); box(ul, mx((4, 5)), (0, 1), (8, 9), GUN)
    for x in (-4, -2, 1, 3): hips[(x, -3, 10)] = '#d8a830'
def look_ar00(part, U, rnd):   # 游猎者：撕边短披 + 高箭袋 + 头上一根浅蓝羽
    chest, head = part('Spine2'), part('Head'); bracer(part); strap(chest)
    for x in range(-4, 4): box(chest, (x, x), (2, 2), (9 + rnd.randint(0, 3), 17), '#3e4a2a')
    quiver(chest, 5, '#4a3a26', AR_TC, 2, y=3); line(head, (4, 2, 28), (6, 5, 32), AR_TC)
def look_ar01(part, U, rnd):   # 守望射手：宽檐帽 + 长摆外套 + 长弓
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); bracer(part); strap(chest); quiver(chest, 5, BROWN, '#e8e2d4', 1)
    box(head, (-8, 7), (-8, 7), (28, 28), '#4a3a26'); box(head, (-6, 5), (-6, 5), (29, 31), '#4a3a26'); box(head, (-6, 5), (-6, 5), (29, 29), AR_TC)
    box(hips, (-5, 4), (2, 2), (4, 11), '#3a3028'); box(hips, (-5, 4), (-3, -3), (4, 8), '#3a3028')
def look_ar10(part, U, rnd):   # 突击枪手：战术背心 + 领巾 + 护膝
    chest = part('Spine2'); neckerchief(chest)
    box(chest, (-4, 3), (-3, -3), (12, 15), '#3a3a3e')
    for x in ((-4, -3), (2, 3), (-1, 0)): box(chest, x, (-4, -4), (12, 13), '#2a2a2e')
    for side, f in SIDES: box(part(side + 'Leg'), f((1, 3)), (-3, -3), (3, 4), '#2a2a2e')
def look_ar11(part, U, rnd):   # 远射兵：贝雷帽 + 肩上伪装草 + 狙击枪
    chest, head = part('Spine2'), part('Head'); neckerchief(chest)
    box(head, (-6, 5), (-6, 5), (29, 30), '#3a4a38'); box(head, (-7, -6), (-6, 5), (28, 29), '#3a4a38'); head[(4, -7, 29)] = AR_TC
    for _ in range(26): chest[(rnd.randint(-7, 6), rnd.randint(-3, 2), rnd.randint(17, 19))] = rnd.choice(('#4a6a3a', '#6a7a4a', '#3a4a2a'))

def hawk(c, x, y, z, s, spread, body, wing, eye):
    # 立着的鹰：身 2×2×(3+s)、头朝前、琥珀喙；spread = 张翼格数（0 = 收翼）
    box(c, (x, x + 1), (y, y + 1), (z, z + 2 + s), body); box(c, (x, x + 1), (y - 1, y + 1), (z + 3 + s, z + 4 + s), wing)
    c[(x, y - 2, z + 3 + s)] = AMBER; c[(x + 1, y - 2, z + 3 + s)] = AMBER
    c[(x, y - 1, z + 4 + s)] = eye; c[(x + 1, y - 1, z + 4 + s)] = eye
    box(c, (x, x + 1), (y + 2, y + 2), (z - 2, z), wing)
    for i in range(1, spread + 1):
        for xx in (x - i, x + 1 + i): box(c, (xx, xx), (y, y + 1), (z + s + i // 3, z + s + 1 + i // 3), wing if i < spread else body)

def sig_a0(part, t, v, U, rnd, F):
    # 驯鹰猎手：左肩一只鹰 + 鹰手套。v0 猛禽 = 褐鹰张翼、越往后翼越大；v1 灵隼 = 灰隼收翼 + 挎包，英雄头顶再飞一只
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    box(part('LeftForeArm'), (7, 8), (-3, 1), (13, 18), F['top2'])
    b, w = (FEATH, FEATH2) if v == 0 else ('#8a96a8', '#4a5668')
    hawk(chest, 5, -1, 18, n + (t >= 6), 0 if t == 3 or v == 1 else 2 + 2 * n, b, w, F['glow'])
    if t >= 4 and v == 1:
        box(hips, (-7, -6), (-2, 1), (6, 10), BROWN); box(hips, (-7, -6), (-2, 1), (10, 10), F['top2'])
        if t >= 6: hawk(chest, -9, 2, 26, 1, 4, b, w, F['glow'])
    if t >= 5:
        for x in range(-5, 5): box(chest, (x, x), (2, 2), (11 + (x % 2) * 2, 17), w)
        for x in range(-5, 5, 3): chest[(x, 2, 11 + (x % 2) * 2)] = F['glow']

def sig_a1(part, t, v, U, rnd, F):
    # 飞索游侠：左腰一卷绳。v0 绊索 = 右腰一串流星锤；v1 钩爪 = 背上抓钩；5 转斜挎绳，英雄背后一个大活套
    chest, hips = part('Spine2'), part('Hips'); n = t - 3; R = 2 + (n + 1) // 2
    for i in range(20):
        a = 2 * math.pi * i / 20
        for x in (4, 5): hips[(x, round(-0.5 + R * math.cos(a)), round(8 + R * math.sin(a)))] = ROPE
    if t >= 4 and v == 0:
        for i in range(1 + n):
            x = -5 - i; line(hips, (x, -1, 10), (x, -1 - i, 5 - i), ROPE); box(hips, (x - 1, x), (-2 - i, -1 - i), (3 - i, 4 - i), IRON)
    if t >= 4 and v == 1:
        tip = (-0.5 + n, 3, 21 + 2 * n); line(chest, (-0.5, 3, 8), tip, IRON)
        for dx in (-2, 2):
            line(chest, tip, (tip[0] + dx, 4, tip[2] + 3), IRON); chest[(round(tip[0] + dx), 4, tip[2] + 3)] = F['glow']
    if t >= 5:
        for k in range(10, 18): chest[(14 - k, -3, k)] = ROPE
    if t >= 6:
        for i in range(48):
            a = 2 * math.pi * i / 48; chest[(round(-0.5 + 9 * math.cos(a)), 5, round(18 + 9 * math.sin(a)))] = F['glow'] if i % 8 == 0 else ROPE

def sig_a2(part, t, v, U, rnd, F):
    # 重弩手：背后弩匣。v0 串钉 = 匣侧斜插长钉、越往后越多；v1 钉墙 = 背上立一面大护板，下沿一排桩
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    box(chest, (-3, 2), (2, 4), (9, 16 + n), F['top2'])
    for x in range(-3, 3, 2): box(chest, (x, x), (3, 3), (17 + n, 18 + n), STEEL); chest[(x, 3, 19 + n)] = F['glow']
    if t >= 4 and v == 0:
        for i in range(2 + 2 * n):
            s = 1 if i % 2 else -1; x0 = 3 if s > 0 else -4
            line(chest, (x0, 3, 10 + i), (x0 + s * (4 + n), 4, 13 + i), STEEL); chest[(x0 + s * (5 + n), 4, 13 + i)] = F['glow']
    if t >= 4 and v == 1:
        top = 20 + 2 * n; box(chest, (-6, 5), (5, 5), (5 - U, top), F['top'])
        for x in (-6, 5): box(chest, (x, x), (5, 5), (5 - U, top), F['top2'])
        box(chest, (-6, 5), (5, 5), (top, top), F['top2'])
        for x in range(-5, 5, 2): box(chest, (x, x), (5, 5), (2 - U, 4 - U), STEEL)
    if t >= 5:
        for side, f in SIDES: box(chest, f((4, 7)), (-3, 1), (18, 18), F['top2']); chest[(f((6, 6))[0], -3, 19)] = STEEL
    if t >= 6: box(hips, (-7, -6), (-2, 1), (7, 10), IRON); line(hips, (-7, -1, 10), (-9, -1, 12), IRON)

def sig_a3(part, t, v, U, rnd, F):
    # 回旋镖手：背后十字交叉的回旋镖。v0 交叉 = 越背越多；v1 战镖 = 一支越来越大的重镖；英雄腰间环绕 4 支
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    m, L = (2, 6) if t == 3 else ((2 + n, 6 + n) if v == 0 else (1, 9 + 3 * n))
    for i in range(m):
        a0 = math.radians(45 + 90 * i / m)
        for a in (a0, a0 + math.pi / 2):
            for y in (3, 4): line(chest, (-0.5, y, 15), (-0.5 + L * math.cos(a), y, 15 + L * math.sin(a)), F['top'])
            chest[(round(-0.5 + (L + 1) * math.cos(a)), 3, round(15 + (L + 1) * math.sin(a)))] = F['glow']
    if t >= 5:
        for side, f in SIDES: box(hips, f((4, 5)), (-2, 1), (7, 10), F['top2'])
    if t >= 6:
        for i in range(4):
            a = math.pi / 4 + math.pi / 2 * i; cx, cy = -0.5 + 10 * math.cos(a), -0.5 + 10 * math.sin(a)
            for d in range(-2, 3): hips[(round(cx + d), round(cy), 10)] = F['top']; hips[(round(cx), round(cy + d), 10)] = F['top']
            hips[(round(cx + 3), round(cy), 10)] = F['glow']

def sig_a4(part, t, v, U, rnd, F):
    # 双枪客：双腿枪套 + 风衣下摆（越往后越长）。v0 枪舞 = 领口拖一条长巾；v1 快拔 = 牛仔帽；5 转子弹带，英雄短斗篷
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    for side, f in SIDES:
        ul = part(side + 'UpLeg'); box(ul, f((4, 4)), (-2, 1), (5, 8), BELT); box(ul, f((4, 5)), (0, 1), (8, 9), GUN)
    for x0, x1 in ((-5, -1), (0, 4)): box(hips, (x0, x1), (2, 2), (8 - 2 * n - U, 11), F['top'])
    if t >= 4 and v == 0:
        box(chest, (-5, 4), (-3, 2), (17, 17), F['top2'])
        for s in range(6 + 3 * n): chest[(2 + s // 4, 3 + s // 2, 17 - s // 3)] = F['glow'] if s % 5 == 4 else F['top2']
    if t >= 4 and v == 1:
        box(head, (-8, 7), (-8, 7), (28, 28), F['top2']); box(head, (-5, 4), (-5, 4), (29, 30 + n), F['top2']); box(head, (-5, 4), (-5, 4), (29, 29), F['glow'])
    if t >= 5:
        for k in range(12, 18): chest[(k - 15, -3, k)] = BELT; chest[(k - 15, -4, k)] = F['glow'] if k % 2 else '#d8a830'
    if t >= 6:
        box(chest, (-6, 5), (3, 3), (13, 18), F['top'])
        for x in range(-6, 6): box(chest, (x, x), (3, 3), (11 + (x % 2), 12), F['top2'])

def sig_a5(part, t, v, U, rnd, F):
    # 榴弹兵：胸前榴弹带 + 背后发射筒。v0 跳弹 = 肩上弹簧弹；v1 粘弹 = 身上糊着发光粘液；5 转大弹药包，英雄背后弹鼓
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    for k in range(12, 18): chest[(14 - k, -3, k)] = BELT; chest[(14 - k, -4, k)] = '#4c5e2e' if k % 2 else F['glow']
    if t >= 5: box(chest, (-5, 4), (2, 4), (9, 16), F['top'])
    box(chest, (-3, 0), (3, 6), (10, 19 + n), F['top2']); box(chest, (-2, -1), (4, 5), (19 + n, 19 + n), F['glow'])
    if t >= 4 and v == 0:
        for side, f in SIDES:
            x = f((6, 6))[0]
            for z in range(18, 21 + n): chest[(x + (z % 2), -1, z)] = STEEL
            box(chest, (x, x + 1), (-2, -1), (21 + n, 22 + n), '#4c5e2e')
    if t >= 4 and v == 1:
        for _ in range(6 + 4 * n): (chest if rnd.random() < 0.6 else hips)[(rnd.randint(-5, 4), rnd.choice((-3, 2)), rnd.randint(9, 17))] = STICKY
    if t >= 6:
        for i in range(32):
            a = 2 * math.pi * i / 32; chest[(round(-0.5 + 6 * math.cos(a)), 7, round(15 + 6 * math.sin(a)))] = F['top2']
        box(chest, (-1, 0), (7, 7), (14, 15), F['glow'])

def sig_a6(part, t, v, U, rnd, F):
    # 狙击手：背上斜挎长枪 + 右眼单片镜。v0 反器材 = 枪口制退器 + 右肩重甲；v1 猎首 = 伪装草披风；英雄头上测距天线
    chest, head = part('Spine2'), part('Head'); n = t - 3; top = 22 + 2 * n
    line(chest, (-6, 3, 6), (5, 3, top), GUN); box(chest, (-2, 0), (4, 4), (13, 15), BLK)
    box(head, (-5, -2), (-7, -7), (20, 24), BLK); box(head, (-4, -3), (-7, -7), (21, 23), F['glow'])
    if t >= 4 and v == 0:
        box(chest, (4, 6), (2, 4), (top, top + 2), BLK); box(chest, mx((4, 8)), (-3, 1), (18, 19 + n), F['top2'])
    if t >= 4 and v == 1:
        for _ in range(14 + 8 * n):
            chest[(rnd.randint(-6, 5), rnd.randint(2, 3), rnd.randint(8 - n, 18))] = rnd.choice(('#4a6a3a', '#6a7a4a', '#3a4a2a'))
    if t >= 5: box(part('Hips'), (4, 5), (-2, 1), (7, 10), F['top2'])
    if t >= 6: line(head, (4, 3, 29), (6, 4, 35), BLK); head[(6, 4, 36)] = F['glow']

def sig_a7(part, t, v, U, rnd, F):
    # 能量射手：胸口发光核心。v0 电磁 = 前臂线圈 + 背后电容鳍；v1 激光 = 肩上浮游棱镜；英雄背后光环
    chest = part('Spine2'); n = t - 3
    box(chest, (-2, 1), (-3, -3), (13, 16), F['top2']); box(chest, (-1, 0), (-4, -4), (14, 15), F['glow'])
    box(chest, (-2, 1), (2, 3), (11, 15), F['top2'])
    if t >= 4 and v == 0:
        for side, f in SIDES:
            for z in (14, 18): box(part(side + 'ForeArm'), f((7, 8)), (-3, 1), (z, z), F['glow'])
        for i in range(2 + n):
            x = -3 + i * 2 - n; box(chest, (x, x), (4, 6 + n), (10, round(18 + n - abs(i - (1 + n) / 2))), F['top']); chest[(x, 6 + n, 12)] = F['glow']
    if t >= 4 and v == 1:
        for side, f in SIDES:
            for i in range(1 + n):
                x = f((6 + 2 * i, 6 + 2 * i))[0]; z = 21 + i * 2
                box(chest, (x, x), (-1, -1), (z, z + 2), F['glow']); chest[(x, -1, z + 3)] = '#e0e6ee'
    if t >= 5:
        for side, f in SIDES: box(part(side + 'Arm'), f((4, 6)), (-3, -3), (16, 16), F['glow'])
    if t >= 6:
        for i in range(40):
            a = 2 * math.pi * i / 40; chest[(round(-0.5 + 8 * math.cos(a)), 6, round(19 + 8 * math.sin(a)))] = F['glow'] if i % 5 == 0 else '#e0e6ee'

AR_FAM = [   # 8 个家族 = classes.ts ARCHER styles[方向][分线]：游猎者（驯鹰 / 飞索）、守望（重弩 / 回旋）、突击（双枪 / 榴弹）、远射（狙击 / 能量）
    dict(top='#7a6a48', top2='#4a3a26', pants='#3e3426', glow=AMBER, style=('hood', 'short', 'long'), coat='#5a4a32', sig=sig_a0),
    dict(top='#6a7a4a', top2='#3e4a2a', pants='#3a3a2a', glow=JADE, style=('ponytail', 'spiky', 'ponytail'), coat='#4a5a34', sig=sig_a1),
    dict(top='#6a5a4a', top2='#3a3028', pants='#4a4038', glow=EMBER, style=('helmet', 'short', 'helmet'), coat='#4a3e30', sig=sig_a2),
    dict(top='#7a4a8a', top2='#4a2a5a', pants='#3a2a44', glow='#ff5ac8', style=('short', 'bun', 'long'), coat='#5a3468', sig=sig_a3),
    dict(top='#8a5a3a', top2='#5a3a22', pants='#3a3a44', glow=FORT, style=('short', 'spiky', 'long'), coat='#6a4428', sig=sig_a4),
    dict(top='#6a7040', top2='#454a28', pants='#4a4a30', glow=STICKY, style=('helmet', 'bald', 'helmet'), coat='#55603a', sig=sig_a5),
    dict(top='#4a5a48', top2='#2e3a2c', pants='#353d33', glow=CYAN, style=('hood', 'hood', 'short'), coat='#3a4838', sig=sig_a6),
    dict(top='#e0e6ee', top2='#3a4a6a', pants='#2a3448', glow=AZURE, style=('short', 'ponytail', 'long'), coat='#c8d4e4', sig=sig_a7),
]
AR_FACE = [dict(CHARS['jet'], extra=[]), dict(CHARS['vera'], extra=[]),                         # TEMPLATE.archer：机动 jet / 阵地 vera
           dict(CHARS['jet'], extra=['goggles']), dict(CHARS['vera'], extra=['holster'])]

def ar_look_weapons(f, t, v):
    if t == 7: return [('bow_star', None), ('hook_star', None), ('xbow_star', None), ('boom_star', 'boom_star' if v == 0 else None),
                       ('revolver_star', 'revolver_star'), ('gl_star', None), ('sniper_star', None), ('rail_star' if v == 0 else 'bow_star', None)][f]
    if f == 0: return 'bow_recurve', None
    if f == 1: return ('hook' if v == 1 and t >= 4 else 'lasso'), None
    if f == 2: return ('xbow_heavy' if v == 0 and t >= 5 else 'xbow'), None
    if f == 3: return ('boomerang' if t == 3 else 'boom_cross' if v == 0 else 'boom_war'), ('boom_cross' if v == 0 and t >= 5 else None)
    if f == 4: return ('pistol', 'pistol') if t == 3 else ('smg', 'smg') if v == 0 else ('revolver', 'revolver')
    if f == 5: return 'glauncher', None
    if f == 6: return ('amr' if v == 0 and t >= 4 else 'sniper'), None
    return ('railgun' if v == 0 and t >= 4 else 'beam_bow'), None

AR = dict(tree='archer', fam=AR_FAM, face=AR_FACE, wpn=ar_look_weapons, star=star_plus(AR_FAM), heavy=(2, 5), salt=3, shield=False)
AR_CHAIN = {   # 手写：基础 + 1 转 2 个 + 2 转 4 个（每方向一套）
    'ar':    dict(AR_FACE[0], top='#b8a47a', top2='#8a7458', pants='#5a4a3a', glove='#6b4a2a', deco=look_ar0, wr='bow'),
    'ar-0':  dict(AR_FACE[0], style='hood', hood='#5a4a32', top='#7a6a48', top2='#4a3a26', pants='#3e3426', glove='#3a2a1c', deco=look_ar1, wr='bow_hunt'),
    'ar-1':  dict(AR_FACE[0], top='#5a4a3a', top2='#3a2a1c', pants='#3a3a3e', glove='#1f1f22', deco=look_ar1g, wr='pistol'),
    'ar-00': dict(AR_FACE[0], top='#6a7a4a', top2='#3e4a2a', pants='#3a3a2a', glove='#3e4a2a', build='slim', deco=look_ar00, wr='bow_recurve', k=1.03),
    'ar-01': dict(AR_FACE[1], top='#6a5a4a', top2='#3a3028', pants='#4a4038', glove='#3a3028', deco=look_ar01, wr='longbow', k=1.03),
    'ar-10': dict(AR_FACE[2], top='#8a5a3a', top2='#5a3a22', pants='#3a3a44', glove='#1f1f22', deco=look_ar10, wr='smg', k=1.03),
    'ar-11': dict(AR_FACE[3], top='#4a5a48', top2='#2e3a2c', pants='#353d33', glove='#2e3a2c', deco=look_ar11, wr='sniper', k=1.03),
}
# ══════════════ 法师树全部 191 个形象（同一套量产规则；key = 'mg'）══════════════
# 树色 = 浅紫（远程施法）：0–2 转是领口宝石 / 书签，3–5 转缩成扣子，英雄上领口；p0 元素 / 秘法，p1 外放 / 引导
# 所有法师都穿长袍：背后 + 两侧的长下摆（robe），正面开襟露腿
MG_TC, VOID, HEX, BLOOD, SOUL = '#c8a8ff', '#16121e', '#ff7ae0', '#8a1a2a', '#9affe0'
MG_M, MG_S = '#a03a2a', '#d07a30'   # 手写链的「主 / 辅」占位色：recolor 换成本格色谱的主色 / 辅色
LOOK_GLOW |= {MG_TC, HEX, SOUL}; LOOK_MATS.update({MG_TC: 'glow', HEX: 'glow', SOUL: 'glow'})

def w_staff(c, L, wood, metal, glow, kind=0, gem=None):
    # 法杖：握把在原点，杖身沿 -y；杖头 kind 0 爪托宝石 / 1 圆环 / 2 叉形（雷）/ 3 骷髅 / 4 羊角 / 5 镰刀
    box(c, (0, 0), (-L, 8), (0, 0), wood); box(c, (-1, 1), (-L, -L), (-1, 1), metal); box(c, (-1, 1), (8, 9), (-1, 1), metal)
    y, g = -L - 1, gem or glow
    if kind == 0:
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)): line(c, (0, y, 0), (dx * 2, y - 3, dz * 2), metal)
        box(c, (-1, 1), (y - 4, y - 2), (-1, 1), g)
    if kind == 1:
        for i in range(24):
            a = 2 * math.pi * i / 24; c[(round(4 * math.cos(a)), round(y - 4 + 4 * math.sin(a)), 0)] = metal
        box(c, (0, 0), (y - 5, y - 3), (-1, 1), g); c[(0, y - 4, 0)] = glow
    if kind == 2:
        for s in (-1, 1): line(c, (0, y, 0), (s * 3, y - 3, 0), metal); line(c, (s * 3, y - 3, 0), (s * 2, y - 7, 0), glow)
        box(c, (0, 0), (y - 3, y - 1), (0, 0), g)
    if kind == 3:
        box(c, (-2, 2), (y - 4, y), (-2, 2), BONE); box(c, (-1, 1), (y - 3, y - 2), (-3, -3), VOID)
        for x in (-1, 1): c[(x, y - 3, -3)] = glow
    if kind == 4:
        box(c, (-1, 1), (y - 2, y), (-1, 1), metal)
        for s in (-1, 1): line(c, (s, y - 1, 1), (s * 4, y - 4, 3), BONE); line(c, (s * 4, y - 4, 3), (s * 3, y - 6, 0), BONE)
        box(c, (0, 0), (y - 4, y - 3), (0, 1), g)
    if kind == 5:
        box(c, (-1, 1), (y - 1, y), (-1, 1), metal)
        for i in range(12): c[(0, y - 1 + i // 4, -1 - i)] = metal; c[(0, y + i // 4, -1 - i)] = EDGE
        c[(0, y - 2, 0)] = glow
def w_wand(c, L, wood, glow, tip=None):
    box(c, (0, 0), (-L, 3), (0, 0), wood); box(c, (-1, 1), (0, 1), (-1, 1), tip or wood); box(c, (0, 0), (-L - 2, -L - 1), (0, 0), glow)
def w_orb(c, R, shell, core, cage=None):
    # 手持法球：托在掌前（-y 一点），外壳 + 内核；cage = 外面一圈金属箍
    cy = -R - 1
    for i in range(-R, R + 1):
        for j in range(-R, R + 1):
            for k in range(-R, R + 1):
                d = i * i + j * j + k * k
                if d <= R * R: c[(i, cy + j, k)] = core if d <= (R - 1.5) ** 2 else shell
    if cage:
        for i in range(32): a = 2 * math.pi * i / 32; c[(round((R + 1) * math.cos(a)), round(cy + (R + 1) * math.sin(a)), 0)] = cage
def w_tome(c, cover, page, glow, big=0):
    # 打开的书托在手上：书脊沿 y，两页摊开（±x），上方浮一枚符文
    w, h = 4 + big, 5 + big
    box(c, (-w, w), (-h - 2, -1), (0, 0), cover); box(c, (-w + 1, w - 1), (-h - 1, -2), (1, 1), page)
    box(c, (0, 0), (-h - 2, -1), (1, 1), cover)
    for s in (-1, 1): box(c, (s * 2, s * 2), (-h, -3), (1, 1), '#8a7a6a')
    box(c, (-1, 0), (-h // 2 - 2, -h // 2 - 1), (4, 5), glow)
LOOK_WPN.update({
    'wand':        lambda c: w_wand(c, 10, '#6a4a2a', AMBER),
    'wand_ivory':  lambda c: w_wand(c, 12, BONE, MG_TC, tip=GOLD),
    'wand_hex':    lambda c: w_wand(c, 12, '#2a2030', HEX, tip=SILV),
    'wand_star':   lambda c: w_wand(c, 14, STARW, LIGHT, tip=STARG),
    'staff':       lambda c: w_staff(c, 26, '#6a4a2a', GOLD, AMBER),
    'staff_prism': lambda c: w_staff(c, 30, '#4a3a2a', GOLD, CYAN, 0, EMBER),
    'staff_storm': lambda c: w_staff(c, 32, '#3a3a44', SILV, CYAN, 2),
    'staff_earth': lambda c: w_staff(c, 30, '#5a4030', STONE, FORT, 0, '#d8b860'),
    'staff_void':  lambda c: w_staff(c, 32, '#2a2430', IRON, VIO, 1, VOID),
    'staff_horn':  lambda c: w_staff(c, 30, '#3a1a1a', IRON, STICKY, 4),
    'staff_skull': lambda c: w_staff(c, 30, '#3a3430', IRON, SOUL, 3),
    'scythe':      lambda c: w_staff(c, 34, '#2a2620', IRON, SOUL, 5),
    'staff_star':  lambda c: w_staff(c, 36, STARW, STARG, LIGHT, 1, '#fff6d8'),
    'scythe_star': lambda c: w_staff(c, 38, STARW, STARG, LIGHT, 5),
    'orb_void':    lambda c: w_orb(c, 3, '#3a2a5a', VOID, GOLD),
    'orb_glass':   lambda c: w_orb(c, 3, GHOST, HEX),
    'orb_star':    lambda c: w_orb(c, 4, '#fff6d8', LIGHT, STARG),
    'tome':        lambda c: w_tome(c, '#5a3a22', '#e8dcc0', MG_TC),
    'tome_hex':    lambda c: w_tome(c, '#3a1a1a', '#d8c8b0', STICKY, 1),
    'tome_bone':   lambda c: w_tome(c, '#4a4440', BONE, SOUL, 1),
    'tome_star':   lambda c: w_tome(c, STARW, '#fff6d8', LIGHT, 2),
})

def robe(part, U, n, top, trim):
    # 法袍下摆：背后一片 + 两侧各一片（在腿外侧，不挡腿），n = 下摆长度（越高转越长），下沿一圈装饰色
    hips = part('Hips'); z0 = 8 - n - U
    box(hips, (-5, 4), (1, 2), (z0, 11), top); box(hips, (-5, 4), (2, 2), (z0, z0), trim)
    for x in (-6, 5): box(hips, (x, x), (-3, 2), (z0 + 1, 11), top); box(hips, (x, x), (-3, 2), (z0 + 1, z0 + 1), trim)
def mg_hat(head, col, band, h=6, tilt=1):
    # 尖顶法师帽：宽檐 + 向后弯的尖顶
    box(head, (-8, 7), (-8, 7), (28, 28), col); box(head, (-6, 5), (-6, 5), (29, 29), band)
    for i in range(h):
        r = max(0, 5 - i); box(head, (-r - 1 + (i > 2), r - (i > 2)), (-r - 1 + i // 3 * tilt, r + i // 3 * tilt), (30 + i, 30 + i), col)
    head[(-1, 1 + h // 3 * tilt + 2, 30 + h)] = band
def skull(c, x, y, z, eye, s=0):
    box(c, (x, x + 2 + s), (y, y + 2 + s), (z, z + 2 + s), BONE); box(c, (x, x + 2 + s), (y + 1, y + 2 + s), (z - 1, z - 1), BONE)
    c[(x, y, z + 1)] = VOID; c[(x + 2 + s, y, z + 1)] = VOID
    if s: c[(x, y, z + 1)] = eye; c[(x + 2 + s, y, z + 1)] = eye
def frog(c, x, y, z, body, eye):
    box(c, (x, x + 2), (y, y + 2), (z, z + 1), body); c[(x, y, z + 2)] = eye; c[(x + 2, y, z + 2)] = eye; box(c, (x, x + 2), (y - 1, y - 1), (z, z), body)

def sig_m0(part, t, v, U, rnd, F):
    # 元素使：肩后浮着火 / 冰 / 雷三颗元素球。v0 连锁 = 三球之间连上光链、越往后链越多；v1 控相 = 胸前相位盘 + 头后一圈相环；英雄背后元素三角阵
    chest, head = part('Spine2'), part('Head'); n = t - 3
    P = [(8, 1, 21 + n), (-10, 1, 21 + n), (-1, 4, 25 + n)]
    for (x, y, z), col in zip(P, (EMBER, AZURE, FORT)): box(chest, (x, x + 1 + (t >= 5)), (y, y + 1), (z, z + 1 + (t >= 5)), col)
    if t >= 4 and v == 0:
        for i in range(3):
            (x0, y0, z0), (x1, y1, z1) = P[i], P[(i + 1) % 3]; line(chest, (x0, y0 + 2, z0), (x1, y1 + 2, z1), F['glow'] if i % 2 else F['top2'])
        for i in range(2 * n): chest[(rnd.randint(-8, 7), rnd.randint(2, 4), rnd.randint(18, 26))] = (EMBER, AZURE, FORT)[i % 3]
    if t >= 4 and v == 1:
        box(chest, (-2, 1), (-3, -3), (13, 16), F['top2']); box(chest, (-1, 0), (-4, -4), (14, 15), F['glow'])
        for i in range(16 + 8 * n):
            a = 2 * math.pi * i / (16 + 8 * n); head[(round(-0.5 + (8 + n) * math.cos(a)), 7, round(24 + (8 + n) * math.sin(a)))] = F['glow'] if i % 4 == 0 else F['top2']
    if t >= 5:
        for side, f in SIDES: box(chest, f((4, 7)), (-3, 1), (18, 18), F['top2']); chest[(f((5, 5))[0], -3, 19)] = (EMBER, AZURE)[side == 'Right']
    if t >= 6:
        for (x0, _, z0), (x1, _, z1) in ((P[0], P[1]), (P[1], P[2]), (P[2], P[0])): line(chest, (x0, 6, z0 - 4), (x1, 6, z1 + 6), F['glow'])

def sig_m1(part, t, v, U, rnd, F):
    # 天候：领口后飘一条长巾。v0 狂风 = 腰间一圈半透明旋风、越往后越多圈；v1 雷云 = 头顶一朵雷云 + 下垂电光；5 转双臂电纹，英雄背后一道大闪电
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    for s in range(8 + 3 * n): chest[(3 + s // 5, 3 + s // 2, 17 - s // 3)] = F['glow'] if s % 4 == 3 else F['top2']
    if t >= 4 and v == 0:
        for k in range(n + 1):
            R, z = 7 + k, 8 + 3 * k - U
            for i in range(28):
                a = 2 * math.pi * i / 28 + k
                if i % 3: hips[(round(-0.5 + R * math.cos(a)), round(-0.5 + R * math.sin(a)), z + (i * 2) // 28)] = GHOST
    if t >= 4 and v == 1:
        for x in range(-6 - n, 6 + n): box(head, (x, x), (-2 - (x % 3 == 0), 2 + (x % 2)), (33 + (x % 2), 34 + (abs(x) < 4)), '#5a6070')
        for x in (-6, -2, 3): line(head, (x - n, 0, 32), (x - n + 1, 0, 28 - n), F['glow'])
    if t >= 5:
        for side, f in SIDES: box(part(side + 'ForeArm'), f((7, 8)), (-3, 1), (16, 16), F['glow'])
    if t >= 6:
        pts = [(5, 5, 30), (0, 5, 24), (3, 5, 21), (-3, 5, 14), (0, 5, 12), (-6, 5, 4)]
        for a, b in zip(pts, pts[1:]): line(chest, a, b, F['glow']); line(chest, (a[0] + 1,) + a[1:], (b[0] + 1,) + b[1:], '#fff6d8')

def sig_m2(part, t, v, U, rnd, F):
    # 地脉：双肩石质肩甲。v0 塑地 = 身边浮几块岩石、越往后越多越大；v1 连脉 = 肩甲 / 胸口 / 腿上发光的地脉纹；5 转背后立石，英雄背后一排水晶柱
    chest = part('Spine2'); n = t - 3
    for side, f in SIDES: box(chest, f((4, 7)), (-3, 1), (17, 18 + (t >= 5)), STONE); box(chest, f((5, 6)), (-3, 1), (19 + (t >= 5),) * 2, F['top2'])
    if t >= 4 and v == 0:
        for i in range(2 + 2 * n):
            a = 2 * math.pi * i / (2 + 2 * n) + 0.4; x, y, z = round(-0.5 + 9 * math.cos(a)), round(-0.5 + 6 * math.sin(a)), 14 + 3 * (i % 3)
            box(chest, (x, x + 1 + (i % 2) * n // 2), (y, y + 1), (z, z + 1 + n // 2), STONE); chest[(x, y, z + 2 + n // 2)] = F['glow']
    if t >= 4 and v == 1:
        for side, f in SIDES: line(chest, (f((5, 5))[0], -4, 18), (f((5, 5))[0], -4, 17), F['glow'])
        for z in range(12, 17): chest[((z % 3) - 1, -3, z)] = F['glow']
        for side, f in SIDES:
            lg = part(side + 'UpLeg')
            for z in range(5, 9 - (n == 0)): lg[(f((2 + z % 2, 2 + z % 2))[0], -3, z)] = F['glow']
    if t >= 5: box(chest, (-3, 2), (3, 5), (10, 21), STONE); box(chest, (-1, 0), (6, 6), (14, 18), F['glow'])
    if t >= 6:
        for i in range(6):
            x = -11 + 4 * i; ht = 22 + 6 - abs(2 * i - 5); box(chest, (x, x + 1), (5, 6), (8, ht), '#d8b860'); box(chest, (x, x + 1), (5, 6), (ht + 1, ht + 1), F['glow'])

def sig_m3(part, t, v, U, rnd, F):
    # 引力：腰间绕着暗星（越往后越多）。v0 黑洞 = 背后一张暗盘 + 亮吸积环；v1 重压 = 双腕镣铐 + 腰侧吊着坠块；英雄胸口一圈斜着的星环
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    for i in range(3 + n):
        a = 2 * math.pi * i / (3 + n); x, y = round(-0.5 + 8 * math.cos(a)), round(-0.5 + 6 * math.sin(a)); box(hips, (x, x + 1), (y, y + 1), (12 - U, 13 - U), VOID); hips[(x, y, 14 - U)] = F['glow']
    if t >= 4 and v == 0:
        R = 5 + n
        for i in range(-R - 2, R + 3):
            for j in range(-R - 2, R + 3):
                d = math.hypot(i, j)
                if d <= R: chest[(i, 6, 18 + j)] = VOID
                elif d <= R + 1.5 and (i + j) % 2 == 0: chest[(i, 6, 18 + j)] = F['glow']
                elif d <= R + 2.2 and (i * j) % 5 == 0: chest[(i, 6, 18 + j)] = F['top2']
    if t >= 4 and v == 1:
        for side, f in SIDES:
            box(part(side + 'ForeArm'), f((7, 8)), (-3, 1), (14, 15), IRON); x = f((6, 6))[0]
            line(hips, (x, 0, 10), (x, 0, 7 - n - U), IRON); box(hips, (x - 1, x + 1), (-1, 1), (4 - 2 * n - U, 6 - n - U), VOID)
    if t >= 5:
        for side, f in SIDES: box(chest, f((7, 8)), (-1, 0), (22, 23), VOID); chest[(f((7, 7))[0], -2, 22)] = F['glow']
    if t >= 6:
        for i in range(48):
            a = 2 * math.pi * i / 48; chest[(round(-0.5 + 10 * math.cos(a)), round(-0.5 + 4 * math.sin(a)), round(14 + 6 * math.sin(a)))] = F['glow'] if i % 6 == 0 else F['top2']

def sig_m4(part, t, v, U, rnd, F):
    # 幻术师：右半张白面具 + 头侧浮着镜片。v0 惑心 = 背后螺旋催眠纹；v1 隐匿 = 半透明披风；5 转镜片变大，英雄头后一圈镜屏
    chest, head = part('Spine2'), part('Head'); n = t - 3
    box(head, (-6, -1), (-7, -7), (19, 27), '#f4f0ea'); box(head, (-4, -3), (-8, -8), (21, 23), F['glow']); head[(-3, -8, 26)] = HEX
    for side, f in SIDES:
        for k in range(1 + n): x = f((8 + 2 * k, 8 + 2 * k))[0]; box(head, (x, x), (-1 + k, 0 + k), (22 + 3 * k, 24 + 3 * k + (t >= 5)), GHOST)
    if t >= 4 and v == 0:
        for i in range(30 + 10 * n):
            a = i * 0.45; r = 1 + a * 0.55
            if r > 6 + n: break
            chest[(round(-0.5 + r * math.cos(a)), 3, round(14 + r * math.sin(a)))] = F['glow'] if i % 2 else HEX
    if t >= 4 and v == 1:
        for x in range(-6, 6):
            for z in range(6 - 2 * n - U, 18):
                if (x + z) % 2 == 0: chest[(x, 3, z)] = GHOST
        box(chest, (-6, 5), (3, 3), (17, 18), F['top2'])
    if t >= 5:
        for side, f in SIDES: box(chest, f((4, 7)), (-3, 1), (18, 18), F['top2'])
    if t >= 6:
        for i in range(7):
            a = math.radians(15 + 25 * i); x, z = round(-0.5 + 11 * math.cos(a)), round(23 + 9 * math.sin(a))
            box(head, (x - 1, x + 1), (7, 7), (z - 2, z + 2), GHOST); head[(x, 7, z)] = F['glow']

def sig_m5(part, t, v, U, rnd, F):
    # 变形术士：腰带上一排药瓶 + 肩上一只青蛙。v0 群变 = 越往后身上蹲的青蛙越多；v1 畸变 = 左臂变成甲壳巨爪；5 转背后药釜，英雄背后变形法阵
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    for i in range(2 + n):
        x = (4, 5, -5, -6, 4)[i]; y = -2 + (i // 2) * 2; box(hips, (x, x), (y, y), (7, 9), (JADE, HEX, AZURE, FORT, EMBER)[i]); hips[(x, y, 10)] = BROWN
    frog(chest, 4, -2, 19, '#5aa040', F['glow'])
    if t >= 4 and v == 0:
        for (x, y, z) in ((-8, -1, 19), (-1, -2, 30), (5, 2, 10), (-7, 2, 10))[:n + 1]: frog(head if z == 30 else chest if z > 15 else hips, x, y, z, ('#5aa040', '#8a6aaa', '#c08a40', '#4a8ab0')[(x + z) % 4], F['glow'])
    if t >= 4 and v == 1:
        fa, hd = part('LeftForeArm'), part('LeftHand'); box(fa, (6, 9), (-3, 1), (13, 18), '#6a3a5a')
        for z in (13, 15, 17): box(fa, (9, 9), (-3, 1), (z, z), HEX)
        for k in range(1 + n): line(hd, (10, -2 + k, 16), (13 + n, -3 + k, 13 - k), BONE)
    if t >= 5:
        box(chest, (-3, 2), (3, 6), (10, 15), IRON); box(chest, (-3, 2), (3, 6), (16, 16), '#5aa040'); box(chest, (-1, 0), (4, 5), (17, 18), F['glow'])
    if t >= 6:
        for i in range(36):
            a = 2 * math.pi * i / 36
            for r in (8, 10): chest[(round(-0.5 + r * math.cos(a)), 7, round(18 + r * math.sin(a)))] = F['glow'] if r == 10 or i % 3 == 0 else F['top2']
        for k in range(3): a = 2 * math.pi * k / 3 + 0.5; line(chest, (-0.5 + 8 * math.cos(a), 7, 18 + 8 * math.sin(a)), (-0.5 + 8 * math.cos(a + 2.1), 7, 18 + 8 * math.sin(a + 2.1)), F['glow'])

def sig_m6(part, t, v, U, rnd, F):
    # 恶魔契约：羊角（越往后越长）+ 腰间契约卷轴。v0 血契 = 背后蝠翼、越往后越大；v1 魂契 = 身边魂火 + 胸口锁链；5 转带刺尾，英雄背后五芒法阵
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    for side, f in SIDES:
        x0, sx = f((5, 5))[0], 1 if side == 'Left' else -1
        line(head, (x0, -2, 28), (x0 + sx * (2 + n), 0, 31 + n), '#3a2a2a'); line(head, (x0 + sx * (2 + n), 0, 31 + n), (x0 + sx * (3 + n), -2, 33 + n), BONE)
    box(hips, (4, 5), (-2, -1), (6, 9), '#e8dcc0'); hips[(4, -2, 9)] = BLOOD
    if t >= 4 and v == 0:
        S = 6 + 3 * n
        for side, f in SIDES:
            sx = 1 if side == 'Left' else -1; x0 = f((3, 3))[0]
            for k in range(S): chest[(x0 + sx * k, 4, 17 + k // 2)] = '#2a1a1a'
            for k in range(S):
                for z in range(17 + k // 2 - (S - k) // 2, 17 + k // 2): chest[(x0 + sx * k, 4, z)] = BLOOD if k % 3 else '#2a1a1a'
            chest[(x0 + sx * S, 4, 17 + S // 2)] = F['glow']
    if t >= 4 and v == 1:
        for i in range(3 + 2 * n):
            a = 2 * math.pi * i / (3 + 2 * n); x, y = round(-0.5 + 9 * math.cos(a)), round(-0.5 + 7 * math.sin(a)); box(chest, (x, x), (y, y), (19, 21), SOUL); chest[(x, y, 22)] = GHOST_E
        line(chest, (-4, -3, 17), (3, -3, 12), IRON); line(chest, (3, -3, 17), (-4, -3, 12), IRON)
    if t >= 5:
        pts = [(-1, 2, 9), (-1, 5, 7), (-1, 8, 6), (-1, 10, 8), (-1, 11, 11)]
        for a, b in zip(pts, pts[1:]): line(hips, (a[0], a[1], a[2] - U), (b[0], b[1], b[2] - U), '#3a1a1a')
        box(hips, (-2, 0), (11, 12), (11 - U, 13 - U), F['glow'])
    if t >= 6:
        pts = [(-0.5 + 10 * math.cos(math.pi / 2 + 4 * math.pi * k / 5), 6, 20 + 10 * math.sin(math.pi / 2 + 4 * math.pi * k / 5)) for k in range(6)]
        for a, b in zip(pts, pts[1:]): line(chest, a, b, F['glow'])

def sig_m7(part, t, v, U, rnd, F):
    # 亡者复苏：左肩骷髅肩甲 + 胸前骨肋。v0 尸潮 = 身边浮着小骷髅、越往后越多；v1 尸爆 = 腰间挂着发光尸囊；5 转背后脊骨，英雄背后骨翼
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    skull(chest, 4, -2, 18, F['glow'], 1)
    for z in (12, 14, 16): box(chest, (-3, 2), (-3, -3), (z, z), BONE)
    box(chest, (-1, 0), (-3, -3), (12, 17), BONE)
    if t >= 4 and v == 0:
        for i in range(2 + 2 * n):
            a = 2 * math.pi * i / (2 + 2 * n) + 0.3; skull(chest, round(-1.5 + 9 * math.cos(a)), round(-1.5 + 7 * math.sin(a)), 20 + 3 * (i % 2), F['glow'])
    if t >= 4 and v == 1:
        for i in range(1 + n):
            x = (-7, -7, 5)[i % 3]; y = (-2, 1, 1)[i % 3]; box(hips, (x, x + 1), (y, y + 1), (6 - U, 9 - U), '#6a8a3a'); hips[(x, y, 8 - U)] = F['glow']
    if t >= 5:
        for z in range(8, 22, 2): box(chest, (-1, 0), (3, 3), (z, z), BONE); chest[(-1, 4, z)] = BONE
    if t >= 6:
        for side, f in SIDES:
            sx = 1 if side == 'Left' else -1
            for k in range(4): line(chest, (f((2, 2))[0], 4, 20 - 2 * k), (f((2, 2))[0] + sx * (12 - 2 * k), 6, 26 - 3 * k), BONE); chest[(f((2, 2))[0] + sx * (12 - 2 * k), 6, 26 - 3 * k)] = F['glow']

def mg_robed(sig):
    # 3 转起所有家族都套法袍：下摆随转数变长（3 / 4 / 5 转 2 / 3 / 4 格，英雄 5 格）
    def f(part, t, v, U, rnd, F): robe(part, U, min(t, 6) - 1, F['top'] or F['top2'], F['top2']); sig(part, t, v, U, rnd, F)
    return f

MG_FAM = [   # 8 个家族 = classes.ts MAGE styles[方向][分线]：咒术师（元素 / 天候）、法则师（地脉 / 引力）、奇术师（幻术 / 变形）、通冥师（恶魔 / 亡者）
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=AZURE, style=('short', 'long', 'long'), coat=MG_M, sig=mg_robed(sig_m0)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=CYAN, style=('ponytail', 'spiky', 'long'), coat=MG_M, sig=mg_robed(sig_m1)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=FORT, style=('bald', 'helmet', 'bald'), coat=MG_M, sig=mg_robed(sig_m2)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=VIO, style=('hood', 'short', 'hood'), coat=MG_M, sig=mg_robed(sig_m3)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=HEX, style=('long', 'ponytail', 'bun'), coat=MG_M, sig=mg_robed(sig_m4)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=JADE, style=('bun', 'short', 'spiky'), coat=MG_M, sig=mg_robed(sig_m5)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=STICKY, style=('spiky', 'long', 'hood'), coat=MG_M, sig=mg_robed(sig_m6)),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=SOUL, style=('hood', 'hood', 'bald'), coat=MG_M, sig=mg_robed(sig_m7)),
]
MG_FACE = [dict(CHARS['bom'], hair='#4a2e1e', extra=[]), dict(CHARS['ella'], extra=[]),     # TEMPLATE.mage：外放 bom / 引导 ella（bom 的橄榄发在红袍上像青苔，换深棕）
           dict(CHARS['bom'], hair='#2a1a14', extra=['beard'], beard='#2a1a14'), dict(CHARS['ella'], extra=[], build='normal')]

def mg_look_weapons(f, t, v):
    if t == 7: return [('staff_star', 'orb_star'), ('staff_star', None), ('staff_star', 'tome_star'), ('orb_star', 'orb_star'),
                       ('wand_star', 'orb_star'), ('wand_star', 'tome_star'), ('tome_star', 'wand_star'), ('scythe_star', None)][f]
    if f == 0: return 'staff_prism', ('orb_glass' if v == 1 and t >= 5 else None)
    if f == 1: return 'staff_storm', None
    if f == 2: return ('staff_earth' if t >= 4 else 'staff'), ('tome' if v == 1 and t >= 5 else None)
    if f == 3: return ('staff_void' if v == 0 or t == 3 else 'orb_void'), ('orb_void' if v == 1 and t >= 4 else None)
    if f == 4: return 'wand_hex', ('orb_glass' if t >= 4 else None)
    if f == 5: return ('wand_ivory' if v == 0 or t == 3 else 'wand_hex'), ('tome' if t >= 5 else None)
    if f == 6: return ('tome_hex' if v == 1 or t == 3 else 'staff_horn'), ('wand_hex' if t >= 5 else None)
    return ('scythe' if v == 1 and t >= 4 else 'staff_skull'), ('tome_bone' if t >= 5 else None)

def gem(chest, y=-3): box(chest, (-1, 0), (y, y), (16, 17), MG_TC)                         # 法师树色件：领口一颗浅紫宝石
def look_mg0(part, U, rnd):    # 法师：短袍 + 浅紫领口宝石 + 腰间书袋 + 短杖
    chest, hips = part('Spine2'), part('Hips'); gem(chest); robe(part, U, 1, MG_M, MG_S)
    box(hips, (4, 5), (-2, 0), (7, 10), BROWN); hips[(4, -2, 10)] = MG_TC
def look_mg1(part, U, rnd):    # 元素法师：长袍 + 披肩 + 宝石胸针 + 法杖
    chest = part('Spine2'); gem(chest); robe(part, U, 2, MG_M, MG_S)
    box(chest, (-6, 5), (-3, 2), (17, 18), MG_S); box(chest, (-6, 5), (2, 2), (13, 16), MG_S)
def look_mg1a(part, U, rnd):   # 秘法师：兜帽 + 长袍 + 腰间挂一本锁链书 + 书签（浅紫）
    chest, hips = part('Spine2'), part('Hips'); gem(chest); robe(part, U, 2, MG_M, MG_S)
    box(hips, (4, 6), (-2, 1), (6, 9), '#4a2a22'); box(hips, (7, 7), (-1, 0), (6, 9), '#e8dcc0'); hips[(5, -3, 5)] = MG_TC
    line(hips, (4, -1, 10), (-3, -3, 11), IRON)
def look_mg00(part, U, rnd):   # 咒术师：尖顶法师帽 + 长袍 + 法杖
    chest, head = part('Spine2'), part('Head'); gem(chest); robe(part, U, 3, MG_M, MG_S); mg_hat(head, MG_M, MG_TC)
def look_mg01(part, U, rnd):   # 法则师：头后一圈金色法环 + 袍上一排符文
    chest, head = part('Spine2'), part('Head'); gem(chest); robe(part, U, 3, MG_M, MG_S)
    for i in range(24): a = 2 * math.pi * i / 24; head[(round(-0.5 + 7 * math.cos(a)), 7, round(24 + 7 * math.sin(a)))] = GOLD if i % 6 else MG_TC
    for z in (12, 14, 16): box(chest, (-1, 0), (2, 2), (z, z), MG_TC)
def look_mg10(part, U, rnd):   # 奇术师：礼帽 + 领结 + 魔杖
    chest, head = part('Spine2'), part('Head'); robe(part, U, 3, MG_M, MG_S)
    box(head, (-8, 7), (-8, 7), (28, 28), BLK); box(head, (-5, 4), (-5, 4), (29, 34), BLK); box(head, (-5, 4), (-5, 4), (29, 29), MG_TC)
    box(chest, (-3, 2), (-3, -3), (16, 17), MG_TC); box(chest, (-1, 0), (-3, -3), (16, 17), BLK)
def look_mg11(part, U, rnd):   # 通冥师：兜帽 + 骨坠 + 腰间提灯（魂火）
    chest, hips = part('Spine2'), part('Hips'); gem(chest); robe(part, U, 3, MG_M, MG_S)
    box(chest, (-1, 0), (-3, -3), (12, 14), BONE); chest[(-1, -4, 13)] = MG_TC
    line(hips, (5, -1, 10), (6, -2, 7), IRON); box(hips, (5, 7), (-3, -1), (4, 6), IRON); hips[(6, -3, 5)] = SOUL

MG = dict(tree='mage', fam=MG_FAM, face=MG_FACE, wpn=mg_look_weapons, star=star_plus(MG_FAM), heavy=(2, 6), salt=5, shield=False)
MG_CHAIN = {   # 手写：基础 + 1 转 2 个 + 2 转 4 个（每方向一套）
    'mg':    dict(MG_FACE[0], style='short', glove=BROWN, deco=look_mg0, wr='wand'),
    'mg-0':  dict(MG_FACE[0], style='short', glove='#3a2a1c', deco=look_mg1, wr='staff'),
    'mg-1':  dict(MG_FACE[1], hood=MG_M, glove='#3a2a1c', deco=look_mg1a, wr='tome'),
    'mg-00': dict(MG_FACE[0], style='short', glove='#3a2a1c', deco=look_mg00, wr='staff_prism', k=1.03),
    'mg-01': dict(MG_FACE[1], style='long', glove='#3a2a1c', deco=look_mg01, wr='staff_earth', k=1.03),
    'mg-10': dict(MG_FACE[2], style='short', glove=WHITE, deco=look_mg10, wr='wand_hex', k=1.03),
    'mg-11': dict(MG_FACE[3], hood='#2a2030', glove='#2a2030', deco=look_mg11, wr='staff_skull', k=1.03),
}
# ══════════════ 辅助树全部 191 个形象（同一套量产规则；key = 'md'）══════════════
# 树色 = 薄荷绿十字：0–2 转是臂章 / 胸前十字，3–5 转缩成扣子，英雄上领口；p0 随军 / 驻地（实在的医疗、自然），p1 吟咏 / 刻印（声、牌、星、符）
MD_TC, LEAF, BARK, PAPER, VINE, THORN, INK = '#9affb8', '#5aa040', '#5a4030', '#efe6d0', '#3a6a2a', '#d8d0a0', '#b02a2a'
NAVY, LEATHER = '#1e2440', '#6a4428'
LOOK_GLOW |= {MD_TC}; LOOK_MATS.update({MD_TC: 'glow'})

def cross(c, x, y, z, col, s=1):
    # 十字（立在 xz 面上，中心 (x, z)，臂长 s）
    box(c, (x - s, x + s), (y, y), (z, z), col); box(c, (x, x), (y, y), (z - s, z + s), col)

def w_injector(c, body, glow, big=0):
    # 注射枪：握把在原点，枪身沿 -y，前端针头；顶上一管发光药剂
    box(c, (0, 0), (0, 2), (-3, 0), '#3a3a40'); box(c, (-1, 1), (-7 - big, 1), (0, 2), body); box(c, (0, 0), (-11 - big, -8 - big), (1, 1), STEEL)
    box(c, (-1, 1), (-6 - big, -2), (3, 4), GHOST); box(c, (0, 0), (-5 - big, -3), (3, 4), glow)
def w_branch(c, L, wood, leaf, glow):
    # 德鲁伊枝杖：弯曲木杖，杖头分三叉挂叶子、正中一颗发光果
    for y in range(-L, 9): c[(round(math.sin(y / 5)), y, 0)] = wood
    y = -L
    for dx, dz in ((-3, 1), (3, 1), (0, 3)): line(c, (0, y, 0), (dx, y - 4, dz), wood); box(c, (dx - 1, dx + 1), (y - 5, y - 4), (dz, dz + 1), leaf)
    box(c, (0, 0), (y - 3, y - 2), (0, 1), glow)
def w_totem(c, L, wood, paint, glow):
    # 图腾杖：杖头一段刻面木桩（彩绘 + 发光眼）+ 两侧翅
    box(c, (0, 0), (-L, 8), (0, 0), wood); y = -L
    box(c, (-2, 2), (y - 7, y), (-2, 2), wood); box(c, (-2, 2), (y - 3, y - 2), (-2, 2), paint)
    for x in (-1, 1): c[(x, y - 5, -3)] = glow; c[(x, y - 5, 3)] = glow
    for s in (-1, 1): box(c, tuple(sorted((s * 3, s * 6))), (y - 6, y - 5), (0, 0), paint)
def w_flask(c, R, glass, brew, cork=BROWN):
    # 投掷药瓶：圆肚 + 细颈 + 软木塞（托在掌前）
    cy = -R - 1
    for i in range(-R, R + 1):
        for j in range(-R, R + 1):
            for k in range(-R, R + 1):
                d = i * i + j * j + k * k
                if d <= R * R: c[(i, cy + j, k)] = brew if d <= (R - 1) ** 2 and k <= 0 else glass
    box(c, (0, 0), (cy, cy), (R, R + 2), glass); c[(0, cy, R + 3)] = cork
def w_lute(c, wood, face, glow):
    # 鲁特琴：握琴颈（原点），琴身在 -y 一侧，弦是一条亮线
    box(c, (0, 0), (-4, 8), (0, 0), wood); box(c, (-1, 1), (7, 9), (0, 0), wood)
    for j in range(-12, -4):
        r = 4 - abs(j + 8) // 2
        box(c, (-r, r), (j, j), (0, 0), wood); box(c, (-r + 1, r - 1), (j, j), (1, 1), face)
    box(c, (0, 0), (-9, -7), (2, 2), BROWN); line(c, (0, 8, 1), (0, -11, 1), glow)
def w_cards(c, back, face, glow):
    # 扇形一手牌：5 张从掌心散开
    for i in range(5):
        a = math.radians(-40 + 20 * i)
        for r in range(2, 9):
            for w in (-1, 0, 1): c[(round(r * math.sin(a) + w * math.cos(a)), -1, round(r * math.cos(a) - w * math.sin(a)))] = face if i == 4 else back
    c[(round(6 * math.sin(math.radians(40))), -2, round(6 * math.cos(math.radians(40))))] = glow
def w_astro(c, L, rod, star, glow):
    # 星杖（短）：细杖头顶一颗五角星
    box(c, (0, 0), (-L, 3), (0, 0), rod); box(c, (-1, 1), (0, 1), (-1, 1), STARG); y = -L - 4
    for k in range(10):
        a = math.pi / 2 + math.pi * k / 5; r = 4 if k % 2 == 0 else 2
        line(c, (0, y, 0), (round(r * math.cos(a)), round(y + r * math.sin(a)), 0), star)
    c[(0, y, 0)] = glow
LOOK_WPN.update({
    'injector':      lambda c: w_injector(c, '#e8ecef', MD_TC),
    'injector_hv':   lambda c: w_injector(c, '#c8ccd4', JADE, 2),
    'injector_star': lambda c: w_injector(c, STARW, LIGHT, 3),
    'branch':        lambda c: w_branch(c, 26, BARK, LEAF, JADE),
    'branch_star':   lambda c: w_branch(c, 30, STARW, '#fff6d8', LIGHT),
    'totem':         lambda c: w_totem(c, 24, '#6a4a2a', PAINT, AMBER),
    'totem_star':    lambda c: w_totem(c, 28, STARW, STARG, LIGHT),
    'flask':         lambda c: w_flask(c, 2, GHOST, STICKY),
    'flask_big':     lambda c: w_flask(c, 3, GHOST, '#ff5ac8'),
    'lute':          lambda c: w_lute(c, '#8a5a2a', '#e0c890', '#ff5ac8'),
    'lute_star':     lambda c: w_lute(c, STARW, '#fff6d8', LIGHT),
    'cards':         lambda c: w_cards(c, '#5a2a6a', PAPER, AMBER),
    'cards_star':    lambda c: w_cards(c, STARG, STARW, LIGHT),
    'wand_astro':    lambda c: w_astro(c, 12, '#2a2a40', STARG, AZURE),
    'tome_rune':     lambda c: w_tome(c, '#3a3a44', PAPER, VIO),
    'tome_seal':     lambda c: w_tome(c, '#2a2030', '#d8c8b0', INK, 1),
})

def sig_d0(part, t, v, U, rnd, F):
    # 战地急救：背后白色急救箱 + 绿十字、腰侧一排药剂管。v0 护盾 = 左手外侧一面菱形光盾、越往后越大；v1 回生 = 胸前除颤器 + 腰上两块电极板；
    # 5 转左肩信标灯，英雄背后一对医疗光翼
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    box(chest, (-3, 2), (2, 5), (11, 16), PAPER); cross(chest, -1, 6, 13, F['glow'])
    for i in range(2 + n): hips[(-5, -2 + i, 10)] = (JADE, F['glow'], AZURE, '#ff5ac8', AMBER)[i]; hips[(-5, -2 + i, 9)] = GHOST
    if t >= 4 and v == 0:
        fa, R = part('LeftForeArm'), 2 + n
        for y in range(-R, R + 1):
            for z in range(-R, R + 1):
                d = abs(y) + abs(z)
                if d <= R: fa[(12, -1 + y, 16 + z)] = F['glow'] if d == R else GHOST
    if t >= 4 and v == 1:
        box(chest, (-2, 1), (-3, -3), (13, 15), '#3a3a40'); chest[(-1, -4, 14)] = F['glow']; chest[(0, -4, 14)] = AMBER
        for x in ((4, 5), (-6, -5))[:1 + (n > 0)]: box(hips, x, (-3, -3), (7 - n, 9), '#e8ecef'); line(hips, (x[0], -3, 10), (-1, -3, 12), '#3a3a40')
    if t >= 5: box(chest, (5, 7), (-1, 1), (18, 19), PAPER); box(chest, (6, 6), (0, 0), (20, 21), F['glow'])
    if t >= 6:
        for side, f in SIDES:
            sx = 1 if side == 'Left' else -1; x0 = f((2, 2))[0]
            for k in range(10):
                for z in range(18 - k // 2, 22 + k // 3): chest[(x0 + sx * k, 4, z)] = F['glow'] if z == 21 + k // 3 or k == 9 else GHOST

def sig_d1(part, t, v, U, rnd, F):
    # 生长：双肩叶片 + 头上一圈花冠。v0 树皮橡心 = 胸前树皮甲 + 发光橡心、前臂树皮护甲（越往后越厚）；v1 荆藤 = 手臂腿上绕荆棘藤；5 转头上鹿角枝，英雄背后一棵小树
    chest, head = part('Spine2'), part('Head'); n = t - 3
    for side, f in SIDES:
        for k in range(3): box(chest, f((4 + k, 5 + k)), (-2 + k % 2, 0 + k % 2), (18 + k, 18 + k), LEAF if k < 2 else F['glow'])
    for i in range(12 + 4 * n):
        a = 2 * math.pi * i / (12 + 4 * n); head[(round(-0.5 + 6.5 * math.cos(a)), round(-0.5 + 6.5 * math.sin(a)), 29)] = ('#ff9ac8', LEAF, F['glow'])[i % 3]
    if t >= 4 and v == 0:
        box(chest, (-3, 2), (-3, -3), (12, 16), BARK); box(chest, (-1, 0), (-4, -4), (14, 15), F['glow'])
        for side, f in SIDES: box(part(side + 'ForeArm'), f((7, 8)), (-3, 1), (15 - n, 17), BARK)
    if t >= 4 and v == 1:
        for side, f in SIDES:
            fa, ul = part(side + 'ForeArm'), part(side + 'UpLeg')
            for k in range(4 + 2 * n):
                x = f((7 + k % 2, 7 + k % 2))[0]; fa[(x, -3 if k % 4 < 2 else 1, 15 + k % 3)] = VINE
                if k % 3 == 0: fa[(x, -4, 16)] = THORN
            for z in range(5, 9): ul[(f((1 + z % 3, 1 + z % 3))[0], -3, z)] = VINE
    if t >= 5:
        for side, f in SIDES:
            sx = 1 if side == 'Left' else -1; x0 = f((4, 4))[0]
            line(head, (x0, 0, 29), (x0 + sx * 3, 1, 34), BARK); line(head, (x0 + sx * 3, 1, 34), (x0 + sx * 5, 2, 36), BARK); line(head, (x0 + sx * 2, 1, 32), (x0 + sx * 4, 0, 33), BARK)
            head[(x0 + sx * 5, 2, 37)] = F['glow']
    if t >= 6:
        box(chest, (-1, 0), (4, 5), (8, 30), BARK)
        for x in range(-9, 9):
            for z in range(28, 38):
                if ((x + .5) / 9) ** 2 + ((z - 33) / 5) ** 2 <= 1: chest[(x, 5 + (x + z) % 2, z)] = F['glow'] if rnd.random() < .12 else LEAF

def sig_d2(part, t, v, U, rnd, F):
    # 图腾：背后一根小图腾柱 + 头上羽冠。v0 雷鸣 = 柱顶雷鸟 + 双臂闪电纹；v1 先祖 = 头侧浮着先祖面具（越往后越多）+ 胸前骨珠串；5 转兽皮披肩，英雄背后三层大图腾柱
    chest, head = part('Spine2'), part('Head'); n = t - 3
    box(chest, (-9, -8), (3, 4), (6, 22 + n), '#6a4a2a'); box(chest, (-9, -8), (3, 4), (18, 19), PAINT); box(chest, (-10, -7), (2, 2), (20 + n, 21 + n), PAINT)
    chest[(-9, 2, 22 + n)] = F['glow']; chest[(-8, 2, 22 + n)] = F['glow']
    for i, x in enumerate(range(-5, 5)): box(head, (x, x), (-2, 4), (29, 30 + (i % 3 == 1) * 2), (F['glow'], PAINT, '#f0f0f0')[i % 3])
    if t >= 4 and v == 0:
        z = 24 + n; line(chest, (-8, 3, z), (-14 - n, 3, z + 3), '#3a3a44'); line(chest, (-9, 3, z), (-3 + n, 3, z + 3), '#3a3a44'); box(chest, (-9, -8), (2, 3), (z, z + 2), F['glow'])
        for side, f in SIDES:
            fa = part(side + 'ForeArm')
            for x in range(7, 9): fa[(f((x, x))[0], -3, 15 + (x % 2) * 2)] = F['glow']
            for x in range(4, 7): part(side + 'Arm')[(f((x, x))[0], -3, 16 + (x % 2))] = F['glow']
    if t >= 4 and v == 1:
        for k in range(1 + n):
            x = (-12, 9, -12, 9)[k]; z = (22, 22, 28, 28)[k]
            box(head, (x, x + 2), (-1, -1), (z, z + 3), BONE); head[(x, -2, z + 2)] = F['glow']; head[(x + 2, -2, z + 2)] = F['glow']; box(head, (x + 1, x + 1), (-2, -2), (z, z), '#2a1a14')
        for x in range(-3, 3): chest[(x, -3, 17 - abs(x + .5) // 1.5)] = BONE if x % 2 else F['glow']
    if t >= 5:
        box(chest, (-6, 5), (-3, 3), (17, 18), FUR); box(chest, (-6, 5), (3, 3), (13, 16), FUR)
    if t >= 6:
        box(chest, (-3, 2), (4, 7), (6, 34), '#6a4a2a')
        for z, col in ((10, PAINT), (18, '#3a7a8a'), (26, PAINT)): box(chest, (-3, 2), (3, 7), (z, z + 3), col); chest[(-2, 8, z + 2)] = F['glow']; chest[(1, 8, z + 2)] = F['glow']
        for s in (-1, 1): box(chest, tuple(sorted((s * 4 - (s < 0), s * 12 - (s < 0)))), (5, 6), (31, 32), PAINT); chest[(s * 12 - (s < 0), 5, 33)] = F['glow']

def sig_d3(part, t, v, U, rnd, F):
    # 炼金调配：额头护目镜 + 胸前斜挎一排药瓶（越往后越多）。v0 酸蚀 = 背后两罐酸液；v1 炼成 = 身边浮着空瓶 + 发光核；5 转皮围裙 + 背后小蒸馏球，英雄背后大蒸馏器
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    box(head, (-6, 5), (-6, 5), (26, 26), LEATHER)
    for x in ((-5, -2), (1, 4)): box(head, x, (-7, -7), (25, 27), '#3a3a40'); box(head, (x[0] + 1, x[1] - 1), (-8, -8), (26, 26), F['glow'])
    for k in range(4 + n):
        x, z = 3 - 2 * k, 13 + k
        if x < -5: break
        box(chest, (x, x), (-4, -4), (z, z + 1), (STICKY, '#ff5ac8', AZURE, AMBER, JADE)[k % 5]); chest[(x, -4, z + 2)] = BROWN
    if t >= 4 and v == 0:
        for x in ((-4, -2), (1, 3))[:1 + (n > 0)]:
            box(chest, x, (2, 4), (9, 16 + n), GHOST); box(chest, (x[0], x[1]), (3, 3), (10, 14 + n), STICKY); box(chest, x, (2, 4), (17 + n, 17 + n), IRON)
        part('LeftHand')[(10, -1, 14)] = STICKY; part('LeftHand')[(10, -1, 13)] = STICKY
    if t >= 4 and v == 1:
        for i in range(2 + n):
            a = 2 * math.pi * i / (2 + n) + 0.5; x, y, z = round(-0.5 + 9 * math.cos(a)), round(-0.5 + 6 * math.sin(a)), 18 + 3 * (i % 2)
            box(chest, (x, x + 1), (y, y + 1), (z, z + 1), GHOST); chest[(x, y, z + 2)] = GHOST; chest[(x, y, z)] = F['glow']
    if t >= 5:
        box(chest, (-4, 3), (-3, -3), (12, 13), LEATHER)
        for z in range(6 - U, 9): box(hips, (-5, -4), (-3, -3), (z, z), LEATHER); box(hips, (3, 4), (-3, -3), (z, z), LEATHER)
    if t >= 5 and t < 6: box(chest, (-2, 1), (3, 5), (17, 19), GHOST); box(chest, (-1, 0), (4, 4), (17, 18), F['glow']); box(chest, (-1, -1), (4, 4), (20, 22), IRON)
    if t >= 6:
        for i in range(-5, 6):
            for j in range(-5, 6):
                for k in range(-5, 6):
                    d = i * i + j * j + k * k
                    if 16 < d <= 25 or d <= 9 and k <= 0: chest[(i, 9 + j, 18 + k)] = F['glow'] if d <= 9 else GHOST
        line(chest, (0, 9, 23), (0, 9, 30), IRON); line(chest, (0, 9, 30), (-8, 5, 32), IRON); box(chest, (-9, -8), (4, 5), (31, 33), F['glow'])

def sig_d4(part, t, v, U, rnd, F):
    # 乐曲：歪戴贝雷帽 + 羽毛、背后斜背一把鲁特琴。v0 战歌 = 腰侧战鼓 + 鼓槌（越往后鼓越大）；v1 挽歌 = 长披风 + 身边浮着音符；5 转金扣肩章，英雄背后发光竖琴
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    box(head, (-7, 5), (-6, 6), (29, 29), F['top2']); box(head, (-5, 3), (-4, 4), (30, 30), F['top2']); line(head, (3, 2, 30), (8, 5, 35), F['glow']); head[(8, 5, 36)] = '#f0f0f0'
    for i in range(-4, 5):
        for j in range(-3, 4):
            if (i / 4.5) ** 2 + (j / 3.5) ** 2 <= 1: chest[(-3 + i, 4, 9 + j)] = '#8a5a2a'
    chest[(-3, 5, 9)] = '#2a1a14'; line(chest, (-3, 4, 12), (4, 4, 22), '#6a4a2a'); chest[(4, 4, 23)] = '#3a2a1a'
    if t >= 4 and v == 0:
        r = 2 + n // 2
        box(hips, (5, 5 + 2 * r), (-1 - r, -1 + r), (8 - U - r, 8 - U + r), '#a03a2a'); box(hips, (5, 5), (-1 - r, -1 + r), (8 - U - r, 8 - U + r), PAPER); box(hips, (6 + 2 * r, 6 + 2 * r), (-1 - r, -1 + r), (8 - U - r, 8 - U + r), PAPER)
        for k in range(1 + n): line(part('RightHand'), (-11, -1, 16), (-13, -4 - k, 19 + k), '#d8c8a0')
    if t >= 4 and v == 1:
        box(chest, (-5, 4), (3, 3), (6 - 2 * n - U, 17), F['top']); box(chest, (-5, 4), (3, 3), (6 - 2 * n - U, 6 - 2 * n - U), F['glow'])
        for i in range(2 + n):
            x, z = (-9, 8, -7, 9, -10)[i], (20, 22, 25, 17, 14)[i]; box(chest, (x, x + 1), (-1, -1), (z, z), F['glow']); line(chest, (x + 1, -1, z), (x + 1, -1, z + 3), F['glow'])
    if t >= 5:
        for side, f in SIDES: box(chest, f((4, 6)), (-2, 0), (18, 18), GOLD); box(chest, f((5, 5)), (-3, -3), (17, 17), GOLD)
        for z in (12, 14, 16): chest[(2, -4, z)] = GOLD
    if t >= 6:
        pts = [(-0.5 + 9 * math.cos(math.radians(a)), 6, 20 + 9 * math.sin(math.radians(a))) for a in range(200, 361, 20)]
        for a, b in zip(pts, pts[1:]): line(chest, a, b, GOLD)
        line(chest, pts[0], (-6, 6, 34), GOLD); line(chest, (-6, 6, 34), pts[-1], GOLD)
        for x in range(-7, 9, 2): line(chest, (x, 6, 18), (x, 6, 31), F['glow'])

def sig_d5(part, t, v, U, rnd, F):
    # 命运牌：头巾 + 头侧浮着牌（越往后越多）。v0 豪赌 = 腰间筹码袋 + 肩头一颗大骰子；v1 预言 = 额前第三只眼 + 左手边水晶球；5 转背后扇形牌阵，英雄背后命运之轮
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    box(head, (-6, 5), (-6, 5), (27, 28), F['top2']); box(head, (-1, 0), (6, 8), (24, 27), F['top2'])
    for i in range(2 + n):
        x, z = (8, -11, 10, -13, 9)[i], (24, 22, 29, 28, 33)[i]; box(head, (x, x + 1), (-1, -1), (z, z + 2), PAPER); head[(x, -2, z + 1)] = F['glow'] if i % 2 else INK
    if t >= 4 and v == 0:
        box(chest, (-9, -7), (-1, 1), (19, 21), PAPER); chest[(-8, -2, 20)] = INK; chest[(-9, -1, 21)] = INK
        for k in range(1 + n): box(hips, (4, 5), (-2 + k, -2 + k), (8, 9), (INK, F['glow'], '#2a2a40', GOLD)[k])
    if t >= 4 and v == 1:
        head[(-1, -7, 26)] = F['glow']; head[(0, -7, 26)] = F['glow']; head[(-1, -7, 27)] = PAPER
        hd, R = part('LeftHand'), 1 + n
        for i in range(-R, R + 1):
            for j in range(-R, R + 1):
                for k in range(-R, R + 1):
                    if i * i + j * j + k * k <= R * R: hd[(12 + R + i, -1 + j, 16 + k)] = F['glow'] if i * i + j * j + k * k <= (R - 1) ** 2 else GHOST
    if t >= 5:
        for i in range(5):
            a = math.radians(50 + 20 * i); x0, z0 = round(-0.5 + 6 * math.cos(a)), round(16 + 6 * math.sin(a))
            box(chest, (x0 - 1, x0 + 1), (3, 3), (z0, z0 + 3), '#5a2a6a' if i % 2 else PAPER)
    if t >= 6:
        for i in range(64):
            a = 2 * math.pi * i / 64
            for r in (10, 11): chest[(round(-0.5 + r * math.cos(a)), 7, round(18 + r * math.sin(a)))] = GOLD
        for k in range(8):
            a = 2 * math.pi * k / 8; line(chest, (-0.5, 7, 18), (-0.5 + 10 * math.cos(a), 7, 18 + 10 * math.sin(a)), GOLD); chest[(round(-0.5 + 12 * math.cos(a)), 7, round(18 + 12 * math.sin(a)))] = F['glow']

def sig_d6(part, t, v, U, rnd, F):
    # 星图：深蓝星斗披风 + 左胸星形胸针。v0 连星 = 头前浮着一组星座连线（越往后越多星）；v1 主星 = 右肩上方一颗大星 + 一圈轨道；5 转星斗肩甲，英雄背后浑天仪
    chest, head = part('Spine2'), part('Head'); n = t - 3
    box(chest, (-5, 4), (3, 3), (8 - U, 17), NAVY)
    for x, z in ((-4, 15), (2, 13), (-1, 10), (3, 9), (-3, 11)): chest[(x, 4, z)] = F['glow']
    cross(chest, 2, -3, 15, GOLD); chest[(2, -4, 15)] = F['glow']
    if t >= 4 and v == 0:
        S = [(-9, -3, 30), (-5, -4, 33), (0, -4, 32), (4, -4, 35), (8, -3, 31), (11, -3, 34)][:3 + n]
        for a, b in zip(S, S[1:]): line(head, a, b, GHOST)
        for p in S: head[p] = F['glow']
    if t >= 4 and v == 1:
        R = 2 + n // 2; cx, cz = -9, 27 + n
        for k in range(10):
            a = math.pi / 2 + math.pi * k / 5; r = R if k % 2 == 0 else max(1, R // 2)
            line(chest, (cx, -1, cz), (cx + round(r * math.cos(a)), -1, cz + round(r * math.sin(a))), F['glow'])
        for i in range(24 + 8 * n): a = 2 * math.pi * i / (24 + 8 * n); chest[(round(cx + (R + 3) * math.cos(a)), round(-1 + 2 * math.sin(a)), round(cz + (R + 3) * math.sin(a) * .5))] = GHOST
    if t >= 5:
        for side, f in SIDES: box(chest, f((4, 7)), (-3, 1), (18, 19), NAVY); chest[(f((6, 6))[0], -4, 19)] = F['glow']
    if t >= 6:
        for i in range(48):
            a = 2 * math.pi * i / 48; chest[(round(-0.5 + 10 * math.cos(a)), 6, round(22 + 10 * math.sin(a)))] = GOLD
            chest[(round(-0.5 + 10 * math.cos(a) * .4), 6 + round(3 * math.sin(a)), round(22 + 10 * math.sin(a)))] = GOLD
            chest[(round(-0.5 + 10 * math.cos(a)), 6, round(22 + 10 * math.sin(a) * .35))] = F['glow'] if i % 4 == 0 else NAVY
        box(chest, (-2, 1), (5, 7), (21, 23), F['glow'])

def sig_d7(part, t, v, U, rnd, F):
    # 符文封印：胸前 / 双肩贴纸符 + 肩旁浮着符石（越往后越多）。v0 禁魔 = 胸前交叉封印锁链 + 金锁、前臂缠链；v1 咒刻 = 双臂和眼下发光咒纹；
    # 5 转腰间一圈符文环，英雄背后大石碑
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    for x, z in ((-3, 15), (2, 13), (5, 18), (-6, 18)): box(chest, (x, x), (-4, -4), (z - 2, z), PAPER); chest[(x, -4, z - 1)] = INK
    for i in range(2 + n):
        x, y, z = (9, -11, 10, -12, 8)[i], (0, 0, 2, 2, 3)[i], (20, 21, 25, 26, 30)[i]; box(chest, (x, x + 1), (y, y + 1), (z, z + 2), STONE); chest[(x, y - 1, z + 1)] = F['glow']
    if t >= 4 and v == 0:
        line(chest, (-5, -4, 17), (4, -4, 11), IRON); line(chest, (4, -4, 17), (-5, -4, 11), IRON); box(chest, (-1, 0), (-5, -5), (13, 15), GOLD); chest[(-1, -6, 14)] = INK
        for side, f in SIDES:
            if n >= 1: fa = part(side + 'ForeArm'); [fa.__setitem__((f((x, x))[0], -3, 15 + (x % 2) * 2), IRON) for x in (7, 8)]
            if n >= 2: up = part(side + 'Arm'); [up.__setitem__((f((x, x))[0], -3, 15 + (x % 2) * 2), IRON) for x in (4, 5, 6)]
    if t >= 4 and v == 1:
        for side, f in SIDES:
            fa = part(side + 'ForeArm')
            for z in range(15, 18 - (n == 0)): fa[(f((7, 7))[0], -3, z)] = F['glow']
            if n >= 1: part(side + 'Arm')[(f((5, 5))[0], -3, 16)] = F['glow']; part(side + 'Arm')[(f((5, 5))[0], -3, 17)] = F['glow']
        for x in ((-4, -3), (2, 3))[:1 + (n > 0)]: box(head, x, (-7, -7), (22, 22), F['glow'])
    if t >= 5:
        for i in range(36):
            a = 2 * math.pi * i / 36; hips[(round(-0.5 + 8 * math.cos(a)), round(-0.5 + 7 * math.sin(a)), 9 - U)] = PAPER if i % 3 == 0 else F['glow'] if i % 3 == 1 else GHOST
    if t >= 6:
        box(chest, (-7, 6), (5, 6), (6, 32), STONE); box(chest, (-7, 6), (5, 6), (32, 33), '#6a6458')
        for x in range(-5, 5, 3): box(chest, (x, x + 1), (4, 4), (26, 29), F['glow']); chest[(x, 7, 30)] = F['glow']

MD_FAM = [   # 8 个家族 = classes.ts MEDIC styles[方向][分线]：随军医师（急救 / 生长）、驻地医师（图腾 / 调配）、吟咏师（乐曲 / 命运牌）、刻印师（星图 / 符文）
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=JADE, style=('bun', 'short', 'helmet'), coat=MG_M, sig=sig_d0),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=STICKY, style=('long', 'spiky', 'long'), coat=MG_M, sig=sig_d1),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=CYAN, style=('spiky', 'bald', 'spiky'), coat=MG_M, sig=sig_d2),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=AMBER, style=('short', 'bun', 'bald'), coat=MG_M, sig=sig_d3),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow='#ff5ac8', style=('ponytail', 'short', 'long'), coat=MG_M, sig=sig_d4),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=VIO, style=('long', 'bun', 'ponytail'), coat=MG_M, sig=sig_d5),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=AZURE, style=('hood', 'long', 'hood'), coat=MG_M, sig=sig_d6),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=SOUL, style=('hood', 'bald', 'short'), coat=MG_M, sig=sig_d7),
]
MD_FACE = [dict(CHARS['lian'], extra=[]), dict(CHARS['shaman'], extra=['paint']),                 # TEMPLATE.medic：lian / shaman 交替
           dict(CHARS['lian'], extra=[], build='normal'), dict(CHARS['shaman'], extra=[], build='slim')]

def md_look_weapons(f, t, v):
    if t == 7: return [('injector_star', None), ('branch_star', None), ('totem_star', None), ('injector_star', 'flask_big'),
                       ('lute_star', None), ('cards_star', 'orb_star'), ('wand_star', 'orb_star'), ('tome_star', 'wand_star')][f]
    if f == 0: return ('injector_hv' if t >= 5 else 'injector'), None
    if f == 1: return 'branch', None
    if f == 2: return 'totem', None
    if f == 3: return ('flask_big' if v == 0 and t >= 5 else 'flask'), ('injector' if v == 1 and t >= 4 else None)
    if f == 4: return 'lute', None
    if f == 5: return 'cards', ('orb_glass' if v == 1 and t >= 4 else None)
    if f == 6: return 'wand_astro', ('tome' if t >= 5 else None)
    return ('tome_seal' if v == 0 else 'tome_rune'), ('wand_astro' if t >= 5 else None)

def armband(part):   # 辅助树色件：左上臂一圈白臂章 + 薄荷绿十字
    up = part('LeftArm'); box(up, (5, 5), (-3, 1), (14, 18), PAPER); up[(5, -4, 16)] = MD_TC; up[(5, -4, 15)] = MD_TC; up[(5, -4, 17)] = MD_TC
def look_md0(part, U, rnd):    # 辅助师：白臂章 + 腰间药包 + 注射枪
    hips = part('Hips'); armband(part); box(hips, (4, 5), (-2, 0), (7, 10), PAPER); hips[(4, -3, 9)] = MD_TC
def look_md1(part, U, rnd):    # 医疗兵：背后急救箱 + 护士帽（绿十字）
    chest, head = part('Spine2'), part('Head'); armband(part)
    box(chest, (-3, 2), (2, 4), (11, 16), PAPER); cross(chest, -1, 5, 13, MD_TC)
    box(head, (-4, 3), (-4, 3), (29, 31), PAPER); cross(head, -1, -5, 30, MD_TC)
def look_md1a(part, U, rnd):   # 秘术师：金链吊坠 + 肩旁浮着一张符纸
    chest = part('Spine2'); armband(part)
    for x in range(-3, 3): chest[(x, -3, 17 - (abs(x + .5) > 2))] = GOLD
    box(chest, (-1, 0), (-4, -4), (13, 14), MD_TC); box(chest, (7, 8), (-1, -1), (21, 24), PAPER); chest[(7, -2, 22)] = INK
def look_md00(part, U, rnd):   # 随军医师：白头盔绿十字 + 斜挎带 + 腰侧急救包
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); armband(part)
    box(head, (-7, 6), (-7, 6), (24, 30), PAPER); box(head, (-6, 5), (-6, 5), (31, 31), PAPER); cross(head, -1, -8, 28, MD_TC)
    for k in range(12, 18): chest[(k - 14, -3, k)] = BROWN
    box(hips, (-6, -5), (-2, 0), (7, 10), PAPER); hips[(-6, -3, 9)] = MD_TC
def look_md01(part, U, rnd):   # 驻地医师：兽皮披肩 + 背后小图腾
    chest = part('Spine2'); armband(part)
    box(chest, (-6, 5), (-3, 3), (17, 18), FUR); box(chest, (-1, 0), (3, 4), (8, 22), '#6a4a2a'); box(chest, (-2, 1), (3, 3), (19, 20), PAINT); chest[(-1, 2, 21)] = MD_TC
def look_md10(part, U, rnd):   # 吟咏师：贝雷帽 + 羽毛 + 背后鲁特琴
    chest, head = part('Spine2'), part('Head'); armband(part)
    box(head, (-7, 5), (-6, 6), (29, 29), MG_S); box(head, (-5, 3), (-4, 4), (30, 30), MG_S); line(head, (3, 2, 30), (7, 5, 34), MD_TC)
    for i in range(-3, 4):
        for j in range(-2, 3):
            if (i / 3.5) ** 2 + (j / 2.5) ** 2 <= 1: chest[(-2 + i, 4, 9 + j)] = '#8a5a2a'
    line(chest, (-2, 4, 11), (3, 4, 19), '#6a4a2a')
def look_md11(part, U, rnd):   # 刻印师：深蓝星斗披风 + 肩旁浮着一枚符石
    chest = part('Spine2'); armband(part)
    box(chest, (-5, 4), (3, 3), (6 - U, 17), NAVY)
    for x, z in ((-3, 14), (2, 11), (0, 8)): chest[(x, 4, z)] = MD_TC
    box(chest, (8, 9), (0, 1), (21, 23), STONE); chest[(8, -1, 22)] = MD_TC

MD = dict(tree='medic', fam=MD_FAM, face=MD_FACE, wpn=md_look_weapons, star=star_plus(MD_FAM), heavy=(1, 2), salt=7, shield=False)
MD_CHAIN = {   # 手写：基础 + 1 转 2 个 + 2 转 4 个（每方向一套）
    'md':    dict(MD_FACE[0], glove=WHITE, deco=look_md0, wr='injector'),
    'md-0':  dict(MD_FACE[0], glove=WHITE, deco=look_md1, wr='injector'),
    'md-1':  dict(MD_FACE[1], style='long', glove='#3a2014', deco=look_md1a, wr='wand_astro'),
    'md-00': dict(MD_FACE[0], style='short', glove=WHITE, deco=look_md00, wr='injector_hv', k=1.03),
    'md-01': dict(MD_FACE[1], glove='#3a2014', deco=look_md01, wr='totem', k=1.03),
    'md-10': dict(MD_FACE[2], style='ponytail', glove=WHITE, deco=look_md10, wr='lute', k=1.03),
    'md-11': dict(MD_FACE[3], style='hood', hood=NAVY, glove='#2a2030', deco=look_md11, wr='tome_rune', k=1.03),
}

# ══════════════ 技术树全部 191 个形象（同一套量产规则；key = 'te'）══════════════
# 树色 = 钢蓝灰护目镜：0–2 转是额头护目镜 / 安全帽，3–5 转缩成扣子，英雄上领口；p0 遥控 / 工事（机器、工程），p1 突击 / 阵地（喷、挖、场、炮）
TE_TC, HAZ, OLIVE, RED_L = '#aab6c4', '#e8c020', '#5a6040', '#ff3a3a'
LOOK_GLOW |= {RED_L}; LOOK_MATS.update({RED_L: 'glow'})

def w_wrench(c, L, metal, grip):
    # 扳手：握柄在原点，柄沿 -y，头部开口扳口
    box(c, (0, 0), (-L, 3), (0, 0), metal); box(c, (-1, 1), (-2, 3), (-1, 1), grip)
    box(c, (-3, 3), (-L - 5, -L), (0, 0), metal); box(c, (-1, 1), (-L - 5, -L - 3), (0, 0), BLK)
    for (i, j, k) in [q for q in c if c[q] == BLK]: del c[(i, j, k)]
def w_remote(c, body, glow):
    # 遥控器：双摇杆手柄 + 天线
    box(c, (-3, 3), (-4, 0), (0, 1), body); box(c, (-3, -2), (-2, -2), (2, 2), GUN); box(c, (2, 3), (-2, -2), (2, 2), GUN)
    c[(0, -3, 2)] = glow; line(c, (2, -4, 1), (3, -10, 5), STEEL); c[(3, -10, 6)] = glow
def w_detonator(c, body, glow):
    # 起爆器：方盒 + T 形压柄 + 红灯
    box(c, (-2, 2), (-4, 0), (-1, 2), body); box(c, (0, 0), (-2, -2), (3, 6), STEEL); box(c, (-2, 2), (-2, -2), (7, 7), STEEL); c[(-2, -5, 2)] = glow
def w_drill(c, L, body, bit, glow):
    # 手持钻：握把 + 电机 + 沿 -y 收尖的钻头（螺纹亮暗交替）
    box(c, (0, 0), (0, 2), (-3, 0), GUN); box(c, (-2, 2), (-6, 0), (0, 3), body); c[(0, -3, 4)] = glow
    for j in range(L):
        r = max(0, 2 - j * 3 // L)
        box(c, (-r, r), (-7 - j, -7 - j), (1 - r + 1, 1 + r + 1), bit if j % 2 else EDGE)
def w_emitter(c, R, body, glow):
    # 力场发生器：握把 + 掌前一圈六边形发射环 + 中心核
    box(c, (0, 0), (0, 2), (-3, 0), GUN); box(c, (-1, 1), (-4, 0), (0, 2), body)
    for i in range(6):
        a, b = math.pi / 3 * i, math.pi / 3 * (i + 1)
        line(c, (round(R * math.cos(a)), -5, round(1 + R * math.sin(a))), (round(R * math.cos(b)), -5, round(1 + R * math.sin(b))), body)
    box(c, (0, 0), (-6, -5), (1, 1), glow)
LOOK_WPN.update({
    'wrench':        lambda c: w_wrench(c, 10, STEEL, '#c03a2a'),
    'wrench_big':    lambda c: w_wrench(c, 18, IRON, HAZ),
    'wrench_star':   lambda c: w_wrench(c, 20, STARW, STARG),
    'remote':        lambda c: w_remote(c, '#3a3a40', CYAN),
    'remote_star':   lambda c: w_remote(c, STARW, LIGHT),
    'detonator':     lambda c: w_detonator(c, '#a03a2a', RED_L),
    'detonator_star': lambda c: w_detonator(c, STARW, LIGHT),
    'drill':         lambda c: w_drill(c, 10, HAZ, STEEL, AMBER),
    'drill_star':    lambda c: w_drill(c, 13, STARW, STARG, LIGHT),
    'emitter':       lambda c: w_emitter(c, 4, '#4a5a7a', VIO),
    'emitter_star':  lambda c: w_emitter(c, 5, STARW, LIGHT),
    'spray_acid':    lambda c: w_sprayer(c, '#6a8a2a', STICKY),
    'spray_star':    lambda c: w_sprayer(c, STARW, LIGHT),
})

def drone(c, x, y, z, glow, eye=None):
    # 小无人机：机身 + 四角旋翼 + 底部灯（eye = 前脸一颗眼灯）
    box(c, (x, x + 2), (y, y + 2), (z, z), '#e6ecef'); box(c, (x + 1, x + 1), (y + 1, y + 1), (z - 1, z - 1), glow)
    for dx in (-1, 3):
        for dy in (-1, 3): c[(x + dx, y + dy, z + 1)] = '#555b60'
    if eye: c[(x + 1, y - 1, z)] = eye

def sig_e0(part, t, v, U, rnd, F):
    # 无人机群：背后天线背包 + 肩旁一架无人机。v0 猎杀 = 身边绕着红眼攻击无人机（越往后越多）；v1 标定 = 头戴标定目镜 + 头顶一架信标机；5 转背后机巢，英雄背后蜂巢架 + 一群机
    chest, head = part('Spine2'), part('Head'); n = t - 3
    box(chest, (-3, 2), (2, 4), (10, 16), '#3a3a40'); line(chest, (2, 3, 17), (3, 3, 24 + n), STEEL); chest[(3, 3, 25 + n)] = F['glow']
    drone(chest, 7, -1, 22, F['glow'])
    if t >= 4 and v == 0:
        for i in range(1 + 2 * n):
            a = 2 * math.pi * i / (1 + 2 * n) + 1.2; drone(chest, round(-1.5 + 10 * math.cos(a)), round(-1.5 + 7 * math.sin(a)), 19 + 3 * (i % 2), RED_L, RED_L)
    if t >= 4 and v == 1:
        box(head, (-6, 5), (-7, -7), (24, 25), '#3a3a40'); box(head, (-4, -2), (-8, -8), (24, 25), F['glow']); head[(3, -8, 25)] = RED_L
        drone(head, -2, -1, 33 + n, F['glow'])
        if n >= 1: line(head, (-1, 0, 32 + n), (-1, -6, 29), F['glow'])
    if t >= 5: box(chest, (-5, 4), (3, 6), (17, 21), '#4a4f53'); box(chest, (-4, 3), (6, 6), (18, 20), F['glow'])
    if t >= 6:
        for x in range(-12, 12, 3):
            for z in range(16, 31, 3):
                if abs(x + .5) + abs(z - 23) * 1.2 <= 13: box(chest, (x, x + 2), (6, 6), (z, z + 2), '#4a4f53'); chest[(x + 1, 7, z + 1)] = F['glow']
        for x, z in ((-14, 30), (12, 30), (-15, 22), (13, 22)): drone(chest, x, 4, z, F['glow'], RED_L)

def sig_e1(part, t, v, U, rnd, F):
    # 载具：左肩液压大肩甲 + 背后一根排气管。v0 突击 = 背后双推进喷口（越往后焰越长）；v1 重甲 = 胸前加厚装甲 + 双前臂护甲；5 转头上天线，英雄背后机甲骨架臂
    chest, head = part('Spine2'), part('Head'); n = t - 3
    box(chest, (4, 8), (-3, 2), (17, 19), IRON); box(chest, (4, 8), (-4, -4), (18, 18), HAZ); box(chest, (6, 6), (-4, -4), (17, 17), BLK)
    box(chest, (-6, -5), (3, 4), (12, 21), '#4a4f53'); chest[(-6, 3, 22)] = '#2a2a2e'
    if t >= 4 and v == 0:
        for x in ((-3, -2), (1, 2)):
            box(chest, x, (3, 5), (10, 14), IRON)
            for k in range(2 + 2 * n): box(chest, x, (4, 4), (9 - k, 9 - k), F['glow'] if k < 2 + n else EMBER)
    if t >= 4 and v == 1:
        box(chest, (-4, 3), (-4, -4), (12, 16), IRON); box(chest, (-3, 2), (-5, -5), (13 + (n == 0), 15), '#4a4f53')
        for side, f in SIDES: box(part(side + 'ForeArm'), f((7, 8)), (-4, 2), (14 - n, 18), IRON); part(side + 'ForeArm')[(f((7, 7))[0], -5, 16)] = F['glow']
    if t >= 5: line(head, (4, 2, 28), (5, 2, 35), STEEL); head[(5, 2, 36)] = F['glow']; box(head, (3, 5), (1, 3), (27, 28), IRON)
    if t >= 6:
        for side, f in SIDES:
            sx = 1 if side == 'Left' else -1; x0 = f((3, 3))[0]
            box(chest, tuple(sorted((x0, x0 + sx))), (3, 5), (10, 24), IRON); line(chest, (x0 + sx, 4, 24), (x0 + sx * 7, 2, 27), IRON); line(chest, (x0 + sx * 7, 2, 27), (x0 + sx * 9, -2, 25), IRON)
            box(chest, tuple(sorted((x0 + sx * 8, x0 + sx * 10))), (-3, -1), (23, 25), '#4a4f53'); chest[(x0 + sx * 9, -4, 24)] = F['glow']

def sig_e2(part, t, v, U, rnd, F):
    # 炮台：腰间工具带 + 右肩一座迷你炮塔。v0 群塔 = 背后折叠架上插满小炮台（越往后越多）；v1 巨塔 = 右肩炮塔换成大炮（越往后炮管越长）；5 转安全帽，英雄背后双管炮塔
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    box(hips, (-5, 4), (-3, 2), (10, 10), '#5a3a22')
    for x in (-5, 3): box(hips, (x, x + 1), (-3, -3), (8, 10), '#6a4428')
    box(chest, (-8, -6), (-2, 0), (18, 20), IRON); line(chest, (-7, -3, 20), (-7, -8, 20), GUN); chest[(-7, -2, 21)] = F['glow']
    if t >= 4 and v == 0:
        box(chest, (-1, 0), (2, 4), (8, 22), '#4a4f53')
        for i in range(2 + 2 * n):
            x, z = (-6, 4, -7, 5, -5, 3, -8, 6)[i], (22, 22, 17, 17, 27, 27, 12, 12)[i]
            box(chest, (x, x + 2), (3, 5), (z, z + 1), IRON); line(chest, (x + 1, 2, z + 1), (x + 1, -1, z + 1), GUN); chest[(x + 1, 6, z)] = F['glow']
    if t >= 4 and v == 1:
        box(chest, (-10, -6), (-3, 1), (18, 22), IRON); line(chest, (-8, -4, 21), (-8, -10 - 2 * n, 21), GUN); line(chest, (-7, -4, 21), (-7, -10 - 2 * n, 21), GUN)
        chest[(-8, -11 - 2 * n, 21)] = F['glow']
    if t >= 5: box(head, (-7, 6), (-7, 6), (26, 29), HAZ); box(head, (-8, 7), (-8, -7), (26, 26), HAZ); box(head, (-1, 0), (-7, 6), (30, 30), HAZ)
    if t >= 6:
        box(chest, (-3, 2), (3, 7), (14, 30), '#4a4f53'); box(chest, (-5, 4), (2, 8), (31, 35), IRON)
        for x in (-3, 1): box(chest, (x, x + 1), (-8, 1), (33, 34), GUN); chest[(x, -9, 33)] = F['glow']
        box(chest, (-5, 4), (8, 8), (32, 34), F['glow'])

def jaw(c, x, y, z, R, col, tooth):
    # 张开的捕兽夹：上下两片半圆夹口（xz 面），齿朝里
    for i in range(16):
        a = math.pi * i / 15
        c[(round(x + R * math.cos(a)), y, round(z + 1 + R * .7 * math.sin(a)))] = col; c[(round(x + R * math.cos(a)), y, round(z - 1 - R * .7 * math.sin(a)))] = col
        if i % 3 == 1: c[(round(x + (R - 1) * math.cos(a)), y, round(z + R * .7 * math.sin(a)))] = tooth; c[(round(x + (R - 1) * math.cos(a)), y, round(z - R * .7 * math.sin(a)))] = tooth

def sig_e3(part, t, v, U, rnd, F):
    # 陷阱：左腰挂一只捕兽夹 + 胸前斜缠绊线卷。v0 爆破 = 胸前 / 背后绑成捆的炸药（越往后越多）；v1 夹具 = 背后一张张开的大夹口；5 转前臂黑黄警示纹，英雄背后巨型捕兽夹
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    jaw(hips, 6, -1, 8 - U, 2, IRON, EDGE)
    for k in range(12, 18): chest[(k - 15, -3, k)] = '#c8a868'
    box(chest, (2, 3), (-4, -4), (16, 17), '#c8a868'); chest[(3, -5, 17)] = F['glow']
    if t >= 4 and v == 0:
        for i in range(1 + n):
            for y, x0 in ((-4, (-4, 0, 1, -3)[i]), (3, (-3, 1, -1, -3)[i])):
                box(chest, (x0, x0 + 2), (y, y), (12 + 2 * i, 13 + 2 * i), '#c03a2a'); chest[(x0 + 1, y - (y < 0) + (y > 0), 14 + 2 * i)] = F['glow']
    if t >= 4 and v == 1: jaw(chest, -1, 4, 17, 4 + n, IRON, EDGE); chest[(-1, 4, 17)] = F['glow']
    if t >= 5:
        for side, f in SIDES:
            for x in (7, 8): box(part(side + 'ForeArm'), f((x, x)), (-3, 1), (15, 17), HAZ if x % 2 else BLK)
    if t >= 6:
        jaw(chest, -1, 6, 21, 9, IRON, EDGE); box(chest, (-2, 1), (6, 6), (20, 22), F['glow'])
        for z in range(10, 18, 2): chest[(-1, 6, z)] = IRON

def tank(c, x0, x1, z0, z1, body, liquid):
    box(c, (x0, x1), (2, 4), (z0, z1), body); box(c, (x0, x1), (2, 4), (z1 + 1, z1 + 1), IRON); box(c, (x0, x0), (2, 2), (z0 + 1, z1 - 1), liquid)

def sig_e4(part, t, v, U, rnd, F):
    # 锥形喷射：背后双罐 + 防毒面具。v0 冰雾 = 冰蓝罐 + 身边浮着冰晶（越往后越多）；v1 酸蚀 = 酸绿罐 + 腰间滴酸；5 转第三罐 + 软管到右手，英雄背后一排罐 + 泄压阀
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    liq = (GHOST_E, STICKY)[v] if t >= 4 else F['glow']
    for x in ((-4, -2), (1, 3)): tank(chest, x[0], x[1], 9, 17, '#8a8f94', liq)
    box(head, (-3, 2), (-7, -7), (19, 22), '#3a3a40'); box(head, (-1, 0), (-8, -8), (19, 20), STEEL); box(head, (-5, -4), (-7, -7), (23, 24), F['glow']); box(head, (3, 4), (-7, -7), (23, 24), F['glow'])
    if t >= 4 and v == 0:
        for i in range(2 + 2 * n):
            a = 2 * math.pi * i / (2 + 2 * n) + .4; x, y, z = round(-0.5 + 9 * math.cos(a)), round(-0.5 + 6 * math.sin(a)), 13 + 4 * (i % 3)
            box(chest, (x, x), (y, y), (z - 1, z + 1), GHOST); box(chest, (x - 1, x + 1), (y, y), (z, z), GHOST); chest[(x, y, z)] = GHOST_E
    if t >= 4 and v == 1:
        for k in range(1 + n): x = (-5, 4, -1, 2)[k]; box(hips, (x, x), (-3, -3), (7 - n - U, 9), STICKY)
    if t >= 5: tank(chest, -1, 0, 18, 22, '#8a8f94', liq); line(chest, (-1, 3, 12), (-6, -1, 13), '#2a2a2e')
    if t >= 6:
        for x0 in (-10, -7, 5, 8): tank(chest, x0, x0 + 1, 10, 22, '#6a6f74', liq); chest[(x0, 3, 24)] = F['glow']
        for x in (-9, 6): line(chest, (x, 3, 23), (x, 3, 27), STEEL); box(chest, (x - 1, x + 1), (2, 4), (28, 28), F['glow'])

def sig_e5(part, t, v, U, rnd, F):
    # 地道：矿灯头盔 + 背后一把短镐。v0 突袭 = 左前臂装钻头（越往后越长）；v1 坑道 = 背后铲子 + 腰侧矿石袋；5 转肩上碎石 + 矿晶，英雄背后一台大钻机
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    box(head, (-7, 6), (-7, 6), (26, 28), HAZ); box(head, (-6, 5), (-6, 5), (29, 30), HAZ); box(head, (-1, 0), (-8, -8), (27, 28), '#fff6d8')
    line(chest, (-5, 3, 9), (4, 3, 21), '#6a4a2a'); line(chest, (1, 3, 22), (7, 3, 19), IRON); line(chest, (1, 3, 22), (-2, 3, 24), IRON)
    if t >= 4 and v == 0:
        fa = part('LeftForeArm'); box(fa, (7, 9), (-3, 1), (14, 18), HAZ)
        for j in range(3 + 2 * n):
            r = max(0, 2 - j * 3 // (3 + 2 * n)); box(fa, (10 + j, 10 + j), (-1 - r, -1 + r), (16 - r, 16 + r), STEEL if j % 2 else EDGE)
    if t >= 4 and v == 1:
        line(chest, (3, 4, 8), (-3, 4, 22), '#6a4a2a'); box(chest, (-5, -2), (4, 4), (22, 26), IRON)
        for k in range(1 + n): box(hips, (-7 + k, -5 + k), (-2 + k, 0 + k), (7 - U, 9 - U), '#8a7050'); hips[(-6 + k, -3 + k, 9 - U)] = F['glow']
    if t >= 5:
        for side, f in SIDES: box(chest, f((4, 6)), (-2, 0), (18, 18), STONE); chest[(f((5, 5))[0], -1, 19)] = F['glow']
    if t >= 6:
        box(chest, (-4, 3), (3, 7), (10, 16), HAZ); box(chest, (-3, 2), (8, 8), (12, 14), F['glow'])
        for j in range(16):
            r = max(0, 4 - j // 4); box(chest, (-1 - r, r), (4, 6), (17 + j, 17 + j), STEEL if j % 2 else IRON)

def sig_e6(part, t, v, U, rnd, F):
    # 屏障：双肩场节点（发光短柱）+ 背后发生器。v0 反射 = 身边浮着镜面板（越往后越多）；v1 重压 = 身周一圈脉冲环（越往后越多圈）；5 转肩节点长成天线柱，英雄背后半透明穹顶网格
    chest, hips = part('Spine2'), part('Hips'); n = t - 3
    for side, f in SIDES: box(chest, f((5, 6)), (-1, 0), (18, 19), '#4a5a7a'); box(chest, f((5, 6)), (-1, 0), (20, 20 + (t >= 5) * 4), F['glow'])
    box(chest, (-3, 2), (2, 4), (11, 16), '#4a5a7a'); box(chest, (-2, 1), (5, 5), (12, 15), F['glow'])
    if t >= 4 and v == 0:
        for i in range(2 + n):
            a = 2 * math.pi * i / (2 + n) + .8; x, y = round(-0.5 + 10 * math.cos(a)), round(-0.5 + 7 * math.sin(a))
            box(chest, (x - 1, x + 1), (y, y), (15, 20), EDGE); box(chest, (x - 1, x + 1), (y, y), (21, 21), F['glow'])
    if t >= 4 and v == 1:
        for k in range(1 + n):
            R, z = 8 + 2 * k, 10 + 3 * k - U
            for i in range(32): a = 2 * math.pi * i / 32; hips[(round(-0.5 + R * math.cos(a)), round(-0.5 + R * .8 * math.sin(a)), z)] = F['glow'] if i % 4 == 0 else GHOST
    if t >= 6:
        for i in range(-12, 12):
            for z in range(10, 34):
                d = math.hypot(i + .5, (z - 18) * 1.1)
                if 11 <= d <= 12.2 or d < 11 and ((i + z) % 4 == 0 or (i - z) % 4 == 0) and z > 18: chest[(i, 6, z)] = F['glow'] if d >= 11 else GHOST

def sig_e7(part, t, v, U, rnd, F):
    # 远程炮击：背后电台 + 长天线（越往后越长）+ 胸前望远镜。v0 徐进 = 胸前斜挎炮弹带 + 腰间信号弹；v1 制导 = 右肩激光指示器 + 耳机；5 转小雷达盘，英雄背后一排炮弹架
    chest, head, hips = part('Spine2'), part('Head'), part('Hips'); n = t - 3
    box(chest, (-3, 2), (2, 5), (10, 17), OLIVE); box(chest, (-2, 1), (6, 6), (12, 13), F['glow'])
    line(chest, (-3, 4, 18), (-6, 5, 28 + 2 * n), '#2a2a2e'); chest[(-6, 5, 29 + 2 * n)] = F['glow']
    box(chest, (-1, 0), (-4, -4), (14, 15), '#2a2a2e'); box(chest, (-2, -2), (-5, -5), (15, 15), '#4a86c8'); box(chest, (1, 1), (-5, -5), (15, 15), '#4a86c8')
    if t >= 4 and v == 0:
        for k in range(12, 18): chest[(k - 15, -4, k)] = BELT; chest[(k - 14, -4, k)] = '#c8a020'
        for k in range(1 + n): box(hips, (5, 5), (-2 + k, -2 + k), (7, 9), (RED_L, F['glow'], '#f0f0f0', AMBER)[k])
    if t >= 4 and v == 1:
        box(chest, (-8, -6), (-3, 0), (19, 20), '#3a3a40'); line(chest, (-7, -4, 20), (-7, -7 - n, 20), GUN); chest[(-7, -8 - n, 20)] = RED_L
        for x in (-7, 6): box(head, (x, x), (-1, 1), (21, 24), '#2a2a2e')
        box(head, (-7, 6), (0, 0), (29, 29), '#2a2a2e')
    if t >= 5:
        for i in range(12): a = 2 * math.pi * i / 12; chest[(round(3.5 + 3 * math.cos(a)), 6, round(21 + 3 * math.sin(a)))] = STEEL
        chest[(3, 6, 21)] = F['glow']; line(chest, (3, 5, 18), (3, 5, 20), IRON)
    if t >= 6:
        box(chest, (-8, 7), (6, 6), (8, 24), OLIVE)
        for x in range(-7, 7, 2):
            for z in (12, 19): box(chest, (x, x), (5, 5), (z, z + 4), '#c8a020'); chest[(x, 5, z + 5)] = RED_L if x % 4 else '#c03a2a'

TE_FAM = [   # 8 个家族 = classes.ts TECH styles[方向][分线]：遥控兵（无人机 / 载具）、工事兵（炮台 / 陷阱）、突击兵（喷射 / 地道）、阵地兵（屏障 / 炮击）
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=CYAN, style=('short', 'ponytail', 'short'), coat=MG_M, sig=sig_e0),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=AMBER, style=('helmet', 'spiky', 'helmet'), coat=MG_M, sig=sig_e1),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=EMBER, style=('short', 'bald', 'spiky'), coat=MG_M, sig=sig_e2),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=FORT, style=('spiky', 'short', 'bald'), coat=MG_M, sig=sig_e3),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=AZURE, style=('bald', 'short', 'bald'), coat=MG_M, sig=sig_e4),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=JADE, style=('short', 'bald', 'short'), coat=MG_M, sig=sig_e5),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=VIO, style=('long', 'ponytail', 'long'), coat=MG_M, sig=sig_e6),
    dict(top=MG_M, top2=MG_S, pants=MG_M, glow=RED_L, style=('helmet', 'short', 'helmet'), coat=MG_M, sig=sig_e7),
]
TE_FACE = [dict(CHARS['sif'], extra=[]), dict(CHARS['nox'], extra=[], style='short'),            # TEMPLATE.tech：sif / nox / jet / vera
           dict(CHARS['jet'], extra=[]), dict(CHARS['vera'], extra=[])]

def te_look_weapons(f, t, v):
    if t == 7: return [('remote_star', 'pistol'), ('wrench_star', None), ('wrench_star', 'smg'), ('detonator_star', 'grenade'),
                       ('spray_star', None), ('drill_star', None), ('emitter_star', 'emitter_star'), ('glauncher', 'laser')][f]
    if f == 0: return 'remote', ('pistol' if t >= 5 else None)
    if f == 1: return 'wrench_big', None
    if f == 2: return 'wrench', ('smg' if v == 0 else 'pistol') if t >= 4 else None
    if f == 3: return 'detonator', ('grenade' if v == 0 and t >= 4 else None)
    if f == 4: return ('freezer' if v == 0 else 'spray_acid') if t >= 4 else 'flamer', None
    if f == 5: return 'drill', None
    if f == 6: return 'emitter', ('emitter' if t >= 5 else None)
    return ('glauncher' if v == 0 or t == 3 else 'laser'), None

def goggles(head, y=-7):   # 技术树色件：额头一副钢蓝灰护目镜
    box(head, (-6, 5), (-6, 5), (26, 26), '#3a3a40')
    for x in ((-5, -2), (1, 4)): box(head, x, (y, y), (25, 27), TE_TC); box(head, (x[0] + 1, x[1] - 1), (y - 1, y - 1), (26, 26), CYAN)
def look_te0(part, U, rnd):    # 技师：护目镜 + 腰间工具带（扳手挂在右腰）+ 手枪
    hips = part('Hips'); goggles(part('Head')); box(hips, (-5, 4), (-3, 2), (10, 10), '#5a3a22'); line(hips, (-5, -3, 10), (-5, -3, 6), STEEL)
def look_te1(part, U, rnd):    # 工程师：护目镜 + 背后工具箱 + 扳手
    chest = part('Spine2'); goggles(part('Head')); box(chest, (-3, 2), (2, 4), (11, 15), '#c03a2a'); box(chest, (-2, 1), (2, 4), (16, 16), STEEL)
def look_te1a(part, U, rnd):   # 装备兵：护目镜 + 胸前插板背心 + 左肩甲 + 冲锋枪
    chest = part('Spine2'); goggles(part('Head')); box(chest, (-3, 2), (-3, -3), (12, 16), '#4a4f53'); box(chest, (4, 7), (-3, 1), (17, 18), '#4a4f53')
def look_te00(part, U, rnd):   # 遥控兵：护目镜 + 天线背包 + 肩上一架无人机 + 遥控器
    chest = part('Spine2'); goggles(part('Head')); box(chest, (-3, 2), (2, 4), (10, 16), '#3a3a40'); line(chest, (2, 3, 17), (3, 3, 24), STEEL); drone(chest, 7, -1, 22, CYAN)
def look_te01(part, U, rnd):   # 工事兵：钢蓝灰安全帽 + 工具带 + 扳手 / 手枪
    head, hips = part('Head'), part('Hips'); box(head, (-7, 6), (-7, 6), (26, 29), TE_TC); box(head, (-8, 7), (-8, -7), (26, 26), TE_TC); box(head, (-1, 0), (-7, 6), (30, 30), TE_TC)
    box(hips, (-5, 4), (-3, 2), (10, 10), '#5a3a22')
def look_te10(part, U, rnd):   # 突击兵：护目镜 + 背后燃料罐 + 喷火器
    chest = part('Spine2'); goggles(part('Head'))
    for x in ((-4, -2), (1, 3)): tank(chest, x[0], x[1], 9, 17, '#8a8f94', EMBER)
def look_te11(part, U, rnd):   # 阵地兵：护目镜 + 背后电台 + 天线 + 榴弹发射器
    chest = part('Spine2'); goggles(part('Head')); box(chest, (-3, 2), (2, 5), (10, 17), OLIVE); line(chest, (-3, 4, 18), (-6, 5, 27), '#2a2a2e')

TE = dict(tree='tech', fam=TE_FAM, face=TE_FACE, wpn=te_look_weapons, star=star_plus(TE_FAM), heavy=(1, 4), salt=9, shield=False)
TE_CHAIN = {   # 手写：基础 + 1 转 2 个 + 2 转 4 个（每方向一套）
    'te':    dict(TE_FACE[0], glove='#2a2a2e', deco=look_te0, wr='pistol'),
    'te-0':  dict(TE_FACE[0], glove='#2a2a2e', deco=look_te1, wr='wrench'),
    'te-1':  dict(TE_FACE[1], glove='#2a2a2e', deco=look_te1a, wr='smg'),
    'te-00': dict(TE_FACE[0], style='ponytail', glove='#2a2a2e', deco=look_te00, wr='remote', k=1.03),
    'te-01': dict(TE_FACE[1], style='short', glove='#5a3a22', deco=look_te01, wr='wrench', wl='pistol', k=1.03),
    'te-10': dict(TE_FACE[2], glove='#2a2a2e', deco=look_te10, wr='flamer', k=1.03),
    'te-11': dict(TE_FACE[3], style='helmet', glove='#2a2a2e', deco=look_te11, wr='glauncher', k=1.03),
}

def cid(path, ult=False, key='sw'): return key + ('-' + ''.join(map(str, path)) if path else '') + ('+' if ult else '')
PATHS = [[(i >> (d - 1 - b)) & 1 for b in range(d)] for d in range(7) for i in range(2 ** d)]
LOOKS = {}
for key, T, chain in (('sw', SW, CHAIN), ('ar', AR, AR_CHAIN), ('mg', MG, MG_CHAIN), ('md', MD, MD_CHAIN), ('te', TE, TE_CHAIN)):
    for p, ult in [(p, False) for p in PATHS] + [(p, True) for p in PATHS if len(p) == 6]:
        lid, t = cid(p, ult, key), 7 if ult else len(p); C = pal(T['tree'], t, u_of(p))
        L = dict(chain[lid], top=C['main'], top2=C['sub'], pants=C['pants']) if lid in chain else gen_look(p, ult, T)
        LOOKS[lid] = dict(L, t=t, pal=C, tree=T['tree'])
assert len(LOOKS) == 955 and set(CHAIN) | set(AR_CHAIN) | set(MG_CHAIN) | set(MD_CHAIN) | set(TE_CHAIN) <= set(LOOKS)

def lift_parts(P, U):
    """腿加长 U 格（对上 zjoints：膝 +U/2、髋及以上 +U）：小腿、大腿各在中段补一截，大腿以上整体上移 U。"""
    def shift(c, n): return {(i, j, k + n): v for (i, j, k), v in c.items()}
    def stretch(c, at, n):
        out = {(i, j, k + n if k > at else k): v for (i, j, k), v in c.items()}
        for (i, j, k), v in c.items():
            if k == at:
                for d in range(1, n + 1): out[(i, j, k + d)] = v
        return out
    h = U // 2
    for g in list(P):
        b = g.replace('mixamorig:', '').replace('Left', '').replace('Right', '').split('|')[0]
        if b in ('Foot', 'ToeBase'): continue
        P[g] = stretch(P[g], 3, h) if b == 'Leg' else stretch(shift(P[g], h), 6 + h, U - h) if b == 'UpLeg' else shift(P[g], U)

_P = {'mixamorig:LeftLeg': {(0, 0, 3): 'a', (0, 0, 4): 'b'}, 'mixamorig:Head': {(0, 0, 20): 'c'}}; lift_parts(_P, 2)
assert _P == {'mixamorig:LeftLeg': {(0, 0, 3): 'a', (0, 0, 4): 'a', (0, 0, 5): 'b'}, 'mixamorig:Head': {(0, 0, 22): 'c'}}, _P

def recolor(P, L):
    # 树色 / 白金 / 旧的绿迷彩 → 色谱色；主色面上按转数刷装饰色花纹（2 转下摆线、3 转袖口、4 转一道 V 纹、5 转两道、英雄起菱点）；
    # 髋部前半、腰带以下、两腿之间的格子删掉：下摆只许在背后和两侧，不挡腿
    p, t = L['pal'], L['t']
    M = {GOLDY: p['trim'], AR_TC: p['trim'], STARG: p['trim'], STARW: p['main'], '#4a6a3a': p['main'], '#6a7a4a': p['pants'],
         '#3a4a2a': p['sub'], '#3e4a2a': p['pants'], '#3a4a38': p['sub'], '#4c5e2e': p['sub'], MG_M: p['main'], MG_S: p['sub']}
    if L['tree'] == 'swordsman': M |= {VIO: AZURE, VIO_D: '#2a4a9a', SHD: '#1e2838', SHD2: '#2c3a54'}   # 剑士不用紫：飘带 / 光效 / 龙翼的紫换成蓝
    rules = [r for i, r in enumerate((lambda x, z: z == 12, lambda x, z: abs(x + .5) - .5 == 16 - z,
                                      lambda x, z: abs(x + .5) - .5 == 13 - z, lambda x, z: z % 2 == 0 and (x - z) % 4 == 0)) if t >= (2, 4, 5, 6)[i]]
    for g, cs in P.items():
        b = g.split(':')[-1]
        for q in list(cs):
            x, y, z = q
            if b.startswith('Hips') and z < 9 and -4 <= y <= 0 and -4 <= x <= 3: del cs[q]; continue
            c = cs[q] = M.get(cs[q], cs[q])
            if p['belt'] and c == p['main'] and b == 'Spine2' and x - z in (-14, -13): cs[q] = p['belt']; continue   # 射手：左肩到右腰的皮带
            if c == p['main'] and (b == 'Spine2' and any(r(x, z) for r in rules) or t >= 3 and b.endswith('ForeArm') and z == 15): cs[q] = p['trim']

def look_cells(lid):
    L = LOOKS[lid]; U = L.get('lift', 0)
    P = build_char(L)
    L['deco'](lambda bone: P.setdefault('mixamorig:' + bone, {}), U, random.Random(lid))
    recolor(P, L)
    lift_parts(P, U)
    return P

if 'looks' in only:
    # 五棵树 955 个互不相同：体素 + 武器整体做指纹，撞了就是招牌件参数没生效
    seen = {}
    for lid, L in LOOKS.items():
        fp = hash((frozenset((g, c, v) for g, cs in look_cells(lid).items() for c, v in cs.items()), L['wr'], L.get('wl')))
        assert fp not in seen, (lid, seen.get(fp)); seen[fp] = lid
    meta = {lid: dict(wr=L['wr'], wl=L.get('wl'), hips=round(zjoints({'lift': L.get('lift', 0), 'k': L.get('k', 1)})['Hips'][2], 4)) for lid, L in LOOKS.items()}
    with open(os.path.join(out_dir, '..', 'looks.json'), 'w') as f: json.dump(meta, f, separators=(',', ':'))
    for wid in sorted({w for L in LOOKS.values() for w in (L['wr'], L.get('wl')) if w in LOOK_WPN}):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        cells = {}; LOOK_WPN[wid](cells)
        o = voxmesh('vox_' + wid, {'wpn': cells}, 0.02, half, mats=LOOK_MATS)
        o.vertex_groups.clear()
        export([o], os.path.join(out_dir, 'vox_%s.glb' % wid))
        print("WPN_OK", wid, len(o.data.polygons), "len_m", round(o.dimensions.y, 3))
    for lid, L in LOOKS.items():
        if len(only) > 1 and lid not in only and lid.split('-')[0].rstrip('+') not in only: continue   # looks ar = 只出射手树
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = poses.FPS
        U, k = L.get('lift', 0), L.get('k', 1)
        # 只有 sw 带动作；其余 190 个运行时借 sw 的片段（旋转原样、臀部位移按 looks.json 的 hips 比例缩）
        arm = skeleton(zjoints({'lift': U, 'k': k}), keep_anims=lid == 'sw')
        char = voxmesh('vox_' + lid, look_cells(lid), V * k, mats=LOOK_MATS,
                       shrink={'mixamorig:Head': (Vector((0, 0, 18 + U)), L.get('head_k', HEAD_K))})
        char.parent = arm
        char.matrix_parent_inverse = arm.matrix_world.inverted()
        char.modifiers.new('arm', 'ARMATURE').object = arm
        if lid == 'sw': poses.build(arm)
        export([arm, char], os.path.join(out_dir, 'vox_%s.glb' % lid.replace('+', '_star')))   # '+' 进 URL 会被当空格
        print("LOOK_OK", lid, "tris", sum(len(p.vertices) - 2 for p in char.data.polygons), "h_m", round(max(v.co.z for v in char.data.vertices) * k, 2))

if 'ghost' in only:
    # 半透明人形（残影 / 灵体用）：拿 sw-000000 那套体素整块改色成 GHOST，LOOK_MATS 把它映射成 _glass 后缀材质，
    # 运行时 prep() 认名字 → transparent + opacity .42 + depthWrite false。之前 _glass 只有武器宝珠在用，人形没上过。
    # 骨架同其余形象：只带 idle/run/walk 的裸骨，动作运行时借 sw 的片段（见 look_file / clipsFor）。
    SRC = 'sw-000000'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = poses.FPS
    U, k, HL = LOOKS[SRC].get('lift', 0), LOOKS[SRC].get('k', 1), LOOKS[SRC].get('head_k', HEAD_K)
    cells = look_cells(SRC)
    for g in cells:
        for c in cells[g]: cells[g][c] = GHOST
    arm = skeleton(zjoints({'lift': U, 'k': k}), keep_anims=False)
    char = voxmesh('vox_ghost', cells, V * k, mats=LOOK_MATS, shrink={'mixamorig:Head': (Vector((0, 0, 18 + U)), HL)})
    char.parent = arm
    char.matrix_parent_inverse = arm.matrix_world.inverted()
    char.modifiers.new('arm', 'ARMATURE').object = arm
    export([arm, char], os.path.join(out_dir, 'vox_ghost.glb'))
    print("GHOST_OK", "tris", sum(len(p.vertices) - 2 for p in char.data.polygons),
          "h_m", round(max(v.co.z for v in char.data.vertices) * k, 2), "mats", [m.name for m in char.data.materials])
