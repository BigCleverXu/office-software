// 渲染层模块注册表：外壳据此渲染侧边栏导航与内容区

import type { Component } from 'vue'
import { AlarmClock, LineChart } from 'lucide-vue-next'
import type { AppModuleId } from '@shared/navigation'
import AlarmPanel from '@/components/AlarmPanel.vue'
import MarketPanel from '@/components/MarketPanel.vue'

/** 模块元信息：侧边栏与顶栏均据此渲染 */
export interface ModuleMeta {
  /** 模块标识 */
  id: AppModuleId
  /** 侧边栏与顶栏标题 */
  label: string
  /** 顶栏描述，一句话说明 */
  description: string
  /** 侧边栏图标 */
  icon: Component
  /** 页面组件 */
  component: Component
}

/** 模块注册表：顺序即侧边栏展示顺序 */
export const MODULES: ModuleMeta[] = [
  {
    id: 'alarms',
    label: '提醒',
    description: '设定时间与重复规则，到点弹出系统通知',
    icon: AlarmClock,
    component: AlarmPanel
  },
  {
    id: 'market',
    label: '行情',
    description: '大盘指数与自选股行情，交易时段自动刷新',
    icon: LineChart,
    component: MarketPanel
  }
]

/** 按 id 查找模块，非法 id 回退到首个模块 */
export function moduleById(id: AppModuleId): ModuleMeta {
  return MODULES.find((module) => module.id === id) ?? MODULES[0]
}
