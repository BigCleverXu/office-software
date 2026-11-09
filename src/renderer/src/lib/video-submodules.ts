// 短视频子模块注册表：外壳据此渲染 tab 与内容区

import type { Component } from 'vue'
import { Captions, Link2 } from 'lucide-vue-next'
import type { VideoSubModuleId } from '@/composables/useVideo'
import VideoParsePanel from '@/components/VideoParsePanel.vue'
import VideoTranscriptPanel from '@/components/VideoTranscriptPanel.vue'

/** 短视频子模块元信息 */
export interface VideoSubModuleMeta {
  id: VideoSubModuleId
  /** tab 文案 */
  label: string
  /** tab 说明 */
  description: string
  /** tab 图标 */
  icon: Component
  /** 子模块组件 */
  component: Component
}

/** 子模块注册表：顺序即 tab 展示顺序 */
export const VIDEO_SUBMODULES: VideoSubModuleMeta[] = [
  {
    id: 'parse',
    label: '链接解析下载',
    description: '解析抖音、快手、小红书与 B 站链接，下载视频或图文',
    icon: Link2,
    component: VideoParsePanel
  },
  {
    id: 'transcript',
    label: '口播提取',
    description: '本地离线识别视频口播，可编辑并导出 TXT',
    icon: Captions,
    component: VideoTranscriptPanel
  }
]
