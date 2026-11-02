# Alber 导演台 (Alber H3 Director Console)

一个节点就能出片的 **MiniMax H3 多段时间轴导演台**，带 **Pika 双 LoRA 一键切换**。

引擎来自 **AIMixer / ComfyUI_MiniMaxH3_Director**（Apache-2.0），在其上做了「内置加载器 + 单节点成型」的重构，
再叠加 `Alber` 前缀与 Pika 模式切换条。

## 节点

| 节点 | 类型 ID | 说明 |
|---|---|---|
| **Alber 导演台 (Director Console)** | `AlberH3DirectorConsole` | **主节点**，内置模型 / LoRA / CLIP / VAE，单个节点即可出片 |
| Alber 导演台 · Refine | `AlberH3ConsoleRefine` | 二采 / 放大（可选） |
| Alber 导演台 · SelfLift | `AlberH3ConsoleSelfLift` | 渐进一采（可选） |
| Alber 导演台 · Semantic Bridge | `AlberH3ConsoleSemanticBridge` | 语义桥（可选） |
| Alber 导演台 · FaceRefine | `AlberH3ConsoleFaceRefine` | 修脸（可选） |
| Alber 导演台 · 分组（图生 / 参考生 / 合并） | `AlberH3ConsoleGroup*` | 外部多组接线（可选） |
| Alber 导演台 · Conditioning / Planner | `AlberH3ConsoleConditioning` 等 | 条件编码（可选） |

菜单分类都是 `MiniMaxH3`，搜 `alber` 或 `导演台` 都能找到。

## 内置默认模型

| 用途 | 控件 | 默认值 |
|---|---|---|
| UNET 基座 | `unet_name` | `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors` |
| 权重量化 | `weight_dtype` | `default`（int8 hybrid 基座用 default） |
| **LoRA** | `lora_name` | `pika_h3_flex_ref2va_v1_bf16.safetensors` |
| LoRA 强度 | `lora_strength` | `1.0` |
| CLIP 文本编码 | `clip_name` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| CLIP 类型 | `clip_type` | `minimax`（固定） |
| 视频 VAE | `video_vae_name` | `minimax_h3_video_vae_fp16.safetensors` |
| 音频 VAE | `audio_vae_name` | `minimax_h3_audio_vae_fp32.safetensors` |

下拉列表走 ComfyUI 的 `folder_paths`，模型放在 `models/diffusion_models`、`models/loras`、
`models/text_encoders`、`models/vae`（含 `extra_model_paths.yaml` 映射）即可。

## Pika 双 LoRA 一键切换

同一个 hybrid 基座，**靠 LoRA 决定走哪条路**，而任务模式必须配套：

| LoRA | 适用 task_type |
|---|---|
| `pika_h3_flex_fl2va_v1_bf16` | `t2v` / `i2v` / `fl2v` |
| `pika_h3_flex_ref2va_v1_bf16` | `r2v` / `v2v` / `rv2v` |

节点面板顶部有一条：

```
Pika 模式  [参考主体 ref2va] [首尾帧/文生 fl2va]   pika_h3_flex_fl2va_v1_bf16.safetensors
```

点任意一侧：

1. 直接改本节点的 `lora_name` 控件（不需要在图上追上游节点）；
2. **自动同步 `task_type`**：切 ref2va 时若当前是 t2v/i2v/fl2v → 改成 `r2v`；切 fl2va 时若是 r2v/v2v/rv2v → 改成 `fl2v`；
3. 右侧显示当前 LoRA 文件名。

两个 Pika LoRA 也被**顶到 `lora_name` 下拉列表最前面**，手动选也是一步。

找不到 LoRA 时会红字提示（例如文件没放进 `models/loras/`），不会静默失败。

## 分镜自动化（剧本分镜 + 批量首尾帧 + 提示词扩写）

首尾帧模式的分镜工具栏上多了三个入口：

