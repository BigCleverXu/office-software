# Tasks

- [x] Task 1: 共享更新契约与纯函数（无依赖，可与 Task 4 并行）
  - [x] SubTask 1.1: 新增 `src/shared/update.ts`——`UPDATE_CHANNELS.check`（`'update:check'`）；常量 `GITEE_OWNER = 'xuyijie_xu'`、`GITEE_REPO = 'office-software'`、`GITEE_RELEASES_ENDPOINT`；类型 `ReleaseInfo`（`version / tag / title / notes / publishedAt / pageUrl`）、`UpdateErrorReason`（`'network' | 'timeout' | 'rate-limited' | 'unreadable' | 'unknown'`）、`UpdateCheckResult`（四态判别联合，均带 `currentVersion`）、`UpdateApi`
  - [x] SubTask 1.2: 在同文件实现纯函数：`normalizeVersion`、`compareVersions`、`isNewerVersion`、`parseRelease(payload, owner, repo)`（snake_case → `ReleaseInfo`，缺 `tag_name` 返回 `null`）、`releasePageUrl(owner, repo, tag)`
  - [x] SubTask 1.3: 新增 `src/shared/update.test.ts`，覆盖：`normalizeVersion('v1.0.0')`、`compareVersions` 的相等 / 更高 / 更低 / 段数不同（`1.0` vs `1.0.0`）/ 数值段（`1.0.10` vs `1.0.9`）/ 非数字段，`isNewerVersion`，`parseRelease` 的正常与缺字段用例，`releasePageUrl`
  - [x] SubTask 1.4: 运行 `pnpm run test`，确认新单测与既有单测全部通过

- [x] Task 2: 主进程取数层 + IPC + preload（依赖 Task 1）
  - [x] SubTask 2.1: 新增 `src/main/release-provider.ts`——`fetchLatestRelease(options)`：`options = { timeoutMs?: number; fetchImpl?: typeof fetch }`，默认超时 5000ms、默认全局 `fetch`；用 `AbortController` 超时；返回判别联合 `{ ok: true; release: ReleaseInfo | null } | { ok: false; reason: UpdateErrorReason }`（404 且响应体消息含未找到 → `release: null`；429 → `'rate-limited'`；401/403 → `'unreadable'`；`AbortError` → `'timeout'`；其余 → `'network'`/`'unknown'`）；复用 `quote-provider.ts` 的写法（不新增依赖）
  - [x] SubTask 2.2: 新增 `src/main/release-provider.test.ts`，用注入的 `fetchImpl` 覆盖：正常返回、无发行版（404）、限流（429）、不可读（403）、超时/网络异常
  - [x] SubTask 2.3: 在 `src/main/ipc.ts` 新增 `registerUpdateIpc(deps: { getVersion: () => string; fetchRelease?: () => Promise<ReleaseFetchResult> })`，`ipcMain.handle(UPDATE_CHANNELS.check, ...)`：取最新发行版 → 用 `isNewerVersion` 归类为 `update-available` / `up-to-date`，无发行版 → `no-release`，失败 → `error`；任何异常都要被捕获并转成 `error` 结果，不向渲染层抛错
  - [x] SubTask 2.4: 在 `src/main/index.ts` 的 `app.whenReady()` 中调用 `registerUpdateIpc({ getVersion: () => app.getVersion() })`
  - [x] SubTask 2.5: `src/preload/index.ts` 增加 `const update: UpdateApi = { check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check) }` 并加入 `api` 对象；`src/preload/index.d.ts` 的 `Window.api` 增加 `update: UpdateApi`
  - [x] SubTask 2.6: 运行 `pnpm run typecheck` 与 `pnpm run test`，确认通过

