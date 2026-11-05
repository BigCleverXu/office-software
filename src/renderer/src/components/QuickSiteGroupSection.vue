<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { AlertCircle, CheckCircle2, Layers, Plus } from 'lucide-vue-next'
import type {
  OpenQuickSiteGroupResult,
  QuickSiteGroup,
  QuickSiteGroupDraft
} from '@shared/quick-sites'
import QuickSiteGroupCard from '@/components/QuickSiteGroupCard.vue'
import QuickSiteGroupFormDialog from '@/components/QuickSiteGroupFormDialog.vue'
import { Button } from '@/components/ui/button'
import { confirm } from '@/composables/useConfirm'
import { useQuickSiteGroups } from '@/composables/useQuickSiteGroups'
import { useQuickSites } from '@/composables/useQuickSites'

const { sites, refresh: refreshSites } = useQuickSites()

const {
  groups,
  refresh: refreshGroups,
  create: createGroup,
  update: updateGroup,
  remove: removeGroup,
  open: openGroup
} = useQuickSiteGroups()

onMounted(() => {
  void refreshGroups()
  void refreshSites()
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

const openingGroupId = ref<string | null>(null)

/** 汇总打开编组的结果：成功 / 回退 / 失败分别计数并追加提示 */
const showGroupOpenToast = (result: OpenQuickSiteGroupResult): void => {
  const parts: string[] = []
  if (result.opened > 0) {
    parts.push(`已打开 ${result.opened} 个窗口`)
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
  const confirmed = await confirm({
    title: '删除编组',
    description: `删除编组「${group.name}」？`
  })
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
</script>

<template>
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
      class="mt-3 grid max-h-60 scroll-py-2 gap-3 overflow-y-auto pr-1 pt-2 min-h-0 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]"
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
