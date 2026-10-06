# 程序化动作：每个关键帧 = {骨骼: 世界方向}，按父→子顺序把骨骼 Y 轴转到目标方向。
# 坐标：Blender 世界系，角色面朝 -Y，右手在 -X，上为 +Z。
import bpy, math
from mathutils import Vector, Matrix

FPS = 30
L, R = 'mixamorig:Left', 'mixamorig:Right'
ORDER = ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
         R + 'Arm', R + 'ForeArm', R + 'Hand', L + 'Arm', L + 'ForeArm', L + 'Hand',
         R + 'UpLeg', R + 'Leg', L + 'UpLeg', L + 'Leg']

ARMS_DOWN = {R + 'Arm': (-0.2, 0, -1), R + 'ForeArm': (-0.1, -0.3, -1), R + 'Hand': (0, -0.3, -1),
             L + 'Arm': (0.2, 0, -1), L + 'ForeArm': (0.1, -0.3, -1), L + 'Hand': (0, -0.3, -1)}

# 抵肩射击：右手握把在右胸前，左手向前托护木；第二帧是后坐力
AIM = {'mixamorig:Spine2': (0.05, 0.05, 1),
       R + 'Arm': (-0.35, -0.35, -0.85), R + 'ForeArm': (0.75, -0.6, 0.1), R + 'Hand': (0.2, -1, 0),
       L + 'Arm': (0.1, -0.75, -0.55), L + 'ForeArm': (-0.35, -1, 0.15), L + 'Hand': (-0.2, -1, 0)}
RECOIL = dict(AIM, **{'mixamorig:Spine2': (0.05, 0.25, 1), R + 'Hand': (0.2, -1, 0.3)})
# 左手不按方向摆，而是两骨 IK 托到护木上：握把前 HANDGUARD 米、枪管下方一点（socket 系：+Y 枪口，-Z 枪身上方）
HANDGUARD = (0.30, 0.03)
AIM['ik_left'] = RECOIL['ik_left'] = True

# 力度靠四件事：蓄力时身体拧回去（twist，度）、出手只用 2 帧（LINEAR）、打到底过冲并定格（顿帧）、
# 重心前压（lunge = 臀部前移 / 升降，米）。腿跟着前后分开，否则整个人是平移过去的
STEP = {R + 'UpLeg': (-0.05, -0.5, -1), R + 'Leg': (0, 0.05, -1), L + 'UpLeg': (0.05, 0.35, -1), L + 'Leg': (0, 0.5, -1)}
LEGS_SET = {R + 'UpLeg': (-0.05, 0.1, -1), R + 'Leg': (0, 0.2, -1), L + 'UpLeg': (0.05, -0.1, -1), L + 'Leg': (0, 0.1, -1)}

# 单手挥砍：拧身把剑收到右后上方 → 2 帧斜劈到左前下方 → 过冲定格 → 收回
WIND = dict(ARMS_DOWN, **LEGS_SET, **{'mixamorig:Spine2': (-0.15, 0.2, 1), 'twist': -35, 'lunge': (-0.03, -0.02),
            R + 'Arm': (-0.7, 0.4, 0.6), R + 'ForeArm': (-0.2, 0.4, 1), R + 'Hand': (0, 0.2, 1),
            L + 'Arm': (0.4, -0.8, 0.1), L + 'ForeArm': (0.1, -1, 0.1)})
SLASH = dict(ARMS_DOWN, **STEP, **{'mixamorig:Spine2': (0.25, -0.35, 1), 'twist': 30, 'lunge': (0.12, -0.06),
             R + 'Arm': (0.4, -0.85, -0.3), R + 'ForeArm': (0.7, -0.7, -0.4), R + 'Hand': (0.6, -0.8, -0.4),
             L + 'Arm': (0.5, 0.6, -0.6), L + 'ForeArm': (0.2, 0.8, -0.6)})
SLASH_END = dict(SLASH, **{'twist': 40, R + 'Arm': (0.7, -0.6, -0.5), R + 'ForeArm': (0.9, -0.3, -0.5), R + 'Hand': (0.8, 0.1, -0.6)})

# 双手重劈（大剑）：高举过头、剑身压到背后 → 2 帧劈到前下方，弯腰下沉；左手托在右手后面的长柄上
HEAVY_WIND = dict(ARMS_DOWN, **LEGS_SET, **{'mixamorig:Spine2': (0, 0.35, 1), 'lunge': (-0.04, 0),
                  R + 'Arm': (-0.2, 0.1, 1), R + 'ForeArm': (0, 0.4, 1), R + 'Hand': (0.1, 0.8, 0.6), 'ik_left': (-0.08, 0)})
HEAVY = dict(ARMS_DOWN, **STEP, **{'mixamorig:Spine2': (0, -0.55, 1), 'lunge': (0.14, -0.1),
             R + 'Arm': (-0.1, -1, -0.1), R + 'ForeArm': (0.1, -1, -0.4), R + 'Hand': (0.1, -0.7, -0.8), 'ik_left': (-0.08, 0)})
HEAVY_END = dict(HEAVY, **{'mixamorig:Spine2': (0, -0.65, 1), R + 'Hand': (0.1, -0.4, -1)})

# 长枪捅刺：侧身（左肩在前）把枪收到右腰 → 2 帧直线送出，重心整个压上去；左手在前方托枪杆
THRUST_WIND = dict(ARMS_DOWN, **LEGS_SET, **{'mixamorig:Spine2': (0, 0.2, 1), 'twist': -40, 'lunge': (-0.05, -0.03),
                   R + 'Arm': (-0.3, 0.7, -0.6), R + 'ForeArm': (0.1, -0.6, 0.1), R + 'Hand': (0.2, -1, 0.05), 'ik_left': (0.22, 0)})
# 中间帧：上臂从身后甩到身前时，逐骨四元数插值会让枪头往下画弧；钉一帧让枪杆全程保持水平
THRUST_MID = dict(ARMS_DOWN, **STEP, **{'mixamorig:Spine2': (0, -0.1, 1), 'twist': -28, 'lunge': (0.07, -0.05),
                  R + 'Arm': (-0.12, -0.25, -0.9), R + 'ForeArm': (0.12, -1, 0.05), R + 'Hand': (0.17, -1, 0.02), 'ik_left': (0.22, 0)})
