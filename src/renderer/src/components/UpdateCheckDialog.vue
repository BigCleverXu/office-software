<script setup lang="ts">
import { computed } from 'vue'
import type { UpdateCheckResult } from '@shared/update'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { UPDATE_ERROR_TEXT } from '@/composables/useUpdateCheck'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  checking: boolean
  result: UpdateCheckResult | null
}>()

const currentVersion = computed(() => props.result?.currentVersion ?? '')

/** 仅在「发现新版本」时返回发行版信息，供模板渲染正文 */
const release = computed(() =>
  props.result?.status === 'update-available' ? props.result.release : null
)

const errorText = computed(() => {
  const current = props.result
  return current?.status === 'error' ? UPDATE_ERROR_TEXT[current.reason] : ''
})

const publishedText = computed(() => {
  const raw = release.value?.publishedAt ?? null
  if (!raw) return '未知'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN')
})

const notesText = computed(() => release.value?.notes.trim() ?? '')

const dialogTitle = computed(() => {
  switch (props.result?.status) {
    case 'update-available':
      return '发现新版本'
    case 'up-to-date':
      return '已是最新版本'
    case 'no-release':
      return '暂无发行版'
    default:
      return '检查更新失败'
  }
})

const dialogDescription = computed(() => {
  switch (props.result?.status) {
    case 'update-available':
      return `检测到有新版本 ${release.value?.version ?? ''} 可用。`
    case 'up-to-date':
      return `当前版本 ${currentVersion.value}，已是最新`
    case 'no-release':
      return `该仓库还没有发布过任何版本，当前版本 ${currentVersion.value}`
    case 'error':
      return `${errorText.value}（当前版本 ${currentVersion.value}）`
    default:
      return '检查更新结果'
  }
})

const openReleasePage = (): void => {
  if (props.result?.status === 'update-available') {
    window.open(props.result.release.pageUrl)
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{ dialogDescription }}</DialogDescription>
      </DialogHeader>

      <div v-if="release" class="flex flex-col gap-3 py-2">
        <p class="text-sm">
          当前版本 {{ currentVersion }} → 新版本 {{ release.version }}
        </p>
        <p class="text-muted-foreground text-sm">
          发布时间：{{ publishedText }}
        </p>
        <div class="max-h-64 overflow-y-auto rounded-md border p-3">
          <p v-if="notesText" class="whitespace-pre-wrap text-sm">
            {{ notesText }}
          </p>
          <p v-else class="text-muted-foreground text-sm">该版本未填写说明</p>
        </div>
      </div>

      <DialogFooter>
        <template v-if="release">
          <Button variant="outline" @click="open = false">稍后</Button>
          <Button @click="openReleasePage">打开发行版页面</Button>
        </template>
        <Button v-else variant="outline" @click="open = false"> 关闭 </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
