// 对抗维度 v2 提案页：node dims2.mjs > docs/review/dims-v2.html
// 提案数据写在本文件（还没进仓库）；现行版从 scenes.ts 读，用来做新旧对照。覆盖数全部由下面的数据算出。
const R = new URL('../../src/data/', import.meta.url).href;
const OLD = await import(R + 'scenes.ts');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FAM = {
  tempo: ['F1', '数量与距离', '敌人多、快、会炸、有人指挥——考验的是"先打谁、在多远处打"'],
  defense: ['F2', '抗性与恢复', '敌人身上的数值规则——考验的是"你的伤害是什么类型"'],
  plane: ['F3', '感知与位面', '敌人不在你能打到的地方——考验的是"你有没有那把钥匙"'],
  mind: ['F4', '区域与心智', '战场本身在伤害你——考验的是"阵型能不能撑住"'],
};

// 答案标签 v3：[编号, 名称, 状态, 说明, 是否依赖 AI 选目标]。K = 钥匙（自动生效），A = 替代答案。
// 编号用于职业技能标注，例如技能写 [K02 减速]。编号一经确认发布就不再复用，删掉的编号空着。
const TAGS = {
  aoeClear: ['K01', '范围清场', 'keep', '不需要选中目标的范围伤害：扇形喷射、爆炸、贯穿弹道、雷环'],
  slow: ['K02', '减速', 'new', '光环或区域：范围内的敌人移动变慢。冰雾、泥沼、粘滞场、沉重踩踏'],
  root: ['K03', '定身石化', 'new', '触发或区域：进入范围的敌人被定住、石化或冻结，原地不动但仍在阻挡'],
  charm: ['K04', '魅惑混乱', 'new', '触发或区域：敌人转而攻击同伴、停下不动或走错方向'],
  block: ['K05', '拦截拒马', 'new', '光环或区域：敌人冲进身边一定范围，自动被弹开或挡停。拒马、反冲锋架势、斥力场'],
  detonate: ['K06', '诱爆', 'new', '火焰、爆炸、雷电、冲击波的区域或陷阱碰到爆炸僵尸，让它提前在原地引爆，顺带炸伤它身边的僵尸'],
  dispel: ['K07', '驱散', 'new', '区域或光环：周期性清除敌方增益、压制光环，并阻止复活'],
  physical: ['K08', '物理伤害', 'new', '按伤害类型自动划分：钝击 / 斩击 / 穿刺 / 爆炸'],
  magic: ['K09', '法术伤害', 'new', '按伤害类型自动划分：火 / 冰 / 毒 / 奥术'],
  electric: ['K10', '电磁伤害', 'new', '按伤害类型自动划分：光线 / 激光 / 电磁脉冲 / 雷电 / 等离子。无视物抗与魔抗，只被电磁场挡'],
  shred: ['K11', '破抗', 'rework', '原「破甲」。命中或区域附带，同时降低物抗与魔抗，对电磁场无效'],
  antiHeal: ['K12', '重创', 'new', '命中或区域附带，压低目标回血（灼烧、撕裂、腐蚀都算）'],
  detect: ['K13', '侦测', 'new', '光环或区域：范围内的隐形单位现形，全队都能选中'],
  seismic: ['K14', '震地', 'new', '周期或触发式地震：命中地下单位，并把它震出地面'],
  antiAir: ['K15', '对空', 'new', '能命中空中单位。远程投射物自动具备；另有击落区域，把范围内的飞行单位拉回地面'],
  cleanse: ['K16', '净化', 'new', '清除我方身上的持续伤害，消掉地面毒区'],
  calm: ['K17', '宁神', 'new', '光环或触发式：免疫或解除恐惧、混乱'],
  deflect: ['K18', '弹幕拦截', 'new', '屏障或护盾吸收、反射敌方投射物'],
  singleTarget: ['A01', '单体点杀', 'keep', '高单体伤害，但要先选中目标', 1],
  burst: ['A02', '爆发', 'keep', '短时间集中伤害，但要先选中目标', 1],
  control: ['A03', '控制打断', 'keep', '主动施放的减速、击退、打断吟唱，要选目标', 1],
  taunt: ['A04', '嘲讽', 'keep', '把敌人的攻击目标和落点固定在自己身上'],
  mitigate: ['A05', '减伤护盾', 'keep', '降低全队承伤'],
  sustain: ['A06', '续航治疗', 'keep', '回血'],
  ranged: ['A07', '远程射程', 'keep', '在威胁范围外解决战斗'],
  mobility: ['A08', '机动', 'keep', '走位成本低，能切入后排', 1],
  summon: ['A09', '召唤物', 'keep', '编制外单位，帮忙分摊伤害、吃下爆炸、挡住冲锋'],
};
const DROPPED_TAGS = [
  ['持续输出 sustainedDps', '是通用强度，不对应任何一把"锁"。'],
  ['直线穿透 pierce', '保留为武器数值（只削物抗），不再作为答案标签。'],
  ['爆炸灼烧 explosive', '爆炸并入物理伤害的爆炸系，灼烧并入重创。'],
  ['标记易伤 debuff', '并入破抗（降抗）与单体点杀（集火）。'],
];