THRUST = dict(ARMS_DOWN, **STEP, **{'mixamorig:Spine2': (0, -0.4, 1), 'twist': -15, 'lunge': (0.18, -0.07),
              R + 'Arm': (0.05, -1, -0.15), R + 'ForeArm': (0.1, -1, 0), R + 'Hand': (0.15, -1, 0), 'ik_left': (0.22, 0)})

# 持刀跑：上臂下垂、前臂前伸、手腕上挑，刀尖朝前上方（运行时只取右臂叠到 run 上）
HOLD1H = dict(ARMS_DOWN, **{R + 'Arm': (-0.3, -0.1, -1), R + 'ForeArm': (-0.15, -1, 0.2), R + 'Hand': (0, -0.6, 0.8)})

# 单手射击（手枪 / 冲锋枪）：右臂平举向前，左臂下垂
AIM1H = dict(ARMS_DOWN, **{'mixamorig:Spine2': (0.1, 0, 1),
             R + 'Arm': (-0.15, -1, 0.1), R + 'ForeArm': (-0.05, -1, 0.05), R + 'Hand': (0, -1, 0)})
RECOIL1H = dict(AIM1H, **{R + 'ForeArm': (-0.05, -1, 0.2), R + 'Hand': (0, -1, 0.4)})

# 投掷（手雷 / 回旋镖）：举到右后上方 → 向前甩出
THROW_WIND = dict(ARMS_DOWN, **{'mixamorig:Spine2': (-0.2, 0.2, 1), L + 'Arm': (0.5, -0.6, 0.2),
                  R + 'Arm': (-0.6, 0.4, 0.7), R + 'ForeArm': (-0.1, 0.6, 0.8), R + 'Hand': (0, 0.4, 1)})
THROW = dict(ARMS_DOWN, **{'mixamorig:Spine2': (0.2, -0.3, 1),
             R + 'Arm': (-0.1, -1, 0.3), R + 'ForeArm': (0, -1, 0), R + 'Hand': (0, -1, -0.3)})

HIT = dict(ARMS_DOWN, **{'mixamorig:Spine': (0, 0.35, 1), 'mixamorig:Spine2': (0, 0.5, 1),
           R + 'Arm': (-0.5, 0.3, -0.8), L + 'Arm': (0.5, 0.3, -0.8)})

# 死亡 = 被打飞：中弹瞬间胸口后仰、手甩在前（惯性）→ 离地往后飞、腿踢起 → 加速砸地（LINEAR）→ 弹一下 → 瘫平。
# lunge 为负 = 往后挪；落点在原地身后约 0.8 m，是"被击倒"而不是"原地躺下"
D_IMPACT = {'mixamorig:Spine': (0, 0.35, 1), 'mixamorig:Spine2': (0, 0.8, 1), 'lunge': (-0.12, -0.04),
            R + 'Arm': (-0.4, -0.7, 0.2), R + 'ForeArm': (-0.2, -0.8, 0.5), L + 'Arm': (0.4, -0.7, 0.2), L + 'ForeArm': (0.2, -0.8, 0.5),
            R + 'UpLeg': (-0.05, -0.25, -1), R + 'Leg': (0, 0.25, -1), L + 'UpLeg': (0.05, -0.1, -1), L + 'Leg': (0, 0.3, -1)}
D_AIR = {'mixamorig:Hips': (0, 0.75, 0.65), 'mixamorig:Spine2': (0, 1, 0.5), 'lunge': (-0.45, 0),
         R + 'Arm': (-0.7, 0.1, 0.7), R + 'ForeArm': (-0.5, -0.3, 0.8), L + 'Arm': (0.7, 0.1, 0.7), L + 'ForeArm': (0.5, -0.3, 0.8),
         R + 'UpLeg': (-0.1, -0.8, -0.5), R + 'Leg': (0, -0.5, -0.9), L + 'UpLeg': (0.1, -0.6, -0.7), L + 'Leg': (0, -0.1, -1)}
D_GROUND = {'mixamorig:Hips': (0, 1, 0.05), 'mixamorig:Spine2': (0, 1, 0.1), 'lunge': (-0.8, 0),
            R + 'Arm': (-1, 0.4, 0.3), R + 'ForeArm': (-1, 0.1, 0.3), L + 'Arm': (1, 0.4, 0.3), L + 'ForeArm': (1, 0.1, 0.3),
            R + 'UpLeg': (-0.15, -1, 0.3), R + 'Leg': (-0.1, -1, 0.1), L + 'UpLeg': (0.15, -1, 0.2), L + 'Leg': (0.1, -1, 0)}
D_BOUNCE = dict(D_GROUND, **{'mixamorig:Spine2': (0, 1, 0.3), R + 'Arm': (-1, 0.3, 0.5), L + 'Arm': (1, 0.3, 0.5),
                             R + 'UpLeg': (-0.15, -1, 0.4), L + 'UpLeg': (0.15, -1, 0.3)})
# 瘫平：一侧膝盖弯起、头歪一点，避免"标本"式的左右对称
DEAD = dict(D_GROUND, **{'mixamorig:Spine2': (0.1, 1, 0.05), 'twist': 15,
                         R + 'Arm': (-1, 0.2, -0.05), R + 'ForeArm': (-0.8, -0.5, -0.05), L + 'Arm': (1, 0.5, -0.05), L + 'ForeArm': (0.9, 0.4, -0.05),
                         R + 'UpLeg': (-0.2, -1, -0.03), R + 'Leg': (-0.2, -1, -0.03), L + 'UpLeg': (0.2, -0.8, 0.45), L + 'Leg': (0.1, -0.7, -0.6)})