| 按钮 | 干什么 | 依赖 |
|---|---|---|
| **剧本分镜** | 贴一段剧本 → 拆成镜头表（每镜：运动提示词 + 首帧画面提示词 + 时长），确认后可**追加**或**替换**时间轴 | 面板里自带模型配置（服务 / 地址 / 模型 / Key，记住上次填的，点「拉模型」可列出本机已有模型）；模型没开时用**本地快拆**（按空行/句末标点切，按字数配时长），不依赖网络 |
| **✦ 批量首尾帧** | 给整条时间轴串行出首帧/尾帧，出完自动回填槽位 | 本机 Qwen-Image 2.1，走 ComfyUI 队列（`api.queuePrompt`），不需要额外装东西 |
| **✎ 扩写** | 按 MiniMax H3 官方 task 模板扩写提示词，单条或批量，中英文输出 | 需要 LLM（Ollama / 智谱 / OpenAI 兼容），配置见下节「提示词扩写」 |

- **批量**：每行一张镜头卡，画面提示词可逐条改；「只补空槽」默认勾上（已有图的槽位跳过）；
  目标槽可选 首帧 / 尾帧 / 首尾都出；尾帧会自动接一句收尾后缀，否则首尾两张会是一模一样的图。
  一次只提交一张（16G 显存最稳），带进度条和「停止」，停止时会把队列里那张也撤掉。
- **剧本**：镜头表的首帧提示词直接存进 `shot.framePrompt`，接着点批量首帧就能一次出全片。
- `framePrompt` 现在会随 `timeline_data` 一起序列化，刷新页面不会丢。

实现：`web/js/alber_script_board.js`（前端面板）、`web/js/alber_batch_frames.js`（批量）、
`web/js/alber_frame_gen.js`（共用的出图函数 `generateFrame`）、
`director/script_split.py`（`POST /alber/director/script_to_shots`）。
**改到 Python 侧（新增路由）后要重启一次 ComfyUI**，纯前端改动硬刷新即可。

## 提示词扩写（独立面板）

首尾帧分镜工具栏的 **✎ 扩写** 打开，按 MiniMax H3 官方 task 模板把短提示词扩成完整描述。

- **模板**：`default / t2v / i2v / fl2v / r2v / v2v / rv2v` 七种，默认跟着节点当前任务类型走。
  点「查看模板」能看到官方模板全文，改了就按 `custom_template` 发出去，「恢复官方」还原。
- **单条**：左边写原句（或点「取当前镜头」「取通用」），右边出结果，可直接改；
  「应用到当前镜头」写回 `shot.prompt` 并刷新面板。
- **批量**：一次扩写整条时间轴，逐镜串行（空提示词跳过），**结果先列出来不动时间轴**，
  每条可改，确认后点「全部应用」才写回。带进度条和「停止」（当前这条跑完就停）。
- **多语言**：中文（简体）/ English。H3 官方示例和 T5 系统提示词是英文，选英文通常更贴官方效果。
- **角色特征增强**：让模型写 ≥300 汉字的详尽人物外观，适合 `r2v` / `rv2v` 这类要吃参考图的任务。
- **带参考图**：勾上会把当前镜头的首帧/尾帧一起发给模型（走 `/alber/director/image_b64`）。
  **只有 vision 模型有效**，纯文本模型别勾 —— 默认不勾。

模型配置和「剧本分镜」共用一份（`localStorage["alber.llm.config"]`），填一次两边都有；
节点上没有 `llm_*` 这些输入，所以配置不能存在节点里。

实现：`web/js/alber_enhance.js`（面板）、`web/js/alber_llm_config.js`（共用配置行）。
后端全是已有的老路由：`/alber/director/enhance`、`/enhance_models`、`/get_template`、`/image_b64`，
**不用重启 ComfyUI**。

> 注：`web/js/minimax_prompt_enhancer.js` 是上游遗留的孤儿模块，从未被 import、UI 上从来没出现过，
> 已停用（文件头有说明），能力已并入上面这个面板。

