<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RefreshCw, SlidersHorizontal } from 'lucide-vue-next'
import { NEWS_PLATFORMS } from '@shared/news'
import type { NewsPlatformId, NewsSection } from '@shared/news'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import NewsCard from '@/components/NewsCard.vue'
import type { NewsCardView } from '@/components/NewsCard.vue'
import NewsPlatformDialog from '@/components/NewsPlatformDialog.vue'
import { useNews } from '@/composables/useNews'

const {
  loading,
  error,
  selectedPlatforms,
  sections,
  updatedAt,
  load,
  refresh,
  applyPlatforms,
  subscribe
} = useNews()

const dialogOpen = ref(false)

/** 已展开全部条目的平台集合 */
const expandedPlatforms = ref<Set<NewsPlatformId>>(new Set())

/** 按展开状态补齐平台中文名与条目总数 */
const sectionViews = computed<NewsCardView[]>(() =>
  sections.value.map((section: NewsSection) => ({
    platform: section.platform,
    name:
      NEWS_PLATFORMS.find((entry) => entry.id === section.platform)?.name ??
      section.platform,
    error: section.error,
    total: section.items.length,
    items: section.items,
    expanded: expandedPlatforms.value.has(section.platform)
  }))
)

/** 宽屏左列：按奇偶固定分配，展开状态不会引起跨列跳动 */
const leftColumn = computed(() =>
  sectionViews.value.filter((_, index) => index % 2 === 0)
)

/** 宽屏右列 */
const rightColumn = computed(() =>
  sectionViews.value.filter((_, index) => index % 2 === 1)
)

/** 更新时间文案：HH:mm，尚未拉取时显示 -- */
const updatedLabel = computed(() => {
  if (updatedAt.value === 0) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(updatedAt.value))
})

/** 首次加载且无任何数据时展示骨架卡片 */
const showSkeleton = computed(
  () => loading.value && sections.value.length === 0
)

/** 已有数据时刷新，展示顶部进度条 */
const showProgress = computed(() => loading.value && sections.value.length > 0)

/** 页脚固定文案 */
const FOOTER_TEXT =
  '数据来源：热点速览 news.orz.ai（orz-ai/hot_news），约每 30 分钟更新，仅供参考'

const openDialog = (): void => {
  dialogOpen.value = true
}

const handleRefresh = (): void => {
  void refresh()
}

/** 切换单个平台的展开 / 收起状态 */
const toggleExpanded = (platform: NewsPlatformId): void => {
  const next = new Set(expandedPlatforms.value)
  if (next.has(platform)) {
    next.delete(platform)
  } else {
    next.add(platform)
  }
  expandedPlatforms.value = next
}

/** 保存平台选择：先关闭弹窗，再写入主进程 */
const handleSave = async (platforms: NewsPlatformId[]): Promise<void> => {
  dialogOpen.value = false
  await applyPlatforms(platforms)
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  void load()
  unsubscribe = subscribe()
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between gap-3 px-6 py-4">
      <span class="text-muted-foreground text-sm">
        已选 {{ selectedPlatforms.length }} 个平台 · 更新于 {{ updatedLabel }}
      </span>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="openDialog">
          <SlidersHorizontal data-icon="inline-start" />
          选择平台
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="handleRefresh"
        >
          <RefreshCw
            data-icon="inline-start"
            class="motion-reduce:animate-none"
            :class="{ 'animate-spin': loading }"
          />
          刷新
        </Button>
      </div>
    </div>

    <div
      v-if="showProgress"
      class="bg-muted relative mx-6 mb-3 h-0.5 overflow-hidden"
    >
      <div
        class="bg-primary absolute inset-y-0 w-1/3 animate-[news-progress_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
      ></div>
    </div>

    <p v-if="error" class="text-destructive px-6 pb-3 text-sm">
      {{ error }}
    </p>

    <div class="flex-1 overflow-y-auto px-6 pb-6 py-2">
      <div
        v-if="showSkeleton"
        class="columns-1 gap-3 lg:columns-2"
        role="status"
        aria-busy="true"
      >
        <span class="sr-only">正在加载热点新闻</span>
        <Card
          v-for="n in 4"
          :key="n"
          class="mb-3 animate-pulse break-inside-avoid"
        >
          <CardHeader class="flex flex-row items-center justify-between gap-2">
            <div class="bg-muted h-4 w-24 rounded"></div>
            <div class="bg-muted h-5 w-8 rounded-full"></div>
          </CardHeader>

          <CardContent>
            <div v-for="row in 5" :key="row" class="flex flex-col gap-1.5 pb-3">
              <div
                class="bg-muted h-3.5 rounded"
                :class="row % 2 === 0 ? 'w-full' : 'w-3/4'"
              ></div>
              <div class="bg-muted h-3 w-1/3 rounded"></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div v-else>
        <div class="hidden gap-3 lg:grid lg:grid-cols-2 lg:items-start">
          <div class="flex min-w-0 flex-col gap-3">
            <NewsCard
              v-for="view in leftColumn"
              :key="view.platform"
              :view="view"
              @refresh="handleRefresh"
              @toggle="toggleExpanded(view.platform)"
            />
          </div>
          <div class="flex min-w-0 flex-col gap-3">
            <NewsCard
              v-for="view in rightColumn"
              :key="view.platform"
              :view="view"
              @refresh="handleRefresh"
              @toggle="toggleExpanded(view.platform)"
            />
          </div>
        </div>

        <div class="flex flex-col gap-3 lg:hidden">
          <NewsCard
            v-for="view in sectionViews"
            :key="view.platform"
            :view="view"
            @refresh="handleRefresh"
            @toggle="toggleExpanded(view.platform)"
          />
        </div>
      </div>
    </div>

    <footer class="text-muted-foreground border-t px-6 py-2 text-xs">
      {{ FOOTER_TEXT }}
    </footer>

    <NewsPlatformDialog
      v-model:open="dialogOpen"
      :selected="selectedPlatforms"
      @save="handleSave"
    />
  </div>
</template>