CLIPS = {
    # 名字 = 运行时的 clip 名；(秒, 姿态, 臀部离地高度占静止高度的比例或 None)
    'attack_rifle':   [(0, AIM, None), (0.08, RECOIL, None), (0.35, AIM, None), (0.6, AIM, None)],
    # 第 4 项 = 从这一键到下一键的插值；出手那一段用 LINEAR，贝塞尔的缓入缓出会把劲吃掉
    'attack_melee1h': [(0, ARMS_DOWN, None), (0.2, WIND, None), (0.3, WIND, None, 'LINEAR'), (0.37, SLASH, None, 'LINEAR'),
                       (0.42, SLASH_END, None), (0.55, SLASH_END, None), (0.8, ARMS_DOWN, None)],
    'attack_heavy':   [(0, ARMS_DOWN, None), (0.3, HEAVY_WIND, None), (0.42, HEAVY_WIND, None, 'LINEAR'), (0.5, HEAVY, None, 'LINEAR'),
                       (0.55, HEAVY_END, None), (0.75, HEAVY_END, None), (1.05, ARMS_DOWN, None)],
    'attack_thrust':  [(0, ARMS_DOWN, None), (0.2, THRUST_WIND, None), (0.28, THRUST_WIND, None, 'LINEAR'), (0.31, THRUST_MID, None, 'LINEAR'), (0.34, THRUST, None),
                       (0.48, THRUST, None), (0.75, THRUST_WIND, None), (0.9, ARMS_DOWN, None)],
    'hold_melee1h':   [(0, HOLD1H, None), (1, HOLD1H, None)],
    'attack_pistol':  [(0, AIM1H, None), (0.06, RECOIL1H, None), (0.25, AIM1H, None), (0.45, AIM1H, None)],
    'attack_throw':   [(0, ARMS_DOWN, None), (0.25, THROW_WIND, None), (0.4, THROW, None), (0.8, ARMS_DOWN, None)],
    'hit':            [(0, ARMS_DOWN, None), (0.1, HIT, None), (0.45, ARMS_DOWN, None)],
    'death':          [(0, ARMS_DOWN, None), (0.07, D_IMPACT, 0.9), (0.28, D_AIR, 0.7, 'LINEAR'), (0.42, D_GROUND, 0.13),
                       (0.52, D_BOUNCE, 0.2), (0.7, DEAD, 0.13), (1.3, DEAD, 0.13)],
}


# glTF 导入的骨骼 Y 轴不一定指向子关节（导入器按启发式定骨长），所以"骨骼方向"
# 一律用 子关节头 − 本关节头 来量，不用 pb.matrix 的 Y 列。
CHILD = {'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck',
         'Arm': 'ForeArm', 'ForeArm': 'Hand', 'Hand': 'HandMiddle1', 'UpLeg': 'Leg', 'Leg': 'Foot'}


def child_of(name):
    for side in ('Left', 'Right', ''):
        pre = 'mixamorig:' + side
        if name.startswith(pre) and name[len(pre):] in CHILD:
            return pre + CHILD[name[len(pre):]] if side else 'mixamorig:' + CHILD[name[len(pre):]]


def aim(arm, name, d, hips_h=None):
    """把骨骼 name 转到世界方向 d（只转这一根，子骨骼跟着走）。"""
    to_arm = arm.matrix_world.to_3x3().normalized().inverted()
    pb = arm.pose.bones[name]; m = pb.matrix.copy()
    cur = arm.pose.bones[child_of(name)].head - pb.head
    q = cur.normalized().rotation_difference((to_arm @ Vector(d)).normalized())
    new = q.to_matrix().to_4x4() @ m.to_3x3().to_4x4()
    new.translation = m.translation
    if hips_h is not None:
        w = arm.matrix_world @ m.translation
        new.translation = arm.matrix_world.inverted() @ Vector((w.x, w.y, hips_h))
    pb.matrix = new
    bpy.context.view_layer.update()


def frame(arm, name, d, face):
    """把骨骼 name 的绑定姿态整体转到：骨向 = d、绑定时朝前（-Y）的那一面 = face（都是世界方向）。"""
    mw3 = arm.matrix_world.to_3x3().normalized()
    pb, bone = arm.pose.bones[name], arm.data.bones[name]
    basis = lambda a, b: (lambda a, b: Matrix((a, b, a.cross(b))).transposed())(a, (b - a * b.dot(a)).normalized())
    b0 = (mw3 @ (arm.data.bones[child_of(name)].head_local - bone.head_local)).normalized()
    rw = basis(Vector(d).normalized(), Vector(face)) @ basis(b0, Vector((0, -1, 0))).inverted()
    new = (mw3.inverted() @ rw @ mw3 @ bone.matrix_local.to_3x3()).to_4x4()
    new.translation = pb.matrix.translation
    pb.matrix = new
    bpy.context.view_layer.update()


def _pose(arm, pose, hips_h):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    if 'lunge' in pose:   # 重心：臀部往前 / 往下挪（世界系，米）
        pb = arm.pose.bones['mixamorig:Hips']; m = pb.matrix.copy()
        w = mw @ m.translation; w.y -= pose['lunge'][0]; w.z += pose['lunge'][1]
        m.translation = mw.inverted() @ w; pb.matrix = m
        bpy.context.view_layer.update()
    for name in ORDER:
        if name in pose.get('frame', {}): frame(arm, name, *pose['frame'][name])
        elif name in pose:
            aim(arm, name, pose[name], hips_h if name == 'mixamorig:Hips' else None)
        if name == 'mixamorig:Spine2' and pose.get('twist'):   # 胸口绕竖轴拧（aim 只管朝向，管不了拧）
            pb = arm.pose.bones[name]; m = pb.matrix.copy(); h = m.translation.copy()
            axis = (mw.to_3x3().inverted() @ Vector((0, 0, 1))).normalized()
            pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(pose['twist']), 4, axis) @ Matrix.Translation(-h) @ m
            bpy.context.view_layer.update()
    if pose.get('ik_left'): ik_left(arm, HANDGUARD if pose['ik_left'] is True else pose['ik_left'])
    for n, k in pose.get('scale', {}).items(): arm.pose.bones[n].scale = (k, k, k)   # 胀大 / 缩没（僵尸）


def ik_left(arm, hg):
    """左臂两骨 IK：手腕落到右手挂点前方 hg[0] 米（负 = 后方长柄）、上方 hg[1] 米处，肘朝下外侧。"""
    mw = arm.matrix_world
    head = lambda n: mw @ arm.pose.bones[n].head
    sk = mw @ arm.pose.bones['socket_hand_r'].matrix
    fwd, up = sk.col[1].xyz.normalized(), -sk.col[2].xyz.normalized()
    t = sk.translation + fwd * hg[0] + up * hg[1]
    s = head(L + 'Arm')
    a = (head(L + 'ForeArm') - s).length
    b = (head(L + 'Hand') - head(L + 'ForeArm')).length
    d = t - s; n = min(d.length, (a + b) * 0.999); d.normalize()
    pole = Vector((0.6, 0, -1))
    pole = (pole - d * pole.dot(d)).normalized()
    x = (a * a - b * b + n * n) / (2 * n)
    e = s + d * x + pole * max(a * a - x * x, 0) ** 0.5
    aim(arm, L + 'Arm', e - s)
    aim(arm, L + 'ForeArm', (s + d * n) - e)
    aim(arm, L + 'Hand', fwd)