// 维度 v3。key = 钥匙（自动生效，可以有多把）；alt = 替代答案。
// 简单常见的维度多给钥匙，硬锁维度只留一两把。
const DIMS = [
  { id: 'swarm', name: '潮涌', fam: 'tempo', st: 'keep', from: '潮涌 + 分裂并入',
    feels: '一眼望不到边的小僵尸，单个不疼，但你只有 5 个人',
    lock: '数量压过来，单体火力会被淹没。这类怪血少，所以解法特别多：只要让前排的僵尸打不出伤害又堵在原地，后面的大群就全被挡在一条线上。',
    key: ['aoeClear', 'slow', 'root', 'charm', 'block'], alt: ['taunt', 'mitigate', 'summon', 'control'],
    floor: '小怪血薄，单体也能慢慢清，只是会被推到墙角。',
    cue: '满屏小怪', zombies: ['普通僵尸', '分裂僵尸', '分裂小僵尸'] },
  { id: 'rush', name: '突进', fam: 'tempo', st: 'keep', from: '突进 + 跳跃僵尸并入',
    feels: '跑得比你快的僵尸，你还没反应过来就已经贴脸了',
    lock: '冲锋太快，等 AI 转身去控制已经来不及。这类怪血也不高，减速、定身、拦截都能拦住。',
    key: ['slow', 'root', 'block'], alt: ['control', 'taunt', 'summon', 'mitigate'],
    floor: '冲刺或跃扑之后有硬直。',
    cue: '高速冲锋的轨迹', zombies: ['高速僵尸', '跳跃僵尸'] },
  { id: 'suicide', name: '自爆', fam: 'tempo', st: 'keep', from: '自爆',
    feels: '它们不咬你，它们只是走过来然后炸掉',
    lock: '一贴脸就爆，炸到全队。血少，所以减速拖住、范围清掉、或者用火与爆炸提前诱爆，都行。',
    key: ['slow', 'aoeClear', 'detonate'], alt: ['ranged', 'summon', 'mitigate'],
    floor: '引爆前会闪光读条。',
    cue: '闪烁的鼓包', zombies: ['爆炸僵尸'] },
  { id: 'command', name: '号令', fam: 'tempo', st: 'new', from: '新增。原「围猎」「分裂」靠点杀解，现改为驱散，不再依赖选目标',
    feels: '后面那只举旗的不倒，前面的怪就一直又快又硬',
    lock: '传令僵尸躲在怪群后方，给范围内的僵尸加速、加抗。要点杀它，得指望 AI 选对目标，所以钥匙改为驱散：在区域里周期性清除强化，不管它站在哪。',
    key: ['dispel'], alt: ['singleTarget', 'burst', 'mobility', 'aoeClear'],
    floor: '传令僵尸自身很脆，光环有范围，站位能看出来。',
    cue: '旗帜，加上被强化僵尸身上的光环', zombies: ['传令僵尸（新）'] },
  { id: 'revive', name: '招魂', fam: 'tempo', st: 'new', from: '新增：你提的「复活」号令',
    feels: '明明已经清干净了，倒下的尸体又一个个站起来',
    lock: '亡者召唤师持续复活场上死掉的僵尸。要么切断复活的源头，要么把复活的杂兵连着尸体一起清掉，让复活变成白费力气。',
    key: ['dispel', 'aoeClear'], alt: ['singleTarget', 'burst'],
    floor: '复活的僵尸血量只有本体的一部分，召唤师每复活一次都会停顿。带索敌特性的职业可以把 A01 点杀当第三把钥匙（见第七节）。',
    cue: '尸体上浮起的绿光，指向召唤师的光丝', zombies: ['亡者召唤师（新）'] },

  { id: 'physRes', name: '物抗', fam: 'defense', st: 'rework', from: '重甲 → 重做',
    feels: '刀砍枪打全是白字，一发火球下去它却疼得直叫',
    lock: '物理伤害被大幅减免。全物理阵容打不动，要靠法术、电磁或破抗。',
    key: ['magic', 'electric', 'shred'], alt: [],
    floor: '减免有上限，物理伤害永远不会是 0。',
    cue: '金属甲片，物理命中时冒火花', zombies: ['铁甲僵尸（原高防胖僵尸）'] },
  { id: 'magicRes', name: '魔抗', fam: 'defense', st: 'rework', from: '精英护盾 → 重做',
    feels: '法术打上去被符文盾吃掉，一刀砍下去盾就碎了',
    lock: '法术伤害被大幅减免。全法术阵容打不动，要靠物理、电磁或破抗。',
    key: ['physical', 'electric', 'shred'], alt: [],
    floor: '同物抗，减免有上限。',
    cue: '浮在身前的符文盾，法术命中时泛光', zombies: ['咒盾僵尸（原护盾僵尸）'] },
  { id: 'field', name: '电磁场', fam: 'defense', st: 'new', from: '新增：你提的电磁场防御',
    feels: '电磁炮打上去全被吸掉，普通子弹和火球却照样打得进去',
    lock: '电磁伤害被完全吸收。电磁是万能解，所以必须有这样一层专门挡它的壳，而且这层壳对物理和法术伤害完全无效。',
    key: ['physical', 'magic'], alt: [],
    floor: '电磁场只吸收电磁伤害，任何物理或法术攻击都能正常打进去。',
    cue: '周身跳动的蓝色电弧', zombies: ['磁暴僵尸（新）'] },
  { id: 'regen', name: '再生', fam: 'defense', st: 'new', from: '新增',
    feels: '眼看要打死了，一转身它又满血',
    lock: '每秒高额回血。持续输出低于回血速度，就永远打不死。',
    key: ['antiHeal'], alt: ['burst', 'singleTarget'],
    floor: '回血有上限；被重创期间回血大幅降低。',
    cue: '伤口蠕动愈合，血条往回涨', zombies: ['增生僵尸（新）'] },

  { id: 'stealth', name: '隐形', fam: 'plane', st: 'new', from: '新增',
    feels: '队友突然倒了，可你根本看不见是谁干的',
    lock: '隐形单位不能被选中，AI 自动索敌会直接无视它。只有侦测，或者不需要选中目标的范围伤害能对付它。',
    key: ['detect'], alt: ['aoeClear'],
    floor: '它出手的瞬间，或者贴到极近距离时，会短暂现形。',
    cue: '空气扭曲的轮廓和脚印', zombies: ['潜影僵尸（新）'] },
  { id: 'burrow', name: '遁地', fam: 'plane', st: 'new', from: '新增',
    feels: '地面隆起，下一秒后排就被从脚下掀翻',
    lock: '在地下时，任何普通攻击都打不到它。它会钻到后排才出土。',
    key: ['seismic'], alt: ['taunt', 'mitigate'],
    floor: '地面有隆起痕迹，出土后有停顿窗口。嘲讽可以把出土点拉到前排。',
    cue: '移动的土包', zombies: ['掘地僵尸（新）'] },
  { id: 'air', name: '空中', fam: 'plane', st: 'new', from: '新增',
    feels: '近战全员抬头，看着它们在头顶盘旋',
    lock: '近战和地面范围伤害打不到空中单位。所有远程投射物自动带对空；近战阵容要靠击落区域把它拉下来。',
    key: ['antiAir'], alt: ['summon', 'mitigate'],
    floor: '俯冲攻击的瞬间贴地，近战可以打到。',
    cue: '地上的影子和俯冲轨迹', zombies: ['蝠翼僵尸（新）'] },

  { id: 'poison', name: '毒区', fam: 'mind', st: 'keep', from: '毒区',
    feels: '地上全是不能踩的东西，你被一点一点挤到墙角',
    lock: '持续掉血，同时能站的地面越来越少。',
    key: ['cleanse'], alt: ['sustain', 'mobility', 'ranged'],
    floor: '毒池会随时间消散。',
    cue: '绿色地面', zombies: ['毒液僵尸'] },
  { id: 'suppress', name: '远程压制', fam: 'mind', st: 'keep', from: '远程压制',
    feels: '站着不动就一直挨打，可前面又有一堆东西挡路',
    lock: '远程僵尸躲在怪群后方持续输出，AI 默认打最近的目标，够不到它。',
    key: ['deflect'], alt: ['mobility', 'mitigate', 'summon'],
    floor: '吐射有前摇，能躲。',
    cue: '从后排飞来的酸液弹道', zombies: ['喷吐僵尸'] },
  { id: 'mental', name: '精神', fam: 'mind', st: 'new', from: '新增',
    feels: '尖啸响起，你的队友扔下枪往回跑，或者把枪口对准了你',
    lock: '尖啸僵尸吟唱结束后，范围内的英雄会恐惧（逃跑）或混乱（攻击随机目标），阵型瞬间崩掉。',
    key: ['calm'], alt: ['control', 'ranged'],
    floor: '有吟唱读条，可以打断。意志能降低中招概率、缩短时长，但有上限，不能完全免疫。',
    cue: '张大的嘴，加上扩散的声波圈', zombies: ['尖啸僵尸（新）'] },
];
const CUT = [
  ['卡口 choke', '玩家不需要专门针对它。走廊、建筑保留为场景地形修饰，范围伤害在窄路里依然更划算，只是不再算一个维度。'],
  ['分裂 split', '只是在惩罚范围伤害，不需要专门的阵容。分裂僵尸并入潮涌，成为潮涌的又一种"死了会变多"。'],
  ['精英护盾 shielded', '和重甲考验的都是输出强度 → 重做为魔抗。'],
  ['重甲 heavyArmor', '从"堆穿透"改成"必须有别的伤害系别" → 重做为物抗。'],
  ['围猎 eliteHunt', '精英和 BOSS 每个场景都有，不是一种可以针对的压力。必须处理关键单位的需求改由号令、招魂承担。'],
  ['开阔 open', '没有专门的答案（持续输出是通用强度），降为地形修饰。'],
  ['迟滞 sluggish', '沼泽、冰面、水域降为地形修饰；对机动的需求改由毒区、远程压制承担。'],
  ['控制抗性 ctrlResist', '它是"让你的某个答案失效"，不是一种需要答案的压力。稳固、霸体、抗冻、狡诈这些字段继续留在僵尸身上。'],
];