## 提示词模板库

两个提示词输入框（通用 / 专属）右上角各有一个 **▤ 模板** 按钮，弹出可搜索的分类模板列表：

| 分类 | 条数 | 内容举例 |
|---|---|---|
| 景别 | 14 | 大远景 / 中景 / 近景 / 特写 / 过肩 / 主观视角 / 空镜 |
| 运镜 | 24 | 固定机位 / 缓推 / 急推 / 跟拍 / 环绕 / 手持 / 希区柯克变焦 |
| 角度 | 15 | 平视 / 仰拍 / 俯拍 / 鸟瞰 / 荷兰角 / 贴地机位 / 门缝视角 |
| 光线 | 22 | 侧逆光 / 逆光剪影 / 硬光 / 烛光 / 霓虹 / 黄金时刻 / 高反差暗调 |
| 构图 | 14 | 三分法 / 框架构图 / 前景遮挡 / 浅景深 / 大面积留白 |
| 动作 | 30 | 推门进来 / 转身就走 / 抓手腕 / 摔手机 / 握紧拳头 / 背过身 |
| 表情 | 24 | 隐忍 / 冷笑 / 震惊 / 委屈 / 心死 / 眼神躲闪 / 苦笑 |
| 场景 | 24 | 便利店门口 / 老居民楼楼道 / 医院走廊 / 出租车后座 / 雨里的窄巷 |
| 氛围 | 16 | 电影感 / 胶片颗粒 / 冷色调 / 复古DV / 潮湿发霉 |
| 时段 | 12 | 清晨 / 黄昏 / 深夜 / 大雨 / 起雾 / 刮风 |
| 声音 | 14 | 雨打车窗 / 电流嗡鸣 / 心跳声 / 脚步回响 / 一片寂静 |
| 成句 | 12 | 情绪爆点 / 反转揭示 / 压迫感 / 亲密拉扯 / 首帧画面句 |

- **搜索**：中文名、正文、英文术语（`close-up`、`dolly in`、`golden hour`）都能命中；
  多关键词用空格分隔（`特写 雨`）。搜索时按分类分组显示结果。
- **插入**：单击 = 插到光标处（自动补逗号，可连续点选拼句子）；**Alt/⌥ + 单击 = 替换整框**。
- **选镜头**：底部「插入到」可以指定插进哪一镜，不用先切到那一镜；也可以选「通用提示词」写全片共用部分。
- 键盘：`↑` `↓` 选、`Enter` 插入、`Esc` 关闭；点空白处也关闭。
- 主面板（文生视频 / 混合 / 分段）的「提示词」框也有同一个小按钮，位置在标题行右侧，只插入到它自己。

模板内容是照着 H3 的用法写的：动作类只写「怎么动」不堆静态描写，声音类只写「现场能听到什么」（H3 会自己生成原生声音，不做后期变调），
成句类里 `〔主体〕` `〔景别〕` 是占位符，插进去再改。

实现：`web/js/alber_prompt_lib.js`（模板数据 + 面板，纯前端，不碰 Python）。

## 参数面板（可折叠）

UNET / LoRA / CLIP / VAE / 采样 / 导出 / 性能 一共二十多个下拉，原来是在节点上纵向排一长串，
节点高度轻松破千。现在全部收进 Pika 条下面的一个折叠框：

```
▶ 参数面板   模型加载 · 采样 · 导出 MP4 · 性能与缓存          28 项   接口
```

- **默认收起**，只占一行；展开状态记在节点的 `properties.alberParamBoxOpen` 里，跟着工作流走。
- 收起时节点高度会按内容收缩，把省下来的画布还给你。
- 框内按 **模型加载 / 采样 / 导出 MP4 / 性能与缓存** 四组卡片排布，两列网格（节点窄了自动单列）。
- 成片预览是节点右侧独立一列，不跟着参数框折叠，见「输出 → 成片预览列」。
- 值双向同步：框里改 = 改节点控件；Pika 切换条改 `lora_name`，框里的下拉跟着变。

