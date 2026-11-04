<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Globe, Loader2, Pencil, Trash2 } from 'lucide-vue-next'
import {
  hostOf,
  SYSTEM_BROWSER_ID,
  type DetectedBrowser,
  type QuickSite,
  type QuickSiteTarget
} from '@shared/quick-sites'
import { BROWSER_LABELS, siteAccent, siteInitials } from '@/lib/site-visuals'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{
    site: QuickSite
    browsers?: DetectedBrowser[]
    opening?: boolean
  }>(),
  { browsers: () => [], opening: false }
)

const emit = defineEmits<{
  open: []
  edit: []
  remove: []
}>()

const initials = computed(() => siteInitials(props.site.name))

const accent = computed(() => siteAccent(props.site.url))

/** 展示域名：去掉 www. 前缀 */
const host = computed(() => hostOf(props.site.url).replace(/^www\./, ''))

interface TargetLabel {
  text: string
  warn: boolean
}

/** 解析单个打开方式的可读标签 */
const resolveTargetLabel = (target: QuickSiteTarget): TargetLabel => {
  if (target.browserId === SYSTEM_BROWSER_ID) {
    return { text: BROWSER_LABELS.system, warn: false }
  }
  const browser = props.browsers.find((item) => item.id === target.browserId)
  if (browser === undefined) {
    return {
      text: `${BROWSER_LABELS[target.browserId]}（不可用）`,
      warn: true
    }
  }
  if (target.profileId === '') {
    return { text: `${browser.name} · 默认角色`, warn: false }
  }
  const profile = browser.profiles.find((item) => item.id === target.profileId)
  if (profile === undefined) {
    return { text: `${browser.name} · 角色（不可用）`, warn: true }
  }
  return { text: `${browser.name} · ${profile.name}`, warn: false }
}

const targetLabels = computed<TargetLabel[]>(() =>
  props.site.targets.map((target) => resolveTargetLabel(target))
)

const ariaLabel = computed(() => {
  const labels = targetLabels.value
  if (labels.length === 1) {
    return `用 ${labels[0]?.text ?? ''} 打开 ${props.site.name}`
  }
  return `用 ${labels.length} 个打开方式打开 ${props.site.name}`
})

/** 底部目标徽标：单目标显示标签，多目标显示数量 */
const badge = computed<{
  text: string
  title: string
  warn: boolean
}>(() => {
  const labels = targetLabels.value
  const first = labels[0]
  if (labels.length === 1 && first) {
    return { text: first.text, title: first.text, warn: first.warn }
  }
  return {
    text: `${labels.length} 个打开方式`,
    title: labels.map((label) => label.text).join('、'),
    warn: labels.some((label) => label.warn)
  }
})

const handleOpen = (): void => {
  if (props.opening) {
    return
  }
  emit('open')
}

/** 仅响应卡片自身键盘事件，避免子按钮的 Enter / Space 触发打开 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.target !== event.currentTarget) {
    return
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  event.preventDefault()
  handleOpen()
}
</script>

<template>
  <article
    role="button"
    :tabindex="opening ? -1 : 0"
    :aria-label="ariaLabel"
    :aria-busy="opening"
    class="group relative flex flex-col gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:border-foreground/20 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    :class="{ 'cursor-pointer': !opening, 'cursor-default': opening }"
    @click="handleOpen"
    @keydown="handleKeydown"
  >
    <div class="flex items-start gap-3 pr-14">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold"
        :class="accent"
        aria-hidden="true"
      >
        {{ initials }}
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 class="truncate text-sm font-medium">{{ site.name }}</h3>
        <p class="text-muted-foreground truncate text-[11px]">{{ host }}</p>
      </div>
    </div>

    <div class="absolute top-2 right-2">
      <div
        v-if="opening"
        class="text-muted-foreground flex size-6 items-center justify-center"
        aria-hidden="true"
      >
        <Loader2 class="size-3.5 animate-spin" />
      </div>
      <div
        v-else
        class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="编辑站点"
              @click.stop="emit('edit')"
            >
              <Pencil aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              class="text-destructive hover:text-destructive"
              aria-label="删除站点"
              @click.stop="emit('remove')"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <footer class="mt-auto flex items-center">
      <span
        class="bg-foreground/5 inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] leading-none"
        :class="{ 'text-destructive': badge.warn }"
        :title="badge.title"
      >
        <AlertTriangle
          v-if="badge.warn"
          class="size-3 shrink-0"
          aria-hidden="true"
        />
        <Globe v-else class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span class="truncate">{{ badge.text }}</span>
      </span>
    </footer>
  </article>
</template>
