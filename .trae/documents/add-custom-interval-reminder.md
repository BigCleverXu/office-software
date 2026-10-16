# 新增「自定义间隔」重复周期 实现计划

## Summary

为定时提醒应用增加一种新的重复周期 **`interval`（自定义间隔）**：用户可以设置「每隔 N 分钟 / N 小时」持续提醒。

已与用户确认的两个关键决策：

1. **起点锚点 = 从现在起算**：创建 / 启用 / 修改间隔时，以「当前时刻」为起点，经过一个间隔后首次提醒；表单**不再需要**时间输入框（仅在间隔模式下隐藏）。
2. **首次触发 = 等满一个间隔再提醒**：保存/启用后不会立即弹通知，而是等一个完整间隔后第一次提醒。

即：设置「每隔 30 分钟」→ 保存后 30 分钟首次提醒，之后每 30 分钟循环，直到被禁用或删除。

## Current State Analysis

现有架构（已实现并验证通过）：

- 重复周期类型定义在 [types.ts](file:///workspace/src/shared/types.ts#L4)：`RepeatType = 'none' | 'daily' | 'weekly' | 'weekdays'`；`Alarm` 含 `time`(HH:mm)、`weekdays`、`enabled`、`createdAt`、`lastFiredAt`。
- 调度逻辑在 [scheduler.ts](file:///workspace/src/main/scheduler.ts)：纯函数 `matchesRepeat`/`shouldFire` 基于「当前 HH:mm == alarm.time」+ 重复规则判断；`AlarmScheduler` 每 15s tick 一次，用 `fireKey = id|YYYY-MM-DD|HH:mm` 在**同一分钟内去重**；`shouldFire` 已包含 `enabled` 判断。
- 持久化在 [alarm-store.ts](file:///workspace/src/main/alarm-store.ts)：JSON 文件 `userData/alarms.json`，`load()` 惰性读缓存、`persist()` 写回；已有 `create/update/remove/setEnabled/markFired`。
- 触发回调在 [index.ts](file:///workspace/src/main/index.ts#L96-L103) `handleFire`：`markFired(id, now)`，若 `repeat === 'none'` 则自动 `setEnabled(false)`，然后弹通知 + 广播。
- IPC 在 [ipc.ts](file:///workspace/src/main/ipc.ts)，preload 暴露 [index.ts](file:///workspace/src/preload/index.ts) `window.api.alarms`；渲染层 [useAlarms.ts](file:///workspace/src/renderer/src/composables/useAlarms.ts) 封装并订阅变更推送。
- 渲染层：列表 [AlarmCard.vue](file:///workspace/src/renderer/src/components/AlarmCard.vue)（大号显示 `alarm.time` + 重复摘要 Badge）；表单 [AlarmFormDialog.vue](file:///workspace/src/renderer/src/components/AlarmFormDialog.vue)（内容 + 时间 + 重复 Select + 每周星期多选 + 启用 Switch）；文案/选项 [format.ts](file:///workspace/src/renderer/src/lib/format.ts)。
- 别名：`@` → `src/renderer/src`，`@shared` → `src/shared`（见 [electron.vite.config.ts](file:///workspace/electron.vite.config.ts#L11-L15)）。主进程用相对路径 `../shared/*`。
- 测试：[scheduler.test.ts](file:///workspace/src/main/scheduler.test.ts) 15 个用例。

间隔提醒无法复用「HH:mm 相等」的判断方式，需要一个**绝对时间戳**驱动的调度路径。

## Proposed Changes

### 1. 数据模型：[types.ts](file:///workspace/src/shared/types.ts)

- `RepeatType` 增加 `'interval'`。
- 新增类型 `export type IntervalUnit = 'minutes' | 'hours'`。
- `Alarm` 增加三个字段：
  - `intervalValue: number` —— 间隔数量（正整数）。
  - `intervalUnit: IntervalUnit` —— 单位（`'minutes'` | `'hours'`）。
  - `nextFireAt: number | null` —— 下一次应触发的绝对时间戳（仅 `interval` 使用；其他类型为 `null`）。这是间隔调度的**唯一数据源**，避免依赖相对时间计算。
- `AlarmDraft` 增加 `intervalValue: number`、`intervalUnit: IntervalUnit`（`time`/`weekdays` 保持，间隔模式下 `time` 存空字符串）。
- `ALARM_CHANNELS` / `AlarmApi` 不变。

### 2. 新增共享工具：[interval.ts](file:///workspace/src/shared/interval.ts)（NEW）

放在 `src/shared` 以便主进程与渲染层共用（纯函数、无 electron 依赖）：

- `INTERVAL_LIMITS: Record<IntervalUnit, { min: number; max: number }>`：`minutes: { min: 1, max: 1440 }`，`hours: { min: 1, max: 24 }`。
- `INTERVAL_UNIT_OPTIONS: { value: IntervalUnit; label: string }[]`：`分钟`、`小时`。
- `getIntervalMs(value: number, unit: IntervalUnit): number`：按单位换算为毫秒。
- `formatIntervalLabel(value: number, unit: IntervalUnit): string`：生成 `每隔 30 分钟` / `每隔 2 小时` 文案。

### 3. 调度器：[scheduler.ts](file:///workspace/src/main/scheduler.ts)

- `matchesRepeat`：`case 'interval': return true`（间隔不依赖星期/日期）。
- `shouldFire`：增加分支 ——
  ```
  if (alarm.repeat === 'interval')
    return alarm.enabled && alarm.nextFireAt !== null
        && now.getTime() >= alarm.nextFireAt
  ```
  其余类型保持原逻辑。
- `fireKey` 保持 `${id}|YYYY-MM-DD|HH:mm`：因间隔最小为 1 分钟，且触发后会把 `nextFireAt` 前移（见下），同一分钟内不会重复命中，`clearExpiredKeys` 的按天清理逻辑仍然成立。
- 说明定位：`shouldFire` 仍为纯函数，间隔分支只读 `nextFireAt`，便于单测。

### 4. 持久化：[alarm-store.ts](file:///workspace/src/main/alarm-store.ts)

- **迁移/归一化**：`load()` 读取后对每条记录做一次归一化，补齐缺失字段（旧 `alarms.json` 无新字段），避免崩溃与数据丢失：
  - `repeat` 缺省 `'none'`；`weekdays` 缺省 `[]`；
  - `intervalValue` 缺省 `0`；`intervalUnit` 缺省 `'minutes'`；`nextFireAt` 缺省 `null`。
- `create(draft)`：`intervalValue/intervalUnit` 落库；若 `repeat === 'interval'`，`nextFireAt = Date.now() + getIntervalMs(...)`（**从现在起算 + 等满一个间隔**）；否则 `nextFireAt = null`。
- `update(id, draft)`：同步新字段；若改为/仍为 `interval`，`nextFireAt = Date.now() + getIntervalMs(...)`（编辑即重置起点）；改为其他类型时 `nextFireAt = null`。
- `setEnabled(id, enabled)`：当 `enabled === true` 且 `repeat === 'interval'` 时，`nextFireAt = Date.now() + getIntervalMs(...)`（重新启用即重置起点，避免补触发造成立即弹窗）。
- `markFired(id, at, nextFireAt?)`：新增可选参数；`lastFiredAt = at`，若传入 `nextFireAt` 则一并写入。
- 新增私有辅助 `normalize(list)` 供 `load()` 调用。

### 5. 主进程触发流转：[index.ts](file:///workspace/src/main/index.ts)

调整 `handleFire`（[index.ts](file:///workspace/src/main/index.ts#L96-L103)）：

- `repeat === 'interval'`：`store.markFired(id, now, now + getIntervalMs(intervalValue, intervalUnit))`，**不自动禁用**（`nextFireAt` 前移一格，下个周期继续）。
- `repeat === 'none'`：维持现状 —— `markFired(id, now, null)` 后 `setEnabled(false)`。
- 其他类型：`markFired(id, now, null)`，行为不变。
- 之后照旧 `showAlarmNotification` + `broadcast()`。
- 需从 [interval.ts](file:///workspace/src/shared/interval.ts) 引入 `getIntervalMs`。

> 说明（已做决策）：应用启动时若 `nextFireAt` 已是过去时刻（例如关机期间错过），启动瞬间的 `check()` 会**补触发一次**；由于触发后 `nextFireAt = now + interval`，只会补一次、不会连续补发。

### 6. 渲染层文案：[format.ts](file:///workspace/src/renderer/src/lib/format.ts)

- `REPEAT_OPTIONS` 增加 `{ value: 'interval', label: '自定义间隔' }`（置于「工作日」之后）。
- `repeatSummary(alarm)`：`repeat === 'interval'` 时返回 `formatIntervalLabel(alarm.intervalValue, alarm.intervalUnit)`（引入 `@shared/interval`）。
- 新增 `primaryTimeLabel(alarm): string`：
  - `interval` 且启用且有 `nextFireAt` → `formatHM(new Date(nextFireAt))`；
  - `interval` 且禁用或 `nextFireAt` 为空 → `'--:--'`；
  - 其他类型 → `alarm.time`。

### 7. 渲染层表单：[AlarmFormDialog.vue](file:///workspace/src/renderer/src/components/AlarmFormDialog.vue)

- 新增响应式状态 `intervalValue: number`（默认 `30`）与 `intervalUnit: IntervalUnit`（默认 `'minutes'`）。
- `watch(open)` 回填：编辑时取 `alarm.intervalValue || 30`、`alarm.intervalUnit || 'minutes'`；新建时用默认值。
- 新增 `isInterval = computed(() => repeat.value === 'interval')`。
- 模板：
  - 当 `!isInterval` 时保留现有「提醒时间」`Input type="time"`。
  - 当 `isInterval` 时改为一行「每隔 [number Input] [单位 Select]」：
    - number Input：`type="number"`、`:min="INTERVAL_LIMITS[intervalUnit].min"`、`:max="INTERVAL_LIMITS[intervalUnit].max"`、`step=1`；
    - 单位 Select 使用 `INTERVAL_UNIT_OPTIONS`。
  - 「每周」星期多选仅在 `repeat === 'weekly'` 时显示（现状保持）。
- `handleSubmit` 校验：
  - `label` 非空（现状保持）；
  - `isInterval` 时校验 `intervalValue` 为整数且在 `INTERVAL_LIMITS[intervalUnit]` 范围内（非整数/越界给出 `error` 文案）；`!isInterval` 时仍校验 `time` 非空；
  - `repeat === 'weekly'` 校验至少选一个星期（现状保持）。
- 提交的 draft：`time` 在 `isInterval` 时存 `''`，否则为 `time.value`；`weekdays` 仅 `weekly` 保留；`intervalValue`/`intervalUnit` 在 `isInterval` 时为输入值，否则存默认值（如 `0` / `'minutes'`，保持数据干净）。

### 8. 渲染层列表卡片：[AlarmCard.vue](file:///workspace/src/renderer/src/components/AlarmCard.vue)

- 大号时间文本改用 `primaryTimeLabel(alarm)`（间隔提醒显示「下次提醒 HH:mm」，禁用时 `--:--`；其余类型显示 `alarm.time`）。
- 重复 Badge 文本沿用 `repeatSummary(alarm)`（自动显示 `每隔 N 分钟/小时`）。
- 其余（启用 Switch、编辑/删除、禁用态变灰/删除线）保持不变。

### 9. 单测：[scheduler.test.ts](file:///workspace/src/main/scheduler.test.ts)

- `makeAlarm` 默认值补充 `intervalValue: 0`、`intervalUnit: 'minutes'`、`nextFireAt: null`。
- 新增用例（`shouldFire` / `matchesRepeat` / `AlarmScheduler`）：
  - `matchesRepeat`：`interval` 对任意日期命中 `true`。
  - `shouldFire`：`now >= nextFireAt` 为 `true`；`now < nextFireAt` 为 `false`；`enabled === false` 为 `false`；`nextFireAt === null` 为 `false`。
  - `AlarmScheduler`：间隔提醒在同一 `nextFireAt` 下只触发一次；`nextFireAt` 前移后可再次触发（模拟一个完整周期）。
- **可选**：为 [alarm-store.ts](file:///workspace/src/main/alarm-store.ts) 增加归一化/`create` 设置 `nextFireAt` 的测试（构造函数支持传 `filePath` 以便脱离 electron 测试）。

## Assumptions & Decisions

- **起点从现在起算**、**首次等满一个间隔**（已与用户确认）。
- 间隔单位仅支持 `分钟`（1–1440）与 `小时`（1–24）；不支持「天」（用户未要求）。输入取整数。
- 间隔模式不设置具体时间点，`Alarm.time` 存空字符串；`weekdays` 存 `[]`。
- 间隔提醒**永不自动禁用**（与 `none` 单次不同）；只能由用户手动禁用/删除。
- 采用 `nextFireAt` 绝对时间戳驱动，而非相对「上次触发 + 间隔」，以便重启后精确续跑、避免漂移；错过周期只补触发一次。
- 旧数据通过 `load()` 归一化自动迁移，不丢数据、无需手动处理。
- 不新增 IPC 通道、不改 preload 接口（`AlarmDraft`/`Alarm` 字段扩展经既有通道透传）。
- 不引入新依赖；图标仍用 `lucide-vue-next`；样式仍用 shadcn-vue 组件。

## Verification

自动化：

1. `pnpm run test` —— 既有 15 个 + 新增间隔用例全绿。
2. `pnpm run typecheck` —— node + web 均无错误（重点：`RepeatType` 扩展后各处 `switch`/穷尽性检查；`AlarmDraft` 新字段在表单提交处齐全）。
3. `pnpm run lint` —— 无 error。
4. `pnpm run build` —— main/preload/renderer 三端构建通过。

手动（本机图形环境）：

5. 新建「每隔 1 分钟」提醒 → 保存后约 1 分钟首次收到系统通知，之后每分钟提醒一次。
6. 列表卡片大号时间显示下次提醒 HH:mm，Badge 显示「每隔 1 分钟」；禁用后显示 `--:--`，重新启用后重新开始计时。
7. 关闭窗口隐藏到托盘后，间隔提醒仍按周期弹系统通知；点击通知聚焦窗口。
8. 编辑间隔（如 1 分钟 → 2 小时）后从编辑时刻重新计时。
9. 退出并重启应用，间隔提醒数据与 `nextFireAt` 保留并继续；若关机期间错过，最多补触发一次。
10. 旧版本 `alarms.json`（无新字段）能被正常加载且不报错（数据迁移生效）。
