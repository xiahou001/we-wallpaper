# we-wallpaper

把本地 [Wallpaper Engine](https://www.wallpaperengine.io/) 创意工坊壁纸变成动态背景的独立工作台 —— 支持 **Scene 实时渲染**(内置 WebWallGL 引擎)、**视频/图片壁纸**、**嵌入 ZCode 等基于 Electron 的应用作为聊天窗口背景**,并自带一个 DSH 风格的壁纸管理工作台。

> 灵感与核心渲染能力来自 [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)(MIT)与其内置的 [WebWallGL](https://github.com/oneincase/webwallgl) 引擎(MIT)。本项目是独立重写的宿主实现,与原项目无隶属关系。

## 功能

- **壁纸渲染**:Scene 壁纸由内置 WebWallGL 实时渲染(粒子/骨骼/SceneScript/包内音频/鼠标交互);video 与 image 壁纸直接播放
- **壁纸工作台**(`/workbench`):当前壁纸、选择网格、**自定义壁纸上传**(图片/视频)、外观调节、轮播列表、过场与省电设置
- **智能可读性**:实时采样壁纸画面亮度,亮壁纸自动切换深色文字 + 浅玻璃,暗壁纸反之(源自 DSH 的"主题跟随/可读性下限"思路)
- **文字描边 / 界面缩放 / 壁纸亮度**:全部滑杆即时生效(样式 5 秒热更新)
- **切换过场**:换壁纸时新旧画面交叉淡化(无/600/1800/3000ms)
- **自动轮转 + 轮播列表**:新建/编辑/删除轮播列表,按列表定时轮换
- **省电**:遮挡暂停三档(从不 / 切走·最小化 / 失焦即停)、场景帧率上限(15/30/60fps)
- **ZCode 深度集成(可选)**:把壁纸层注入 ZCode 桌面客户端(Electron 应用)的聊天窗口背景,并在其设置页添加 Wallpaper 入口

## 环境要求

- Node.js ≥ 18(零 npm 依赖)
- Windows + Steam:创意工坊已下载 Wallpaper Engine 壁纸(**无需安装 Wallpaper Engine 本体**,壁纸文件即所需全部)
- 可选:任何 image / video 文件可作为自定义壁纸上传
- 可选(深度集成):ZCode Desktop(Electron)客户端

## 快速开始

```cmd
git clone https://github.com/<you>/we-wallpaper.git
cd we-wallpaper
node server.mjs
```

打开 <http://127.0.0.1:7396> —— 全屏播放,右下角 🖼 打开工作台,或直接访问 <http://127.0.0.1:7396/workbench>。

服务器自动扫描 Steam 库中的 `steamapps/workshop/content/431960`(Wallpaper Engine 工坊)。手动下载的壁纸包(含 `project.json` 的目录)可通过 `~/.we-wallpaper/state.json` 的 `workshopDirs` 数组追加,再 `POST /api/scan`。

### 开机自启(可选)

把 `autostart.vbs` 放入 `shell:startup` 文件夹(Win+R → `shell:startup`),登录后服务器自动隐藏运行。

## 嵌入 Electron 应用聊天窗口(以 ZCode Desktop 为例)

> ⚠️ 此操作修改本地客户端资源(原文件不被改动、随时可恢复),属非官方玩法,应用更新后需重跑一遍。请自担风险。

```cmd
apply.cmd     rem 解包 resources/app + 注入壁纸层加载器(幂等,可重复执行)
restore.cmd   rem 一键恢复原生界面
```

刷新/重启客户端后:聊天窗口背景即为动态壁纸,右下角出现 🖼 按钮打开工作台;若客户端支持自定义设置页注入,设置侧边栏也会出现 **Wallpaper** 条目。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/wallpapers` | 壁纸清单(含预览图、类型、可播性) |
| GET | `/api/state` | 当前状态(选中/暂停/音量/外观/亮度采样等) |
| POST | `/api/select` `{id}` | 切换壁纸 |
| POST | `/api/close` | 关闭壁纸层 |
| POST | `/api/pause` `{paused}` | 暂停 / 恢复 |
| POST | `/api/volume` `{volume}` | 音量 0~1 |
| POST | `/api/rotate` `{enabled,intervalMin,playlist}` | 自动轮转 |
| POST | `/api/playlists` `{name,ids}` / `/api/playlists/delete` `{name}` | 轮播列表管理 |
| POST | `/api/transition` `{ms}` | 交叉淡化时长 |
| POST | `/api/appearance` `{main,row,sidebar,stroke,brightness,zoom}` | 外观(玻璃α/描边/亮度/缩放) |
| POST | `/api/readability` `{auto}` | 智能可读性开关 |
| POST | `/api/luminance` `{v}` | 播放器亮度采样上报(0~1) |
| POST | `/api/advanced` `{occlusion,sceneFps}` | 遮挡暂停 / 帧率上限 |
| POST | `/api/upload?filename=x` | 上传自定义壁纸(原始字节体) |
| POST | `/api/scan` | 重新扫描壁纸库 |

## 目录结构

```
server.mjs            零依赖 HTTP 服务器:扫描/清单/静态服务/全部 API
public/player.*       全屏播放页(工作台控制之外的自用形态)
public/workbench.*    DSH 式壁纸工作台(左导航 + 四分区)
public/embed.js       客户端注入脚本:壁纸层 + 样式热更新 + 设置页钩子
public/panel.js       聊天窗口内的按钮与工作台模态入口
public/embed.css      动态生成的界面样式(玻璃α/描边/亮度/缩放,由服务器按状态输出)
vendor/webwallgl/     内置 WebWallGL 渲染页(上游 MIT,见 THIRD-PARTY.md)
asar-extract.js 等    ZCode 客户端集成工具(可选)
```

## 许可

本项目以 [MIT](LICENSE) 协议开源。第三方组件归属见 [THIRD-PARTY.md](THIRD-PARTY.md)。

## 致谢

- [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) —— 架构思路(场景载荷 token 协议、降级链、可读性/主题跟随、省电三档)的来源
- [oneincase/webwallgl](https://github.com/oneincase/webwallgl) —— Scene 壁纸实时渲染引擎
