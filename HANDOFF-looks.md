# 交接：职业形象资产（剑士已完成 → 下一步射手）

新会话先读这份文件，再读下面列出的代码位置。全部用中文汇报。

## 用户的长期约束（原话，一直有效）
- 「docs/ 推到 main 即公开发布（GitHub Pages）。未经我同意不要 push」
- 「提交/推送要先问我」；commit 结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 「文档里的数字全部从模拟器导出，不许手填」（形象相关的数字从构建日志 `LOOK_OK … tris … h_m` 统计）
- 「不要使用红色来标识近战角色…近战职业使用深黄色，远程职业使用浅蓝色，辅助职业使用浅绿色」
- 不要用 Workflow 工具。

## 当前未完成的任务（用户最新一条消息）
「在角色名称前加上编号（用1.1表示1转1号），然后按照剑士的模版生成射手的角色阵列」

1. **名牌编号**：`proto/m0/index.html` 的 `lplate = plates(...)`（约 344 行）里 `text: c.name` 改成 `` `${c.tier}.${序号} ${c.name}` ``。
   - 序号 = 该职业在本转内的位置，从 1 开始（顺序就是 `LOOKS.filter(c => c.tier === t)` 的顺序，即路径二进制从小到大）。
   - 基础用 0.1；五星的 tier 是 7，写成 7.x。用户只说了「1.1 表示 1 转 1 号」，五星写 7.x 还是「星.x」没定，先用 7.x，汇报时提一句。
   - 名牌宽 256px（`plates(..., 256, 128, 1.5, 0.75, 0.42, 40)`），加编号后像「6.64 影幕·艾伦」这样的长名字可能挤，要截图核对，必要时减字号或加宽。
2. **射手树 191 个形象**：照剑士的结构在 `proto/m0/tools/voxel.py` 里做一套，页面上加「射手形象」tab（或者把 looks tab 做成可以切换树）。

## 剑士已经做完的（未提交）
- `proto/m0/tools/voxel.py` 1233 行到文件末尾是形象代码：
  - `LOOK_WPN` 是形象专用武器（1120、1262 行）；`LOOK_GLOW` / `LOOK_MATS` 在 1244 行（发光色 → `_glow` 材质，GHOST → `_glass` 半透明）。
  - 工具函数：`shield`、`aura_trim(part,a,big)`（5 转光环镶边：进取金尖 / 守护银圆）、`order_mark(part,o,col)`（英雄号令：授=背旗，令=令羽）、`buckle`、`hero_coat`。
  - `sig_f0..sig_f7`（1322 行起）：8 个家族的招牌件，签名是 `(part, t, v, U, rnd, F)`，t=转，v=流派。
  - `star_suit(fam,v,a,o,F)`（1473 行）：五星整套。
  - `FAM`（1522 行）：8 个家族的配色、发型三元组、英雄长衣、sig 函数。
  - `FACE`（1532 行）：4 个方向的 0–5 转用脸，取自 classes.ts 的 `TEMPLATE`。
  - `person(f,h)`：用公式生成英雄的人物数据，五星沿用。
  - `look_weapons(f,t,v)`：按家族、转、流派选左右手武器。
  - `gen_look(path, ult)`：组装一个形象。
  - `CHAIN`（1591 行）：手写的 12 个，是样板链 8 级加 sw-1/01/10/11。
  - `cid` / `PATHS` / `LOOKS`，以及 `assert len(LOOKS)==191`。
  - `lift_parts` 和 `look_cells`。
  - `if 'looks' in only:` 导出块：先校验 191 个形象两两指纹不同，写 `assets/looks.json`（每个职业的 wr/wl/hips），导出武器，再导出每个职业。只有 sw 带动作（`keep_anims=lid=='sw'`）。
- **路径含义**（剑士）：p0 锋/盾，p1 轻/重，p2 家族（`styles[p0*2+p1][p2]`），p3 流派，p4 光环（进取/守护），p5 号令（授/令）。方向 d=p0*2+p1，家族 f=d*2+p2。
- **id 规则**：`'sw' + ('-'+路径) + ('+' if 五星)`，文件名里 `+` 写成 `_star`。射手的 key 是 `ar`（classes.ts 445 行），id 是 `ar`、`ar-0`、…、`ar-000000+`。
- **身形**：k 依次为 1.00 / 1.00 / 1.03 / 1.06 / 1.09 / 1.12；英雄 k1.14、lift2、head_k0.74；五星 k1.18、lift4、head_k0.7。
- **页面**（`proto/m0/index.html`）：
  - 70 行：`const LOOKS = CLASSES.filter(c => c.tree === 'swordsman')`。
  - 68 行附近 fetch `assets/looks.json` 得到 `LMETA`。
  - 131 行 `LW` 是武器列表。
  - 约 311 行起：`LSUB`、`lband`、`lpos`（每转一段，每行 16 个，高转数站后排）、地面深浅色带和左侧转数牌（`lground`）、`clipsFor`（借 sw 的动作，丢掉非 Hips 的位移轨，Hips 位移按 hips 比例缩放）、`lunits`、`lplate`、`lplay`。
  - setTab 里同时切换 `lplate` 和 `lground` 的可见性；镜头是 `lfront: [[0,21,46],[0,0,4]]`、`ltop: [[0,66,6],[0,0,0]]`。
