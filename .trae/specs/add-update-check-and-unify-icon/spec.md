# 检查更新与应用图标统一 Spec

## Why

应用已有「提醒」「行情」两个模块与侧边栏外壳，但缺少版本感知：用户无法在应用内知道 Gitee 上是否发布了新版本；同时窗口 / 托盘 / Linux 打包仍在用 electron-vite 模板的默认图标，与已定稿的新图标（铃铛×走势线）不一致。本次为应用补上「手动检查更新」能力，并把图标在启动、托盘、打包三处统一为新图标。

## What Changes

- 新增「检查更新」：侧边栏**底部**入口，手动点击后由主进程匿名请求 Gitee 发行版 API，返回四类结果之一并在弹窗中呈现；发现新版本时可一键打开发行版页面（外部浏览器）。
- 新增共享契约 `src/shared/update.ts`：通道名 `UPDATE_CHANNELS`、`UpdateApi`、`UpdateCheckResult`、`ReleaseInfo`，以及纯函数 `parseRelease` / `normalizeVersion` / `compareVersions` / `isNewerVersion` / `releasePageUrl`；常量 `GITEE_OWNER` / `GITEE_REPO` / `GITEE_RELEASES_ENDPOINT`。
- 新增主进程取数层 `src/main/release-provider.ts`：`fetchLatestRelease`，带超时（默认 5000ms）与可注入 `fetchImpl`，把 HTTP 状态映射为结构化结果（含「无发行版」）。
- 新增 IPC：`registerUpdateIpc`（`src/main/ipc.ts`），在 `src/main/index.ts` 装配（版本号取自 `app.getVersion()`），preload 暴露 `window.api.update.check()`。
- 新增渲染层 `src/renderer/src/components/UpdateCheckEntry.vue`：侧边栏底部按钮（含加载态 / 折叠态图标）+ 结果弹窗。
- 统一图标：`resources/icon.png`（窗口 + 托盘）与 `build/icon.png`（Linux 打包）替换为由 `design/app-icon/assets/app-icon-bell-trend-clean.png` 派生的 512×512 PNG；`build/icon.icns`（macOS）与 `build/icon.ico`（Windows）已由同一母版生成，本次仅校验一致。
- 无 **BREAKING**：不改动既有 IPC 通道、模块行为与 `electron-builder.yml`。

## Impact

- Affected specs：`redesign-app-shell-layout`（侧边栏底部增加一个入口，外壳结构与模块导航不变）
- Affected code：
  - 新增：`src/shared/update.ts`、`src/shared/update.test.ts`、`src/main/release-provider.ts`、`src/main/release-provider.test.ts`、`src/renderer/src/components/UpdateCheckEntry.vue`
  - 修改：`src/main/ipc.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`、`src/renderer/src/components/AppSidebar.vue`
  - 替换：`resources/icon.png`、`build/icon.png`；校验：`build/icon.icns`、`build/icon.ico`

## 前置条件（用户操作，非代码改动）

1. 仓库 `xuyijie_xu/office-software` 当前为**私有**：匿名请求 Gitee API 返回 403、仓库页面 403。需在 Gitee「仓库 → 管理 → 基本信息」把可见性改为**公开**，否则「检查更新」只能返回「无法读取」。
2. 仓库当前**没有任何发行版**（`/releases` 返回 `[]`）。本次将创建一个 `v1.0.0` 发行版，否则「检查更新」只会返回「暂无发行版」。

已核实的事实（本次调查）：Gitee 发行版 API 返回字段为 `id / tag_name / target_commitish / prerelease / name / body / author / created_at / assets[]`，**没有** `html_url`，发行版页面地址需按 `https://gitee.com/{owner}/{repo}/releases/tag/{tag_name}` 自行拼接；无发行版时 `/releases/latest` 返回 404。

## ADDED Requirements

### Requirement: 检查更新入口

系统 SHALL 在侧边栏底部、「收起侧边栏」之上提供「检查更新」入口。

#### Scenario: 展开态
- **WHEN** 侧边栏为展开态
- **THEN** 底部显示带图标与「检查更新」文字的按钮