实现方式不是删控件：canvas 控件仍然留在 `node.widgets` 里，只是 `computeSize` 归零、
`draw` 置空（隐身），所以**序列化、API 提交、旧工作流兼容完全不变**，
框里用的是原生 DOM 控件（`web/js/alber_param_box.js`）。

## 浅色主题

节点整块 UI 是浅色的（白底、深字、绿色强调），跟 ComfyUI 深色画布形成对比，看着不压抑。

三部分组成，**都不改原来的类名和 DOM 结构**：

| 文件 | 作用 |
|---|---|
| `web/js/alber_light_theme.css` | 覆盖层样式：300+ 条规则，把深色面板/按钮/输入框改成浅色 |
| `web/js/alber_light_theme.js` | 注入上面的 CSS + 设置节点外框配色（`bgcolor` / `color` / `title_text_color`）|
| `minimax_timeline.js`、`minimax_fl2v.js` | 画在 canvas 上的部分（标尺、轨道底色、缩略图占位）改成浅色常量 |

- 覆盖层全部带 `.mmx-host` 前缀 + `!important`，所以压得住原来的深色规则，也不影响别的节点。
- **删掉 `alber_light_theme.css` 就退回深色**，原样式一行没动。
- 那份 CSS 不是手写的，是 `_tools/gen_light_theme.py` 从现有深色样式机械推导的：
  暗面 → 近白（保留明暗层次）、暗色文字 → 深色文字、强调色保留色相只调明度，
  最后再补一段手写的层次微调。改了上游深色样式后，重跑一次脚本即可同步：

```bash
python _tools/gen_light_theme.py     # 重新生成 web/js/alber_light_theme.css
python _tools/preview_light_theme.py # 生成离线预览页，用浏览器看效果
```

## 安装

```bash
cp -r "Alber-ComfyUI-MiniMaxH3-Director" "<ComfyUI>/custom_nodes/"
pip install -r "<ComfyUI>/custom_nodes/Alber-ComfyUI-MiniMaxH3-Director/requirements.txt"
```

重启 ComfyUI → 菜单 `MiniMaxH3` → **Alber 导演台 (Director Console)**。

> 需要 ComfyUI ≥ **0.30.0**（官方 MiniMax H3 节点）。
> 默认是 T2V 空项目：无参考图、无预置提示词、124 帧 / 24fps / 864×480。
> 因为用的是独立节点 ID，装在已有原版 Director/Console 的机器上也**不需要停用任何东西**。

### 外接模型（可选）

`model`、`clip`、`video_vae`、`audio_vae` 四个输入是**可选**的：

- 不接线 → 用节点顶部的内置加载器（最省事）；
- 接线 → 以外部为准。例如 `UNETLoader → Sage Attention Patch → LoraLoader → 导演台.model`，
  这样能在保留内置 CLIP/VAE 的同时挂加速补丁。

## 输出

`images`、`audio`、`fps`、`frame_count`、`source_images`、`report`、`images_pre_refine`、`images_pre_face_refine`、**`mp4_path`**。

### 内置 MP4 直出（不需要 VHS / SaveVideo）

节点底部新增五个控件（追加在最后，不影响旧工作流控件索引），在参数框的「导出 MP4」组里：

| 控件 | 默认 | 说明 |
|---|---|---|
| **导出 MP4** | ✅ 开 | 跑完直接写一个 H.264 MP4（带 H3 原生音轨）|
| **MP4 保存目录** | 空 | 空 = `ComfyUI/output`；相对路径 = `output` 下的子目录；绝对路径 = 直接写那里，如 `G:/成片/牙膏从中间挤`（反斜杠、带引号都能识别）|
| **MP4 文件名** | `Alber导演台` | 只写名字就行；带 `/` 时前半段仍作为子目录 |
| **MP4 画质 CRF** | `18` | libx264 CRF，越小越清晰，成片建议 16–20 |
| **覆盖同名 MP4** | ⬜ 关 | 关：重名自动加 `_2` / `_3`；开：直接覆盖（播放器占用时会失败，代码里会回退到下一个可用名）|

