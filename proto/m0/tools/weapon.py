# M0 武器归一：原点移到握把、枪口/刃尖朝 glTF +Z、按实际长度缩放。
#
#   blender -b -P weapon.py -- <in.glb> <out.glb> <grip_x,y,z> <rot_x_deg> <length_m>
#
# grip 用 Rodin 原始坐标（Blender Z-up）量出来；glTF 的 +Z = Blender 的 -Y，+Y = Blender 的 +Z。
# 所以"枪口朝 Blender -Y、瞄具朝 +Z"就是约定朝向，rot_x 只用来把竖着生成的剑放倒。
import bpy, sys, math
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
src, dst, grip, rot_x, length = a[0], a[1], Vector(map(float, a[2].split(','))), float(a[3]), float(a[4])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
w = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

R = Matrix.Rotation(math.radians(rot_x), 4, 'X')
w.data.transform(R @ Matrix.Translation(-grip))
ys = [v.co.y for v in w.data.vertices]
s = length / (max(ys) - min(ys))
w.data.transform(Matrix.Scale(s, 4))
w.name = w.data.name = bpy.path.display_name_from_filepath(dst)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
ys = [v.co.y for v in w.data.vertices]
print("WPN_OK", w.name, len(w.data.polygons), "muzzle_y", round(min(ys), 3), "butt_y", round(max(ys), 3))