def build(arm, clips=None):
    arm.animation_data_create()
    hips0 = (arm.matrix_world @ arm.data.bones['mixamorig:Hips'].head_local).z
    for name, keys in (clips or CLIPS).items():
        scaled = {n for k in keys for n in k[1].get('scale', {})}
        act = bpy.data.actions.new(name); act.use_fake_user = True
        arm.animation_data.action = act
        prev = {}
        for t, pose, hips_h, *_ in keys:
            _pose(arm, pose, hips_h and hips_h * hips0)
            f = 1 + round(t * FPS)
            for pb in arm.pose.bones:
                # 四元数 q 与 -q 同义，但逐分量插值会穿过零点把人翻过来：保持和上一帧同号
                q = pb.rotation_quaternion
                if pb.name in prev and prev[pb.name].dot(q) < 0: pb.rotation_quaternion = -q
                prev[pb.name] = pb.rotation_quaternion.copy()
                pb.keyframe_insert('rotation_quaternion', frame=f)
                if pb.name == 'mixamorig:Hips': pb.keyframe_insert('location', frame=f)
                if pb.name in scaled: pb.keyframe_insert('scale', frame=f)
        interp = {1 + round(k[0] * FPS): k[3] for k in keys if len(k) > 3}
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                if round(kp.co.x) in interp: kp.interpolation = interp[round(kp.co.x)]
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)


def add_sockets(arm):
    """编辑模式下在左右手加挂点骨（静止姿态须是 T-pose，掌面朝下）。
    挂点骨的朝向就是武器的朝向约定（05 §2.3）：骨骼 +Y = 枪口（= 手指方向），骨骼 +Z = 掌面朝下。
    运行时对所有武器只有一个常量旋转 Rx(-90°)，不存在逐把偏移。"""
    eb = arm.data.edit_bones
    down = (arm.matrix_world.to_3x3().inverted() @ Vector((0, 0, -1))).normalized()
    # glTF 没有骨骼尾端，导入器补的 tail 一律朝上、长度随意，所以手的方向与长度取"中指根 - 手腕"
    for side, hand in (('r', 'mixamorig:RightHand'), ('l', 'mixamorig:LeftHand')):
        h = eb[hand]
        fwd = eb[hand.replace('Hand', 'HandMiddle1')].head - h.head
        L = fwd.length; fwd.normalize()
        s = eb.new('socket_hand_' + side)
        s.head = h.head + fwd * L * 0.9 + down * L * 0.3   # 掌心：靠近指根、往掌面压，握把落在手指弯里
        s.tail = s.head + fwd * L * 0.5
        s.align_roll(down)
        s.parent = h
        s.use_deform = False


# ════════ 僵尸动作（05 §3：行为可读性 > 外观多样性）════════
def mirror(p):
    """左右镜像一个姿态：L/R 互换、世界 x 取反、拧身反向。"""
    out = {}
    for k, v in p.items():
        if k.startswith(L): out[R + k[len(L):]] = (-v[0], *v[1:])
        elif k.startswith(R): out[L + k[len(R):]] = (-v[0], *v[1:])
        elif k.startswith('mixamorig:'): out[k] = (-v[0], *v[1:])
        elif k == 'twist': out[k] = -v
        else: out[k] = v
    return out

# 经典僵尸手：双臂平伸向前、手腕下垂
ARMS_FWD = {R + 'Arm': (-0.15, -1, 0.05), R + 'ForeArm': (-0.05, -1, 0), R + 'Hand': (0, -1, -0.35),
            L + 'Arm': (0.2, -1, -0.05), L + 'ForeArm': (0.1, -1, -0.1), L + 'Hand': (0, -1, -0.45)}
Z_IDLE = dict(ARMS_FWD, **{'mixamorig:Spine2': (0.05, -0.3, 1), R + 'UpLeg': (-0.1, 0, -1), L + 'UpLeg': (0.1, 0.05, -1)})
Z_IDLE2 = dict(Z_IDLE, **{'mixamorig:Spine2': (-0.08, -0.25, 1), 'twist': 6, R + 'Arm': (-0.15, -1, -0.1)})

# 蹒跚：右腿大步、左腿拖着走（步幅不对称 = "瘸"），重心随落脚左右晃
SH_A = dict(ARMS_FWD, **{'mixamorig:Spine2': (0.12, -0.35, 1), 'twist': 8,
            R + 'UpLeg': (-0.05, -0.45, -1), R + 'Leg': (0, -0.1, -1), L + 'UpLeg': (0.05, 0.25, -1), L + 'Leg': (0, 0.5, -1)})
SH_B = dict(ARMS_FWD, **{'mixamorig:Spine2': (0.05, -0.3, 1),
            R + 'UpLeg': (-0.05, 0.05, -1), R + 'Leg': (0, 0.1, -1), L + 'UpLeg': (0.05, -0.1, -1), L + 'Leg': (0, 0.3, -1)})
SH_C = dict(ARMS_FWD, **{'mixamorig:Spine2': (-0.12, -0.3, 1), 'twist': -5,
            R + 'UpLeg': (-0.05, 0.3, -1), R + 'Leg': (0, 0.55, -1), L + 'UpLeg': (0.05, -0.25, -1), L + 'Leg': (0, -0.05, -1)})
SH_D = dict(ARMS_FWD, **{'mixamorig:Spine2': (-0.05, -0.3, 1),
            R + 'UpLeg': (-0.05, -0.15, -1), R + 'Leg': (0, 0.35, -1), L + 'UpLeg': (0.05, 0.05, -1), L + 'Leg': (0, 0.1, -1)})

