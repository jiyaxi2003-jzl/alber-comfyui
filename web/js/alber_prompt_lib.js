// Alber 导演台 · 提示词模板库
// ---------------------------------------------------------------------------
// 提示词框右上角一个「▤ 模板」按钮，弹出可搜索的分类模板列表：
// 景别 / 运镜 / 角度 / 光线 / 构图 / 动作 / 表情 / 场景 / 氛围 / 时段 / 声音 / 成句。
//
// 设计原则（对齐 H3 的用法）：
//   · 每条都是可以直接拼进提示词的中文短句，不是术语单词
//   · 动作类只写「怎么动」，不堆静态描写
//   · 声⾳类只描述现场能听到什么，H3 会自己生成原生声音
//
// 交互：
//   · 单击 = 插入到插入点（没有光标就追加到末尾），自动补逗号
//   · Alt/⌥ + 单击 = 用这条替换整个框
//   · 可以改「插入到」选择别的镜头，不必来回切选中
//   · 搜索支持中文名、正文、英文别名
// ---------------------------------------------------------------------------

import { isDarkTheme } from "./alber_palette.js";
import { t } from "./minimax_i18n.js";

const STYLE_ID = "alber-apl-style";

// ==== 模板数据 ============================================================
// n = 名称（列表标题、搜索主要靠它）
// t = 插入文本
// k = 检索别名（英文术语 / 同义词，只用于搜索，不插入）
// m = 1 表示这条主要给「运动提示词」用（列表上标一个「动」）

