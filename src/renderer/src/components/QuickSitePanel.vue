<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Plus,
  Search,
  SearchX
} from 'lucide-vue-next'
import type { QuickSite, QuickSiteDraft } from '@shared/quick-sites'
import QuickSiteCard from '@/components/QuickSiteCard.vue'
import QuickSiteFormDialog from '@/components/QuickSiteFormDialog.vue'
import QuickSiteGroupSection from '@/components/QuickSiteGroupSection.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirm } from '@/composables/useConfirm'
import { useQuickSites } from '@/composables/useQuickSites'
import { QUICK_SITE_PRESETS, type QuickSitePreset } from '@/lib/site-visuals'

const {
  sites,
  browsers,
  browsersLoading,
  refresh,
  refreshBrowsers,
  create,
  update,
  remove,
  open
} = useQuickSites()

onMounted(() => {
  void refresh()
  void refreshBrowsers()
})

const searchQuery = ref('')

const keyword = computed(() => searchQuery.value.trim().toLowerCase())

/** 按名称或网址做大小写不敏感的包含匹配 */
const filteredSites = computed<QuickSite[]>(() => {
  const query = keyword.value
  if (query === '') {
    return sites.value
  }
  return sites.value.filter(
    (site) =>
      site.name.toLowerCase().includes(query) ||
      site.url.toLowerCase().includes(query)
  )
})

/** 底部轻提示：2.8 秒后自动消失 */
type ToastKind = 'success' | 'error'

const toast = ref<{ kind: ToastKind; message: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

const clearToastTimer = (): void => {
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

const showToast = (kind: ToastKind, message: string): void => {
  clearToastTimer()
  toast.value = { kind, message }
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 2800)
}

onUnmounted(clearToastTimer)

const openingId = ref<string | null>(null)

const handleOpenSite = async (site: QuickSite): Promise<void> => {
  if (openingId.value !== null) {
    return
  }
  openingId.value = site.id
  try {
    const result = await open(site.id)
    if (!result.ok) {
      showToast('error', result.errors?.[0] ?? '打开失败')
      return
    }
    const parts = [`已打开 ${result.opened} 个窗口`]
    if (result.fallback > 0) {
      parts.push(`${result.fallback} 个回退到系统默认`)
    }
    if (result.failed > 0) {
      parts.push(`${result.failed} 个打开失败`)
    }
    const kind: ToastKind = result.failed > 0 ? 'error' : 'success'
    showToast(kind, parts.join('，'))
  } catch {
    showToast('error', '打开失败')
  } finally {
    openingId.value = null
  }
}

const handleRemoveSite = async (site: QuickSite): Promise<void> => {
  const confirmed = await confirm({
    title: '删除站点',
    description: `删除站点「${site.name}」？`
  })
  if (!confirmed) {
    return
  }
  try {
    await remove(site.id)
  } catch {
    showToast('error', '删除失败')
  }
}

const formOpen = ref(false)
const editingSite = ref<QuickSite | null>(null)
const preset = ref<QuickSitePreset | null>(null)
const formError = ref('')
const saving = ref(false)

const openCreateDialog = (nextPreset: QuickSitePreset | null = null): void => {
  editingSite.value = null
  preset.value = nextPreset
  formError.value = ''
  formOpen.value = true
}

const openEditDialog = (site: QuickSite): void => {
  editingSite.value = site
  preset.value = null
  formError.value = ''
  formOpen.value = true
}

const handleSubmit = async (draft: QuickSiteDraft): Promise<void> => {
  saving.value = true
  formError.value = ''
  try {
    const result = editingSite.value
      ? await update(editingSite.value.id, draft)
      : await create(draft)
    if (result.ok) {
      formOpen.value = false
      editingSite.value = null
      preset.value = null
    } else {
      formError.value = result.error ?? '保存失败'
    }
  } catch {
    formError.value = '保存失败'
  } finally {
    saving.value = false
  }
}

const handleRescan = async (): Promise<void> => {
  await refreshBrowsers()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <QuickSiteGroupSection />

    <div class="flex shrink-0 flex-col gap-2 px-6 py-4">
      <div class="flex items-center justify-between gap-3">
        <div class="relative w-full max-w-xs">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            v-model="searchQuery"
            class="pl-8"
            placeholder="搜索名称或网址"
            aria-label="搜索名称或网址"
          />
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <span class="text-muted-foreground text-xs">
            共
            <span class="text-foreground font-medium">{{ sites.length }}</span>
            个站点
          </span>
          <Button size="sm" @click="openCreateDialog()">
            <Plus data-icon="inline-start" />
            新增站点
          </Button>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto scroll-py-2 px-6 pt-2 pb-6">
      <div
        v-if="sites.length === 0"
        class="empty-state text-muted-foreground h-full"
      >
        <span class="empty-state-icon"><Globe class="size-6" /></span>
        <div class="flex flex-col gap-1">
          <p class="text-foreground text-sm font-semibold">还没有快捷站点</p>
          <p class="text-sm">把每天要打开的网站放进来，点一下直达</p>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            v-for="item in QUICK_SITE_PRESETS"
            :key="item.url"
            type="button"
            class="hover:bg-muted hover:text-foreground rounded-full border px-3 py-1 text-xs transition-colors"
            @click="openCreateDialog(item)"
          >
            {{ item.name }}
          </button>
        </div>
      </div>

      <div
        v-else-if="filteredSites.length === 0"
        class="empty-state text-muted-foreground h-full"
      >
        <span class="empty-state-icon"><SearchX class="size-6" /></span>
        <div class="flex flex-col gap-1">
          <p class="text-foreground text-sm font-semibold">没有匹配的站点</p>
          <p class="text-sm">换个关键词试试</p>
        </div>
      </div>

      <div
        v-else
        class="stagger-list grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]"
      >
        <QuickSiteCard
          v-for="site in filteredSites"
          :key="site.id"
          :site="site"
          :browsers="browsers"
          :opening="openingId === site.id"
          @open="handleOpenSite(site)"
          @edit="openEditDialog(site)"
          @remove="handleRemoveSite(site)"
        />
      </div>
    </div>

    <div
      v-if="toast"
      class="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
    >
      <div
        class="bg-popover text-popover-foreground ring-foreground/10 flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm shadow-lg ring-1"
        :role="toast.kind === 'error' ? 'alert' : 'status'"
      >
        <CheckCircle2
          v-if="toast.kind === 'success'"
          class="size-4 shrink-0 text-emerald-600"
          aria-hidden="true"
        />
        <AlertCircle
          v-else
          class="text-destructive size-4 shrink-0"
          aria-hidden="true"
        />
        <span>{{ toast.message }}</span>
      </div>
    </div>

    <QuickSiteFormDialog
      v-model:open="formOpen"
      :site="editingSite"
      :preset="preset"
      :browsers="browsers"
      :scanning="browsersLoading"
      :saving="saving"
      :error="formError"
      @submit="handleSubmit"
      @rescan="handleRescan"
    />
  </div>
</template>
