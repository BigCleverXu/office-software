<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Layers,
  Plus,
  Search,
  SearchX
} from 'lucide-vue-next'
import type {
  DetectedBrowser,
  OpenQuickSiteGroupResult,
  QuickSite,
  QuickSiteDraft,
  QuickSiteGroup,
  QuickSiteGroupDraft
} from '@shared/quick-sites'
import QuickSiteCard from '@/components/QuickSiteCard.vue'
import QuickSiteFormDialog from '@/components/QuickSiteFormDialog.vue'
import QuickSiteGroupCard from '@/components/QuickSiteGroupCard.vue'
import QuickSiteGroupFormDialog from '@/components/QuickSiteGroupFormDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuickSiteGroups } from '@/composables/useQuickSiteGroups'
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

const {
  groups,
  refresh: refreshGroups,
  create: createGroup,
  update: updateGroup,
  remove: removeGroup,
  open: openGroup
} = useQuickSiteGroups()

onMounted(() => {
  void refresh()
  void refreshGroups()
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
      showToast('error', result.error ?? '打开失败')
    } else if (result.fallback) {
      showToast('success', '原浏览器不可用，已使用系统默认浏览器打开')
    } else {
      showToast('success', `已用 ${result.browserName ?? '浏览器'} 打开`)
    }
  } catch {
    showToast('error', '打开失败')
  } finally {
    openingId.value = null
  }
}

const handleRemoveSite = async (site: QuickSite): Promise<void> => {
  const confirmed = window.confirm(`删除站点「${site.name}」？`)
  if (!confirmed) {
    return
  }
  try {
    await remove(site.id)
  } catch {
    showToast('error', '删除失败')
  }
}

const openingGroupId = ref<string | null>(null)

/** 汇总打开编组的结果：成功 / 回退 / 失败分别计数并追加提示 */
const showGroupOpenToast = (result: OpenQuickSiteGroupResult): void => {
  const parts: string[] = []
  if (result.opened > 0) {
    parts.push(`已打开 ${result.opened} 个网站`)
  }
  if (result.fallback > 0) {
    parts.push(`${result.fallback} 个回退到系统默认`)
  }
  if (result.failed > 0) {
    parts.push(`${result.failed} 个打开失败`)
  }
  const summary = parts.length > 0 ? parts.join('，') : '未能打开网站'
  const detail = result.errors?.[0]
  const kind: ToastKind =
    result.opened === 0 || result.failed > 0 ? 'error' : 'success'
  showToast(
    kind,
    kind === 'error' && detail ? `${summary}：${detail}` : summary
  )
}

const handleOpenGroup = async (group: QuickSiteGroup): Promise<void> => {
  if (openingGroupId.value !== null) {
    return
  }
  openingGroupId.value = group.id
  try {
    const result = await openGroup(group.id)
    showGroupOpenToast(result)
  } catch {
    showToast('error', '打开失败')
  } finally {
    openingGroupId.value = null
  }
}

const handleRemoveGroup = async (group: QuickSiteGroup): Promise<void> => {
  const confirmed = window.confirm(`删除编组「${group.name}」？`)
  if (!confirmed) {
    return
  }
  try {
    await removeGroup(group.id)
  } catch {
    showToast('error', '删除失败')
  }
}

const groupFormOpen = ref(false)
const editingGroup = ref<QuickSiteGroup | null>(null)
const groupFormError = ref('')
const groupSaving = ref(false)

const openGroupCreateDialog = (): void => {
  editingGroup.value = null
  groupFormError.value = ''
  groupFormOpen.value = true
}

const openGroupEditDialog = (group: QuickSiteGroup): void => {
  editingGroup.value = group
  groupFormError.value = ''
  groupFormOpen.value = true
}

const handleGroupSubmit = async (draft: QuickSiteGroupDraft): Promise<void> => {
  groupSaving.value = true
  groupFormError.value = ''
  try {
    const result = editingGroup.value
      ? await updateGroup(editingGroup.value.id, draft)
      : await createGroup(draft)
    if (result.ok) {
      groupFormOpen.value = false
      editingGroup.value = null
    } else {
      groupFormError.value = result.error ?? '保存失败'
    }
  } catch {
    groupFormError.value = '保存失败'
  } finally {
    groupSaving.value = false
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

const browserFor = (site: QuickSite): DetectedBrowser | undefined =>
  browsers.value.find((browser) => browser.id === site.browserId)

const profileNameFor = (
  site: QuickSite,
  browser: DetectedBrowser | undefined
): string =>
  browser?.profiles.find((profile) => profile.id === site.profileId)?.name ??
  (site.profileId ? '未知角色' : '')
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="shrink-0 px-6 pt-5">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold">编组</h2>
          <span class="text-muted-foreground text-xs">
            {{ groups.length }} 个编组
          </span>
        </div>
        <Button variant="outline" size="sm" @click="openGroupCreateDialog">
          <Plus data-icon="inline-start" />
          新建编组
        </Button>
      </div>

      <div
        v-if="groups.length > 0"
        class="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))] max-h-60 overflow-y-auto pr-1"
      >
        <QuickSiteGroupCard
          v-for="group in groups"
          :key="group.id"
          :group="group"
          :site-count="group.siteIds.length"
          :opening="openingGroupId === group.id"
          @open="handleOpenGroup(group)"
          @edit="openGroupEditDialog(group)"
          @remove="handleRemoveGroup(group)"
        />
      </div>

      <div
        v-else
        class="mt-3 flex items-center gap-3 rounded-xl border border-dashed px-3.5 py-3"
      >
        <span
          class="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          <Layers class="size-4" />
        </span>
        <p class="text-muted-foreground min-w-0 flex-1 text-xs">
          把常一起打开的网站编成一组，一次点开全部
        </p>
        <Button variant="outline" size="xs" @click="openGroupCreateDialog">
          新建编组
        </Button>
      </div>
    </div>

    <div class="flex flex-col gap-2 px-6 py-4">
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

    <div class="flex-1 overflow-y-auto px-6 pb-6">
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
          :browser="browserFor(site)"
          :profile-name="profileNameFor(site, browserFor(site))"
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

    <QuickSiteGroupFormDialog
      v-model:open="groupFormOpen"
      :group="editingGroup"
      :sites="sites"
      :saving="groupSaving"
      :error="groupFormError"
      @submit="handleGroupSubmit"
    />
  </div>
</template>
