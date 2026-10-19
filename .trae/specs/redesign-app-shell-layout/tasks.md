# Tasks

- [x] Task 1: 抽象通用导航契约（主进程 / preload / 共享层）
  - [x] SubTask 1.1: 新增 `src/shared/navigation.ts`，定义 `AppModuleId`（`'alarms' | 'market'`）、`APP_MODULE_IDS`、`DEFAULT_MODULE` 与 `isAppModuleId` 白名单校验
  - [x] SubTask 1.2: 修改 `src/shared/market.ts`，删除 `MarketPage`，改用 `AppModuleId`：`MarketSettings.lastPage`、`MarketApi.setLastPage`、`MarketApi.onNavigate` 三处
  - [x] SubTask 1.3: 修改 `src/main/market-store.ts`，`normalizeSettings` 用 `isAppModuleId` 白名单校验 `lastPage`，非法回落 `DEFAULT_MODULE`；`setLastPage` 参数类型改为 `AppModuleId`
  - [x] SubTask 1.4: 修改 `src/main/ipc.ts`，`setLastPage` 处理函数参数类型改为 `AppModuleId`
  - [x] SubTask 1.5: 修改 `src/preload/index.ts` 与 `src/preload/index.d.ts` 中的类型引用（`MarketPage` → `AppModuleId`），运行时行为不变
  - [x] SubTask 1.6: 运行 `pnpm run typecheck` 与 `pnpm run test`，确认类型与既有单测通过（含 `market-scheduler.test.ts` 中的 `lastPage: 'market'`）

- [x] Task 2: 渲染层模块注册表与侧边栏组件（依赖 Task 1）
  - [x] SubTask 2.1: 新增 `src/renderer/src/lib/modules.ts`，登记 `MODULES`（id / 标题 / 描述 / lucide 图标 / 页面组件），并导出按 id 查找的辅助方法
  - [x] SubTask 2.2: 新增 `src/renderer/src/components/AppSidebar.vue`，实现品牌区 + 模块导航（选中态用 sidebar-accent token，折叠时用 Tooltip 显示名称）+ 底部折叠开关；折叠宽度过渡平滑
  - [x] SubTask 2.3: 侧边栏图标全部取自 `lucide-vue-next`，不使用内联 SVG；每行 ≤80 字符、单引号、无分号

- [x] Task 3: 抽出提醒页并将 App.vue 重构为外壳（依赖 Task 1、Task 2）
  - [x] SubTask 3.1: 新增 `src/renderer/src/components/AlarmPanel.vue`，把现有提醒页逻辑与模板从 `App.vue` 迁移进来（`useAlarms` + `AlarmFormDialog` + 卡片列表 + 空状态 + 底部说明），并在页内工具条提供「新建提醒」入口，行为与改造前一致
  - [x] SubTask 3.2: 重构 `src/renderer/src/App.vue` 为薄外壳：`TooltipProvider` + 左侧 `AppSidebar` + 右侧「顶栏（当前模块标题 / 描述）+ 内容区」；内容区按 `MODULES` 用 `<component :is>` 配合 `v-show` 渲染，保留各模块状态
  - [x] SubTask 3.3: 在 `App.vue` 中：启动用 `window.api.market.getState()` 恢复 `settings.lastPage` 作为当前模块；订阅 `onNavigate` 响应托盘切页；切换时调用 `setLastPage` 持久化；折叠状态用 `useLocalStorage` 持久化
  - [x] SubTask 3.4: 修改 `src/renderer/src/composables/useMarket.ts` 的类型引用（`MarketPage` → `AppModuleId`），行为不变

- [x] Task 4: 全量验证（依赖 Task 1-3）
  - [x] SubTask 4.1: 运行 `pnpm run lint` 并修复问题（≤80 列、单引号、无分号、无内联样式）
  - [x] SubTask 4.2: 运行 `pnpm run typecheck`（node + web）并修复类型错误
  - [x] SubTask 4.3: 运行 `pnpm run test`，确认既有提醒与行情单测全部通过
  - [x] SubTask 4.4: 运行 `pnpm run build`，确认 main / preload / renderer 三端构建成功

- [x] Task 5: 界面验收（依赖 Task 3，可与 Task 4 并行）
  - [x] SubTask 5.1: 启动预览构建产物，核对侧边栏导航、选中态、折叠 / 展开与过渡、顶栏模块标题
  - [x] SubTask 5.2: 核对模块切换保留状态（提醒与行情各自状态不被重置）与恢复上次模块
  - [x] SubTask 5.3: 核对窄窗口下不破版：行情表格横向可滚动、指数卡片网格正常

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 1、Task 2
- Task 4 依赖 Task 1-3
- Task 5 依赖 Task 3，可与 Task 4 并行