- `docs/05-资产清单.html` §2.4 已经更新成「剑士 191 个全部出模」，三角面数取自构建日志：基础 470；英雄平均 1423；五星平均 963；最高 3224（龙枪骑士英雄的龙翼）。射手做完要同样更新这一节，数字从日志统计。

## 射手树要用的资料（已核对 src/data/classes.ts 445 行起）
- p0：传统射具 / 现代火器；p1：机动 / 阵地；p2 家族；p3 流派；p4 光环；p5 号令。
- 1 转：猎手 / 枪手；2 转：游猎者、守望射手、突击枪手、远射兵。
- `TEMPLATE.archer = ['jet','vera','jet','vera']`（机动=jet，阵地=vera）。jet、vera 的人物数据在 voxel.py 约 193–196 行的 `CHARS` 字典里，可以当 `FACE`。
- 8 个家族及招牌件（docs/05 §2.4 的射手行；f = d*2+p2）：
  - f0 驯鹰猎手（宠物伙伴，流派 猛禽/灵隼）：肩上的鹰
  - f1 飞索游侠（投索，绊索/钩爪）：腰缠钩索卷
  - f2 重弩手（钉刺，串钉/钉墙）：背后弩匣
  - f3 回旋镖手（往返弹射，交叉/战镖）：背后十字回旋镖
  - f4 双枪客（枪斗术，枪舞/快拔）：双腿枪套、风衣下摆
  - f5 榴弹兵（抛射，跳弹/粘弹）：胸前弹带、背后榴弹筒
  - f6 狙击手（超远单体，反器材/猎首）：超长狙击枪背挂、单眼镜
  - f7 能量射手（能量蓄放，电磁/激光）：胸口发光核心、能量弓
- 已有武器（`WPN`，173 行）：sniper、pistol、smg、laser、grenade、boomerang 等，**没有弓和弩**，要在 `LOOK_WPN` 里新做 bow、crossbow 和各家族的五星版。
- 远程姿势：sw 的动作片段里有 attack_pistol / attack_rifle / attack_throw；`lplay` 现在把 attack 写死成 `attack_melee1h`，射手要按武器选片段。
- 射手是远程职业，名牌和地面上的标识色用**浅蓝色**（剑士用的是金色 `#d4a017`）。

## 建议的做法
1. 把剑士专用的 `CHAIN` / `FAM` / `FACE` / `look_weapons` / `cid` 收进按树区分的表（比如 `TREES = {'sw': ..., 'ar': ...}`），`LOOKS` 合并两棵树共 382 个。导出命令加树过滤（例如 `looks ar`，注意 `voxel.py:19` 只有 `len(only) > 1` 时才过滤）。
2. 射手要手写：基础 + 1 转 2 个 + 2 转 4 个，共 7 个装饰函数，再加 8 个 sig、8 套五星和武器。`person` / `aura_trim` / `order_mark` / `hero_coat` 直接复用。
3. `looks.json` 合并两棵树。页面用 `tree` 参数或另开一个 tab（快捷键 7）：`LOOKS = CLASSES.filter(c => c.tree === 当前树)`。只有每棵树的基础形象（`ar`）带动作，或者全部借 sw 的动作（骨架相同，可以借）。
4. 唯一性断言要对两棵树都生效。

## 命令
- 构建：在 `proto/m0/tools` 下运行 `/c/tools/blender-4.2.9-windows-x64/blender.exe -b --factory-startup -P voxel.py -- ../assets/src/Xbot.glb ../assets/build looks`（约 1 分钟一棵树）。统计用 `| grep LOOK_OK`。
- 压缩：在 `proto/m0/assets` 下，对每个文件运行 `../../../node_modules/.bin/gltf-transform meshopt build/vox_X.glb vox_X.glb`。
- 注意：构建会覆盖 `assets/build/vox_sword.glb`。如果压缩时误把它当成源，压缩后的 `assets/vox_sword.glb` 被盖掉了，就用 `git checkout proto/m0/assets/vox_sword.glb` 恢复。
- 浏览器：Vite 已经在 http://localhost:5199 运行。探测命令 `node c:/tmp/probe.mjs <url> <js文件> <shot.png> [等待ms]`；`c:/tmp/lk.js` 是正视截图，`c:/tmp/lkt.js` 是俯视截图。`window.__m0` 暴露了 setTab、setView、setState、lunits、camera、orbit。
- 改代码的习惯：用 c:/tmp 下的 Python 脚本，`rep(a,b,cnt=1)` 断言出现次数；不要在 bash heredoc 里写带引号的 JS。

## 待用户决定
- `assets/build/` 里的未压缩模型要不要提交：原本入库 70 个，剑士新增约 200 个、28 MB。用户还没回答。
- 剑士部分全部未提交。提交前先问用户。