const SCENES = [
  ['城市废墟', ['suicide', 'command', 'burrow'], '下水道里钻出掘地僵尸，传令僵尸在楼顶举旗。'],
  ['原始丛林', ['swarm', 'stealth', 'mental'], '密林里看不见潜影僵尸，尖啸声把阵型喊散。'],
  ['沼泽疫地', ['poison', 'regen', 'revive'], '毒素与增生僵尸泡在毒水里回血，亡者召唤师不停把尸体拉起来。'],
  ['荒漠废土', ['burrow', 'air', 'rush'], '沙下有掘地僵尸，天上有蝠翼僵尸盘旋，地面还有高速冲锋。'],
  ['雪原冻土', ['stealth', 'magicRes', 'suppress'], '雪盲中潜影僵尸贴近，冰晶咒盾挡住法术。'],
  ['军事禁区', ['physRes', 'field', 'air'], '装甲实验体、电磁屏障和飞行试验体。'],
];

const ZOMBIES = [
  ['normal', '普通僵尸', '数量', 'swarm', 'keep', '—'],
  ['splitter', '分裂僵尸', '增殖', 'swarm', 'keep', '维度：分裂 → 潮涌'],
  ['spawnling', '分裂小僵尸', '（分裂产物）', 'swarm', 'keep', '—'],
  ['runner', '高速僵尸', '冲刺', 'rush', 'keep', '—'],
  ['leaper', '跳跃僵尸', '跃扑', 'rush', 'keep', '维度：开阔 / 迟滞 → 突进'],
  ['bomber', '爆炸僵尸', '自爆', 'suicide', 'keep', '—'],
  ['herald', '传令僵尸', '号令', 'command', 'new', '光环：加速、加抗；本体脆，躲在后排'],
  ['summoner', '亡者召唤师', '招魂', 'revive', 'new', '持续复活场上尸体；复活的僵尸只有部分血量；每复活一次会停顿'],
  ['brute', '铁甲僵尸', '硬扛', 'physRes', 'rework', '原高防胖僵尸。物抗高、魔抗与电磁场为 0'],
  ['ward', '咒盾僵尸', '吸法', 'magicRes', 'rework', '原护盾僵尸。护盾只挡法术，物理一碰就碎'],
  ['tesla', '磁暴僵尸', '屏障', 'field', 'new', '电磁场吸收全部电磁伤害；对物理与法术完全无效'],
  ['regenerator', '增生僵尸', '再生', 'regen', 'new', '高额回血；被重创时回血大降'],
  ['stalker', '潜影僵尸', '潜伏', 'stealth', 'new', '隐形；出手或贴近时现形；背刺伤害高'],
  ['burrower', '掘地僵尸', '钻地', 'burrow', 'new', '地下移动，不可命中；在后排出土掀飞'],
  ['flyer', '蝠翼僵尸', '盘旋', 'air', 'new', '空中，近战与地面范围伤害打不到；俯冲时贴地'],
  ['toxic', '毒液僵尸', '封锁', 'poison', 'keep', '—'],
  ['spitter', '喷吐僵尸', '压制', 'suppress', 'keep', '—'],
  ['screamer', '尖啸僵尸', '尖啸', 'mental', 'new', '吟唱尖啸，范围恐惧或混乱；可打断'],
];

const ATTR = [
  ['伤害系别：三系', '物理 = 钝击、斩击、穿刺、爆炸；法术 = 火、冰、毒、奥术；电磁 = 光线、激光、电磁脉冲、雷电、等离子。原来的「雷」从法术划归电磁，风暴术士因此成为电磁系的第二个来源。'],
  ['护甲 → 物抗', '韧性派生，规则不变，但只减物理伤害。穿透只削物抗。'],
  ['新增：魔抗（意志）', '智力派生（推荐，见问题 1）。减免法术伤害，同时降低恐惧和混乱的概率与时长。两项都设上限，遵守"留地板"原则。'],
  ['新增：电磁场', '僵尸侧的字段，不是玩家的常规属性。效果：吸收全部电磁伤害；对物理与法术伤害完全无效果。破抗不能降低它。'],
  ['僵尸新字段', 'physRes 物抗、magicRes 魔抗、energyField 电磁场（取代单一护甲）；regen 回血；行为标签新增 stealth / burrow / flying / scream / herald / summon。'],
  ['甲型克制表', '保留，作为 ±15% 以内的手感微调，不再承担维度职责。'],
];