# 冲刺（高速）：上身前倾近 45°、双臂甩在身后，大步幅
SP_ARMS = {R + 'Arm': (-0.3, 0.75, -0.6), R + 'ForeArm': (-0.2, 0.95, 0), R + 'Hand': (-0.1, 1, 0.1),
           L + 'Arm': (0.3, 0.75, -0.6), L + 'ForeArm': (0.2, 0.95, 0), L + 'Hand': (0.1, 1, 0.1)}
SP_A = dict(SP_ARMS, **{'mixamorig:Spine2': (0, -0.8, 0.7),
            R + 'UpLeg': (0, -0.85, -0.5), R + 'Leg': (0, -0.1, -1), L + 'UpLeg': (0, 0.45, -0.9), L + 'Leg': (0, 1, -0.2)})
SP_B = dict(SP_ARMS, **{'mixamorig:Spine2': (0, -0.75, 0.7),
            R + 'UpLeg': (0, -0.1, -1), R + 'Leg': (0, 0.3, -1), L + 'UpLeg': (0, -0.45, -0.9), L + 'Leg': (0, 0.6, -0.8)})

# 潜行（跳跃）：长腿大蹲、膝盖朝外，手快贴地——像蜘蛛
ST_A = {'mixamorig:Spine2': (0, -0.85, 0.55), R + 'Arm': (-0.3, -0.6, -0.8), R + 'ForeArm': (-0.1, -0.4, -1), R + 'Hand': (0, -1, -0.3),
        L + 'Arm': (0.3, -0.6, -0.8), L + 'ForeArm': (0.1, -0.4, -1), L + 'Hand': (0, -1, -0.3),
        R + 'UpLeg': (-0.4, -0.85, -0.3), R + 'Leg': (-0.1, 0.35, -1), L + 'UpLeg': (0.45, -0.6, -0.5), L + 'Leg': (0.1, 0.45, -1)}
ST_B = dict(ST_A, **{R + 'UpLeg': (-0.45, -0.6, -0.5), R + 'Leg': (-0.1, 0.45, -1), L + 'UpLeg': (0.4, -0.85, -0.3), L + 'Leg': (0.1, 0.35, -1)})
LEAP_LOAD = dict(ST_A, **{'mixamorig:Spine2': (0, -0.7, 0.4), R + 'UpLeg': (-0.4, -0.9, -0.1), L + 'UpLeg': (0.4, -0.9, -0.1),
                          R + 'Leg': (-0.1, 0.5, -1), L + 'Leg': (0.1, 0.5, -1)})
LEAP_OUT = {'mixamorig:Spine2': (0, -1, 0.25), 'lunge': (0.45, 0),
            R + 'Arm': (-0.2, -1, 0.3), R + 'ForeArm': (-0.1, -1, 0.2), R + 'Hand': (0, -1, 0),
            L + 'Arm': (0.2, -1, 0.3), L + 'ForeArm': (0.1, -1, 0.2), L + 'Hand': (0, -1, 0),
            R + 'UpLeg': (-0.1, 0.7, -0.6), R + 'Leg': (0, 1, -0.3), L + 'UpLeg': (0.1, 0.6, -0.7), L + 'Leg': (0, 1, -0.4)}
LEAP_AIR = dict(LEAP_OUT, **{'lunge': (0.8, 0), R + 'Arm': (-0.3, -1, -0.2), L + 'Arm': (0.3, -1, -0.2),
                             R + 'ForeArm': (-0.1, -0.7, -0.7), L + 'ForeArm': (0.1, -0.7, -0.7),
                             R + 'UpLeg': (-0.2, -0.7, -0.6), R + 'Leg': (0, 0.4, -0.9), L + 'UpLeg': (0.2, -0.7, -0.6), L + 'Leg': (0, 0.4, -0.9)})
LEAP_LAND = dict(LEAP_LOAD, lunge=(1.2, 0))
LEAP_UP = {'mixamorig:Hips': (0, 0, 1), 'mixamorig:Spine2': (0, -0.35, 1), 'lunge': (0.25, 0),
           R + 'Arm': (-0.3, -0.3, 1), R + 'ForeArm': (-0.2, -0.2, 1), R + 'Hand': (0, -0.2, 1),
           L + 'Arm': (0.3, -0.3, 1), L + 'ForeArm': (0.2, -0.2, 1), L + 'Hand': (0, -0.2, 1),
           R + 'UpLeg': (-0.1, 0.3, -1), R + 'Leg': (0, 0.4, -1), L + 'UpLeg': (0.1, 0.3, -1), L + 'Leg': (0, 0.4, -1)}
LEAP_TUCK = {'mixamorig:Hips': (0, 0, 1), 'mixamorig:Spine2': (0, -0.5, 1), 'lunge': (0.6, 0),
             R + 'Arm': (-0.5, -0.5, 0.7), R + 'ForeArm': (-0.2, -0.8, 0.5), R + 'Hand': (0, -1, 0),
             L + 'Arm': (0.5, -0.5, 0.7), L + 'ForeArm': (0.2, -0.8, 0.5), L + 'Hand': (0, -1, 0),
             R + 'UpLeg': (-0.3, -1, 0.1), R + 'Leg': (0, 0.2, -1), L + 'UpLeg': (0.3, -1, 0.1), L + 'Leg': (0, 0.2, -1)}
LEAP_DIVE = {'mixamorig:Hips': (0, 0, 1), 'mixamorig:Spine2': (0, -0.9, 0.5), 'lunge': (1.0, 0),
             R + 'Arm': (-0.2, -1, -0.3), R + 'ForeArm': (-0.1, -0.8, -0.6), R + 'Hand': (0, -0.4, -1),
             L + 'Arm': (0.2, -1, -0.3), L + 'ForeArm': (0.1, -0.8, -0.6), L + 'Hand': (0, -0.4, -1),
             R + 'UpLeg': (-0.2, -0.5, -0.9), R + 'Leg': (0, 0.2, -1), L + 'UpLeg': (0.2, -0.5, -0.9), L + 'Leg': (0, 0.2, -1)}

# 扑抓：双手举过头 → 2 帧往前下方抓，上身扑出去
CLAW_WIND = dict(LEGS_SET, **{'mixamorig:Spine2': (0, 0.2, 1), 'lunge': (-0.04, 0),
                 R + 'Arm': (-0.4, -0.2, 1), R + 'ForeArm': (-0.1, -0.5, 0.9), R + 'Hand': (0, -0.6, 0.8),
                 L + 'Arm': (0.4, -0.2, 1), L + 'ForeArm': (0.1, -0.5, 0.9), L + 'Hand': (0, -0.6, 0.8)})
