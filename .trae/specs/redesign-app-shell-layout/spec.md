# 重新设计应用外壳布局 Spec

## Why

当前应用的入口是一个「顶部页签」布局：页头右侧用两个按钮在「提醒 / 行情」之间切换，页面主体直接写在
`App.vue` 中。随着后续要接入的功能模块增多，顶部页签在横向空间、模块元信息（标题 / 描述 / 图标）与页面状态管理上都会迅速拥塞，
`App.vue` 也会膨胀成「所有模块的集合体」。本次改造把入口重构为可扩展的「侧边栏 + 内容区」外壳，让新增模块只需登记一条注册表项，
而不必再改动外壳结构。

## What Changes

- **BREAKING**（内部契约，非对外 API）：把导航标识从行情专用的 `MarketPage`（`'alarms' | 'market'`）抽象为通用的
  `AppModuleId`，新增共享模块 `src/shared/navigation.ts` 作为唯一事实来源。
- 新增渲染层「模块注册表」`src/renderer/src/lib/modules.ts`，集中登记模块的 `id / 标题 / 描述 / 图标 / 组件`；外壳据此渲染导航与页面。
- 新增侧边栏组件 `AppSidebar.vue`（品牌区 + 模块导航 + 折叠开关），使用主题中已有的 sidebar 系列 token。
- 把提醒页从 `App.vue` 抽出为独立组件 `AlarmPanel.vue`（与 `MarketPanel.vue` 同级），提醒功能与交互保持不变。
- 重构 `App.vue` 为薄外壳：左侧 `AppSidebar`，右侧「顶栏（当前模块标题 / 描述）+ 内容区」，内容区按注册表渲染模块组件。
- 页面切换继续用 `v-show` 保留各模块状态；启动恢复上次停留模块、响应托盘「打开行情」切页、切换时持久化，行为保持不变。
- 侧边栏折叠状态用 `useLocalStorage` 持久化（渲染层本地存储，不经过 IPC）。
- 移除页头右侧的「提醒 / 行情」页签按钮，以及临时的「新建提醒」按钮位置（该按钮移入提醒页自身的工具条，与行情页工具条保持一致）。

## Impact

- Affected specs：`add-desktop-reminder-app`（提醒页 UI 迁移，行为不变）、`add-stock-quotes-panel`（行情页容器变化，行为不变）
- Affected code：
  - 新增：`src/shared/navigation.ts`、`src/renderer/src/lib/modules.ts`、
    `src/renderer/src/components/AppSidebar.vue`、`src/renderer/src/components/AlarmPanel.vue`
  - 修改：`src/shared/market.ts`、`src/main/market-store.ts`、`src/main/ipc.ts`、
    `src/preload/index.ts`（仅类型）、`src/renderer/src/composables/useMarket.ts`（仅类型）、
    `src/renderer/src/App.vue`

## ADDED Requirements

### Requirement: 可扩展的应用外壳

系统 SHALL 提供「左侧边栏 + 右侧内容区」的应用外壳，左侧边栏承载品牌区、模块导航与折叠开关，右侧内容区承载当前模块。

#### Scenario: 进入应用
- **WHEN** 应用启动完成
- **THEN** 左侧展示侧边栏（品牌区 + 各模块导航项 + 折叠开关），右侧展示上次停留模块的页面

#### Scenario: 切换模块
- **WHEN** 用户点击侧边栏中的某个模块导航项
- **THEN** 右侧内容区切换到该模块，对应导航项呈现选中态，其他模块页面的状态被保留而非销毁

### Requirement: 模块注册表

系统 SHALL 通过单一注册表描述每个模块的 `id`、标题、描述、图标与页面组件；渲染层导航与内容区 SHALL 由该注册表驱动。

#### Scenario: 新增模块
- **WHEN** 开发者新增一个模块
- **THEN** 只需在共享导航契约中登记模块 id，并在注册表中增加一条包含图标与组件的记录，侧边栏与内容区即自动出现该模块，无需改动外壳结构

### Requirement: 侧边栏折叠

系统 SHALL 允许用户折叠 / 展开侧边栏；折叠后 SHALL 仅保留模块图标（悬停可见名称），且折叠状态在重启后保持。

#### Scenario: 折叠与恢复
- **WHEN** 用户点击折叠开关后重启应用
- **THEN** 侧边栏保持上次的折叠 / 展开状态

## MODIFIED Requirements

### Requirement: 导航标识（原 MarketPage）

系统 SHALL 使用通用模块标识 `AppModuleId` 作为导航与「上次停留页面」的持久化类型，取代原行情专用的 `MarketPage`。

- 现有持久化数据中的值（`'alarms'`、`'market'`）仍为合法值，无需迁移。
- 设置读取时 SHALL 按 `AppModuleId` 白名单校验，非法值回退为默认模块（`'alarms'`）。
- 托盘「打开行情」发送的导航目标（`'market'`）语义不变。

#### Scenario: 兼容既有数据
- **WHEN** 磁盘上的 `market.json` 中 `settings.lastPage` 为 `'market'`
- **THEN** 应用启动后仍停留在行情模块

#### Scenario: 非法值兜底
- **WHEN** `settings.lastPage` 为超出白名单的字符串
- **THEN** 应用回退到默认模块「提醒」

### Requirement: 提醒页（原写在 App.vue 内）

提醒功能 SHALL 迁移到独立组件 `AlarmPanel.vue`，行为保持不变：列表展示、新建 / 编辑 / 删除 / 启用切换、
空状态提示、底部常驻托盘说明与新建入口均不改变；模块级操作（新建提醒）在提醒页内部提供。

#### Scenario: 提醒能力不回归
- **WHEN** 进入提醒模块
- **THEN** 用户可看到提醒列表、新建提醒、编辑 / 删除 / 启用切换，与改造前一致

### Requirement: 行情页容器

行情页 SHALL 作为外壳中的一个模块呈现，页面内部（指数卡片、自选股列表、暂停 / 刷新、数据来源说明）保持不变。

#### Scenario: 托盘切页
- **WHEN** 用户从托盘点击「打开行情」
- **THEN** 窗口显示并聚焦，右侧内容区切换到行情模块

## REMOVED Requirements

### Requirement: 页头页签导航

**Reason**：顶部两个页签按钮无法承载后续更多模块及其元信息，且与新外壳的侧边栏导航重复。

**Migration**：页签的切换能力由侧边栏导航项取代，选中态与持久化逻辑保留；「新建提醒」按钮从页头移入提醒页内部工具条。
