// 尸群渲染：动画烘焙到贴图 + 实例化（04 §7.2 的对象池方案）。
// 每种僵尸 = 每个材质一个 InstancedMesh，一共十几个 draw call；每只只剩一个实例矩阵 + 一个"第几帧"。
// 体素件是刚体绑骨（每个顶点只挂一根骨、权重 1），所以顶点着色器只读 skinIndex.x 那一根。
// 贴图：每行 = 某个动作的一帧（30 fps），每 4 个 RGBA 像素 = 一根骨的 4×4 世界矩阵（已乘 bindMatrix）。
// ponytail: 切动作是硬切、没有 crossFade；60 像素高看不出，要淡入再给 aAnim 加第二组帧号做混合
import * as THREE from 'three';

const FPS = 30;
const clipOf = (anims, name) => anims.find((a) => a.name === name || a.name.startsWith(name + '_'));

export function bakeCrowd(gltf, clipNames, cap) {
  const root = gltf.scene;
  const meshes = [];
  root.traverse((o) => o.isSkinnedMesh && meshes.push(o));
  const sm = meshes[0], sk = sm.skeleton, nB = sk.bones.length;
  for (const m of meshes) console.assert(m.skeleton.bones[0] === sk.bones[0], 'crowd: 多个蒙皮网格没共用骨架');

  // 1. 烘焙：逐帧摆姿势、读骨骼矩阵
  const clips = {}, rows = [];
  const mixer = new THREE.AnimationMixer(root), M = new THREE.Matrix4();
  for (const name of clipNames) {
    const clip = clipOf(gltf.animations, name);
    const n = Math.ceil(clip.duration * FPS) + 1;
    clips[name] = { start: rows.length, frames: n, dur: clip.duration };
    mixer.stopAllAction();
    const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
    for (let f = 0; f < n; f++) {
      a.time = Math.min(f / FPS, clip.duration); mixer.update(0);
      root.updateMatrixWorld(true); sk.update();
      const row = new Float32Array(nB * 16);
      for (let b = 0; b < nB; b++) M.fromArray(sk.boneMatrices, b * 16).multiply(sm.bindMatrix).toArray(row, b * 16);
      rows.push(row);
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  const data = new Float32Array(nB * 16 * rows.length);
  rows.forEach((r, i) => data.set(r, i * nB * 16));
  const tex = new THREE.DataTexture(data, nB * 4, rows.length, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;

  // 2. 实例化网格：共用一份实例矩阵和帧号
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const group = new THREE.Group(), mats = [];
  for (const m of meshes) {
    const geo = m.geometry.clone(); geo.setAttribute('aAnim', anim);
    const mat = m.material.clone();
    mat.onBeforeCompile = (s) => {
      s.uniforms.uBones = { value: tex };
      const fetch = (r) => `mat4(texelFetch(uBones, ivec2(bi, ${r}), 0), texelFetch(uBones, ivec2(bi + 1, ${r}), 0), texelFetch(uBones, ivec2(bi + 2, ${r}), 0), texelFetch(uBones, ivec2(bi + 3, ${r}), 0))`;
      s.vertexShader = s.vertexShader
        .replace('void main() {', `uniform highp sampler2D uBones;
attribute vec4 skinIndex;
attribute vec2 aAnim;
mat4 boneMat() {
  int bi = int(skinIndex.x) * 4, r = int(aAnim.x);
  return ${fetch('r')} * (1.0 - aAnim.y) + ${fetch('r + 1')} * aAnim.y;
}
void main() {`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = mat3(boneMat()) * normal;')
        .replace('#include <begin_vertex>', 'vec3 transformed = (boneMat() * vec4(position, 1.0)).xyz;');
    };
    mat.customProgramCacheKey = () => 'crowd';
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.instanceMatrix = inst; im.frustumCulled = false; im.count = 0;
    group.add(im); mats.push([m.material, mat]);   // [原材质, 实例化版]：换色时按原材质认
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  return {
    group, clips, mats,
    set count(n) { for (const im of group.children) im.count = n; },
    // 写第 i 只：位置、朝向（绕 y）、缩放、动作名、动作内时间（秒，调用方负责循环 / 夹住）
    set(i, pos, rotY, scale, clip, t) {
      m4.compose(pos, q.setFromAxisAngle(Y, rotY), sv.setScalar(scale)).toArray(inst.array, i * 16);
      const c = clips[clip], ft = Math.min(Math.max(t, 0) * FPS, c.frames - 1.001), f = Math.floor(ft);
      anim.array[i * 2] = c.start + f; anim.array[i * 2 + 1] = ft - f;
    },
    commit() { inst.needsUpdate = true; anim.needsUpdate = true; },
  };
}