const CATS = [
    {
        id: "shot",
        label: "景别",
        items: [
            { n: "大远景", t: "极远的大远景，人物只占画面很小一角，环境和天空占满", k: "extreme wide ews 建立镜头" },
            { n: "远景", t: "远景镜头，人物全身和环境的关系交代清楚", k: "wide ws long shot" },
            { n: "全景", t: "全景镜头，人物全身入画，头顶留少量空隙", k: "full shot" },
            { n: "中景", t: "中景镜头，人物腰部以上入画，手部动作看得见", k: "medium ms 半身" },
            { n: "中近景", t: "中近景镜头，人物胸部以上入画", k: "medium close mcu" },
            { n: "近景", t: "近景镜头，人物肩部以上，脸占画面主要位置", k: "close shot cu" },
            { n: "特写", t: "特写镜头，脸部充满画面", k: "close-up cu 大头" },
            { n: "大特写", t: "大特写，只留一只眼睛的局部（容易崩，慎用）", k: "extreme close ecu 微距" },
            { n: "双人近景", t: "双人近景镜头，两人同框，肩膀挨着肩膀", k: "two shot 两人" },
            { n: "过肩镜头", t: "过肩镜头，前景是另一人的肩膀和侧脸，虚化", k: "over the shoulder ots 越肩" },
            { n: "主观视角", t: "主观视角，画面就是角色眼睛看到的", k: "pov first person 第一人称" },
            { n: "空镜", t: "空镜，画面里没有人，只有环境和物件", k: "empty insert 过场" },
            { n: "物件特写", t: "物件特写，只有手和物件占满画面", k: "insert detail 道具" },
            { n: "局部近景", t: "局部近景，只拍手、脚或背影", k: "detail 拆碎" },
        ],
    },
    {
        id: "move",
        label: "运镜",
        items: [
            { n: "固定机位", t: "镜头固定不动，画面里只有人物在动", k: "static locked off 静止" },
            { n: "缓推", t: "镜头缓慢向前推近，一点点靠近人物", k: "slow push in dolly in 推镜头" },
            { n: "急推", t: "镜头快速推到人物脸上", k: "crash zoom 推" },
            { n: "缓拉", t: "镜头缓慢向后拉远，逐渐露出环境", k: "pull out dolly out 拉镜头" },
            { n: "急拉", t: "镜头猛地向后拉开", k: "snap pull 拉" },
            { n: "右横移", t: "镜头水平向右平移", k: "pan right truck 移镜头" },
            { n: "左横移", t: "镜头水平向左平移", k: "pan left truck" },
            { n: "摇镜", t: "镜头原地水平摇过整个空间", k: "pan 摇镜头" },
            { n: "上摇", t: "镜头从下往上摇，最后停在高处", k: "tilt up 仰摇" },
            { n: "下摇", t: "镜头从上往下摇，停在人物脚边", k: "tilt down 俯摇" },
            { n: "跟随", t: "镜头跟着人物一起移动", k: "tracking follow 跟拍" },
            { n: "背跟", t: "镜头在人物背后跟着走", k: "follow back 后跟" },
            { n: "迎面跟", t: "镜头在人物正前方，倒退着跟拍", k: "lead follow 前跟" },
            { n: "升降", t: "镜头从地面升到高处", k: "crane boom jib 吊臂" },
            { n: "环绕", t: "镜头绕着人物走半圈", k: "orbit arc 环绕" },
            { n: "手持", t: "手持镜头，画面轻微晃动", k: "handheld 抖动" },
            { n: "变焦推", t: "机位不动，镜头变焦推近", k: "zoom in 变焦" },
            { n: "变焦拉", t: "机位不动，镜头变焦拉远", k: "zoom out" },
            { n: "希区柯克变焦", t: "希区柯克变焦，人物大小不变，背景被拉开", k: "dolly zoom vertigo" },
            { n: "甩镜", t: "镜头快速甩向另一侧", k: "whip pan 甩" },
            { n: "贴地穿行", t: "镜头贴着地面快速穿行", k: "fpv low 低机位" },
            { n: "俯冲", t: "镜头从高空俯冲下来", k: "fpv drone 航拍" },
            { n: "静止后启动", t: "镜头先静止两秒，然后突然跟着动作动起来", k: "delay 启动" },
            { n: "极慢摇移", t: "镜头极慢地横摇，制造不安", k: "slow pan 慢" },
        ],
    },
    {
        id: "angle",
        label: "角度",
        items: [
            { n: "平视", t: "平视机位，与人物眼睛同高", k: "eye level 平" },
            { n: "微仰", t: "机位略低于视线，轻微仰拍", k: "slight low" },
            { n: "仰拍", t: "低角度仰拍，人物居高临下看着镜头", k: "low angle 仰" },
            { n: "大仰拍", t: "机位几乎贴地仰拍，人物高大得压向画面", k: "extreme low 极端仰" },
            { n: "俯拍", t: "高角度俯拍，人物显得渺小", k: "high angle 俯" },
            { n: "鸟瞰", t: "垂直向下的鸟瞰视角", k: "bird eye overhead top" },
            { n: "荷兰角", t: "镜头倾斜，画面整体歪斜", k: "dutch angle 斜" },
            { n: "侧脸", t: "侧面机位，只看侧脸轮廓", k: "profile side 侧面" },
            { n: "正脸", t: "正面机位，人物直视镜头", k: "frontal front" },
            { n: "背面", t: "背面机位，只看见后脑和背影", k: "back 背影" },
            { n: "越肩", t: "机位在人物肩后，越过肩膀看向前方", k: "over shoulder" },
            { n: "贴地机位", t: "机位几乎贴着地面，前景压过脚边", k: "ground level 地面" },
            { n: "门缝视角", t: "机位透过门缝，画面两侧是暗的", k: "peeping 偷看 窥视" },
            { n: "镜中视角", t: "机位在镜子里，人物看着镜中的自己", k: "mirror 镜子" },
            { n: "车内视角", t: "机位在车厢内，隔着前挡风玻璃向前看", k: "car dash 车内" },
        ],
    },
    {
        id: "light",
        label: "光线",
        items: [
            { n: "顺光", t: "正面顺光，脸上没有阴影", k: "front light" },
            { n: "侧光", t: "侧光，脸一半亮一半暗", k: "side light" },
            { n: "侧逆光", t: "侧逆光，头发和肩膀边缘有一圈亮边", k: "rim back" },
            { n: "逆光剪影", t: "强逆光，人物只剩黑色剪影", k: "backlight silhouette 剪影" },
            { n: "轮廓光", t: "轮廓光勾出人物边线，主体和背景分开", k: "rim light 边缘光" },
            { n: "硬光", t: "硬光，影子边缘锐利", k: "hard light 生硬" },
            { n: "柔光", t: "柔光，影子和缓，过渡柔和", k: "soft light 柔和" },
            { n: "顶光", t: "顶光从正上方打下来，眼窝和鼻下都是暗的", k: "top light 顶" },
            { n: "底光", t: "光从下方往上打，脸上出现反常的阴影", k: "under light 脚光" },
            { n: "窗口自然光", t: "只有窗口的自然光，光从侧面铺进来", k: "window light 自然光" },
            { n: "烛光", t: "烛光，暖黄的小光源在脸前晃", k: "candle 火光" },
            { n: "霓虹", t: "霓虹灯的光，脸和墙上有红蓝色块", k: "neon 霓虹灯" },
            { n: "月光", t: "冷白的月光，四周很暗", k: "moonlight 夜" },
            { n: "黄金时刻", t: "黄金时刻的斜射暖光，影子拉得很长", k: "golden hour 夕阳光" },
            { n: "蓝调时刻", t: "蓝调时刻的天光，整体偏冷偏青", k: "blue hour 天光" },
            { n: "阴天散射", t: "阴天的散射光，没有明确方向", k: "overcast 阴" },
            { n: "实用光源", t: "只有场景里本来就有的灯在亮（灯管、屏幕、车灯）", k: "practical 实景光" },
            { n: "单灯硬侧", t: "单灯硬侧光，背景全黑", k: "single source 一灯" },
            { n: "高反差暗调", t: "高反差暗调，大面积暗部只有一处亮", k: "low key 暗调" },
            { n: "高调明亮", t: "高调明亮，画面几乎没有暗部", k: "high key 明亮" },
            { n: "屏幕光", t: "电视或手机屏幕的光打在脸上，忽明忽暗", k: "screen 屏幕" },
            { n: "车灯扫过", t: "车灯从旁边扫过来，一道光带划过人物", k: "headlight 车灯" },
        ],
    },
    {
        id: "frame",
        label: "构图",
        items: [
            { n: "中心构图", t: "人物居中，左右对称", k: "center 居中" },
            { n: "三分法", t: "人物站在画面三分之一线上，一侧留空", k: "rule of thirds" },
            { n: "严格对称", t: "画面严格对称，正面对称构图", k: "symmetry 对称" },
            { n: "框架构图", t: "用门框或窗框把人物框住", k: "frame 框中框" },
            { n: "前景遮挡", t: "前景有虚化的遮挡物，人从遮挡物后面露出来", k: "foreground 前景" },
            { n: "大面积留白", t: "人物偏在一边，另一边是大面积空白", k: "negative space 空白" },
            { n: "对角线", t: "画面沿对角线铺开，人物站在斜线上", k: "diagonal" },
            { n: "浅景深", t: "浅景深，人物清楚，背景化开", k: "shallow dof bokeh 虚化" },
            { n: "深焦", t: "前后都清楚，人物和环境都在焦内", k: "deep focus" },
            { n: "镜子镜像", t: "画面里有镜子，人物和镜像同框", k: "mirror" },
            { n: "头顶留白", t: "人物偏下，头顶留一大片空", k: "headroom" },
            { n: "手部前景", t: "手伸进画面做前景，浅焦虚化", k: "hand foreground" },
            { n: "双人对照", t: "两人分立画面左右，一明一暗", k: "two shot" },
            { n: "光柱浮尘", t: "逆光里有浮尘或水汽，光柱看得见", k: "dust god ray 光柱" },
        ],
    },
    {
        id: "act",
        label: "动作",
        items: [
            { n: "推门进来", t: "推开门走进来，脚步在门口顿了一下", k: "enter door 进门", m: 1 },
            { n: "转身就走", t: "说完转身就走，不回头", k: "turn leave 走", m: 1 },
            { n: "停住脚步", t: "往前走了两步又停住", k: "stop 停", m: 1 },
            { n: "猛地回头", t: "猛地回头看向身后", k: "turn back 回头", m: 1 },
            { n: "抬眼", t: "慢慢抬起眼睛看过来", k: "look up 抬头", m: 1 },
            { n: "低头", t: "低下头，视线落到地上", k: "look down", m: 1 },
            { n: "递东西", t: "把东西递到对方面前", k: "hand over 递", m: 1 },
            { n: "抓手腕", t: "一把抓住对方的手腕", k: "grab wrist 抓", m: 1 },
            { n: "甩开", t: "用力甩开对方的手", k: "shake off 甩", m: 1 },
            { n: "后退半步", t: "被逼得往后退了半步", k: "step back 后退", m: 1 },
            { n: "撞到墙", t: "后退时撞到身后的墙", k: "hit wall 撞", m: 1 },
            { n: "蹲下", t: "蹲下去捡地上的东西", k: "crouch 蹲", m: 1 },
            { n: "起身", t: "从椅子上站起来", k: "stand up 站", m: 1 },
            { n: "重重坐下", t: "重重地坐下来", k: "sit down 坐", m: 1 },
            { n: "跪下", t: "膝盖一软跪在地上", k: "kneel 跪", m: 1 },
            { n: "掀桌", t: "一把把桌上的东西全扫到地上", k: "sweep table 掀", m: 1 },
            { n: "扇巴掌", t: "抬手扇了对方一巴掌", k: "slap 打", m: 1 },
            { n: "举手机", t: "举起手机对着对方拍", k: "phone record 拍", m: 1 },
            { n: "摔手机", t: "把手机摔在地上", k: "throw phone 摔", m: 1 },
            { n: "撕纸", t: "把纸撕成两半", k: "tear 撕", m: 1 },
            { n: "按电梯", t: "快步走过去连按电梯按钮", k: "elevator 电梯", m: 1 },
            { n: "追到门口", t: "追到门口停住，人已经走远", k: "chase 追", m: 1 },
            { n: "撑伞走进雨里", t: "撑开伞，走进雨里", k: "umbrella 雨", m: 1 },
            { n: "抹脸", t: "抬手抹掉脸上的雨水", k: "wipe face 擦", m: 1 },
            { n: "拉开车门", t: "一把拉开车门坐进去", k: "car door 上车", m: 1 },
            { n: "握紧拳头", t: "垂在身侧的手慢慢握紧", k: "fist 握拳", m: 1 },
            { n: "手指发抖", t: "捏着东西的手指在发抖", k: "tremble 抖", m: 1 },
            { n: "猛地站起", t: "猛地从座位上站起来", k: "jump up 起", m: 1 },
            { n: "沉默地看着", t: "一句话不说，只是看着对方", k: "stare 看", m: 1 },
            { n: "背过身", t: "背过身去，肩膀在抖", k: "turn away 转身", m: 1 },
        ],
    },
    {
        id: "emo",
        label: "表情",
        items: [
            { n: "平静", t: "表情平静，什么都看不出来", k: "calm 平淡" },
            { n: "面无表情", t: "面无表情，眼睛也不动", k: "blank 木" },
            { n: "隐忍", t: "咬着后槽牙，把话咽回去", k: "endure 忍" },
            { n: "眼眶发红", t: "眼眶慢慢红起来，但没掉眼泪", k: "teary 红" },
            { n: "掉眼泪", t: "一滴眼泪顺着脸颊滑下来", k: "cry tear 哭" },
            { n: "强撑笑", t: "扯出一个笑，比哭还难看", k: "forced smile 假笑" },
            { n: "冷笑", t: "嘴角一挑，冷笑了一下", k: "smirk 冷" },
            { n: "讥讽", t: "眼里带着讥讽，上下打量对方", k: "mock 嘲讽" },
            { n: "震惊", t: "整个人僵住，眼睛睁大", k: "shock 惊" },
            { n: "错愕", t: "表情错愕，嘴微微张开", k: "stunned 愣" },
            { n: "慌乱", t: "眼神乱瞟，手不知道往哪放", k: "panic 慌" },
            { n: "恐惧", t: "瞳孔缩紧，呼吸变急", k: "fear 怕" },
            { n: "委屈", t: "嘴唇抖了一下，眼圈红了", k: "wronged 委屈" },
            { n: "愤怒", t: "太阳穴跳了一下，下颌绷紧", k: "angry 生气" },
            { n: "失望", t: "眼里的光一点点暗下去", k: "disappointed 失落" },
            { n: "心死", t: "眼神空掉，什么都不在意了", k: "dead inside 空" },
            { n: "得意", t: "微微抬起下巴，很得意", k: "proud 爽" },
            { n: "心虚", t: "不敢和对方对视，先移开眼", k: "guilty 虚" },
            { n: "眼神躲闪", t: "目光躲开，看向别处", k: "avoid 躲" },
            { n: "直视", t: "眼睛直直地看着对方，不躲", k: "stare 看" },
            { n: "挑眉", t: "挑了一下眉，意味不明", k: "raise brow 眉" },
            { n: "抿嘴", t: "抿紧嘴，没说话", k: "press lips 嘴" },
            { n: "长出一口气", t: "慢慢吐出一口气，肩膀落下来", k: "sigh 叹气" },
            { n: "苦笑", t: "笑了一下，摇了摇头", k: "bitter smile 苦" },
        ],
    },
    {
        id: "scene",
        label: "场景",
        items: [
            { n: "都市夜景街道", t: "都市夜景街道，招牌和路灯都亮着", k: "city night 街道 马路" },
            { n: "便利店门口", t: "便利店门口，冷白的灯光从店里透出来", k: "store 便利店" },
            { n: "老居民楼楼道", t: "老居民楼的楼道，声控灯昏黄", k: "corridor 楼道 楼梯" },
            { n: "电梯轿厢", t: "电梯轿厢里，头顶灯管发白", k: "elevator 电梯" },
            { n: "写字楼大堂", t: "写字楼大堂，大理石地面反光", k: "lobby 大堂 公司" },
            { n: "老板办公室", t: "老板办公室，落地窗外是城市", k: "office 办公室" },
            { n: "咖啡馆靠窗", t: "咖啡馆靠窗的位置，玻璃上有水汽", k: "cafe 咖啡" },
            { n: "医院走廊", t: "医院走廊，白墙和长椅，灯很亮", k: "hospital 医院" },
            { n: "学校教室", t: "学校教室，课桌排成行，窗外有树", k: "classroom 教室 学校" },
            { n: "狭小出租屋", t: "狭小的出租屋，东西堆得很满", k: "rent room 出租 小房间" },
            { n: "豪华别墅客厅", t: "豪华别墅客厅，挑高很高，家具很少", k: "villa 别墅 豪宅" },
            { n: "车厢内", t: "车厢内，前排座椅挡住一半视线", k: "car interior 车内" },
            { n: "出租车后座", t: "出租车后座，车窗外灯影流动", k: "taxi 出租车" },
            { n: "菜市场", t: "菜市场，摊位上挂着灯泡", k: "market 市场 买菜" },
            { n: "工地", t: "工地，钢筋和水泥，空气里有扬尘", k: "construction 工地 打工" },
            { n: "过街天桥", t: "过街天桥上，下面是车流", k: "bridge 天桥" },
            { n: "公交站台", t: "公交站台，广告灯箱发亮", k: "bus stop 公交" },
            { n: "地下车库", t: "地下车库，柱子和车位线，灯管忽明忽暗", k: "garage parking 车库" },
            { n: "酒店房间", t: "酒店房间，窗帘半拉，床单很白", k: "hotel 酒店" },
            { n: "雨里的窄巷", t: "下着雨的窄巷，地面全是水", k: "alley rain 巷子" },
            { n: "农家院子", t: "农家院子，砖墙和晾衣绳", k: "yard 农村 院子" },
            { n: "火车站候车厅", t: "火车站候车厅，广播声混着人声", k: "station 车站 火车" },
            { n: "楼顶天台", t: "楼顶天台，栏杆和远处的天际线", k: "roof 天台" },
            { n: "空荡的房间", t: "空荡的房间，只有一张桌子和一扇窗", k: "empty room 空房" },
        ],
    },
    {
        id: "mood",
        label: "氛围",
        items: [
            { n: "电影感", t: "电影感，讲究的构图和调色", k: "cinematic 电影" },
            { n: "纪实感", t: "纪实感，像随手拍的纪录片", k: "documentary 纪实" },
            { n: "胶片颗粒", t: "有胶片颗粒，像 35mm 拍的", k: "film grain 胶片" },
            { n: "冷色调", t: "整体冷色调，青蓝为主", k: "cool tone 冷" },
            { n: "暖色调", t: "整体暖色调，橙黄为主", k: "warm tone 暖" },
            { n: "低饱和", t: "低饱和，颜色很灰", k: "desaturated 灰" },
            { n: "高饱和", t: "高饱和，颜色很浓", k: "vivid 浓" },
            { n: "柔焦", t: "柔焦，画面发软", k: "soft focus 柔" },
            { n: "霓虹赛博", t: "霓虹色块和反光地面，赛博感", k: "cyberpunk 赛博" },
            { n: "古风", t: "古风质感，木质和布料", k: "ancient 古装 国风" },
            { n: "复古DV", t: "复古 DV 画质，边缘有点糊", k: "vhs retro 复古" },
            { n: "手机随手拍", t: "手机随手拍的质感，广角有点畸变", k: "phone footage 手机" },
            { n: "黑白", t: "黑白画面", k: "bw monochrome 黑白" },
            { n: "压抑闷热", t: "空气闷热，画面发闷", k: "stuffy 闷" },
            { n: "干净通透", t: "干净通透，空气很清", k: "clean 通透" },
            { n: "潮湿发霉", t: "潮湿，墙上有霉斑和水痕", k: "damp 潮" },
        ],
    },
    {
        id: "time",
        label: "时段",
        items: [
            { n: "清晨", t: "清晨，光很薄，街上没什么人", k: "dawn morning 早" },
            { n: "正午", t: "正午，光从头顶直下来", k: "noon 中午" },
            { n: "黄昏", t: "黄昏，天边是橘红的", k: "dusk sunset 落日" },
            { n: "傍晚", t: "傍晚，天还没全黑，灯已经开了", k: "evening 入夜" },
            { n: "深夜", t: "深夜，除了几盏灯全黑", k: "midnight 夜里" },
            { n: "下小雨", t: "下着小雨，地面反光", k: "rain 雨" },
            { n: "下大雨", t: "下大雨，雨线很清楚", k: "heavy rain 暴雨" },
            { n: "雨后", t: "雨刚停，地上全是水洼", k: "after rain 雨后" },
            { n: "下雪", t: "下雪，雪花在光里飘", k: "snow 雪" },
            { n: "起雾", t: "起雾，远处看不清", k: "fog mist 雾" },
            { n: "刮风", t: "刮风，衣角和头发被吹起来", k: "wind 风" },
            { n: "阴天", t: "阴天，天是灰白的", k: "overcast 阴" },
        ],
    },
    {
        id: "audio",
        label: "声音",
        items: [
            { n: "雨声", t: "背景是连续的雨声", k: "rain sound 雨" },
            { n: "雨打车窗", t: "雨点打车窗的声音", k: "rain window 车窗" },
            { n: "电流嗡鸣", t: "有低低的电流嗡鸣", k: "buzz hum 嗡" },
            { n: "心跳声", t: "只听得见心跳声", k: "heartbeat 心跳" },
            { n: "很近的呼吸声", t: "很近的呼吸声", k: "breath 呼吸" },
            { n: "玻璃碎", t: "玻璃碎裂的声音", k: "glass break 碎" },
            { n: "脚步回响", t: "脚步声在空房间里回响", k: "footstep echo 脚步" },
            { n: "远处车流", t: "远处有持续的车流声", k: "traffic 车" },
            { n: "蝉鸣", t: "背景是蝉鸣", k: "cicada 夏天 蝉" },
            { n: "一片寂静", t: "全场寂静，只有一点环境底噪", k: "silence 安静" },
            { n: "手机振动", t: "手机在桌上振动", k: "phone buzz 震动" },
            { n: "门轴吱呀", t: "门轴发出吱呀声", k: "door creak 门" },
            { n: "人群嘈杂", t: "背景是模糊的人声嘈杂", k: "crowd murmur 人声" },
            { n: "广播声", t: "有广播报站的声音", k: "announce 广播" },
        ],
    },
    {
        id: "line",
        label: "成句",
        items: [
            {
                n: "标准叙事句",
                t: "〔景别〕，〔主体〕在〔场景〕〔动作〕，镜头〔运镜〕，〔光线〕",
                k: "template 句式 万能 通用",
            },
            {
                n: "情绪爆点",
                t: "特写，〔主体〕的脸，〔表情〕，镜头缓慢推近，背景全部虚掉，只有眼睛是清楚的",
                k: "emotion close 爆发 反应",
            },
            {
                n: "反转揭示",
                t: "中景，〔主体〕停下手上的动作，转过头，镜头同时横移让出〔揭示物〕，〔光线〕",
                k: "reveal twist 反转",
            },
            {
                n: "压迫感",
                t: "大仰拍，〔主体〕逼近镜头，画面被填满，镜头被迫跟着后退，硬光",
                k: "oppress power 压迫 气场",
            },
            {
                n: "亲密拉扯",
                t: "双人近景，两人距离很近，〔A〕抓住〔B〕的手腕，镜头轻微手持，柔和侧光",
                k: "intimate 拉扯 亲密 暧昧",
            },
            {
                n: "落差对比",
                t: "先给〔细节特写〕，再急速拉远成大远景，声音只留〔环境声〕",
                k: "contrast 对比 落差",
            },
            {
                n: "空镜过渡",
                t: "空镜，〔场景物件〕在〔光〕里，没有人物，镜头极慢地横移",
                k: "transition 过渡 空镜",
            },
            {
                n: "主观视角推近",
                t: "主观视角，镜头跟着〔主体〕的视线往前移动，看到〔所见物〕，镜头轻微晃动",
                k: "pov 主观",
            },
            {
                n: "首帧画面句",
                t: "〔景别〕，〔主体〕位于画面〔位置〕，穿〔服装〕，〔表情〕，〔环境〕，光从〔方向〕来，构图完整",
                k: "first frame 首帧 定妆 画面",
            },
            {
                n: "环境交代",
                t: "大远景，交代〔时间〕的〔地点〕，人物在画面里很小，环境细节清楚",
                k: "establishing 开场 交代",
            },
            {
                n: "收尾定格",
                t: "中景，〔主体〕〔动作〕后停住，镜头缓慢拉远，画面定格在〔状态〕",
                k: "ending 结尾 定格",
            },
            {
                n: "冲突爆发",
                t: "近景，〔A〕抬手，〔B〕侧头躲开，镜头手持紧跟，动作要快，结尾停在两人对峙的瞬间",
                k: "conflict fight 冲突 打",
            },
        ],
    },
];