CLAW = dict(STEP, **{'mixamorig:Spine2': (0, -0.7, 1), 'lunge': (0.15, -0.08),
            R + 'Arm': (-0.2, -1, -0.35), R + 'ForeArm': (-0.05, -0.7, -0.7), R + 'Hand': (0, -0.3, -1),
            L + 'Arm': (0.2, -1, -0.35), L + 'ForeArm': (0.05, -0.7, -0.7), L + 'Hand': (0, -0.3, -1)})

# 自爆（爆炸）：双臂张开、上身一抽一抽地胀大（Spine2 缩放），最后一帧最大——运行时接爆炸
SW = dict(LEGS_SET, **{'mixamorig:Spine2': (0, 0.15, 1), R + 'Arm': (-1, -0.2, 0.35), R + 'ForeArm': (-1, -0.3, 0.5),
          L + 'Arm': (1, -0.2, 0.35), L + 'ForeArm': (1, -0.3, 0.5)})
SW1 = dict(SW, twist=6, scale={'mixamorig:Spine2': 1.15})
SW2 = dict(SW, twist=-6, scale={'mixamorig:Spine2': 1.3})
SW3 = dict(SW, twist=5, scale={'mixamorig:Spine2': 1.25})
SW4 = dict(SW, **{'mixamorig:Spine2': (0, 0.3, 1)}, scale={'mixamorig:Spine2': 1.6})

# 分裂（分裂僵尸死亡）：抽搐胀大 → 一帧缩没（运行时在原地放 3 只分裂小）
SPL1 = dict(Z_IDLE, **{'mixamorig:Spine2': (0.1, -0.6, 1)}, twist=10, scale={'mixamorig:Spine2': 1.25})
SPL2 = dict(Z_IDLE, **{'mixamorig:Spine2': (-0.1, -0.5, 1)}, twist=-10, scale={'mixamorig:Spine2': 1.5})
SPL3 = dict(SPL2, scale={'mixamorig:Spine2': 1.5, 'mixamorig:Hips': 0.03})

# 喷吐：后仰蓄力（背囊胀）→ 2 帧往前探脖子吐出去
SPIT_WIND = dict(ARMS_DOWN, **LEGS_SET, **{'mixamorig:Spine2': (0, 0.45, 1), 'lunge': (-0.05, 0)}, scale={'mixamorig:Spine2': 1.15})
SPIT = dict(ARMS_DOWN, **STEP, **{'mixamorig:Spine2': (0, -0.9, 0.6), 'lunge': (0.1, -0.06),
            R + 'Arm': (-0.4, 0.4, -0.8), L + 'Arm': (0.4, 0.4, -0.8)}, scale={'mixamorig:Spine2': 0.95})

# 举盾（护盾）：左前臂横在胸前、盾面朝前；右手在后面等着抓。0.08 s 是挨了一下
BLOCK = dict(STEP, **{'mixamorig:Spine2': (0, -0.2, 1),
             L + 'Arm': (0.3, -0.6, -0.75), L + 'Hand': (-1, -0.2, 0), 'frame': {L + 'ForeArm': ((-1, -0.15, 0.05), (0, -1, 0))},
             R + 'Arm': (-0.35, -0.3, -0.9), R + 'ForeArm': (-0.2, -0.9, -0.3), R + 'Hand': (0, -1, -0.3)})
BLOCK_HIT = dict(BLOCK, **{'mixamorig:Spine2': (0, 0.15, 1), 'lunge': (-0.06, 0)})
# 持盾行军：两腿对称大步、落脚时身子一沉，胸口随步子左右晃、微拧，右臂前后摆；盾（左前臂）始终竖在身前
GW_A = {R + 'UpLeg': (-0.05, -0.5, -1), R + 'Leg': (0, -0.05, -1), L + 'UpLeg': (0.05, 0.4, -1), L + 'Leg': (0, 0.65, -1)}
GW_B = {R + 'UpLeg': (-0.05, 0.1, -1), R + 'Leg': (0, 0.15, -1), L + 'UpLeg': (0.05, -0.25, -1), L + 'Leg': (0, 0.9, -1)}
GUARD = lambda legs, sx, tw, rarm: dict(BLOCK, **legs, **{'mixamorig:Spine2': (sx, -0.28, 1), 'twist': tw,
                                   R + 'Arm': rarm, R + 'ForeArm': (rarm[0] * 0.5, rarm[1] - 0.4, -0.8)})
GW1 = GUARD(GW_A, 0.08, 6, (-0.3, 0.35, -0.9))
GW2 = GUARD(GW_B, 0.03, 2, (-0.3, 0, -1))
GW3 = GUARD(mirror(GW_A), -0.08, -6, (-0.3, -0.55, -0.8))
GW4 = GUARD(mirror(GW_B), -0.03, -2, (-0.3, 0, -1))

# 盾砸（护盾的普通攻击）：双手把盾举过头、盾面朝下 → 2 帧往前下方砸，弯腰下沉，砸到底定格
SLAM_WIND = dict(LEGS_SET, **{'mixamorig:Spine2': (0, 0.3, 1), 'lunge': (-0.04, 0.02),
                 L + 'Arm': (0.35, -0.4, 0.85), L + 'Hand': (-1, -0.1, 0), 'frame': {L + 'ForeArm': ((-1, -0.2, 0.2), (0, -0.6, 0.8))},
                 R + 'Arm': (-0.35, -0.4, 0.85), R + 'ForeArm': (0.3, -0.5, 0.8), R + 'Hand': (0.3, -0.3, 1)})
SLAM = dict(STEP, **{'mixamorig:Spine2': (0, -0.75, 0.8), 'lunge': (0.14, -0.1),
            L + 'Arm': (0.3, -0.9, -0.4), L + 'Hand': (-1, -0.2, -0.2), 'frame': {L + 'ForeArm': ((-1, -0.3, -0.3), (0, -0.6, -0.8))},
            R + 'Arm': (-0.3, -0.9, -0.4), R + 'ForeArm': (0.3, -0.8, -0.5), R + 'Hand': (0.2, -0.6, -0.8)})

