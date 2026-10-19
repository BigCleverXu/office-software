# Checklist

## 检查更新入口
- [x] 侧边栏底部、「收起侧边栏」之上有「检查更新」入口
- [x] 展开态显示图标 + 「检查更新」文字；折叠态只显示图标且悬停有 Tooltip
- [x] 检查过程中按钮禁用并呈现加载态，重复点击不会发起第二次请求

## 更新查询（主进程）
- [x] 查询由主进程发起（渲染层不直接请求外部接口），请求 `releases/latest`，默认超时 5000ms
- [x] 未引入新的第三方依赖，`fetch` 可注入以便单测
- [x] 404（无发行版）/ 429（限流）/ 401、403（不可读）/ 超时 / 网络异常均映射为结构化结果，不抛出未捕获异常
- [x] 版本比较规则符合规格：去前导 `v`、按 `.` 分段、数字段按数值比较、缺失段按 0

## 结果弹窗
- [x] 发现新版本：显示新版本号、当前版本号、发布时间、发行说明，并提供「打开发行版页面」
- [x] 已是最新：显示「已是最新版本」与当前版本号
- [x] 暂无发行版：显示「暂无发行版」与仓库尚未发布版本的说明
- [x] 请求失败：显示对应中文原因（网络 / 限流 / 无法读取 / 未知），可关闭后重试
- [x] 「打开发行版页面」由系统默认浏览器打开，应用内不加载该页面
- [x] 发行说明按纯文本呈现（保留换行），未引入 Markdown 渲染依赖

## 共享契约与通路
- [x] `src/shared/update.ts` 提供通道名、`UpdateApi` 与四态结果类型，成为唯一事实来源
- [x] preload 暴露 `window.api.update.check()`，`index.d.ts` 同步更新
- [x] `releasePageUrl` 按 `https://gitee.com/{owner}/{repo}/releases/tag/{tag_name}` 拼接（Gitee API 无 `html_url` 字段）

## 应用图标统一
- [x] `resources/icon.png` 为 512×512，派生自 `app-icon-bell-trend-clean.png`，圆角外透明
- [x] `build/icon.png` 为 512×512，与 `resources/icon.png` 同源
- [x] `build/icon.icns` 含 `icp4..ic14` 共 11 个条目且与母版一致
- [x] `build/icon.ico` 含 16/24/32/48/64/128/256 且与母版一致
- [x] Linux 窗口图标与托盘图标均取自 `resources/icon.png`（代码路径核对）
- [x] 打包配置无需改动即分别使用 `build/icon.icns` / `build/icon.ico` / `build/icon.png`
- [x] 512×512 成品在深色与浅色背景下角部透明、无水印残留

## 发行版与联调
- [x] 仓库已公开，匿名 `GET .../releases` 返回 200
- [x] 已创建 `v1.0.0` 发行版，匿名 `GET .../releases/latest` 返回 200 且 `tag_name` 为 `v1.0.0`
- [x] 当前版本（1.0.0）与 `v1.0.0` 比对结果为「已是最新」

## 验证
- [x] `pnpm run lint` 无 error
- [x] `pnpm run typecheck`（node + web）无类型错误
- [x] `pnpm run test` 全部通过（含新增的 update / release-provider 单测）
- [x] `pnpm run build` 三端构建成功
- [x] 浏览器预览下四种弹窗状态与展开 / 折叠入口均按规格呈现