// 各树能提供钥匙的候选分线（草案，审核后进技能设计）
const SUPPLY = {
  aoeClear: ['全树', '全树', '榴弹兵 · 回旋镖手 · 重弩手（串钉）', '炼金药剂师 · 星象家 · 萨满', '全树'],
  slow: ['巨人剑士（沉重踏地）· 盾阵兵（拒马）', '元素使（冰霜）· 地脉术士（泥沼）', '飞索游侠（绊索）', '德鲁伊（藤蔓）· 萨满（冰霜图腾）· 星象家', '喷射兵（冰雾）· 力场工程师（粘滞场）'],
  root: ['巨人剑士（践踏）· 龙枪骑士（落砸）', '变形师（石化）· 地脉术士（岩缚）', '飞索游侠（套索）', '德鲁伊（根须缠绕）', '机关师（夹具）'],
  charm: ['幻影卫（虚影扰心）', '幻术师（惑心）· 变形师', '—', '吟游诗人（挽歌）', '蜂群技师（蜂群骚扰）'],
  block: ['盾阵兵（枪林拒马）· 堡垒兵（荆棘反击）', '引力术士（斥力场）', '重弩手（钉墙）', '—', '力场工程师（重压场）'],
  detonate: ['巨人剑士（撼地冲击波）', '元素使（火）· 风暴术士（落雷）', '榴弹兵', '炼金药剂师（爆裂瓶）', '机关师（爆破手）· 炮击观测员'],
  dispel: ['幻影卫（虚空领域）', '幻术师 · 变形师（群变）', '能量射手（电磁脉冲）', '神秘学家（禁魔师）· 吟游诗人（挽歌）', '蜂群技师（电磁干扰）'],
  physical: ['全树', '引力术士（压扁）· 死灵法师（尸群）· 变形师', '全树（能量射手除外）', '炼金（爆裂瓶）· 德鲁伊（藤鞭）', '全树（喷射兵除外）'],
  magic: ['御剑士（剑气）· 幻影卫（灵体）', '全树', '—（远程线上没有法术伤害）', '萨满 · 星象家 · 神秘学家 · 炼金', '喷射兵（火 / 冰 / 酸）'],
  electric: ['—', '元素使（雷）· 风暴术士（全树）', '能量射手（电磁 / 激光）', '萨满（雷鸣图腾）', '蜂群技师（电磁脉冲）· 炮台工程师（电磁炮）'],
  shred: ['龙枪骑士（贯阵）', '元素使（超导）', '能量射手（电磁）', '炼金药剂师（酸蚀）', '喷射兵（喷酸）'],
  antiHeal: ['狂战士（撕裂）', '元素使（灼烧）· 恶魔术士', '重弩手（钉刺流血）', '炼金药剂师（腐蚀）', '喷射兵（喷火）'],
  detect: ['幻影卫（灵视）', '幻术师（识破）', '驯鹰猎手（鹰眼）', '占卜师（预知）· 神秘学家（显形符）', '蜂群技师（扫描）· 炮击观测员（照明弹）'],
  seismic: ['巨人剑士（撼地）· 龙枪骑士（落砸）', '地脉术士', '榴弹兵（钻地弹）', '德鲁伊（根须）', '掘地工兵 · 机关师（地雷）'],
  antiAir: ['御剑士（飞剑）', '引力术士（拉落）· 风暴术士（雷云）', '全树（远程投射物自动具备）', '萨满（雷鸣图腾）', '炮台工程师（防空炮）· 蜂群技师'],
  cleanse: ['—', '风暴术士（御风吹散毒雾）', '—', '军医 · 德鲁伊 · 萨满（先祖）', '喷射兵（冰雾封冻毒池）'],
  calm: ['盾阵兵（军阵稳心）', '幻术师（心智屏障）', '驯鹰猎手（灵隼守心）', '吟游诗人 · 萨满（先祖之灵）· 神秘学家', '力场工程师（屏蔽场）'],
  deflect: ['盾阵兵（龟甲阵）· 幻影卫（替身守卫）', '引力术士（扭曲弹道）· 风暴术士（风墙）', '双枪客（枪斗术击落子弹）', '军医（护盾军医）· 神秘学家（符文结界）', '力场工程师（反射场）'],
};
const TREES = ['剑士', '法师', '射手', '辅助师', '技师'];

// ── 计算 ──
const answersOf = (d) => [...d.key, ...d.alt];
const dimsOfTag = (t) => DIMS.filter((d) => answersOf(d).includes(t));
const famIds = Object.keys(FAM);
const ST = { keep: '保留', rework: '重做', new: '新增' };
const stChip = (s) => `<span class="st st-${s}">${ST[s]}</span>`;
const tagChip = (t, k) => `<span class="chip ${k ? 'key' : ''}"><code class="tc">${TAGS[t][0]}</code>${TAGS[t][1]}${TAGS[t][4] ? '<i class="aim" title="依赖 AI 选目标">◎</i>' : ''}</span>`;
const dc = (d) => 'D' + String(DIMS.indexOf(d) + 1).padStart(2, '0');
const dimName = (id) => DIMS.find((d) => d.id === id).name;
const fb = (id) => `<label class="fbl" for="fb-${id}">意见</label><textarea id="fb-${id}" data-k="${id}" rows="2" placeholder="保留 / 改名 / 换机制……"></textarea>`;

const oldDims = OLD.DIMENSIONS;
const cards = famIds.map((f) => `<section class="fam f-${f}"><h3><span>${FAM[f][0]}</span>${FAM[f][1]}</h3><p class="fam-d">${FAM[f][2]}</p>${DIMS.filter((d) => d.fam === f).map((d) => `
<article class="dim" id="d-${d.id}">
  <header><code class="dc">${dc(d)}</code><h4>${d.name}</h4>${stChip(d.st)}<code>${d.id}</code></header>
  <p class="feels">“${esc(d.feels)}”</p>
  <dl>
    <dt>锁</dt><dd>${esc(d.lock)}</dd>
    <dt>答案</dt><dd class="chips">${d.key.map((t) => tagChip(t, 1)).join('')}${d.alt.map((t) => tagChip(t, 0)).join('')}</dd>
    <dt>地板</dt><dd>${esc(d.floor)}</dd>
    <dt>认出它</dt><dd>${esc(d.cue)}</dd>
    <dt>僵尸</dt><dd>${d.zombies.join('、')}</dd>
    <dt>来源</dt><dd class="mute">${esc(d.from)}</dd>
  </dl>${fb(d.id)}
</article>`).join('')}</section>`).join('');

