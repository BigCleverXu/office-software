<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Globe } from 'lucide-vue-next'
import {
  hostOf,
  type DetectedBrowser,
  type QuickSite
} from '@shared/quick-sites'
import {
  siteAccent,
  siteInitials,
  siteOpenAriaLabel,
  siteTargetBadge
} from '@/lib/site-visuals'
import QuickSiteCardShell from '@/components/QuickSiteCardShell.vue'

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

const ariaLabel = computed(() => siteOpenAriaLabel(props.site, props.browsers))

/** 底部目标徽标：单目标显示标签，多目标显示数量 */
const badge = computed(() => siteTargetBadge(props.site, props.browsers))

const handleOpen = (): void => {
  if (props.opening) {
    return
  }
  emit('open')
}
</script>

<template>
  <QuickSiteCardShell
    :aria-label="ariaLabel"
    :opening="opening"
    edit-label="编辑站点"
    remove-label="删除站点"
    @open="handleOpen"
    @edit="emit('edit')"
    @remove="emit('remove')"
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

    <template #footer>
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
    </template>
  </QuickSiteCardShell>
</template>