- 文件名不再带 `_00001_`：`牙膏从中间挤.mp4`，重名才加 `_2`。
- 目录不可写（盘符不存在、权限不够）时**自动回退到 `output/`**，不会因为路径写错丢片。
- 多段 / 分段导出时，先把 `images`、`audio` 列表拼成整条时间线，再编码成**一个** mp4。
- 编码器复用 `lib/video_export.write_frames_to_mp4`（ffmpeg + libx264 + aac + `+faststart`），与「分段导出」同一套。
- 编码失败只记日志、返回空 `mp4_path`，**不会中断出片**。
- 节点已标记为输出节点（`OUTPUT_NODE`），所以画布上只留这一个节点就会执行并把 mp4 落地；
  想继续用 VHS/SaveVideo 也可以，两条路并存。

### 成片预览列（节点右侧，可折叠无关）

预览不放在参数框里，而是 **节点右侧独立的一列**（`web/js/alber_mp4_panel.js`）：

- **与时间轴等高**：`top/bottom: 6px` 贴住 host 上下边，不随参数框展开/收起变高。
- **宽度按分辨率算**：读节点里的 `width` / `height` 控件，列宽 = 可用高度 × (w ÷ h)，
  再夹在「节点宽度的 46%」以内。竖屏 768×1344 出窄列、横屏 864×480 出宽列，画面不留黑边。
  改分辨率控件会立刻重算。
- 实现方式是给 `.mmx-host` 加 `padding-right`，预览列绝对定位在 padding 区里 ——
  不动 host 的 DOM 结构，时间轴的布局逻辑一行没改。
- 首次挂载会把节点**自动补宽一次**（补上列宽），避免时间轴被硬挤窄；记在
  `properties.alberPreviewWidened`，只补一次。

列内功能：

| 元素 | 行为 |
|---|---|
| 文件名行 | 显示 `名字 · 大小 · 帧数`，**点击复制完整路径** |
| 预览区 | 出片后自动载入，可拖进度条（`/alber/director/mp4_preview`，FileResponse + Range）|
| 打开目录 | `/alber/director/open_folder`，资源管理器定位到最后一条片 |
| 刷新 | 文件被删/移走时提示「找不到」，不会一直放旧画面 |
| 新窗口 | 浏览器原生播放器打开，可全屏 |

路径记在 `node.properties.alberMp4Path`，跟着工作流走。

配套路由（`director/mp4_routes.py`）：

| 路由 | 作用 |
|---|---|
| `GET /alber/director/open_folder?path=` | 系统文件管理器打开目录（传文件则打开其父目录）|
| `GET /alber/director/mp4_preview?path=` | 按绝对路径回放 mp4，`FileResponse` + Range |
| `GET /alber/director/mp4_info?path=` | 返回是否存在 / 大小 / 修改时间 |

### 导出参数自愈（老工作流）

`widgets_values` 是按「保存当时的控件顺序」存的数组。老工作流加载到新版本节点时可能整体错位，
导出这组会拿到 `True` / `False` / `"性能"` 这种不相干的值 —— 曾经真的产出过
`output/性能/False.mp4`。

现在的处理：

- 加载时 `sanitizeExportWidgets()` 兜底纠正：`mp4_prefix` 非字符串或 `true/false/none` → 回默认名；
  `mp4_crf` 非 1–51 → 回 18；`mp4_dir` 等于标题条文字（"性能"/"采样设置"/"高级采样"）→ 清空。
- 文本框只在用户真敲过字时才提交（`dirty` 标记）。旧版是 `blur` 无条件提交，
  会把显示用的 `"false"` 写回控件，把布尔值污染成字符串。
- 后端 `_clean_name()` / CRF 校验再兜一层，非法值只 warn 并回默认。