const tagIds = Object.keys(TAGS);
const matrix = `<table class="mx"><thead><tr><th class="corner">编号 · 答案 ＼ 维度</th>${DIMS.map((d) => `<th class="f-${d.fam}"><span>${dc(d)} ${d.name}</span></th>`).join('')}<th>覆盖</th></tr></thead><tbody>
${tagIds.map((t) => `<tr class="${TAGS[t][0][0] === 'K' ? 'rk' : 'ra'}"><th><code class="tc">${TAGS[t][0]}</code><b>${TAGS[t][1]}</b>${TAGS[t][4] ? '<i class="aim" title="依赖 AI 选目标">◎</i>' : ''} ${TAGS[t][2] !== 'keep' ? stChip(TAGS[t][2]) : ''}<small>${esc(TAGS[t][3])}</small></th>${DIMS.map((d) => `<td>${d.key.includes(t) ? `<i class="dot k f-${d.fam}" title="钥匙"></i>` : d.alt.includes(t) ? `<i class="dot f-${d.fam}" title="替代"></i>` : ''}</td>`).join('')}<td class="num">${dimsOfTag(t).length}</td></tr>`).join('')}
</tbody><tfoot><tr><th>钥匙 / 全部答案</th>${DIMS.map((d) => `<td class="num">${d.key.length}/${answersOf(d).length}</td>`).join('')}<td></td></tr></tfoot></table>`;

const sceneCount = Object.fromEntries(DIMS.map((d) => [d.id, SCENES.filter((s) => s[1].includes(d.id)).length]));
const scenes = `<table class="sc"><thead><tr><th>场景</th><th>现行签名</th><th>新签名</th><th>一句话</th></tr></thead><tbody>
${SCENES.map(([n, sig, b]) => { const o = OLD.SCENES.find((s) => s.name === n);
  return `<tr><th>${n}</th><td class="chips">${o.signature.map((id) => `<span class="chip old">${oldDims.find((x) => x.id === id).name}</span>`).join('')}</td><td class="chips">${sig.map((id) => `<a class="chip f-${DIMS.find((d) => d.id === id).fam} dimc" href="#d-${id}">${dimName(id)}</a>`).join('')}</td><td class="brief">${esc(b)}</td></tr>`; }).join('')}
</tbody><tfoot><tr><td colspan="4">每个维度出现的场景数：${DIMS.map((d) => `${d.name} ${sceneCount[d.id]}`).join(' · ')}</td></tr></tfoot></table>`;

const zt = `<table class="zt"><thead><tr><th>僵尸</th><th>动词</th><th>维度</th><th>状态</th><th>变化</th></tr></thead><tbody>
${ZOMBIES.map(([id, n, v, d, s, x]) => `<tr><th>${n}<code>${id}</code></th><td>${v}</td><td>${dimName(d)}</td><td>${stChip(s)}</td><td>${esc(x)}</td></tr>`).join('')}</tbody></table>`;

const KEYS = Object.keys(SUPPLY);
const keyTags = tagIds.filter((t) => TAGS[t][0][0] === 'K'), altTags = tagIds.filter((t) => TAGS[t][0][0] === 'A');
const treeKeys = TREES.map((_, i) => KEYS.filter((k) => SUPPLY[k][i] !== '—').length);
const sp = `<table class="sp"><thead><tr><th>钥匙</th>${TREES.map((t) => `<th>${t}</th>`).join('')}<th>树数</th></tr></thead><tbody>
${KEYS.map((k) => `<tr><th><code class="tc">${TAGS[k][0]}</code>${TAGS[k][1]}<small>${DIMS.filter((d) => d.key.includes(k)).map((d) => d.name).join(' / ')}</small></th>${SUPPLY[k].map((s) => `<td class="${s === '—' ? 'none' : ''}">${esc(s)}</td>`).join('')}<td class="num">${SUPPLY[k].filter((s) => s !== '—').length}</td></tr>`).join('')}
</tbody><tfoot><tr><th>本树能提供的钥匙数</th>${treeKeys.map((n) => `<td class="num">${n} / ${KEYS.length}</td>`).join('')}<td></td></tr></tfoot></table>`;

const TRAITS = [
  ['为什么放在军衔上', '军衔是唯一的局外成长线，每升一级现在只涨属性。把特性挂上去，玩家每几级就有一次"选能力"的决策，而不是纯等数值。'],
  ['索敌智能是什么', '一张可叠加的目标条件优先级词表。基础只有最近的 / 最弱的 / 最强的；解锁后追加：精英与 BOSS、召唤者、施法者、带光环的、正在吟唱的、后排远程、隐形的、血量最低的、离我最远的、没被我打过的新目标。'],
  ['怎么表达', '玩家排成一条优先级，例如「召唤者 → 精英 → 带光环的 → 最近的」。AI 按这条顺序挑第一个命中的敌人。'],
  ['只改行为不改数值', '特性只扩索敌与触发条件，不提供任何攻击力、生命、冷却加成。这样 C7-5"军衔是唯一乘区"不被打破，配平不用重跑。'],
  ['对维度的影响', 'A01 单体点杀、A02 爆发可以从"替代答案"升为"钥匙"——前提是职业把索敌养到了对应条件。招魂、号令这两个维度的钥匙供给因此翻倍。'],
  ['和其他特性的关系', '索敌只是一类特性。同一个池里还会有触发类（残血自动后撤 / 队友倒地自动换位）、条件类（被包围时自动换近战武器）。先做索敌一类，验证手感再扩。'],
];

const TARGETS = [
  ['狙杀类', '重弩手 · 能量射手 · 炮击观测员', '最远的 / 精英与 BOSS / 血量最高的 / 没被我打过的新目标'],
  ['暗杀类', '瞬影刺客 · 幻影卫 · 潜影系', '召唤者 / 施法者 / 正在吟唱的 / 血量最低的 / 落单的'],
  ['突袭类', '龙枪骑士 · 机甲驾驶员 · 狂战士', '后排远程 / 带光环的 / 远程压制者 / 离我最近的高威胁目标'],
  ['压制类', '双枪客 · 榴弹兵 · 蜂群技师', '最密集的方向 / 数量最多的一群 / 正在接近的'],
];

