// 渲染层模块注册表：外壳据此渲染侧边栏导航与内容区

import type { Component } from 'vue'
import {
  AlarmClock,
  CalendarDays,
  CloudSun,
  FolderSearch,
  Gamepad2,
  LineChart,
  Newspaper,
  StickyNote
} from 'lucide-vue-next'
import type { AppModuleId } from '@shared/navigation'
import AlarmPanel from '@/components/AlarmPanel.vue'
import CalendarPanel from '@/components/CalendarPanel.vue'
import FileSearchPanel from '@/components/FileSearchPanel.vue'
import GamesPanel from '@/components/GamesPanel.vue'
import MarketPanel from '@/components/MarketPanel.vue'
import NewsPanel from '@/components/NewsPanel.vue'
import NotesPanel from '@/components/NotesPanel.vue'
import WeatherPanel from '@/components/WeatherPanel.vue'

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
    id: 'calendar',
    label: '日历',
    description: '查看月历与节假日安排，管理倒计日',
    icon: CalendarDays,
    component: CalendarPanel
  },
  {
    id: 'market',
    label: '行情',
    description: '大盘指数与自选股行情，交易时段自动刷新',
    icon: LineChart,
    component: MarketPanel
  },
  {
    id: 'weather',
    label: '天气',
    description: '实时天气与一周预报，常用城市快速切换',
    icon: CloudSun,
    component: WeatherPanel
  },
  {
    id: 'news',
    label: '热点',
    description: '实时热点新闻，按平台聚合展示',
    icon: Newspaper,
    component: NewsPanel
  },
  {
    id: 'notes',
    label: '便签',
    description: '随手记录、置顶与检索本地便签',
    icon: StickyNote,
    component: NotesPanel
  },
  {
    id: 'files',
    label: '文件',
    description: '本地文件极速搜索，按类型筛选与预览',
    icon: FolderSearch,
    component: FileSearchPanel
  },
  {
    id: 'games',
    label: '游戏',
    description: '单机小游戏，休息时放松一下',
    icon: Gamepad2,
    component: GamesPanel
  }
]

/** 按 id 查找模块，非法 id 回退到首个模块 */
export function moduleById(id: AppModuleId): ModuleMeta {
  return MODULES.find((module) => module.id === id) ?? MODULES[0]
}
