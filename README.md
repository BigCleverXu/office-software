# reminder-app

桌面端效率工具，把「定时提醒、A 股行情、随手便签」收进一个常驻托盘的小窗口。

## 项目概述

应用采用 Electron + Vue 3 + TypeScript 构建，主进程负责数据持久化、系统通知、行情调度与版本检查，渲染层只做展示与交互。

### 功能模块

| 模块 | 说明 |
| --- | --- |
| 提醒 | 设定时间与重复规则，到点弹出系统通知 |
| 行情 | 大盘指数与自选股快照，交易时段自动刷新，休市自动暂停 |
| 便签 | 本地记录、置顶与检索 |
| 设置 | 主题切换、数据管理与手动检查更新 |

其他能力：

- 系统托盘常驻，关闭窗口默认隐藏到托盘
- 自动检查更新：启动 10 秒后首检、之后每 4 小时一次；发现新版本全局弹窗提醒，同一版本在一次运行内只提醒一次，窗口隐藏时延迟到下次显示再弹出
- 页面状态记忆：重新打开应用会回到上次停留的模块

### 技术栈

| 类别 | 选型 |
| --- | --- |
| 运行时 | Electron 39 |
| 界面 | Vue 3 + TypeScript + Tailwind CSS 4 + shadcn-vue（reka-ui） |
| 图标 | lucide-vue-next |
| 工具库 | VueUse |
| 构建 | electron-vite 5 + electron-builder |
| 测试 | Vitest |
| 存储 | SQLite（Node 内置 `node:sqlite`） |

### 目录结构

```text
src/
├─ main/       # 主进程：窗口、托盘、数据库、行情调度、更新检查
├─ preload/    # 预加载脚本：向渲染层暴露受限 API
├─ renderer/   # 渲染层：Vue 组件、composables、样式
└─ shared/     # 主进程与渲染层共用的类型、常量与纯函数
```

## 注意事项

- **关闭窗口不会退出应用**。点击关闭按钮只是隐藏到托盘，提醒与行情仍会继续运行；需要彻底退出请使用托盘菜单中的「退出」。
- **提醒依赖系统通知权限**。首次使用时若系统未授权通知，到点提醒将不可见，请在系统设置中允许本应用发送通知；应用需保持运行（可最小化到托盘）。
- **数据保存在本地**。数据库文件为 `office-software.db`，位于 Electron 的 `userData` 目录（例如 Windows 的 `%APPDATA%/reminder-app`、macOS 的 `~/Library/Application Support/reminder-app`）。卸载或手动清理该目录会导致提醒、便签与自选股丢失，重要数据请自行备份。
- **行情数据仅供参考**。数据来自第三方公开接口，可能存在延迟、停牌或无数据的情况，完整条款见下方「免责声明」。
- **安装包未做代码签名**。构建产物由 CI 生成，macOS / Windows 首次运行时可能提示「未知开发者」，需要手动允许后运行。
- **检查更新需要联网**。无法访问 `api.github.com` 时，后台自动检查会静默失败，不会打扰使用；可在设置页手动重试查看具体原因。
- **开发环境版本**。CI 使用 Node.js 22 与 pnpm 10，本地请保持一致，避免 `node:sqlite` 等内置能力不可用。

## 速率限制

### GitHub Releases API（检查更新）

- 检查更新调用 `GET https://api.github.com/repos/BigCleverXu/office-software/releases/latest`，请求未携带任何凭据。
- GitHub 对未认证请求的限制为**每个出口 IP 每小时 60 次**，限制按 IP 统计，与设备数量无关。
- 应用默认在启动 10 秒后首检，之后每 4 小时检查一次，每天约 6 次；设置页的手动检查与自动检查使用同一接口，会额外消耗额度。
- 正常使用远低于上限；若同一网络下多台设备频繁手动检查，或出口 IP 被其他程序大量占用，可能触发限制。此时接口返回 `429`，界面提示「请求过于频繁，请稍后再试」，后台自动检查则静默跳过本次。
- 所有请求超时为 5 秒，失败会归因为网络不可用、超时、限流、发行版信息不可读或未知错误。

### 腾讯行情接口（行情刷新）

- 行情请求地址为 `https://qt.gtimg.cn/q=...`，多只标的会拼接为**一次批量请求**，不会按股票逐只请求。
- A 股交易时段（周一至周五 09:30–11:30、13:00–15:00）每 **3 秒**刷新一次；开盘前 1 分钟开始预热；休市、午休与非交易日不请求。
- 连续失败 3 次后进入退避，刷新间隔降为 **30 秒**，恢复成功后回到 3 秒；单次请求超时 5 秒。
- 行情页支持「暂停刷新」，暂停期间不发起任何请求；托盘提示文本每 10 秒更新一次，但不额外请求行情接口。
- 请勿修改刷新频率或绕过批量请求逻辑，过度请求可能被数据源限流或封禁 IP。

## 免责声明

- 本软件按「现状」提供，不附带任何明示或默示的担保，包括但不限于适销性、特定用途适用性与非侵权担保。
- 行情数据来自第三方公开接口，仅作信息展示，可能存在延迟、缺失、错误或中断；不构成任何投资建议或要约，据此作出的任何决策及后果由使用者自行承担。
- 提醒功能依赖系统通知权限、应用运行状态与系统调度，可能因系统限制、休眠、勿扰模式等原因延迟或漏发；请勿将本软件作为医疗、安全等高风险场景下的唯一提醒手段。
- 所有数据存储于用户本地，因卸载、清理、磁盘故障或误操作导致的数据丢失，作者不承担赔偿责任。
- 在适用法律允许的最大范围内，作者及贡献者不对使用或无法使用本软件所产生的任何直接、间接、偶然或后果性损失承担责任。
- 第三方接口、商标与内容的权利归其各自所有者，本软件与其无隶属或背书关系。

## 开发与构建

### 环境要求

- Node.js 22
- pnpm 10

### 安装与开发

```bash
pnpm install
pnpm dev
```

### 检查与测试

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

### 打包

```bash
# Windows
pnpm run build:win

# macOS
pnpm run build:mac

# Linux
pnpm run build:linux
```

推送 `v*` 标签会触发 GitHub Actions 构建三端安装包并发布 Release；版本号以 `package.json` 为准。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
