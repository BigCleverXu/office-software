<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Gamepad2, WifiOff } from 'lucide-vue-next'
import type { GameMeta } from '@/games/registry'
import { GAMES, gameById } from '@/games/registry'
import { Button } from '@/components/ui/button'

/** 8×8 恐龙剪影栅格：true 为实心像素，false 为透明空格 */
const DINO_THUMBNAIL: readonly (readonly boolean[])[] = [
  [false, false, false, false, false, true, true, false],
  [false, false, false, true, true, true, true, false],
  [false, false, false, true, true, true, true, true],
  [true, false, false, true, true, true, false, false],
  [true, true, true, true, true, true, false, false],
  [false, false, true, true, true, false, false, false],
  [false, false, true, true, false, true, false, false],
  [false, false, true, true, false, true, true, false]
]

/** 展平为一维单元格列表，模板中直接遍历 */
const THUMBNAIL_CELLS = DINO_THUMBNAIL.flatMap((row, rowIndex) =>
  row.map((filled, columnIndex) => ({
    key: `${rowIndex}-${columnIndex}`,
    filled
  }))
)

/** 当前进入的游戏 id，null 表示停留在列表页 */
const activeGameId = ref<string | null>(null)

/** 当前游戏元信息：列表态取注册表首项占位 */
const activeGame = computed<GameMeta>(() =>
  gameById(activeGameId.value ?? GAMES[0].id)
)

const openGame = (game: GameMeta): void => {
  activeGameId.value = game.id
}

const backToList = (): void => {
  activeGameId.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-show="activeGameId === null" class="flex flex-col gap-2 px-6 py-4">
      <div class="flex items-center justify-between gap-3">
        <p class="text-muted-foreground text-sm">
          共
          <span class="text-foreground font-medium">{{ GAMES.length }}</span>
          款单机游戏
        </p>
        <span class="text-muted-foreground flex items-center gap-1.5 text-sm">
          <WifiOff class="size-4" aria-hidden="true" />
          纯单机 · 无需联网
        </span>
      </div>
    </div>

    <!-- 列表用 v-show 保留滚动位置，返回后仍停留在原处 -->
    <div
      v-show="activeGameId === null"
      class="flex-1 overflow-y-auto px-6 pb-6"
    >
      <div
        v-if="GAMES.length === 0"
        class="empty-state text-muted-foreground h-full"
      >
        <span class="empty-state-icon"><Gamepad2 class="size-6" /></span>
        <p class="text-sm">暂无可玩的游戏</p>
      </div>

      <div v-else class="stagger-list grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="game in GAMES"
          :key="game.id"
          type="button"
          class="card-interactive shadow-soft flex w-full items-start gap-4 rounded-2xl border border-border/70 p-4 text-left"
          :aria-label="`开始游戏 ${game.title}`"
          @click="openGame(game)"
        >
          <div
            class="bg-muted/60 size-12 shrink-0 rounded-xl p-2"
            :class="game.accent"
            aria-hidden="true"
          >
            <div class="grid h-full w-full grid-cols-8 grid-rows-8 gap-px">
              <span
                v-for="cell in THUMBNAIL_CELLS"
                :key="cell.key"
                :class="cell.filled ? 'bg-current' : ''"
              ></span>
            </div>
          </div>

          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-sm font-semibold">{{ game.title }}</span>
            <span class="text-muted-foreground line-clamp-2 text-xs">
              {{ game.subtitle }}
            </span>
            <span class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="tag in game.tags"
                :key="tag"
                class="rounded-full bg-muted px-2 py-0.5 text-[11px]"
              >
                {{ tag }}
              </span>
            </span>
          </div>
        </button>
      </div>
    </div>

    <div
      v-if="activeGameId !== null"
      class="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-4 pb-6"
    >
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" @click="backToList">
          <ArrowLeft data-icon="inline-start" />
          返回游戏列表
        </Button>
        <h2 class="text-sm font-semibold">{{ activeGame.title }}</h2>
        <span class="rounded-full bg-muted px-2 py-0.5 text-[11px]">
          单机
        </span>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <component :is="activeGame.component" class="min-h-0 flex-1" />
      </div>
    </div>
  </div>
</template>