const ASK = [
  ['意志从哪来？', '推荐由智力派生：一级属性不变，150 点预算不用重配，智力也多了防御用途。另一个方案是新增第 7 个一级属性"意志"，那样 955 个职业的属性都要重新分配。'],
  ['电磁能否作为独立的第三系？', '推荐可以：电磁无视物抗与魔抗，只被电磁场挡，代价是电磁的适用范围窄（只有光线、电磁、雷电类技能），而且遇到磁暴僵尸就完全打不动。这样三系形成循环：物理怕物抗、法术怕魔抗、电磁怕电磁场。'],
  ['破抗对电磁场无效，可以吗？', '推荐无效。破抗同时降物抗和魔抗，已经是最强的通用钥匙；如果它还能降电磁场，电磁场这一维就形同虚设。'],
  ['索敌特性会开第二条成长线，要不要？', 'C7-5 记着"军衔是全游戏唯一允许的额外乘区"，所以军衔一直只发属性成长 + 转职点。加特性 = 多一条横向成长线。我的建议是加，但把它限定成**只改行为、不改数值**：特性只扩索敌词表和触发条件，不碰攻击力、生命、冷却。这样既给玩家新的成长目标，又不破 C7-5 的"唯一乘区"。'],
  ['特性池按分线还是按职业？', '5 棵树 191 个职业，每个职业一套特性池 = 955 套，维护不动。建议按 40 条分线共享：同一条分线的所有职业用同一个池，槽位随军衔开。狙杀类三条线（重弩手 / 能量射手 / 炮击观测员）共享一套"远程优先"词表。'],
  ['25 级里给几个特性槽？', '建议 4–5 个，落在属性成长的中间节点上（例如 E-6 / W-1 / O-2 / O-5 / O-8），避免和 7 次转职点挤在一起。具体位置等你定了再排。'],
  ['覆盖门槛改成这样，行不行？', '每个维度至少 2 个答案；每个维度至少 1 把钥匙（自动生效的）；每把钥匙至少由 3 棵树提供；每棵树至少提供 18 把钥匙中的 15 把。按第八节草案：剑士 16、法师 18、射手 16、辅助师 17、技师 18，全部达标，而且没有一把钥匙的供给少于 3 棵树。'],
  ['净化只有 3 棵树有，够吗？', 'K16 净化只有法师、辅助师、技师有，剑士和射手完全没有。这会让毒区对这两个阵容偏硬。要么给剑士和射手各加一条净化来源，要么毒区多给几个替代答案（现在已经可以靠续航和机动硬吃）。'],
];