# 死亡二 = 跪倒扑脸：膝盖一软跪下 → 往前扑（LINEAR）→ 脸朝下趴平，一只手压在身下
F_HIT = dict(ARMS_DOWN, **{'mixamorig:Spine2': (0, -0.4, 1), R + 'Arm': (-0.3, 0.3, -0.9), L + 'Arm': (0.3, 0.3, -0.9)})
F_KNEE = dict(ARMS_DOWN, **{'mixamorig:Hips': (0, -0.2, 1), 'mixamorig:Spine2': (0, -0.7, 0.8), 'lunge': (0.08, 0),
              R + 'UpLeg': (-0.1, -0.75, -0.65), R + 'Leg': (0, 1, -0.25), L + 'UpLeg': (0.1, -0.65, -0.75), L + 'Leg': (0, 1, -0.3),
              R + 'Arm': (-0.2, -0.3, -1), L + 'Arm': (0.2, -0.3, -1)})
F_FLAT = {'mixamorig:Hips': (0, -1, 0.05), 'mixamorig:Spine2': (0, -1, -0.05), 'lunge': (0.4, 0),
          R + 'Arm': (-0.4, -1, 0), R + 'ForeArm': (-0.1, -1, 0), L + 'Arm': (1, -0.2, 0), L + 'ForeArm': (0.5, 0.9, 0),
          R + 'UpLeg': (-0.15, 1, 0), R + 'Leg': (-0.1, 1, 0.05), L + 'UpLeg': (0.2, 1, 0), L + 'Leg': (0.1, 0.8, 0.6)}
F_BOUNCE = dict(F_FLAT, **{'mixamorig:Spine2': (0, -1, 0.25), R + 'Leg': (-0.1, 0.8, 0.5)})
F_DEAD = dict(F_FLAT, **{'mixamorig:Spine2': (0.15, -1, -0.05), 'twist': -12, L + 'Leg': (0.1, 0.9, 0.35)})
# 死亡三 = 打转侧倒：被打得拧过半身 → 腿一软往右侧瘫 → 蜷着侧躺（头朝角色右手方向，胸口仍朝前）
S_HIT = dict(ARMS_DOWN, **{'mixamorig:Spine2': (-0.3, 0.3, 1), 'twist': 35, R + 'Arm': (-0.9, 0.4, 0.2), L + 'Arm': (0.6, -0.6, -0.4)})
S_SAG = dict(ARMS_DOWN, **{'mixamorig:Hips': (-0.5, 0, 1), 'mixamorig:Spine2': (-0.8, -0.1, 0.7), 'twist': 20,
             R + 'UpLeg': (-0.3, -0.6, -0.8), R + 'Leg': (0, 0.6, -1), L + 'UpLeg': (0.2, -0.3, -1), L + 'Leg': (0, 0.4, -1),
             R + 'Arm': (-1, 0.2, -0.5), L + 'Arm': (0.8, -0.5, 0.4)})
S_FLAT = {'mixamorig:Hips': (-1, 0, 0.05), 'mixamorig:Spine2': (-1, -0.1, 0.05),
          R + 'Arm': (-0.4, -1, -0.1), R + 'ForeArm': (-0.9, -0.4, 0), L + 'Arm': (-0.2, -0.7, -0.6), L + 'ForeArm': (-0.3, -1, 0),
          R + 'UpLeg': (0.7, -0.7, 0), R + 'Leg': (0.5, 0.85, 0), L + 'UpLeg': (0.9, -0.4, 0.1), L + 'Leg': (0.6, 0.8, 0.1)}
S_BOUNCE = dict(S_FLAT, **{'mixamorig:Spine2': (-1, -0.1, 0.3), L + 'Arm': (0, -0.8, 0.3)})
S_DEAD = dict(S_FLAT, **{'mixamorig:Spine2': (-1, -0.2, 0), L + 'UpLeg': (0.95, -0.3, 0.2)})

# ════════ BOSS（体型 2-3 倍：动作放慢、幅度加大）════════
B_ARMS = lambda sw: {R + 'Arm': (-0.25, sw, -1), R + 'ForeArm': (-0.15, 0.6 * sw - 0.35, -1), R + 'Hand': (0, -0.3, -1),
                     L + 'Arm': (0.25, -sw, -1), L + 'ForeArm': (0.15, -0.6 * sw - 0.35, -1), L + 'Hand': (0, -0.3, -1)}
B_IDLE = dict(Z_IDLE, **B_ARMS(0))
# 重踏：两腿对称大步、落脚身子一沉，双臂反向前后甩，胸口随步子晃
BW1 = dict(B_ARMS(0.4), **GW_A, **{'mixamorig:Spine2': (0.1, -0.35, 1), 'twist': 8})
BW2 = dict(B_ARMS(0), **GW_B, **{'mixamorig:Spine2': (0.04, -0.3, 1)})
# 双拳锤地：两拳在头顶合拢、后仰 → 2 帧砸到脚前，弯腰下沉，砸到底定格
SMASH_WIND = dict(LEGS_SET, **{'mixamorig:Spine2': (0, 0.35, 1), 'lunge': (-0.06, 0.02),
                  R + 'Arm': (-0.3, 0.1, 1), R + 'ForeArm': (0.35, 0.2, 1), R + 'Hand': (0.3, 0, 1),
                  L + 'Arm': (0.3, 0.1, 1), L + 'ForeArm': (-0.35, 0.2, 1), L + 'Hand': (-0.3, 0, 1)})
SMASH = dict(STEP, **{'mixamorig:Spine2': (0, -0.9, 0.55), 'lunge': (0.2, -0.16),
             R + 'Arm': (-0.2, -1, -0.45), R + 'ForeArm': (0.1, -0.45, -1), R + 'Hand': (0, -0.2, -1),
             L + 'Arm': (0.2, -1, -0.45), L + 'ForeArm': (-0.1, -0.45, -1), L + 'Hand': (0, -0.2, -1)})
# 咆哮：先缩身，再挺胸后仰、双臂张开，胸口一抖一抖
ROAR_IN = dict(B_IDLE, **LEGS_SET, **{'mixamorig:Spine2': (0, -0.7, 0.8), 'lunge': (0, -0.06)})
ROAR = dict(LEGS_SET, **{'mixamorig:Spine2': (0, 0.5, 1), 'lunge': (-0.05, 0),
            R + 'Arm': (-1, 0.15, 0.35), R + 'ForeArm': (-0.7, -0.1, 0.7), R + 'Hand': (-0.3, -0.2, 1),
            L + 'Arm': (1, 0.15, 0.35), L + 'ForeArm': (0.7, -0.1, 0.7), L + 'Hand': (0.3, -0.2, 1)})
