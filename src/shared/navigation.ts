// 应用模块导航共享契约：主进程 / preload / 渲染层共用

/** 应用模块标识 */
export type AppModuleId =
  'alarms' | 'calendar' | 'market' | 'weather' | 'news' | 'notes'

/** 全部合法模块标识，顺序即侧边栏展示顺序 */
export const APP_MODULE_IDS: readonly AppModuleId[] = [
  'alarms',
  'calendar',
  'market',
  'weather',
  'news',
  'notes'
]

/** 默认模块（损坏 / 缺失数据时的兜底值） */
export const DEFAULT_MODULE: AppModuleId = 'alarms'

/** 判断 value 是否为合法的应用模块标识（白名单校验） */
export function isAppModuleId(value: unknown): value is AppModuleId {
  return (
    typeof value === 'string' &&
    (APP_MODULE_IDS as readonly string[]).includes(value)
  )
}
