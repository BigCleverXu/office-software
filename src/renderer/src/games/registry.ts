// 单机游戏注册表：列表页据此渲染游戏卡片

import type { Component } from 'vue'
import DinoGame from '@/games/dino/DinoGame.vue'
import { dinoThumbnail } from '@/games/dino/thumbnail'
import FlappyGame from '@/games/flappy/FlappyGame.vue'
import { flappyThumbnail } from '@/games/flappy/thumbnail'

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
  /** 8×8 像素缩略图，true 为实心像素，false 为透明 */
  thumbnail: readonly (readonly boolean[])[]
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
    thumbnail: dinoThumbnail,
    component: DinoGame
  },
  {
    id: 'flappy-bird',
    title: '管道鸟',
    subtitle: '点击拍翅穿过管道缝隙，撞到管子或地面就结束',
    tags: ['休闲', '像素风', '单机'],
    accent: 'text-weather-sun',
    thumbnail: flappyThumbnail,
    component: FlappyGame
  }
]

/** 按 id 查找游戏，非法 id 回退到首个游戏 */
export function gameById(id: string): GameMeta {
  return GAMES.find((game) => game.id === id) ?? GAMES[0]
}
