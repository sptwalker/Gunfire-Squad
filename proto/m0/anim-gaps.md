# 缺失角色动作清单

> 数据来源：`battle.html?lab` 评审面板的自动审计（`window.__battle.revGapOf`）。
> 数字随 `K` / `KV` / `CLIP_SET` 变化，重跑探针即可刷新，不是手填。
> 最近一次实测：2026-10-12，**633 / 790 条技能有缺口**（157 条干净）。
> 其中 `clip` 类缺口 **0 条**——本文档列出的 7 个动作已全部补进 `poses.py` 并验收。
> 其余缺口按类：`noact` 628 · `fx` 577 · `stand` 43 · `kv` 2，都属于特效层，是另一件事。

## 现状

角色骨架 `mixamorig` 现在有 **20 个 clip**（`proto/m0/tools/poses.py` 的 `CLIPS` 表），
运行时另合成 2 个（`run_rifle` / `run_melee1h`），合 22 个。

| 已有 | 用途 |
|---|---|
| `idle` / `run` / `walk` | 位移（来自 Xbot 捐赠者） |
| `attack_melee1h` | 单手挥砍（剑 / 刀） |
| `attack_heavy` | 双手重劈（大剑） |
| `attack_thrust` | 长枪捅刺 |
| `attack_rifle` | 抵肩射击 |
| `attack_pistol` | 单手射击 |
| `attack_throw` | 投掷 |
| `hold_melee1h` | 持刀跑（运行时叠到 `run` 上） |
| `hit` / `death` | 受击 / 死亡 |
| **`leap`** | 蓄力 → 腾空收腿 → 落地缓冲（臀高抛物线，对应运行时 `h.leap`） |
| **`spin`** | 拧身起势 → 绕竖轴一整圈 → 收势 |
| **`summon`** | 双手前推 → 掌心外张撑开 → 收势 |
| **`cast`** | 双臂上抬过头 → 上举定格 → 放下 |
| **`guard`** | 武器横架胸前、身体侧缩（可循环） |
| **`aim` / `aim_pistol`** | 双手 / 单手端平静止瞄准（蓄力态） |
| **`roll`** | 团身 → 绕横轴一整圈 → 起身 |

注意 `clipOf()` 找不到 clip 时**静默返回 null**——`play(h, 'leap')` 是不会报错的无声失败，这是补动作时最容易踩的坑。
反过来，`battle.html` 的 `CLIP_SET` 也要跟着 `poses.py` 走：往 `CLIPS` 里加了动作却忘了同步 `CLIP_SET`，审计会把文案点名的动作继续算成缺口。

## 缺口（已清空）

以下 7 个动作原先卡住 114 条技能，现已全部实现并在形象页逐个验过。

| # | clip 名 | 曾卡住 | 文案里的词 | 补之前怎么顶 |
|---|---|---|---|---|
| 1 | `leap` | **36** | 跳 / 跃 / 腾空 / 后空 / 扑 / 坠 | `dash` 类只有直线位移 + 尾迹粒子，身体保持 idle 姿态平移过去 |
| 2 | `summon` | **30** | 召唤 / 召出 / 唤出 / 分身 / 影子 / 图腾 / 布置 / 放置 / 摆下 | 无起手动作，召唤物凭空出现 |
| 3 | `cast` | **15** | 吟唱 / 念咒 / 咏唱 / 施法 / 引导 / 念诵 / 祈祷 / 祝祷 / 冥想 | 借 `attack_throw` / `attack_heavy` 冒充 |
| 4 | `spin` | **14** | 旋转 / 旋身 / 绕身 / 环绕 / 回旋 / 转圈 | 只转特效不转人（环刃剑阵只让 6 片刀绕身） |
| 5 | `guard` | **9** | 举盾 / 盾墙 / 格挡 / 架盾 / 列阵 / 结阵 | 只有地面 one-shot 圈，身上没有盾形 / 姿态变化 |
| 6 | `aim` | **8** | 蓄力 / 聚力 / 蓄势 / 瞄准 / 端枪 / 架上 | 举枪类直接用 `attack_rifle` 的第一帧静态对准 |
| 7 | `roll` | **2** | 闪避 / 规避 / 躲开 / 后撤 / 拉开距离 / 退开 | 无表现 |

补完 114 → 0，但只有 **18 条技能因此彻底干净**——其余 96 条同时还缺 `noact` / `fx`。

## 已知取舍

`roll` 做不出贴地滚。姿势系统里 `aim()` 只旋转骨骼、压不短长度（头到髋恒定 0.79 米），
绕髋转到 180° 时头必然扫到地下。所以 `roll` 走的是**臀高弧线的腾空翻滚**，不是贴地滚。
要真贴地得先让脊椎能压缩——那是改姿势系统，不是改这一条 clip。细节见 `poses.py` 里 `ROLL_TUCK` 上方注释。

另一个坑记在 `_tumble` 的 docstring 里：关键帧第 3 项 `hips_h` 会在 `_pose()` 里覆盖掉 `lunge` 的 z，
**臀高只能写进 `CLIPS` 表的第 3 项**，写进 `lunge` 是无声失效（改四轮数值没进 GLB 才查到）。

## 验收

1. `blender -b -P voxel.py -- ../assets/src/Xbot.glb ../assets/build looks sw` 重建（约 1 分钟）。
2. 压缩：`cd ../assets && ../../../node_modules/.bin/gltf-transform meshopt build/vox_sw.glb vox_sw.glb`。
   **运行时读的是 `assets/vox_sw.glb`，不是 `build/`**；只跑第 1 步页面不会有变化。
3. `index.html` 形象页新增按钮逐个播放，肉眼确认姿态到位、没有穿模。
4. `battle.html?lab` 重跑探针：`clip` 类缺口应为 0（余下 `noact` / `fx` / `stand` 属于特效层）。
5. `docs/11-动画规范.html` 若有 clip 名清单，同步补上这 7 个。

