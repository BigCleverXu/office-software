# Tasks

- [x] Task 1: 建立行情共享类型与纯规则模块
  - [x] SubTask 1.1: 新增 `src/shared/market.ts`，定义 `Quote`、`WatchItem`、`MarketStatus`、`MarketSnapshot`、IPC 通道常量 `MARKET_CHANNELS` 与 `MarketApi`
  - [x] SubTask 1.2: 定义指数常量（上证指数 `sh000001`、深证成指 `sz399001`、创业板指 `sz399006`）
  - [x] SubTask 1.3: 实现代码校验与规范化（6 位数字；6/9 → `sh`，0/3 → `sz`；8/4 与其他前缀拒绝）
  - [x] SubTask 1.4: 实现交易时段判定与下一次开盘时间计算（周一至周五 09:30–11:30、13:00–15:00；午休、收盘、周末返回对应休市文案）
  - [x] SubTask 1.5: 实现数值与展示规则（涨跌额、涨跌幅、颜色方向、成交额万/亿单位、`--` 缺失值、`HH:mm:ss` 时间格式化）
  - [x] SubTask 1.6: 新增 `src/shared/market.test.ts` 覆盖 1.3 / 1.4 / 1.5 的边界（含正负号、平盘、缺失值、跨午休与跨周末）

- [x] Task 2: 主进程行情取数层（依赖 Task 1）
  - [x] SubTask 2.1: 新增 `src/main/quote-provider.ts`，实现批量快照请求（一次请求获取全部指数与自选股）
  - [x] SubTask 2.2: 处理 GBK 响应解码与响应文本解析，映射为 `Quote`（含名称、现价、昨收、今开、最高、最低、成交额、数据时间）
  - [x] SubTask 2.3: 处理个股无数据 / 停牌情形，标记为缺失值；请求超时设上限，失败向上抛出
  - [x] SubTask 2.4: 新增 `src/main/quote-provider.test.ts`，用固定响应样本验证解析、停牌与字段缺失

- [x] Task 3: 主进程自选股与设置持久化（依赖 Task 1，可与 Task 2 并行）
  - [x] SubTask 3.1: 新增 `src/main/market-store.ts`，读写 `userData/market.json`（自选股列表 + 页面设置）
  - [x] SubTask 3.2: 实现自选股增删、名称缓存与默认按加入时间排序；读取时对损坏数据做容错回退为空列表
  - [x] SubTask 3.3: 实现页面设置读写（暂停开关、上次停留页面）

- [x] Task 4: 主进程刷新调度（依赖 Task 1、Task 2）
  - [x] SubTask 4.1: 新增 `src/main/market-scheduler.ts`，实现时段感知的周期刷新（交易时段 3 秒、非交易时段停止）
  - [x] SubTask 4.2: 实现同一时刻仅一轮请求在途（上一轮未返回则跳过本轮）
  - [x] SubTask 4.3: 实现失败保留旧值、连续 3 次失败退避 30 秒、成功后恢复 3 秒并清零计数
  - [x] SubTask 4.4: 实现距离下一次开盘 1 分钟自动恢复刷新
  - [x] SubTask 4.5: 实现节假日识别：应交易时段内连续 60 秒数据时间戳无前进则判定休市，至下一交易时段起点重新尝试
  - [x] SubTask 4.6: 新增 `src/main/market-scheduler.test.ts`，覆盖时段切换、在途跳过、退避恢复、停滞判定（使用可注入的假时钟与假取数函数）

- [x] Task 5: 主进程接线（依赖 Task 2、3、4）
  - [x] SubTask 5.1: 在 `src/main/ipc.ts` 新增行情通道：获取初始状态、添加自选股（先校验代码格式再试取行情，成功才写入）、删除自选股、立即刷新、暂停 / 恢复刷新、记录上次停留页面
  - [x] SubTask 5.2: 在 `src/main/index.ts` 启动时初始化行情持久化与调度器，并把快照 + 自选股变更推送给渲染层
  - [x] SubTask 5.3: 在 `src/main/tray.ts` 按 10 秒节奏更新悬浮提示为 `上证指数 点位 涨跌幅`，失败超阈值退化为 `上证指数 --`；右键菜单新增「打开行情」并在点击后聚焦窗口且通知渲染层切页

- [x] Task 6: preload 桥接（依赖 Task 1 的通道契约，可与 Task 5 并行）
  - [x] SubTask 6.1: 在 `src/preload/index.ts` 暴露 `window.api.market`（invoke 方法与状态订阅）
  - [x] SubTask 6.2: 在 `src/preload/index.d.ts` 补齐行情 API 类型声明

- [x] Task 7: 渲染层状态与格式化（依赖 Task 6）
  - [x] SubTask 7.1: 新增 `src/renderer/src/composables/useMarket.ts`，订阅主进程快照与自选股变更，维护指数、自选股、刷新状态（加载中 / 已更新 / 刷新中 / 刷新失败 / 加载失败 / 已休市 / 已暂停）与上次成功时间
  - [x] SubTask 7.2: 新增 `src/renderer/src/lib/market-format.ts`，统一格式化涨跌数值、颜色方向、成交额单位与时间戳

- [x] Task 8: 行情页面 UI 组件（依赖 Task 7）
  - [x] SubTask 8.1: 新增 `src/renderer/src/components/IndexCard.vue`（指数名、点位、涨跌额与涨跌幅、更新时间；缺失显示 `--`）
  - [x] SubTask 8.2: 新增 `src/renderer/src/components/WatchPanel.vue`（自选股表格、表头全局状态、空状态、行内删除入口；仅原地更新单元格）
  - [x] SubTask 8.3: 新增 `src/renderer/src/components/AddWatchDialog.vue`（6 位代码输入、内联校验与重复 / 不存在提示、请求失败提示）
  - [x] SubTask 8.4: 新增 `src/renderer/src/components/MarketPanel.vue`，组合卡片区、列表、添加入口与底部数据来源说明

- [x] Task 9: 应用主导航改造（依赖 Task 8）
  - [x] SubTask 9.1: 修改 `src/renderer/src/App.vue`，新增「提醒 / 行情」主导航与页面切换，切换时保留各自页面状态
  - [x] SubTask 9.2: 启动时恢复上次停留页面，并响应托盘「打开行情」切页事件

- [x] Task 10: 全量验证（依赖 Task 1-9）
  - [x] SubTask 10.1: 运行 `pnpm run lint` 并修复问题
  - [x] SubTask 10.2: 运行 `pnpm run typecheck`（node + web）并修复类型错误
  - [x] SubTask 10.3: 运行 `pnpm run test`，确认行情新增单测与既有提醒单测全部通过
  - [x] SubTask 10.4: 运行 `pnpm run build`，确认 main / preload / renderer 三端构建成功

- [x] Task 11: 修复托盘失败退化逻辑（验证阶段发现，依赖 Task 5.3）
  - [x] SubTask 11.1: 修正 `src/main/index.ts` 的托盘悬浮提示：连续失败达到 `FAILURE_THRESHOLD` 时退化为 `上证指数 --`（原先仅在 `load-failed` 时退化），与非交易时段保留最后文案的规则并存
  - [x] SubTask 11.2: 复核 lint / typecheck / test / build 全部通过

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 1，可与 Task 2 并行
- Task 4 依赖 Task 1、Task 2
- Task 5 依赖 Task 2、Task 3、Task 4
- Task 6 依赖 Task 1（通道契约），可与 Task 5 并行
- Task 7 依赖 Task 6
- Task 8 依赖 Task 7
- Task 9 依赖 Task 8
- Task 10 依赖 Task 1-9