const css = `
:root{--bg:#f3f4f2;--paper:#fbfbf9;--ink:#1d2228;--ink2:#4a535d;--mute:#7b848d;--line:#d9dcd8;--line2:#e8eae6;
  --acc:#8a5a1c;--acc-soft:#f1e6d4;--steel:#2f5470;--steel-soft:#e3ebf1;--warn:#a2412c;--warn-soft:#f6e4de;--ok:#2f7a5b;--ok-soft:#dfeee6;
  --tempo:#b5562d;--defense:#5a4b9a;--plane:#1f7a8c;--mind:#9a7a12}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
  --bg:#15181b;--paper:#1c2024;--ink:#e6e8e6;--ink2:#b3b9bf;--mute:#838b93;--line:#30363c;--line2:#262b30;
  --acc:#d9a35c;--acc-soft:#332a1d;--steel:#8fb6d4;--steel-soft:#1f2b35;--warn:#e8876f;--warn-soft:#3a231d;--ok:#6cc59d;--ok-soft:#1c3128;
  --tempo:#e88a5f;--defense:#a99be6;--plane:#5fc3d6;--mind:#d9b84a}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#15181b;--paper:#1c2024;--ink:#e6e8e6;--ink2:#b3b9bf;--mute:#838b93;--line:#30363c;--line2:#262b30;
  --acc:#d9a35c;--acc-soft:#332a1d;--steel:#8fb6d4;--steel-soft:#1f2b35;--warn:#e8876f;--warn-soft:#3a231d;--ok:#6cc59d;--ok-soft:#1c3128;
  --tempo:#e88a5f;--defense:#a99be6;--plane:#5fc3d6;--mind:#d9b84a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding-inline:20px;padding-block:32px 80px;display:flex;flex-direction:column;gap:44px}
h1,h2,h3,h4{font-family:"Noto Serif SC","Songti SC",serif;margin:0;line-height:1.3;text-wrap:balance}
h1{font-size:2.2rem;font-weight:900}h2{font-size:1.45rem;padding-bottom:6px;border-bottom:1px solid var(--line)}
code,.num{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
code{font-size:.72rem;color:var(--mute);margin-left:6px}
.eyebrow{font-size:.75rem;letter-spacing:.14em;color:var(--acc);font-weight:500}
.top{border-bottom:2px solid var(--ink);padding-bottom:20px}.lede{color:var(--ink2);max-width:76ch;margin:8px 0 0}
.home{display:inline-flex;margin:10px 12px 12px 0;padding:6px 14px;border:1px solid var(--steel);border-radius:4px;background:var(--steel-soft);color:var(--steel);font-weight:700;font-size:.88rem;text-decoration:none}
.home:hover{background:var(--steel);color:var(--paper)}
section.part{display:flex;flex-direction:column;gap:14px}
.hint{font-size:.84rem;color:var(--mute);margin:0;max-width:80ch}
.f-tempo{--fc:var(--tempo)}.f-defense{--fc:var(--defense)}.f-plane{--fc:var(--plane)}.f-mind{--fc:var(--mind)}
.st{font-size:.7rem;padding:0 7px;border-radius:3px;font-weight:700;white-space:nowrap}
.st-keep{background:var(--line2);color:var(--ink2)}.st-rework{background:var(--acc-soft);color:var(--acc)}.st-new{background:var(--ok-soft);color:var(--ok)}
.principle{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}
.principle div{background:var(--paper);border:1px solid var(--line);border-top:3px solid var(--steel);border-radius:5px;padding:12px 14px;font-size:.9rem}
.principle b{display:block;font-family:"Noto Serif SC",serif;font-size:1rem;margin-bottom:4px}
.fams{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:18px;align-items:start}
.fam{display:flex;flex-direction:column;gap:10px}
.fam h3{font-size:1.1rem;display:flex;align-items:baseline;gap:8px;color:var(--fc);padding-bottom:4px;border-bottom:3px solid var(--fc)}
.fam h3 span{font-family:"JetBrains Mono",monospace;font-size:.78rem}.fam-d{margin:0;font-size:.82rem;color:var(--ink2)}
.dim{background:var(--paper);border:1px solid var(--line);border-left:4px solid var(--fc);border-radius:5px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;scroll-margin-top:16px}
.dim:target{box-shadow:0 0 0 3px var(--steel-soft)}
.dim header{display:flex;align-items:baseline;gap:8px}.dim h4{font-size:1.15rem}.dim header code{margin-left:auto}
.feels{margin:0;color:var(--ink2);font-size:.9rem}
dl{display:grid;grid-template-columns:4.2em 1fr;gap:4px 10px;margin:0;font-size:.86rem}
dt{color:var(--steel);font-weight:700;font-size:.78rem;padding-top:2px}dd{margin:0}.mute{color:var(--mute)}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:.75rem;padding:0 8px;border:1px solid var(--line);border-radius:10px;color:var(--ink2);text-decoration:none;white-space:nowrap}
.chip.key{border-color:var(--acc);background:var(--acc-soft);color:var(--acc);font-weight:700}
.chip.old{text-decoration:line-through;color:var(--mute)}a.dimc{border-color:var(--fc);color:var(--fc);font-weight:700}
.fbl{font-size:.74rem;color:var(--mute)}
textarea{width:100%;font:inherit;font-size:.85rem;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:6px 8px;resize:vertical}
textarea:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--steel);outline-offset:2px}
.cut{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:8px 18px;margin:0;padding:0;list-style:none;font-size:.88rem}
.cut li{border-left:3px solid var(--warn);padding:4px 10px;background:var(--paper)}.cut b{color:var(--warn);margin-right:6px}
.tw{overflow-x:auto;background:var(--paper);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:.86rem}
th,td{padding:6px 8px;border-bottom:1px solid var(--line2);text-align:left;font-weight:400;vertical-align:top}
thead th{font-size:.78rem;color:var(--ink2)}tbody th{font-weight:700}tbody th small{display:block;font-weight:400;color:var(--mute);font-size:.74rem}
.mx thead th:not(.corner):not(:last-child){border-top:4px solid var(--fc);text-align:center;min-width:3.2em;vertical-align:bottom}
.mx thead th span{writing-mode:vertical-rl;letter-spacing:.1em;display:inline-block}
.mx td{text-align:center;vertical-align:middle}.mx tbody tr:hover{background:var(--steel-soft)}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;border:2px solid var(--fc)}.dot.k{background:var(--fc);width:14px;height:14px}
.num{text-align:center}.none{color:var(--warn);text-align:center}
tfoot td,tfoot th{border-top:2px solid var(--line);border-bottom:0;font-size:.8rem;color:var(--ink2)}
.sc .brief{color:var(--ink2)}.zt code{display:block;margin:0}.sp td{font-size:.82rem}
.ask{margin:0;padding-left:1.4em;display:flex;flex-direction:column;gap:10px;max-width:90ch}.ask b{display:block}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{font:inherit;font-weight:700;padding:7px 16px;border-radius:4px;border:1px solid var(--steel);background:var(--steel);color:var(--paper);cursor:pointer}
#msg{font-size:.85rem;color:var(--ok)}
.tc{font-size:.68rem;font-weight:700;color:var(--steel);margin:0 5px 0 0}.chip.key .tc{color:var(--acc)}.dc{font-size:.72rem;font-weight:700;color:var(--fc);margin:0}.aim{font-style:normal;color:var(--warn);margin-left:3px;font-size:.75rem}.mx tr.rk th{background:var(--acc-soft)}.mx tr.rk + tr.ra th{border-top:2px solid var(--line)}
.order{margin:0;padding-left:1.4em;font-size:.9rem;display:flex;flex-direction:column;gap:4px}
`;

