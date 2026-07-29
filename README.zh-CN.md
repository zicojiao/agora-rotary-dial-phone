# Agora Rotary Dial Phone

一个使用 Three.js 构建、由 Agora Conversational AI 驱动的交互式旋转拨号电话。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Agora](https://img.shields.io/badge/Agora-Conversational_AI-099DFD)](https://www.agora.io/en/products/conversational-ai-engine/)

[English](./README.md) · **简体中文**

**[在线体验 →](https://rotary-dial-phone.vercel.app)**

[![Agora Rotary Dial Phone 界面](docs/images/agora-rotary-dial-phone.png)](https://rotary-dial-phone.vercel.app)

拿起听筒，拨打 `555-0193`，即可与 Elon 风格的 AI 进行实时对话。每个数字都必须
转到金属限位器，等拨盘回转后才会完成输入，就像使用真实的旋转拨号电话一样。

## 亮点

- **程序化 3D 场景** — 使用 Three.js 渲染 Art Deco 电话、桌面布景、材质和
  联系卡片。
- **拟真旋转拨号** — 支持拨号孔交互、金属限位检测、回转运动、脉冲计数和机械音效。
- **实时语音通话** — 通过 Agora RTC 传输麦克风和远端 AI 音频，并可通过 RTM
  实时更新状态。
- **稳定的通话生命周期** — 包含签名通话凭证、Token 续期、授权挂断、超时处理和
  统一清理流程。
- **响应式交互** — 同时适配桌面和移动端，并明确展示加载、权限、连接和错误状态。

## 工作原理

1. 拿起听筒，接通线路。
2. 将拨盘上的每个数字拖到金属限位器，然后松开。
3. 完整拨出 `555-0193` 后，服务端创建独立的 Agora 频道并返回与频道绑定的凭证。
4. Conversational AI Agent 加入通话，五分钟倒计时开始。
5. 挂断、离开页面、通话超时或发生错误时，系统会释放 Agent、RTC/RTM 客户端、
   麦克风、听筒和拨盘状态。

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- pnpm 11.6.0
- 一个包含 App ID 和 App Certificate 的 [Agora](https://console.agora.io/) 项目
- 一个 [Fish Audio](https://fish.audio/) API Key
- 支持 WebGL、Web Audio 和麦克风的浏览器

### 本地运行

```bash
git clone https://github.com/zicojiao/agora-rotary-dial-phone.git
cd agora-rotary-dial-phone
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

配置 `.env.local` 后，打开 [http://localhost:3000](http://localhost:3000)，
拿起听筒并拨打 `555-0193`。

> 生产环境中的麦克风权限需要 HTTPS；浏览器允许在 `localhost` 上进行本地开发。

## 环境变量

| 变量 | 使用范围 | 是否必需 | 用途 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_AGORA_APP_ID` | 浏览器和服务端 | 是 | Agora 项目 App ID；按设计可公开 |
| `NEXT_AGORA_APP_CERTIFICATE` | 仅服务端 | 是 | 签发 Agora RTC 和 RTM Token |
| `NEXT_PUBLIC_AGENT_UID` | 浏览器和服务端 | 否 | Agent RTC UID；默认值为 `123456` |
| `FISH_AUDIO_API_KEY` | 仅服务端 | 是 | 授权 Fish Audio TTS 请求 |
| `CALL_TICKET_SECRET` | 仅服务端 | 是 | 签发通话和 Agent 停止凭证 |

使用以下命令生成通话凭证密钥：

```bash
openssl rand -hex 32
```

声音选择和 Fish Audio 后端配置位于
[`lib/fishAudio.ts`](lib/fishAudio.ts)。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| [`app/`](app/) | Next.js 页面外壳和仅服务端使用的通话 API 路由 |
| [`components/`](components/) | React 通话编排、RTC 运行时和状态界面 |
| [`src/`](src/) | Three.js 场景、程序化电话、拨号物理、音频和浏览器事件 |
| [`lib/`](lib/) | Agora 配置、Fish Audio 设置和签名通话凭证 |
| [`spec/`](spec/) | 物理交互、生命周期、安全性、麦克风和 API 契约测试 |

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod
```

测试使用模拟的通话创建流程，不会启动真实的 Agora 或 Fish Audio 会话。

## 部署

将项目部署到 Vercel 或其他支持 Next.js 的平台，然后添加所需的环境变量。

自行托管时，运行 `pnpm build`，然后运行 `pnpm start`。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
