# M0 绑骨管线：把 Rodin 生成的静态角色绑到 Mixamo 骨架上，并挂上武器插槽。
#
#   blender -b -P rig.py -- <rodin_char.glb> <rig_donor.glb> <out.glb>
#
# 思路（代替手工上传 Mixamo）：
#   1. 角色按身高归一到 1.8，脚底落地、居中
#   2. 捐赠者（three.js 的 Xbot，Mixamo 骨架 + 已蒙皮 + 自带 idle/run/walk）
#      也归一到同身高，骨骼即为目标骨架
#   3. 把捐赠者手臂拟合到角色的 A-pose，这个姿态直接应用成骨架静止姿态（网格不动）
#   4. 从捐赠者身体投射权重；Xbot 动作按世界空间逐骨复制重定向到新静止姿态
#   5. 在右手 / 左手下加 socket_hand_r / socket_hand_l 两根挂点骨
#   6. 只导出 Rodin 网格 + 骨架 + 动画
import bpy, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

char_path, donor_path, out_path = sys.argv[sys.argv.index("--") + 1:][:3]
H = 1.8
TRIS = 7800   # docs/06 M0 验收：< 8k 三角面

bpy.ops.wm.read_factory_settings(use_empty=True)

def imported(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

def normalize(root, objs):
    lo, hi = world_bbox(objs)
    s = H / (hi.z - lo.z)
    root.scale = root.scale * s
    bpy.context.view_layer.update()
    lo, hi = world_bbox(objs)
    root.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bpy.context.view_layer.update()

def apply_all(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ── 角色 ──
char_objs = imported(char_path)
char = [o for o in char_objs if o.type == 'MESH'][0]
for o in char_objs:
    if o is not char:
        mw = char.matrix_world.copy()
        char.parent = None
        char.matrix_world = mw
char_root = char
normalize(char_root, [char])
apply_all([char])
# Rodin 的 Quad 模式 quality=8000 指 8000 个四边形 ≈ 16k 三角面，这里减到预算内
bpy.context.view_layer.objects.active = char
tris = sum(len(p.vertices) - 2 for p in char.data.polygons)
if tris > TRIS:
    dec = char.modifiers.new("dec", 'DECIMATE'); dec.ratio = TRIS / tris
    bpy.ops.object.modifier_apply(modifier="dec")

# ── 捐赠骨架 ──
donor_objs = imported(donor_path)
arm = [o for o in donor_objs if o.type == 'ARMATURE'][0]
body = max((o for o in donor_objs if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
arm.data.pose_position = 'REST'
droot = arm
while droot.parent: droot = droot.parent
normalize(droot, [body])
arm.data.pose_position = 'POSE'
# 导入器把动作挂在 NLA 上，每次 update 都会覆盖手摆的姿态：先摘掉，动作本身靠 fake user 保住
for a in bpy.data.actions: a.use_fake_user = True
arm.animation_data_clear()
bpy.context.view_layer.update()

# ── 把捐赠者的手臂摆成角色的姿态 ──
# Rodin 基本不肯出 T-pose（A-pose、手臂还左右不对称），而 Xbot 的静止姿态是 T-pose。
# 所以先逐侧搜肩/肘角度让捐赠者骨架贴合角色，再把这个姿态当成静止姿态。
to_arm = arm.matrix_world.to_3x3().normalized().inverted()
dg = bpy.context.evaluated_depsgraph_get()

import poses
aim = lambda name, d: poses.aim(arm, name, d)

# 分数 = 双向倒角距离：捐赠者手臂→角色表面 + 角色肩侧顶点→捐赠者表面。
# 只量单向会被风衣骗：手臂贴着衣服任何一处都"很近"，袖子却没人认领。
ctree = BVHTree.FromObject(char, dg)
gidx = {vg.name: vg.index for vg in body.vertex_groups}
ARM_G = {i for n, i in gidx.items() if any(k in n for k in ('Arm', 'Hand'))}

def arm_verts(side):
    want = {gidx['mixamorig:%s%s' % (side, n)] for n in ('Arm', 'ForeArm', 'Hand')}
    return [v.index for v in body.data.vertices if any(g.group in want and g.weight > 0.5 for g in v.groups)][::4]

def score(ids, cpts):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg); me = ev.to_mesh(); mw = body.matrix_world
    a = sum(ctree.find_nearest(mw @ me.vertices[i].co)[3] for i in ids) / len(ids)
    dtree = BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [p.vertices for p in me.polygons])
    b = sum(min(dtree.find_nearest(p)[3], 0.15) for p in cpts) / len(cpts)
    ev.to_mesh_clear()
    return a + b

import math
for side in ('Left', 'Right'):
    up, fore = 'mixamorig:%sArm' % side, 'mixamorig:%sForeArm' % side
    sx = 1 if (arm.matrix_world @ arm.pose.bones[up].head).x > 0 else -1
    ids = arm_verts(side)
    sh = arm.matrix_world @ arm.pose.bones[up].head
    cpts = [char.matrix_world @ v.co for v in char.data.vertices
            if (v.co.x - sh.x) * sx > 0 and v.co.z > 0.7][::3]
    # 方向 = 下垂角 a（0 = 水平侧伸）+ 前伸角 f（0 = 贴冠状面）；角色面朝 -Y
    def d(a, f):
        a, f = math.radians(a), math.radians(f)
        return (sx * math.cos(a) * math.cos(f), -math.sin(f), -math.sin(a) * math.cos(f))
    best = (9, None, None)
    for a in range(0, 86, 5):
        for f in range(0, 61, 15):
            aim(up, d(a, f)); aim(fore, d(a, f))
            best = min(best, (score(ids, cpts), (a, f), (a, f)))
    aim(up, d(*best[1]))
    for a in range(0, 101, 10):
        for f in range(0, 76, 15):
            aim(fore, d(a, f))
            best = min(best, (score(ids, cpts), best[1], (a, f)))
    aim(up, d(*best[1])); aim(fore, d(*best[2]))
    print("FIT", side, "shoulder", best[1], "elbow", best[2], "err", round(best[0], 4))

if os.environ.get("RIG_DEBUG"):   # 只看拟合后的捐赠者姿态
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'
    cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.2; cam.location = (0, -6, 0.95); cam.rotation_euler = (math.pi / 2, 0, 0)
    body.location.y -= 0.4
    sc.render.filepath = os.environ["RIG_DEBUG"]; bpy.ops.render.render(write_still=True)
    body.location.y += 0.4

# ── 权重：按拟合姿态从捐赠者身体投射（最近面插值）──
# 热扩散在 Rodin 这种非流形、多碎块的网格上会把头发/衣领分给手臂，一跑就炸成尖刺。
char.vertex_groups.clear()
for vg in body.vertex_groups:
    char.vertex_groups.new(name=vg.name)
bpy.context.view_layer.objects.active = char
dt = char.modifiers.new("dt", 'DATA_TRANSFER')
dt.object = body
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
dt.layers_vgroup_select_dst = 'NAME'
bpy.context.view_layer.update()
bpy.ops.object.modifier_apply(modifier="dt")

# 离捐赠者手臂太远却拿到了手臂权重的顶点（头发、衣摆挨着手）改用最近的非手臂顶点的权重
from mathutils.kdtree import KDTree
ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = ev.to_mesh()
dpos = [body.matrix_world @ v.co for v in me.vertices]; ev.to_mesh_clear()
# 手不算：Rodin 张开的手指比 Xbot 的手长出好几厘米，按距离判会把指尖分给大腿
FORE_G = {i for n, i in gidx.items() if n.endswith('Arm')}
armw = [sum(g.weight for g in v.groups if g.group in FORE_G) for v in body.data.vertices]
kd_all, kd_body = KDTree(len(dpos)), KDTree(len(dpos))
for i, p in enumerate(dpos):
    kd_all.insert(p, i)
    if armw[i] < 0.05: kd_body.insert(p, i)
kd_all.balance(); kd_body.balance()
cname = {vg.name: vg for vg in char.vertex_groups}
fixed = 0
for v in char.data.vertices:
    p = char.matrix_world @ v.co
    _, i, d = kd_all.find(p)
    if armw[i] > 0.3 and d > 0.06:
        _, j, _ = kd_body.find(p)
        for g in list(v.groups): char.vertex_groups[g.group].remove([v.index])
        for g in body.data.vertices[j].groups:
            cname[body.vertex_groups[g.group].name].add([v.index], g.weight, 'REPLACE')
        fixed += 1
# 同理按骨骼量：离"肩→肘→腕"连线超过袖子半径的顶点不可能是袖子（多是腰侧衣片），跟手臂走就会飞出去
from mathutils.geometry import intersect_point_line as ipl
def seg_d(p, a, b):
    q, t = ipl(p, a, b)
    return (p - (a if t < 0 else b if t > 1 else q)).length
bh = lambda n: arm.matrix_world @ arm.pose.bones[n].head
UP_G = {i for n, i in gidx.items() if n.endswith(('LeftArm', 'RightArm', 'ForeArm'))}
for v in char.data.vertices:
    if sum(g.weight for g in v.groups if char.vertex_groups[g.group].name in {body.vertex_groups[i].name for i in UP_G}) < 0.3: continue
    p = char.matrix_world @ v.co
    d = min(seg_d(p, bh('mixamorig:%sArm' % sd), bh('mixamorig:%sForeArm' % sd)) for sd in ('Left', 'Right'))
    d = min(d, *(seg_d(p, bh('mixamorig:%sForeArm' % sd), bh('mixamorig:%sHand' % sd)) for sd in ('Left', 'Right')))
    if d > 0.13:
        _, j, _ = kd_body.find(p)
        for g in list(v.groups): char.vertex_groups[g.group].remove([v.index])
        for g in body.data.vertices[j].groups:
            cname[body.vertex_groups[g.group].name].add([v.index], g.weight, 'REPLACE')
        fixed += 1
print("ARM_WEIGHT_FIX", fixed)
# 反向：袖子内侧离 Xbot 胯部表面比离手臂表面还近，拿了 Hips 权重，一抬手就留在原地飘着。
# 离手臂骨 < 袖子半径、且离捐赠者手臂表面比离身体表面近的，改用最近手臂顶点的权重
kd_arm = KDTree(len(dpos))
for i, p in enumerate(dpos):
    if armw[i] > 0.5: kd_arm.insert(p, i)
kd_arm.balance()
sleeve = 0
for v in char.data.vertices:
    p = char.matrix_world @ v.co
    d = min(seg_d(p, bh('mixamorig:%s%s' % (sd, a)), bh('mixamorig:%s%s' % (sd, b)))
            for sd in ('Left', 'Right') for a, b in (('Arm', 'ForeArm'), ('ForeArm', 'Hand')))
    _, j, da = kd_arm.find(p)
    if d > 0.13 or da >= kd_body.find(p)[2]: continue
    if sum(g.weight for g in v.groups if g.group in UP_G) > 0.5: continue
    for g in list(v.groups): char.vertex_groups[g.group].remove([v.index])
    for g in body.data.vertices[j].groups:
        cname[body.vertex_groups[g.group].name].add([v.index], g.weight, 'REPLACE')
    sleeve += 1
print("SLEEVE_FIX", sleeve)

# 反过来的情况：Rodin 张开的手指比 Xbot 的手长，垂在大腿边的指尖离捐赠者大腿比离捐赠者手更近，
# 于是拿到 UpLeg 权重，一抬手就拉出一根刺。离"手腕→指尖延长线"比离腿表面更近的顶点整个归手。
# ponytail: 手是刚体。Rodin 的手套手指和 Xbot 指骨对不上，逐指分权重一弯就撕；要真握紧得 M3 换带指骨的手模
from mathutils.geometry import intersect_point_line
LEGISH = {i for n, i in gidx.items() if 'Leg' in n or n == 'mixamorig:Hips'}
kd_leg = KDTree(len(dpos)); nleg = 0
for i, p in enumerate(dpos):
    if any(g.group in LEGISH and g.weight > 0.5 for g in body.data.vertices[i].groups): kd_leg.insert(p, i); nleg += 1
kd_leg.balance()
handfix = 0
for side in ('Left', 'Right'):
    w0 = arm.matrix_world @ arm.pose.bones['mixamorig:%sHand' % side].head
    w1 = arm.matrix_world @ arm.pose.bones['mixamorig:%sHandMiddle1' % side].head
    tip = w0 + (w1 - w0) * 2.6
    hand = cname['mixamorig:%sHand' % side]
    for v in char.data.vertices:
        p = char.matrix_world @ v.co
        q, t = intersect_point_line(p, w0, tip)
        if not 0 <= t <= 1: continue
        dh = (p - q).length
        if dh > 0.05 or dh >= kd_leg.find(p)[2]: continue
        for g in list(v.groups): char.vertex_groups[g.group].remove([v.index])
        hand.add([v.index], 1, 'REPLACE'); handfix += 1
print("HAND_FIX", handfix)
# Rodin 把垂着的手和大腿/衣摆长成了一整块：同一顶点既跟手又跟腿，一抬手就拉出尖刺。
# 硬切：手臂 与 腿/臀 二选一，谁权重大归谁（袖子内侧和衣身侧面同理）；
# 手臂 与 腿/臀 之间的面删掉——那是粘连，不是衣服。前提是生成时手臂离开身体（05 §2.2），
# 长外套那种上臂与衣身连成一片的，删了就漏洞。
is_a = lambda n: 'Arm' in n or 'Hand' in n
is_l = lambda n: 'Leg' in n or n == 'mixamorig:Hips'
gn = {vg.index: vg.name for vg in char.vertex_groups}
own = {}
for v in char.data.vertices:
    a = sum(g.weight for g in v.groups if is_a(gn[g.group]))
    l = sum(g.weight for g in v.groups if is_l(gn[g.group]))
    own[v.index] = 'a' if a > l else ('l' if l > 0 else None)
import bmesh
bm = bmesh.new(); bm.from_mesh(char.data)
ol = bm.verts.layers.int.new('own')
for v in bm.verts: v[ol] = {'a': 1, 'l': 2}.get(own[v.index], 0)
cut = [f for f in bm.faces if {own[v.index] for v in f.verts} >= {'a', 'l'}]
bmesh.ops.delete(bm, geom=cut, context='FACES_ONLY')
# 删面后残留的小碎岛（原本夹在手臂和腰之间）没有可靠的权重，跑起来就飘在半空：一并删掉
islands, seen = [], set()
for v0 in bm.verts:
    if v0 in seen: continue
    stack, isl = [v0], []
    seen.add(v0)
    while stack:
        v = stack.pop(); isl.append(v)
        for e in v.link_edges:
            o = e.other_vert(v)
            if o not in seen: seen.add(o); stack.append(o)
    islands.append(isl)
junk = [v for isl in islands if len(isl) < 40 for v in isl]
bmesh.ops.delete(bm, geom=junk, context='VERTS')
bm.to_mesh(char.data); bm.free()
print("HAND_LEG_CUT", len(cut), "ISLANDS_DROPPED", sum(len(i) < 40 for i in islands), len(junk))
# 切开之后再抹平：先抹的话臀部权重会顺着袖口-腰侧的连片渗进袖子，切分时整片袖子被判给身体、抬手留在原地
# 沿网格连通性抹平：相邻顶点权重跳变是跑动时"拉丝"的直接来源
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=4)
bpy.ops.object.mode_set(mode='OBJECT')
# 裆部以下左右腿互相借权重，一迈步就在两腿之间拉出一张膜：按顶点在哪一侧，砍掉对侧腿的权重
crotch = arm.matrix_world @ arm.pose.bones['mixamorig:LeftUpLeg'].head
lx = crotch.x
for v in char.data.vertices:
    p = char.matrix_world @ v.co
    if p.z > crotch.z: continue
    other = 'Right' if (p.x > 0) == (lx > 0) else 'Left'
    for g in list(v.groups):
        n = char.vertex_groups[g.group].name
        if n.startswith('mixamorig:' + other) and ('Leg' in n or 'Foot' in n or 'Toe' in n):
            char.vertex_groups[g.group].remove([v.index])
    if not v.groups: cname['mixamorig:Hips'].add([v.index], 1, 'REPLACE')
# 抹平会把切口两侧的权重重新混起来：按切分时的归属再砍一次
own = [d.value for d in char.data.attributes['own'].data]
gn = {vg.index: vg.name for vg in char.vertex_groups}
for v in char.data.vertices:
    lose = is_l if own[v.index] == 1 else is_a if own[v.index] == 2 else None
    if lose:
        for g in list(v.groups):
            if lose(gn[g.group]): char.vertex_groups[g.group].remove([v.index])
    if not v.groups: cname['mixamorig:Hips'].add([v.index], 1, 'REPLACE')
char.data.attributes.remove(char.data.attributes['own'])
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

# ── 拟合姿态直接当静止姿态：角色网格一个顶点都不动 ──
# 旧做法是把网格"反蒙皮"回 T-pose，线性蒙皮的逆在袖子、裤裆处会把网格撕成尖刺。
# 现在反过来：留一份 T-pose 骨架 src 播 Xbot 原动作，本体骨架在世界空间逐骨复制 src 再烘焙。
# 网格形变 = S_t · F⁻¹（F = 拟合姿态），与"捐赠者表面从拟合姿态走到第 t 帧"严格一致。
src = arm.copy(); src.data = arm.data.copy(); bpy.context.scene.collection.objects.link(src)
for pb in src.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)