ROAR_B = dict(ROAR, **{'mixamorig:Spine2': (0.06, 0.42, 1), 'twist': 5})
# 召唤（毒母）：双臂高举、背后毒囊一胀一缩——运行时在身边刷出毒液僵尸
SUM1 = dict(LEGS_SET, **{'mixamorig:Spine2': (0, 0.3, 1),
            R + 'Arm': (-0.8, -0.2, 0.6), R + 'ForeArm': (-0.4, -0.3, 0.9), R + 'Hand': (-0.2, -0.2, 1),
            L + 'Arm': (0.8, -0.2, 0.6), L + 'ForeArm': (0.4, -0.3, 0.9), L + 'Hand': (0.2, -0.2, 1)})
SUM2 = dict(SUM1, **{'mixamorig:Spine2': (0, 0.4, 1)}, scale={'mixamorig:Spine2': 1.12})

ZCLIPS = {
    'stomp':  [(0, BW1, 0.93), (0.35, BW2, 1.0), (0.7, mirror(BW1), 0.93), (1.05, mirror(BW2), 1.0), (1.4, BW1, 0.93)],
    'smash':  [(0, B_IDLE, None), (0.45, SMASH_WIND, None), (0.6, SMASH_WIND, None, 'LINEAR'), (0.68, SMASH, None),
               (1.0, SMASH, None), (1.5, B_IDLE, None)],
    'swipe':  [(0, B_IDLE, None), (0.35, WIND, None), (0.5, WIND, None, 'LINEAR'), (0.58, SLASH, None, 'LINEAR'),
               (0.64, SLASH_END, None), (0.9, SLASH_END, None), (1.3, B_IDLE, None)],
    'roar':   [(0, B_IDLE, None), (0.35, ROAR_IN, None), (0.6, ROAR, None), (0.75, ROAR_B, None), (0.9, ROAR, None),
               (1.05, ROAR_B, None), (1.2, ROAR, None), (1.7, B_IDLE, None)],
    'summon': [(0, B_IDLE, None), (0.45, SUM1, None), (0.65, SUM2, None), (0.85, SUM1, None), (1.05, SUM2, None),
               (1.25, SUM1, None), (1.8, B_IDLE, None)],
    'idle':   [(0, Z_IDLE, None), (1.1, Z_IDLE2, None), (2.2, Z_IDLE, None)],
    'walk':   [(0, SH_A, 0.95), (0.35, SH_B, 1.0), (0.6, SH_C, 0.96), (0.85, SH_D, 1.0), (1.2, SH_A, 0.95)],
    'sprint': [(0, SP_A, 0.85), (0.15, SP_B, 0.95), (0.3, mirror(SP_A), 0.85), (0.45, mirror(SP_B), 0.95), (0.6, SP_A, 0.85)],
    'guard':  [(0, GW1, 0.94), (0.28, GW2, 1.0), (0.56, GW3, 0.94), (0.84, GW4, 1.0), (1.12, GW1, 0.94)],
    'stalk':  [(0, ST_A, 0.62), (0.45, ST_B, 0.66), (0.9, ST_A, 0.62)],
    'attack': [(0, Z_IDLE, None), (0.3, CLAW_WIND, None), (0.4, CLAW_WIND, None, 'LINEAR'), (0.47, CLAW, None),
               (0.62, CLAW, None), (0.9, Z_IDLE, None)],
    'leap':   [(0, ST_A, 0.62), (0.3, dict(LEAP_LOAD, lunge=(-0.05, 0)), 0.4), (0.42, dict(LEAP_LOAD, lunge=(-0.05, 0)), 0.38, 'LINEAR'),
               (0.5, LEAP_UP, 1.5), (0.7, LEAP_TUCK, 2.0), (0.88, LEAP_DIVE, 1.6, 'LINEAR'), (0.98, LEAP_LAND, 0.4),
               (1.15, LEAP_LAND, 0.42), (1.5, dict(ST_A, lunge=(1.2, 0)), 0.62)],
    'swell':  [(0, Z_IDLE, None), (0.25, SW1, None), (0.45, SW2, None), (0.6, SW3, None), (0.85, SW4, None), (1.2, SW4, None)],
    'split':  [(0, Z_IDLE, None), (0.3, SPL1, None), (0.5, SPL2, None, 'LINEAR'), (0.55, SPL3, None), (0.8, SPL3, None)],
    'spit':   [(0, Z_IDLE, None), (0.35, SPIT_WIND, None), (0.42, SPIT_WIND, None, 'LINEAR'), (0.48, SPIT, None),
               (0.7, SPIT, None), (1.0, Z_IDLE, None)],
    'block':  [(0, BLOCK, None), (0.08, BLOCK_HIT, None), (0.35, BLOCK, None), (0.8, BLOCK, None)],
    'hit':    CLIPS['hit'],
    'slam':   [(0, BLOCK, None), (0.3, SLAM_WIND, None), (0.4, SLAM_WIND, None, 'LINEAR'), (0.46, SLAM, None),
               (0.66, SLAM, None), (0.95, BLOCK, None)],
    # 三种死亡，运行时随机挑一个（death / death2 / death3）：后仰打飞 / 跪倒扑脸 / 打转侧倒
    'death':  CLIPS['death'],
    'death2': [(0, Z_IDLE, None), (0.1, F_HIT, 0.95), (0.35, F_KNEE, 0.5), (0.45, F_KNEE, 0.48, 'LINEAR'), (0.62, F_FLAT, 0.14),
               (0.72, F_BOUNCE, 0.18), (0.88, F_DEAD, 0.14), (1.4, F_DEAD, 0.14)],
    'death3': [(0, Z_IDLE, None), (0.08, S_HIT, 0.95), (0.35, S_SAG, 0.6, 'LINEAR'), (0.55, S_FLAT, 0.4),
               (0.65, S_BOUNCE, 0.46), (0.8, S_DEAD, 0.4), (1.4, S_DEAD, 0.4)],
}