- [x] Task 3: 渲染层入口与结果弹窗（依赖 Task 2）
  - [x] SubTask 3.1: 新增 `src/renderer/src/components/UpdateCheckEntry.vue`——props `{ collapsed: boolean }`；底部按钮用 `lucide-vue-next` 的 `DownloadCloud` 图标 + 「检查更新」文字（折叠态只显图标 + Tooltip + `aria-label`，样式对齐 `AppSidebar` 的「收起侧边栏」按钮）；点击后置 `checking` 并 `await window.api.update.check()`，期间按钮禁用且图标旋转（`Loader2` + `animate-spin`）
  - [x] SubTask 3.2: 在同一组件内实现结果弹窗（复用 `@/components/ui/dialog`，参照 `AlarmFormDialog.vue` 的 `Dialog / DialogContent / DialogHeader / DialogTitle / DialogDescription / DialogFooter` 用法）：按四种状态分支渲染标题、描述、版本号、发布时间与发行说明正文（纯文本、`whitespace-pre-wrap`、可滚动，不引入 Markdown 渲染依赖）；`update-available` 时提供「打开发行版页面」与「稍后」，其余状态仅提供关闭
  - [x] SubTask 3.3: 「打开发行版页面」用 `window.open(release.pageUrl)`（主进程已把 `setWindowOpenHandler` 接到 `shell.openExternal`，应用内不加载该页面）
  - [x] SubTask 3.4: 在 `src/renderer/src/components/AppSidebar.vue` 底部区域、「收起侧边栏」之上引入 `<UpdateCheckEntry :collapsed="collapsed" />`
  - [x] SubTask 3.5: 运行 `pnpm run lint` 与 `pnpm run typecheck`，确认无 error（≤80 列、单引号、无分号、无内联样式、图标取自 `lucide-vue-next`）

- [x] Task 4: 统一应用图标（无依赖，可与 Task 1-3 并行）
  - [x] SubTask 4.1: 由 `design/app-icon/assets/app-icon-bell-trend-clean.png` 用 LANCZOS 生成 512×512 PNG，替换 `resources/icon.png` 与 `build/icon.png`（保留透明圆角）
  - [x] SubTask 4.2: 校验 `build/icon.icns`（11 条目 `icp4..ic14`）与 `build/icon.ico`（16/24/32/48/64/128/256）存在且可解析，并抽样比对其中 512 条目与母版缩放结果一致
  - [x] SubTask 4.3: 核对代码路径：`src/main/index.ts` 中窗口 `icon`（Linux）与 `createTray({ iconPath })` 均指向 `resources/icon.png`；`electron-builder.yml` 的 `directories.buildResources: build` 使 mac/win/linux 分别取 `build/icon.icns` / `build/icon.ico` / `build/icon.png`——确认无需改配置
  - [x] SubTask 4.4: 目检 512×512 成品在深色与浅色背景下角部透明、无残留水印

- [x] Task 5: 创建 v1.0.0 发行版（依赖前置条件：仓库已改为公开；可与 Task 1-4 并行）
  - [x] SubTask 5.1: 匿名确认仓库可读——`GET https://gitee.com/api/v5/repos/xuyijie_xu/office-software/releases` 返回 200（若仍为 403，记录为阻塞项并告知用户在 Gitee 仓库设置中改为公开）
  - [x] SubTask 5.2: 用 gitee 插件（`gitee_create_release`）在 `xuyijie_xu/office-software` 创建发行版：`tag_name = 'v1.0.0'`、`name = 'v1.0.0'`、`target_commitish = 'main'`、`prerelease = false`，正文为用户可读的版本说明（提醒 + 行情 + 侧边栏外壳 + 新图标）
  - [x] SubTask 5.3: 匿名 `GET .../releases/latest` 返回 200 且 `tag_name` 为 `v1.0.0`，确认端到端可读

- [x] Task 6: 全量验证与界面验收（依赖 Task 1-5）
  - [x] SubTask 6.1: 运行 `pnpm run lint`、`pnpm run typecheck`（node + web）、`pnpm run test`、`pnpm run build`，全部通过
  - [x] SubTask 6.2: 浏览器预览验收：侧边栏底部出现「检查更新」入口，展开 / 折叠两种形态正确；用桩化 `window.api.update.check()` 的四份返回值分别核对「发现新版本 / 已是最新 / 暂无发行版 / 请求失败」四种弹窗内容与动作
  - [x] SubTask 6.3: 真实联调：以当前版本 1.0.0 与发行版 `v1.0.0` 走一遍主进程取数路径，确认归类为「已是最新」；限流或不可读时确认转为友好文案而非抛错

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 2
- Task 5 依赖仓库可见性改为公开（用户操作）
- Task 6 依赖 Task 1-5
- Task 4 与 Task 1-3 无依赖，可并行