/** 扁平成一张表，附带分类信息，便于搜索。 */
const ALL = [];
for (const cat of CATS) {
    for (const item of cat.items) {
        ALL.push({
            ...item,
            cat: cat.id,
            catLabel: cat.label,
            hay: `${item.n} ${item.t} ${item.k || ""} ${cat.label}`.toLowerCase(),
        });
    }
}

// ==== 样式 ================================================================

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.apl-pop{position:fixed;z-index:100400;display:flex;flex-direction:column;overflow:hidden;
  width:min(620px,94vw);max-height:min(540px,76vh);border-radius:10px;
  background:#1e1e22;color:#dcdce4;border:1px solid #3a3a44;
  box-shadow:0 18px 56px rgba(0,0,0,.55);font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.apl-pop.light{background:#fff;color:#24242c;border-color:#d5d5de;box-shadow:0 18px 48px rgba(0,0,0,.22)}
.apl-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #31313a;flex:0 0 auto}
.apl-pop.light .apl-head{border-bottom-color:#e6e6ee}
.apl-search{flex:1 1 auto;min-width:0;font:12px/1.4 inherit;padding:5px 8px;border-radius:6px;outline:none;
  background:#141417;color:#dcdce4;border:1px solid #3a3a44}
.apl-search:focus{border-color:#5ec8ff}
.apl-pop.light .apl-search{background:#f7f7fa;color:#24242c;border-color:#d5d5de}
.apl-x{all:unset;cursor:pointer;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;
  font-size:15px;opacity:.65;flex:0 0 auto}
.apl-x:hover{background:rgba(130,130,160,.22);opacity:1}
.apl-tabs{display:flex;gap:4px;padding:7px 10px 6px;overflow-x:auto;scrollbar-width:none;flex:0 0 auto;
  border-bottom:1px solid #2b2b33}
.apl-tabs::-webkit-scrollbar{display:none}
.apl-pop.light .apl-tabs{border-bottom-color:#e6e6ee}
.apl-tab{all:unset;cursor:pointer;padding:3px 9px;border-radius:99px;font-size:11px;white-space:nowrap;
  border:1px solid #3a3a44;color:#a9b0c0;background:transparent}
.apl-tab:hover{border-color:#5ec8ff;color:#dcdce4}
.apl-pop.light .apl-tab{color:#5d6472;border-color:#d5d5de}
.apl-pop.light .apl-tab:hover{color:#24242c;border-color:#2f6fd0}
.apl-tab.on{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.apl-pop.light .apl-tab.on{background:#2f6fd0;border-color:#2f6fd0;color:#fff}

.apl-list{flex:1 1 auto;min-height:200px;overflow-y:auto;overscroll-behavior:contain;padding:4px 8px 8px}
.apl-group{font-size:10px;letter-spacing:.06em;opacity:.5;padding:8px 4px 4px;position:sticky;top:0;
  background:inherit;backdrop-filter:blur(2px)}
.apl-pop.light .apl-group{background:#fff}
.apl-row{all:unset;display:block;cursor:pointer;padding:4px 8px;border-radius:6px;box-sizing:border-box;
  border:1px solid transparent;transition:background .08s}
.apl-row:hover,.apl-row.act{background:#26262c;border-color:#3a3a44}
.apl-pop.light .apl-row:hover,.apl-pop.light .apl-row.act{background:#f2f4f9;border-color:#dde0ea}
.apl-row .l1{display:flex;align-items:center;gap:6px}
.apl-row .nm{font-weight:650;font-size:11.5px}
.apl-row .tag{font-size:9px;padding:0 4px;border-radius:4px;border:1px solid #3f3f4a;opacity:.65}
.apl-row .gt{font-size:10px;opacity:.45;margin-left:auto}
.apl-row .tx{font-size:11px;opacity:.75;margin-top:1px;line-height:1.38;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.apl-empty{padding:24px 12px;text-align:center;font-size:11px;opacity:.6;line-height:1.7}
@keyframes apl-flash{0%{background:#2f6fd0aa}100%{background:transparent}}
.apl-row.flash{animation:apl-flash .34s ease-out}

.apl-foot{display:flex;align-items:center;gap:8px;padding:7px 10px;border-top:1px solid #31313a;flex:0 0 auto;
  font-size:11px}
.apl-pop.light .apl-foot{border-top-color:#e6e6ee}
.apl-foot .lb{opacity:.65;white-space:nowrap}
.apl-target{font:11px/1.4 inherit;padding:3px 5px;border-radius:5px;max-width:320px;flex:0 1 auto;outline:none;
  background:#17171a;color:#dcdce4;border:1px solid #3a3a44}
.apl-pop.light .apl-target{background:#f7f7fa;color:#24242c;border-color:#d5d5de}
.apl-hint{margin-left:auto;opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 主面板（t2v / 混合 / 分段）提示词框：绝对定位在标题行右侧，不改原布局 */
.apl-ta-btn{all:unset;position:absolute;top:0;right:0;cursor:pointer;font-size:10px;line-height:1;
  padding:2px 5px;border-radius:5px;border:1px solid #3d3d48;color:#9aa3b6;background:#1b1b20;
  z-index:2;opacity:.75;transition:opacity .1s}
.apl-ta-btn:hover{border-color:#5ec8ff;color:#5ec8ff;opacity:1}
.light .apl-ta-btn,.light-theme .apl-ta-btn{background:#f4f5f9;border-color:#d5d5de;color:#5d6472}
.light .apl-ta-btn:hover,.light-theme .apl-ta-btn:hover{border-color:#2f6fd0;color:#2f6fd0}

/* 输入框右上角的触发按钮 */
.bd-fl2v-promptcell .fp-lib-btn{all:unset;cursor:pointer;flex:0 0 auto;font-size:10px;line-height:1;
  padding:3px 6px;border-radius:5px;border:1px solid #3d3d48;color:#9aa3b6;white-space:nowrap}
.bd-fl2v-promptcell .fp-lib-btn:hover{border-color:#5ec8ff;color:#5ec8ff}
.mmx-host.light .bd-fl2v-promptcell .fp-lib-btn,.light .bd-fl2v-promptcell .fp-lib-btn{
  border-color:#cfd4e0;color:#5d6472}
.mmx-host.light .bd-fl2v-promptcell .fp-lib-btn:hover,.light .bd-fl2v-promptcell .fp-lib-btn:hover{
  border-color:#2f6fd0;color:#2f6fd0}
`;
    document.head.appendChild(st);
}

// ==== 插入逻辑 ============================================================

const BOUNDARY_TAIL = /[，,。；;、：:！!？?…\s\n]$/;
const BOUNDARY_HEAD = /^[，,。；;、：:！!？?…\s\n]/;

/** 在 textarea 光标处插入（没焦点就在末尾），自动补分隔逗号，返回新值。 */
function insertAtCaret(ta, text) {
    const text0 = String(text || "").trim();
    if (!text0) return ta.value || "";
    const val = ta.value || "";
    const focused = document.activeElement === ta;
    let start = focused ? ta.selectionStart ?? val.length : val.length;
    let end = focused ? ta.selectionEnd ?? val.length : val.length;
    if (start == null) start = val.length;
    if (end == null) end = val.length;
    const before = val.slice(0, start);
    const after = val.slice(end);
    let ins = text0;
    if (before && !BOUNDARY_TAIL.test(before)) ins = "，" + ins;
    if (after && !BOUNDARY_HEAD.test(after)) ins = ins + "，";
    const next = before + ins + after;
    ta.value = next;
    try {
        const caret = before.length + ins.length;
        ta.setSelectionRange(caret, caret);
    } catch {
        /* 有些环境不允许设选区，忽略 */
    }
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    return next;
}

/** 把一段文本追加到某个镜头的提示词（不是当前显示的那一镜时走这条）。 */
function appendToShot(editor, idx, text) {
    const shots = editor?.timeline?.shots || [];
    const shot = shots[idx];
    if (!shot) return;
    const base = String(shot.prompt || "");
    let add = String(text || "").trim();
    if (!add) return;
    if (base.trim()) {
        if (!BOUNDARY_TAIL.test(base)) add = "，" + add;
        shot.prompt = base.replace(/\s+$/, "") + add;
    } else {
        shot.prompt = add;
    }
    editor.commit?.(false, { syncTimeline: true });
    editor.scheduleRender?.();
}

/** Alt 点击：整框替换。 */
function replaceAll(ta, text) {
    ta.value = String(text || "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
}

// ==== 主面板 ==============================================================

let popEl = null; // 当前打开的浮层
let blurTimer = 0;

export function isPromptLibOpen() {
    return !!popEl;
}

export function closePromptLib() {
    if (!popEl) return;
    popEl.remove();
    popEl = null;
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onDocKey, true);
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("scroll", onWindowResize, true);
}

function onDocDown(e) {
    if (!popEl) return;
    if (popEl.contains(e.target)) return;
    closePromptLib();
}

function onDocKey(e) {
    if (!popEl) return;
    if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        closePromptLib();
    }
}

/** 窗口尺寸/滚动变化：跟着按钮重新贴一次，别直接关（关掉会让人误以为没点中）。 */
let resizeRaf = 0;
function onWindowResize(e) {
    if (!popEl) return;
    // 面板内部滚动（列表）不触发布局重算
    if (e?.type === "scroll" && popEl.contains(e.target)) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        if (!popEl) return;
        const a = popEl._anchor;
        // 按钮被重建或已经不可见 → 收起
        if (!a || !a.isConnected || a.getClientRects().length === 0) {
            closePromptLib();
            return;
        }
        placePopover(popEl, a);
    });
}

/**
 * 打开模板库。
 * @param {object} editor
 * @param {object} opts
 *   · anchor: 被点的按钮，用来定位
 *   · target: "common" 或镜头序号
 *   · onInsert(desc): 插入后的回调（可选）
 */
export function openPromptLib(editor, { anchor, target = "common", textarea = null, onInsert } = {}) {
    ensureStyle();
    closePromptLib();
    // "shot" = 跟着当前选中的镜头走
    if (target === "shot") target = Number(editor?.selectedIndex ?? 0);
    if (!Number.isFinite(Number(target)) && target !== "common") target = "common";

    const dark = isDarkTheme();
    const pop = document.createElement("div");
    pop.className = `apl-pop${dark ? "" : " light"}`;
    pop.setAttribute("role", "dialog");

    // --- 头：搜索 + 关闭 ---
    const head = document.createElement("div");
    head.className = "apl-head";
    const search = document.createElement("input");
    search.className = "apl-search";
    search.type = "text";
    search.placeholder = "搜：特写 / 仰拍 / 侧逆光 / 雨 / 抓手腕 / 反转…";
    search.spellcheck = false;
    const xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "apl-x";
    xBtn.textContent = "×";
    xBtn.title = "关闭（Esc）";
    xBtn.addEventListener("click", closePromptLib);
    head.append(search, xBtn);

    // --- 分类 tabs ---
    const tabs = document.createElement("div");
    tabs.className = "apl-tabs";
    const tabDefs = [{ id: "all", label: "全部", count: ALL.length }].concat(
        CATS.map((c) => ({ id: c.id, label: c.label, count: c.items.length }))
    );
    let activeCat = "all";
    const tabBtns = new Map();
    for (const def of tabDefs) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `apl-tab${def.id === activeCat ? " on" : ""}`;
        b.textContent = def.label;
        b.title = `${def.label} · ${def.count} 条`;
        b.addEventListener("click", () => {
            activeCat = def.id;
            for (const [id, btn] of tabBtns) btn.classList.toggle("on", id === activeCat);
            render();
            listEl.scrollTop = 0;
        });
        tabBtns.set(def.id, b);
        tabs.appendChild(b);
    }

    // --- 列表 ---
    const listEl = document.createElement("div");
    listEl.className = "apl-list";

    // --- 底：插入到 + 提示 ---
    const foot = document.createElement("div");
    foot.className = "apl-foot";
    const lb = document.createElement("span");
    lb.className = "lb";
    lb.textContent = "插入到";
    const targetSel = document.createElement("select");
    targetSel.className = "apl-target";
    const shots = editor?.timeline?.shots || [];
    const mkOpt = (v, label) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        return o;
    };
    if (textarea) {
        targetSel.appendChild(mkOpt("self", "当前输入框"));
    } else {
        targetSel.appendChild(mkOpt("common", "通用提示词（全片共用）"));
    }
    if (!textarea) {
        shots.forEach((s, i) => {
            const raw = String(s?.prompt || "").replace(/\s+/g, " ").trim();
            const p = raw.length > 9 ? raw.slice(0, 9) + "…" : raw;
            targetSel.appendChild(mkOpt(String(i), `第 ${i + 1} 镜${p ? " · " + p : ""}`));
        });
    }
    if (textarea) {
        targetSel.value = "self";
        targetSel.disabled = true;
        targetSel.title = "这个框只插入到它自己";
    } else {
        targetSel.value = String(target);
        if (targetSel.value !== String(target)) targetSel.value = "common";
    }

    const hint = document.createElement("span");
    hint.className = "apl-hint";
    hint.textContent = "Alt+点击 = 替换整框";
    foot.append(lb, targetSel, hint);

    pop.append(head, tabs, listEl, foot);

    // --- 渲染列表 ---
    let rows = []; // 当前可插入的行
    let activeIdx = 0;

    function matches(item, terms) {
        if (!terms.length) return true;
        return terms.every((w) => item.hay.includes(w));
    }

    function makeRow(item, showCat) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "apl-row";
        row.dataset.cat = item.cat;

        const l1 = document.createElement("div");
        l1.className = "l1";
        const nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = item.n;
        l1.appendChild(nm);
        if (item.m) {
            const tg = document.createElement("span");
            tg.className = "tag";
            tg.textContent = "动";
            tg.title = "主要用在运动提示词";
            l1.appendChild(tg);
        }
        // 「全部」视图已经有分组标题了，行内不再重复分类
        if (showCat) {
            const gt = document.createElement("span");
            gt.className = "gt";
            gt.textContent = item.catLabel;
            l1.appendChild(gt);
        }

        const tx = document.createElement("div");
        tx.className = "tx";
        tx.textContent = item.t;

        row.append(l1, tx);
        row.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            doInsert(item, e.altKey, row);
        });
        return row;
    }

    function render() {
        listEl.textContent = "";
        rows = [];
        activeIdx = 0;
        const terms = search.value
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);

        const pool = activeCat === "all" ? CATS : CATS.filter((c) => c.id === activeCat);
        let total = 0;
        for (const cat of pool) {
            const hit = ALL.filter(
                (it) => it.cat === cat.id && matches(it, terms)
            );
            if (!hit.length) continue;
            if (activeCat === "all" && hit.length) {
                const g = document.createElement("div");
                g.className = "apl-group";
                g.textContent = `${cat.label} · ${hit.length}`;
                listEl.appendChild(g);
            }
            for (const it of hit) {
                const rowEl = makeRow(it, activeCat !== "all");
                listEl.appendChild(rowEl);
                rows.push({ el: rowEl, item: it });
                total += 1;
            }
        }

        if (!total) {
            const empty = document.createElement("div");
            empty.className = "apl-empty";
            empty.textContent = terms.length
                ? `没找到「${search.value.trim()}」。\n试试更短的词，比如「特写」「雨」「手」。`
                : "这个分类下暂时没有内容。";
            empty.style.whiteSpace = "pre-line";
            listEl.appendChild(empty);
        }
        highlight();
    }

    function highlight() {
        for (let i = 0; i < rows.length; i += 1) {
            rows[i].el.classList.toggle("act", i === activeIdx);
        }
        rows[activeIdx]?.el.scrollIntoView({ block: "nearest" });
    }

    function doInsert(item, replace, rowEl) {
        if (rowEl) {
            rowEl.classList.remove("flash");
            void rowEl.offsetWidth;
            rowEl.classList.add("flash");
        }
        if (textarea) {
            if (replace) replaceAll(textarea, item.t);
            else insertAtCaret(textarea, item.t);
            onInsert?.({ name: item.n, cat: item.catLabel, where: "当前框" });
            return;
        }
        const raw = targetSel.value;
        const ui = editor?.fl2vUi;
        const isCommon = raw === "common";
        const idx = isCommon ? -1 : Number(raw);

        if (isCommon) {
            const ta = ui?.commonPrompt;
            if (ta) {
                if (replace) replaceAll(ta, item.t);
                else insertAtCaret(ta, item.t);
            } else {
                // 兜底：直接写数据
                const base = String(editor?.timeline?.global?.prompt || "");
                const next = replace
                    ? item.t
                    : base.trim()
                      ? base + (BOUNDARY_TAIL.test(base) ? "" : "，") + item.t
                      : item.t;
                editor.timeline.global = editor.timeline.global || { refs: [] };
                editor.timeline.global.prompt = next;
                if (editor.globalPrompt) editor.globalPrompt.value = next;
                if (editor.globalPromptWidget) editor.globalPromptWidget.value = next;
                editor.onGlobalField?.("prompt", next);
                editor.commit?.(false, { syncTimeline: true });
            }
        } else if (idx === editor?.selectedIndex && ui?.prompt) {
            if (replace) replaceAll(ui.prompt, item.t);
            else insertAtCaret(ui.prompt, item.t);
        } else {
            appendToShot(editor, idx, item.t);
        }

        onInsert?.({
            name: item.n,
            cat: item.catLabel,
            where: isCommon ? "通用" : `第 ${idx + 1} 镜`,
        });
    }

    // --- 搜索（输入即过滤） ---
    let composing = false;
    search.addEventListener("compositionstart", () => {
        composing = true;
    });
    search.addEventListener("compositionend", () => {
        composing = false;
        render();
    });
    search.addEventListener("input", () => {
        if (composing) return;
        render();
    });

    // --- 键盘：上下选、回车插入 ---
    search.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (rows.length) {
                activeIdx = (activeIdx + 1) % rows.length;
                highlight();
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (rows.length) {
                activeIdx = (activeIdx - 1 + rows.length) % rows.length;
                highlight();
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            const row = rows[activeIdx];
            if (row) doInsert(row.item, e.altKey, row.el);
        } else if (e.key === "Escape") {
            e.preventDefault();
            closePromptLib();
        }
        e.stopPropagation();
    });

    // 挂载 + 定位
    document.body.appendChild(pop);
    popEl = pop;
    pop._anchor = anchor || null;
    placePopover(pop, anchor);

    render();
    search.focus();

    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onDocKey, true);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowResize, true);
    return pop;
}

/** 贴着按钮定位：优先下方，空间不够翻到上方，再不行就贴边。 */
function placePopover(pop, anchor) {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = anchor?.getBoundingClientRect?.();
    const w = Math.min(620, vw * 0.94);
    const h = Math.min(540, vh * 0.76);

    let left = rect ? rect.right - w : vw - w - pad;
    left = Math.max(pad, Math.min(left, vw - w - pad));

    const below = rect ? rect.bottom + 6 : pad;
    const aboveTop = rect ? rect.top - h - 6 : pad;
    const roomBelow = vh - below - pad;
    const roomAbove = (rect?.top || 0) - pad;
    let top = below;
    let above = false;
    if (roomBelow < Math.min(h, 320) && roomAbove > roomBelow) {
        top = Math.max(pad, aboveTop);
        above = true;
    }
    const room = above ? roomAbove : roomBelow;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.width = `${Math.round(w)}px`;
    pop.style.maxHeight = `${Math.max(220, Math.round(Math.min(h, room)))}px`;
    return { above, maxH: room };
}

// ==== 给提示词框挂按钮 ====================================================

/**
 * 在每个提示词框（fp-head）右侧插一个「▤ 模板」按钮。
 * flushDraft 由 minimax_fl2v 注入，避免模块循环依赖。
 */
export function mountPromptLibTriggers(editor, { flushDraft } = {}) {
    const ui = editor?.fl2vUi;
    if (!ui?.promptbar) return;
    ensureStyle();

    const bind = (cell, target) => {
        if (!cell) return;
        const head = cell.querySelector(".fp-head");
        if (!head || head.querySelector(".fp-lib-btn")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fp-lib-btn";
        btn.textContent = "▤ 模板";
        btn.title = t("tooltip.promptLib") || "从模板库挑选景别/运镜/角度/光线/动作…，可搜索";
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                flushDraft?.();
            } catch {
                /* 忽略 */
            }
            // 再点一次同一个按钮 = 收起
            if (popEl && popEl._anchor === btn) {
                closePromptLib();
                return;
            }
            openPromptLib(editor, {
                anchor: btn,
                target: target === "common" ? "common" : "shot",
            });
        });
        // 免得点按钮时被画布/外层的其它手势吃掉
        btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        head.appendChild(btn);
    };

    bind(ui.commonPrompt?.closest(".bd-fl2v-promptcell"), "common");
    bind(ui.shotCell, "shot");
}

// ==== 主面板（t2v / 混合 / 分段）的提示词框 ================================
// 这些框没有 fp-head，改成在标题行右侧悬浮一个小按钮，不动原布局。
// 插入只针对它自己，和 fl2v 的「插入到第 N 镜」分开。

let autoObserver = null;
let autoTimer = 0;

export function attachPromptLibButtons(root = document) {
    ensureStyle();
    const boxes = root.querySelectorAll?.('textarea.bd-prompt[data-r]') || [];
    for (const ta of boxes) {
        if (ta._aplBound) continue;
        if (ta.hidden || ta.classList.contains("bd-prompt-negative")) continue;
        // 分镜面板的两个框有自己的按钮，别重复挂
        if (ta.closest(".bd-fl2v-promptcell")) continue;
        const host = ta.parentElement;
        if (!host) continue;
        ta._aplBound = true;
        if (getComputedStyle(host).position === "static") host.style.position = "relative";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "apl-ta-btn";
        btn.textContent = "▤ 模板";
        btn.title = t("tooltip.promptLib") || "提示词模板库";
        btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (popEl && popEl._anchor === btn) {
                closePromptLib();
                return;
            }
            openPromptLib(null, { anchor: btn, textarea: ta });
        });
        host.appendChild(btn);
    }
}

/** 面板是动态生成的，挂一个观察器自动补按钮（节流 300ms，扫一遍很轻）。 */
export function installPromptLibAutoAttach() {
    if (autoObserver) return;
    const kick = (muts) => {
        // 只有新插入的节点里带提示词框才扫，避免画布重绘时空转
        let hit = false;
        for (const m of muts || []) {
            for (const n of m.addedNodes || []) {
                if (n.nodeType !== 1) continue;
                if (n.matches?.("textarea.bd-prompt[data-r]") || n.querySelector?.("textarea.bd-prompt[data-r]")) {
                    hit = true;
                    break;
                }
            }
            if (hit) break;
        }
        if (!hit) return;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => attachPromptLibButtons(document), 300);
    };
    autoObserver = new MutationObserver(kick);
    autoObserver.observe(document.body, { childList: true, subtree: true });
    attachPromptLibButtons(document);
}