for o in donor_objs:
    if o.type == 'MESH': bpy.data.objects.remove(o, do_unlink=True)
for o in char_objs:
    if o is not char and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)

# ── 挂点骨（在 T-pose 静止下按手的朝向摆，随后跟着 armature_apply 一起进 A-pose）──
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
poses.add_sockets(arm)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ── 绑定：权重已在上面按名字写好，只挂修改器 ──
char.parent = arm
char.matrix_parent_inverse = arm.matrix_world.inverted()
char.modifiers.new("arm", 'ARMATURE').object = arm

# ── 重定向 Xbot 动作：世界空间逐骨复制 src，烘焙成本体骨架的动作 ──
keep = {'idle', 'run', 'walk'}
for a in list(bpy.data.actions):
    if a.name.split('_')[0] not in keep: bpy.data.actions.remove(a)
for pb in arm.pose.bones:
    if pb.name in src.pose.bones:
        c = pb.constraints.new('COPY_TRANSFORMS'); c.target = src; c.subtarget = pb.name
src.animation_data_create()
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for a in list(bpy.data.actions):
    name = a.name; a.name = name + '_src'
    src.animation_data.action = a
    f0, f1 = map(int, a.frame_range)
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=False, visual_keying=True,
                     clear_constraints=False, use_current_action=False, bake_types={'POSE'})
    arm.animation_data.action.name = name
    arm.animation_data.action.use_fake_user = True
    bpy.data.actions.remove(a)
bpy.ops.object.mode_set(mode='OBJECT')
for pb in arm.pose.bones:
    for c in list(pb.constraints): pb.constraints.remove(c)
bpy.data.objects.remove(src, do_unlink=True)
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)

# ── 程序化补齐动作：Xbot 没有 hit / death / 攻击 ──
# ponytail: 关键帧是手摆的方向向量，够 M0 验"按握持切换攻击"这条管线；
#           正式动作包到 M3 美术替换时整段删掉，换成动捕或买的包。
poses.build(arm)

bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_yup=True)
print("RIG_OK", len(char.data.vertices), [a.name for a in bpy.data.actions])