console.log(`<title>对抗维度 v2</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@700;900&family=JetBrains+Mono:wght@500&display=swap">
<style>${css}</style>
<div class="wrap">
<header class="top">
  <div class="eyebrow">Gunfire Squad · 第三轮 · 对抗维度重做提案 v3</div>
  <a class="home" href="index.html">← 返回职业树首页</a><a class="home" href="dims.html">现行维度设计图</a>
  <h1>对抗维度 v3：从"比输出"到"钥匙与锁"</h1>
  <p class="lede">现行 ${oldDims.length} 个维度里，有一半考验的其实都是"输出够不够"：重甲和护盾差不多，卡口和分裂不需要专门应对。v3 删掉 ${CUT.length} 个低效维度，重做 ${DIMS.filter((d) => d.st === 'rework').length} 个，新增 ${DIMS.filter((d) => d.st === 'new').length} 个，共 ${DIMS.length} 个维度。每个维度都对应一组"钥匙"：阵容里没有它，玩家能立刻感觉到卡住了。简单的维度给很多把钥匙，硬锁维度只留一两把。<b>这一页只是方案，没有改仓库。</b>文中不写具体数值，审核通过后由模拟器导出。</p>
</header>

<section class="part"><h2>一、五条判据（v2 的三条 + 本次新增两条）</h2><div class="principle">
  <div><b>能被一眼认出</b>每个维度都有一个视觉信号（旗帜、土包、扭曲轮廓、头顶的影子……），玩家进场就知道要面对什么。</div>
  <div><b>缺钥匙会卡住</b>维度的压力不是"更多血"，而是一条规则：打不到、选不中、打不动、阵型崩。补强输出解决不了，只能换答案。</div>
  <div><b>永远留地板</b>没有钥匙也有替代答案可以硬吃，或者有一个短暂的弱点窗口。绝不出现"这个阵容对这一关完全无解"。</div>
  <div><b>钥匙默认不依赖 AI 选目标</b>钥匙必须是光环、区域、触发、被动或伤害属性，只要角色在场就生效。需要"选对目标"的能力（标 ◎）默认只能当替代答案——但它可以通过<b>军衔解锁的索敌特性</b>升级成真正的钥匙，见第七节。</div>
  <div><b>简单的维度多给钥匙</b>潮涌、突进、自爆这类怪血少的维度，解法本来就该有很多种：减速、定身、魅惑、拦截、范围清场都能算钥匙。真正的硬锁（物抗、魔抗、电磁场、隐形）只留一两把钥匙。</div>
</div></section>

<section class="part"><h2>二、删掉的 ${CUT.length} 个维度</h2><ul class="cut">${CUT.map(([n, r]) => `<li><b>${n}</b>${esc(r)}</li>`).join('')}</ul></section>

<section class="part"><h2>三、v3 的 ${DIMS.length} 个维度</h2><p class="hint">维度编号 D01–D13。高亮标签 = 钥匙（K 编号），普通标签 = 替代答案（A 编号，能硬吃，但代价更高）；◎ = 依赖 AI 选目标。</p><div class="fams">${cards}</div></section>

<section class="part"><h2>四、答案标签 v3 与覆盖矩阵</h2>
  <p class="hint">${keyTags.length} 把钥匙（K01–K${String(keyTags.length).padStart(2, '0')}）+ ${altTags.length} 个替代答案（A01–A${String(altTags.length).padStart(2, '0')}）。每把钥匙只对应一个维度，例外是 K07 破抗，它同时能解物抗和魔抗（这是有意设计的通用第二解）。所以玩家看到一个维度，就知道要找哪一把钥匙。实心点 = 钥匙，空心点 = 替代。</p>
  <p class="hint"><b>技能标注写法</b>：在技能说明末尾写 <code>[K02 拦截]</code>，多个标签并列写 <code>[K02 拦截][A04 嘲讽]</code>。一个技能最多标 1 把钥匙，避免一个技能解掉两个维度。编号发布后不再复用。</p>
  <div class="tw">${matrix}</div>
  <ul class="cut">${DROPPED_TAGS.map(([n, r]) => `<li><b>删 ${n}</b>${esc(r)}</li>`).join('')}</ul>
</section>

<section class="part"><h2>五、怪物设计表 v3（${ZOMBIES.length} 种）</h2><p class="hint">保留 ${ZOMBIES.filter((z) => z[4] === 'keep').length} 种，重做 ${ZOMBIES.filter((z) => z[4] === 'rework').length} 种，新增 ${ZOMBIES.filter((z) => z[4] === 'new').length} 种。延续"每种僵尸一个动词"的原则。</p><div class="tw">${zt}</div></section>

<section class="part"><h2>六、战斗属性改动</h2><div class="tw"><table><tbody>${ATTR.map(([a, b]) => `<tr><th>${a}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div></section>

<section class="part"><h2>七、军衔特性：索敌智能（你提的方向）</h2>
<p class="hint">军衔现在只发两样东西：属性成长（每级 5–10%）和转职点（7 次）。你提的做法是再加第三样——<b>职业特性</b>，其中一类就是更聪明的索敌。这样"我该打谁"从一条写死的全局规则，变成一条可以养、而且每个职业养得不一样的能力线。</p>
<div class="tw"><table><tbody>${TRAITS.map(([a, b]) => `<tr><th>${a}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>
<p class="hint"><b>现成的钩子</b>：<code>characters.ts</code> 里每个角色已经有 <code>aiProfile.targetPriority</code>（closest / weakest / strongest 三选一），12 个角色各不相同。索敌特性就是把这个三选一扩展成一张可叠加的目标词表。</p>
<div class="tw"><table><thead><tr><th>职业倾向</th><th>候选分线</th><th>解锁后能表达的目标条件</th></tr></thead><tbody>${TARGETS.map(([a, b, c]) => `<tr><th>${a}</th><td>${b}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table></div>
<p class="hint"><b>这条线一开，A01 单体点杀和 A02 爆发就不只是替代答案</b>：暗杀类职业把索敌条件养到"召唤者 / 施法者"，招魂和号令的点杀解法就成立；狙杀类养到"精英 / 最远的"，围猎这类压力也重新立得住。钥匙的判定随之从"你带没带这个技能"变成"<b>你的职业有没有针对性地养索敌</b>"——这是玩家能自己规划的一层深度。</p>
</section>

<section class="part"><h2>八、场景签名 v3</h2><div class="tw">${scenes}</div></section>

<section class="part"><h2>九、职业技能：各树能提供哪些钥匙（草案）</h2><p class="hint">按 40 条分线现有的核心机制找最顺的落点，不新增分线。审核通过后再逐条改技能和标签。</p><div class="tw">${sp}</div></section>

<section class="part"><h2>十、需要你拍板</h2><ol class="ask">${ASK.map(([q, a], i) => `<li><b>${q}</b>${esc(a)}${fb('ask' + i)}</li>`).join('')}</ol>
  ${fb('extra')}
  <div class="actions"><button id="copy" type="button">复制全部意见</button><span id="msg" role="status"></span></div>
</section>

<section class="part"><h2>十一、审核通过后的修改顺序</h2><ol class="order">
  <li>damage.ts + attributes.ts：伤害系别、物抗/魔抗、意志、雷与奥术两种伤害类型。</li>
  <li>zombies.ts：新增 6 种僵尸、重做 2 种，加入新字段；数值由模拟器跑出。</li>
  <li>scenes.ts：维度、答案标签、ANSWER_DIMS、6 个场景的签名与关卡权重；哨兵改用新门槛。</li>
  <li>职业树：5 棵树按第八节补钥匙技能、重打标签，然后重跑 check / xcheck / balance-check。</li>
  <li>progression.ts + characters.ts：军衔特性槽与索敌词表。这是新系统，等你确认第七节的方向之后再谈数值。</li>
  <li>重新生成 dims.html 和 5 个评审页。docs/ 等你同意后再导出。</li>
</ol></section>
</div>
<script>
const KEY = 'dims-v2-review';
let s = {}; try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const tas = [...document.querySelectorAll('textarea[data-k]')];
for (const t of tas) { t.value = s[t.dataset.k] || ''; t.addEventListener('input', () => { s[t.dataset.k] = t.value; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }); }
document.getElementById('copy').addEventListener('click', async () => {
  const txt = '【对抗维度 v3 审核意见】\\n' + tas.filter((t) => t.value.trim()).map((t) => {
    const card = t.closest('.dim, li'); const h = card?.querySelector('h4, b')?.textContent || t.dataset.k;
    return '- ' + h + '：' + t.value.trim(); }).join('\\n');
  const msg = document.getElementById('msg');
  try { await navigator.clipboard.writeText(txt); msg.textContent = '已复制，粘贴回对话即可'; }
  catch { const o = document.createElement('textarea'); o.value = txt; document.body.append(o); o.select(); msg.textContent = '已选中文本，请按 Ctrl+C'; }
});
</script>`);
