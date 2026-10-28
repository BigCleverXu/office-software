// 单机游戏注册表：列表页据此渲染游戏卡片

import type { Component } from 'vue'
import DinoGame from '@/games/dino/DinoGame.vue'

/** 单机游戏元信息 */
export interface GameMeta {
  /** 游戏唯一标识 */
  id: string
  /** 卡片与游戏页标题 */
  title: string
  /** 一句话玩法简介 */
  subtitle: string
  /** 玩法标签，如「跑酷」「像素风」 */
  tags: readonly string[]
  /** 缩略图配色，Tailwind 类，如 'text-primary' */
  accent: string
  /** 游戏组件，自身铺满父容器 */
  component: Component
}

/** 单机游戏注册表：顺序即列表展示顺序 */
export const GAMES: readonly GameMeta[] = [
  {
    id: 'dino-run',
    title: '恐龙快跑',
    subtitle: '像素风横向跑酷，躲避仙人掌与翼龙，看你能跑多远',
    tags: ['跑酷', '像素风', '单机'],
    accent: 'text-primary',
    component: DinoGame
  }
]

/** 按 id 查找游戏，非法 id 回退到首个游戏 */
export function gameById(id: string): GameMeta {
  return GAMES.find((game) => game.id === id) ?? GAMES[0]
}
