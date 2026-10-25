<script lang="ts">
import type { NewsItem, NewsPlatformId } from '@shared/news'

/** 单个平台卡片的视图模型 */
export interface NewsCardView {
  platform: NewsPlatformId
  name: string
  error: string | null
  total: number
  items: NewsItem[]
  expanded: boolean
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** 折叠状态下最多展示的条目数 */
const MAX_VISIBLE_ITEMS = 10

const props = defineProps<{ view: NewsCardView }>()

const emit = defineEmits<{
  refresh: []
  toggle: []
}>()

/** 折叠时仅展示前 MAX_VISIBLE_ITEMS 条，展开时展示全部 */
const visibleItems = computed(() =>
  props.view.expanded
    ? props.view.items
    : props.view.items.slice(0, MAX_VISIBLE_ITEMS)
)
</script>

<template>
  <Card class="card-interactive shadow-soft">
    <CardHeader class="flex flex-row items-center justify-between gap-2">
      <CardTitle class="min-w-0 truncate">{{ view.name }}</CardTitle>
      <Badge variant="secondary" class="shrink-0">
        {{ view.total }}
      </Badge>
    </CardHeader>

    <CardContent>
      <div v-if="view.error" class="flex items-center gap-2">
        <p class="text-destructive text-sm">{{ view.error }}</p>
        <Button variant="ghost" size="sm" @click="emit('refresh')">
          重试
        </Button>
      </div>

      <p v-else-if="view.total === 0" class="text-muted-foreground text-sm">
        暂无内容
      </p>

      <template v-else>
        <div class="flex flex-col gap-0.5">
          <a
            v-for="(item, index) in visibleItems"
            :key="item.url"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group hover:bg-muted/60 flex gap-2 rounded-lg px-2 py-2 transition-colors"
          >
            <span
              class="text-muted-foreground w-5 shrink-0 text-xs tabular-nums"
            >
              {{ index + 1 }}
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                class="text-sm leading-snug line-clamp-2 group-hover:underline"
              >
                {{ item.title }}
              </span>
              <span
                v-if="item.content"
                class="text-muted-foreground text-xs line-clamp-2"
              >
                {{ item.content }}
              </span>
              <span
                v-if="item.publishTime"
                class="text-muted-foreground text-xs"
              >
                {{ item.publishTime }}
              </span>
            </span>
          </a>
        </div>

        <Button
          v-if="view.total > MAX_VISIBLE_ITEMS"
          variant="ghost"
          size="sm"
          class="mt-2 w-full"
          @click="emit('toggle')"
        >
          {{ view.expanded ? '收起' : `展开全部（${view.total}）` }}
        </Button>
      </template>
    </CardContent>
  </Card>
</template>