**根治办法**：在参数框里确认一次导出设置后重新保存工作流，`widgets_values` 就会按新顺序重新生成。

## 独立节点 ID：可以和其他 Director/Console 插件共存

Alber 版用的是自己的一套类型 ID（`AlberH3DirectorConsole` / `AlberH3Console*`），
和上游原版（`H3DirectorConsole` / `H3Console*`）**完全错开**，所以：

- 本机可以同时装原版 `ComfyUI_H3_Director_Console` 和本插件，两边各自注册成功，互不抢占；
- 路由也分开：本插件 `/alber/director/*`，原版 `/h3console/director/*`；
- 前端扩展名同样分开（`Alber.*` vs `ComfyUI.*`），面板逻辑不会互相污染。

### 旧工作流怎么办：自动迁移

`web/js/alber_id_migrate.js` 在**加载工作流的那一刻**做一次类型改写：

| 情况 | 行为 |
|---|---|
| 图里是 `H3DirectorConsole`，而本机**没有**原版插件 | 自动改写为 `AlberH3DirectorConsole`，直接用 Alber 版打开 |
| 图里是 `H3DirectorConsole`，本机**装了**原版 | 原样保留，交给原版处理，Alber 不越权 |
| 新旧 ID 都不可用 | 不动，让 ComfyUI 正常报缺失节点 |

只改内存里的图，不回写文件；保存时按新 ID 存。控制台会打印
`[Alber Director] 旧节点 ID 已迁移 N 处`。

## Pika 调度：默认跑 6 步，不是 25 步

Pika H3 Flex 是把 H3 的 50 步生成器**蒸馏到 6 步**的 LoRA，并且按固定 sigma 计划训练：

| 项 | 正确值 |
|---|---|
| sigmas（ManualSigmas） | `1.0 / 0.972973 / 0.923077 / 0.8 / 0.571429 / 0.333333 / 0`（**0–1 值域**，7 个值 = 6 步） |
| 采样器 | `lcm` |
| CFG | `1.0` |
| LoRA 强度 | `1.0` |
| shift | video 12 / audio 3 |

> ⚠️ **不要写成 `1000 / 750 / 500 / ...`**。H3 是 flow matching，sigma 值域是 0–1；
> 传 1000 级的值会让 DiT 的 timestep 反演整个错位，第一步就发散成 NaN —— 采样器不报错、
> 帧数音轨全正常，成片却是纯黑 mp4（NaN→uint8 静默变 0）。`core_sampling` 里已加兜底：
> 检测到 sigma 最大值 >10 会告警并自动 ÷1000 换算。

用通用采样器跑 25 步不仅慢约 4 倍，还偏离蒸馏计划，画质并不会更好。

节点上的 **`Pika 调度`** 控件：

- **自动（按 LoRA）**（默认）：`lora_name` 里含 `pika` → 自动套上面的 6 步计划并强制 `lcm`；
- **强制 Pika 6 步**：无视 LoRA 名，一律 6 步；
- **关闭（用步数/调度器）**：完全按你在「高级采样」里填的步数 + 调度器走。

接上 `sigmas` 输入口时以你的 sigmas 为准，本项不生效。
启用时控制台打印 `Pika 6 步调度已启用：lcm + ManualSigmas ...`。

> 参考：ComfyUI 官方文档 Pika H3 Flex 工作流（6 步 / lcm / CFG 1.0 / 不要叠加 turbo、Lightning 等加速 LoRA）。

## 说明

- 衍生自 AIMixer 原项目，保留 Apache-2.0 许可证与版权声明，详见 `LICENSE` 和 `NOTICE`。
- 路由命名空间为 `/alber/director/*`。
- 若同时装了其他会改写 H3 布局的插件（如 `minimax-h3-motion-director`、旧版 Motion Context），
  只要对方补丁能通过内置自检，导演台会叠加工作；若日志提示 `layout self-test failed` 或连续性明显错位，
  请禁用那个插件后重启。
