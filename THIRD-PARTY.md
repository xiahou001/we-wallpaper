# 第三方组件归属(THIRD-PARTY NOTICE)

本项目包含/借鉴以下第三方开源组件,谨此致谢。

## 1. WebWallGL 渲染页(`vendor/webwallgl/`)

- 上游项目:https://github.com/oneincase/webwallgl
- 经由:https://github.com/elysia395/dsh-wallpaper-engine (`lib/webwallgl/`,版本 2.0.2,commit `cd56f801`)
- 许可:MIT License(原文见下)

Scene 类型 Wallpaper Engine 壁纸的实时渲染由该引擎完成,本项目未修改其渲染逻辑,
仅以原始构建产物形式随包分发并按上游约定的 `/wallpaper-engine/scene-live/` 前缀挂载。

## 2. dsh-wallpaper-engine(架构参考与协议来源)

- 项目:https://github.com/elysia395/dsh-wallpaper-engine
- 许可:MIT License(原文见下)

本项目的以下设计借鉴自该项目:Steam 工坊扫描与 scene.pkg 探测策略、
场景载荷 token(base64url)与 `/scene-files` 服务协议、WebWallGL 渲染页的
URL 参数协议(`type/fit/sceneFps/muted/src/mediaBase`)、
"主题跟随/可读性"与"遮挡暂停/帧率上限"等功能设计。
本项目宿主实现(server.mjs、播放页、工作台、注入层)为独立编写,未复制其源码。

## MIT License 原文(适用于上述两个组件)

MIT License

Copyright (c) 2026 elysia395

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 其他

- Wallpaper Engine 及其创意工坊内容由 Valve Corporation 与相应壁纸作者所有;
  本项目仅读取用户已通过 Steam 正常下载的本地文件,不分发任何壁纸内容。
- ZCode 为其所属方的产品;本项目的客户端集成工具为独立的社区第三方工具,
  与 ZCode 官方无关,使用者需自行承担相应风险。
