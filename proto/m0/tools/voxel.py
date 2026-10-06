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
GLOW_COLS = {'#a6ff3a', '#ffd23a', ZEYE, '#f07a2a'}

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
         'attack': Z[z.get('attack', 'attack')], 'hit': Z['hit'], 'death': Z['death'], 'death2': Z['death2'], 'death3': Z['death3']}
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

for kind, table, pre in (('zombies', ZOMBIES, 'vox_z_'), ('bosses', BOSSES, 'vox_b_')):
    if kind not in only: continue
    for zid, z in table.items():
        if len(only) > 1 and zid not in only: continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = poses.FPS
        J = zjoints(z)
        arm = skeleton(J, keep_anims=False)
        hz = 18 + z.get('lift', 0) + z.get('hoff', (0, 0))[1]
        mats = {c: 'glow' for c in GLOW_COLS}
        mesh = voxmesh(pre + zid, build_zombie(zid, z), V * z.get('k', 1), mats=mats,
                       shrink={'mixamorig:Head': (Vector((0, z.get('hoff', (0, 0))[0], hz)), ZHEAD_K)})
        mesh.parent = arm
        mesh.matrix_parent_inverse = arm.matrix_world.inverted()
        mesh.modifiers.new('arm', 'ARMATURE').object = arm
        poses.build(arm, zclips(z))
        export([arm, mesh], os.path.join(out_dir, pre + zid + '.glb'))
        print("ZOM_OK", zid, len(mesh.data.vertices), "tris", sum(len(p.vertices) - 2 for p in mesh.data.polygons))


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