#### Scenario: 折叠态
- **WHEN** 侧边栏为折叠态
- **THEN** 该入口只显示图标，悬停时通过 Tooltip 显示「检查更新」，与模块导航项的表现一致

#### Scenario: 检查中
- **WHEN** 用户点击入口且请求尚未返回
- **THEN** 按钮进入加载态（图标旋转）并禁用，重复点击不会发起第二次请求

### Requirement: 手动检查更新

系统 SHALL 在用户点击入口时，由**主进程**向 `https://gitee.com/api/v5/repos/{owner}/{repo}/releases/latest` 发起一次匿名 GET 请求（超时 5000ms），并把结果归类为四种状态之一返回渲染层：

- `update-available`：最新发行版版本高于当前版本
- `up-to-date`：最新发行版版本等于或低于当前版本
- `no-release`：仓库尚无任何发行版（API 返回 404 且消息为未找到）
- `error`：网络失败 / 超时 / 限流（429）/ 仓库不可读（401/403）等

版本比较规则：`normalizeVersion` 去掉前导 `v`/`V` 并去除首尾空白；`compareVersions` 按 `.` 分段逐段比较，数字段按数值比较、非数字段按字典序比较，缺失段按 `0` 处理。

#### Scenario: 发现新版本
- **WHEN** 主进程取到最新发行版且 `isNewerVersion(latest, current)` 为真
- **THEN** 弹窗标题为「发现新版本」，显示新版本号、当前版本号、发布时间与发行说明正文，并提供「打开发行版页面」与「稍后」两个动作

#### Scenario: 已是最新
- **WHEN** 最新发行版版本等于或低于当前版本
- **THEN** 弹窗显示「已是最新版本」与当前版本号，仅提供关闭动作

#### Scenario: 暂无发行版
- **WHEN** 仓库尚无任何发行版
- **THEN** 弹窗显示「暂无发行版」，并说明该仓库还没有发布过任何版本

#### Scenario: 请求失败
- **WHEN** 请求因网络异常、超时、限流或仓库不可读而失败
- **THEN** 弹窗显示对应的中文原因（网络不可用 / 请求过于频繁 / 无法读取发行版 / 未知错误），且不产生未捕获异常；用户可关闭弹窗后重新点击重试

### Requirement: 打开发行版页面

系统 SHALL 允许用户在结果为「发现新版本」时通过系统默认浏览器打开发行版页面，地址为 `https://gitee.com/{owner}/{repo}/releases/tag/{tag_name}`。

#### Scenario: 打开发行版页面
- **WHEN** 用户点击「打开发行版页面」
- **THEN** 系统默认浏览器打开发行版页面，应用内不加载该页面

### Requirement: 统一应用图标

系统 SHALL 使窗口图标、托盘图标与各平台打包图标均派生自同一母版 `design/app-icon/assets/app-icon-bell-trend-clean.png`（1920×1920，RGBA，透明圆角）。

- 窗口图标（Linux）：`resources/icon.png`，512×512
- 托盘图标：与窗口图标同一文件（`createTray` 的 `iconPath`）
- Linux 打包：`build/icon.png`，512×512
- macOS 打包：`build/icon.icns`
- Windows 打包：`build/icon.ico`

#### Scenario: 启动与托盘
- **WHEN** 应用在 Linux 启动并创建托盘
- **THEN** 窗口与托盘图标均为新图标

#### Scenario: 打包
- **WHEN** 执行 `electron-builder --mac` / `--win` / `--linux`
- **THEN** 分别使用 `build/icon.icns` / `build/icon.ico` / `build/icon.png`，三者为同一母版的产物

## MODIFIED Requirements

### Requirement: 侧边栏（原 `redesign-app-shell-layout`）

侧边栏底部区域的 SHALL 在「收起侧边栏」之上增加「检查更新」入口；品牌区、模块导航、折叠开关与折叠状态持久化的行为保持不变。

#### Scenario: 底部区域
- **WHEN** 查看侧边栏底部
- **THEN** 自上而下为「检查更新」与「收起侧边栏」，两者在展开态显示文字、折叠态只显示图标

## REMOVED Requirements

无。
