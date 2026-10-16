# 桌面定时提醒应用 Spec

## Why
用户需要一个可常驻后台、到点用系统通知提醒的桌面软件，用于日程或习惯提醒；系统自带闹钟在自定义重复周期与后台提醒方面不够灵活。

## What Changes
- 新增基于 electron-vite + Vue 3 + TypeScript 的 Electron 桌面应用工程，包管理器使用 pnpm
- 样式框架使用 shadcn-vue，图标统一使用 lucide-vue-next
- 支持创建、编辑、删除、启用/禁用提醒（标题 + 提醒时间 + 重复周期）
- 重复周期支持：不重复（单次）、每天、每周（指定星期）、工作日
- 由主进程统一负责计时调度，到点触发系统原生通知
- 应用常驻系统托盘，关闭窗口时隐藏而非退出
- 提醒数据持久化到本地用户数据目录

## Impact
- Affected specs: 新增能力 — 提醒管理、重复周期、到点通知、主进程调度、托盘常驻、本地持久化
- Affected code: 全新项目，涉及 `src/main`（主进程）、`src/preload`（预加载桥）、`src/renderer`（Vue 渲染层）

## ADDED Requirements

### Requirement: 提醒管理
The system SHALL 允许用户创建、编辑、删除提醒，每条提醒包含标题、提醒时间（HH:mm）、重复周期与启用状态。

#### Scenario: 创建提醒
- **WHEN** 用户点击新增，填写标题、时间并选择重复周期后保存
- **THEN** 提醒出现在列表中并持久化保存

#### Scenario: 启用/禁用提醒
- **WHEN** 用户切换某条提醒的启用开关
- **THEN** 该提醒状态立即更新并保存；禁用的提醒不再触发

#### Scenario: 删除提醒
- **WHEN** 用户删除某条提醒
- **THEN** 该提醒从列表移除并从本地存储中删除

### Requirement: 重复周期
The system SHALL 支持四种重复周期：不重复（单次）、每天、每周（指定星期）、工作日。

#### Scenario: 单次提醒
- **WHEN** 单次提醒在设定时间触发后
- **THEN** 该提醒自动置为禁用，不再重复触发

#### Scenario: 每天提醒
- **WHEN** 每天重复的提醒到达设定时间
- **THEN** 每天都触发提醒

#### Scenario: 每周提醒
- **WHEN** 当前星期几属于用户选中的星期集合且时间匹配
- **THEN** 触发提醒

#### Scenario: 工作日提醒
- **WHEN** 当前为周一至周五且时间匹配
- **THEN** 触发提醒

### Requirement: 主进程调度
The system SHALL 由主进程统一负责计时与调度，保证渲染窗口隐藏时仍能按时触发。

#### Scenario: 分钟去重
- **WHEN** 同一提醒在同一分钟内被多次检查
- **THEN** 仅触发一次通知

#### Scenario: 数据变更后重新排程
- **WHEN** 提醒被创建、编辑、启用或禁用
- **THEN** 调度立即按最新数据生效

### Requirement: 到点通知
The system SHALL 在提醒到点时通过操作系统原生通知进行提示，应用处于后台或托盘状态时同样生效。

#### Scenario: 到点触发
- **WHEN** 系统时间到达某启用提醒的设定时间（分钟级）
- **THEN** 弹出系统原生通知，显示提醒标题

#### Scenario: 点击通知
- **WHEN** 用户点击通知
- **THEN** 应用主窗口显示并聚焦

### Requirement: 托盘常驻
The system SHALL 常驻系统托盘，并在窗口关闭时隐藏窗口而非退出应用。

#### Scenario: 关闭窗口
- **WHEN** 用户关闭主窗口
- **THEN** 应用隐藏到托盘并继续后台调度

#### Scenario: 托盘菜单
- **WHEN** 用户右键点击托盘图标
- **THEN** 显示“显示主窗口”与“退出”菜单项；点击退出才真正结束应用

### Requirement: 本地持久化
The system SHALL 将提醒数据持久化到本地用户数据目录，应用重启后仍可恢复。

#### Scenario: 重启恢复
- **WHEN** 用户重启应用
- **THEN** 之前保存的提醒列表仍然存在，且启用状态与重复周期保持不变
