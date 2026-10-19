<script setup lang="ts">
import { computed, ref } from 'vue'
import { DownloadCloud, Loader2 } from 'lucide-vue-next'
import type { UpdateCheckResult, UpdateErrorReason } from '@shared/update'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

defineProps<{ collapsed: boolean }>()

const checking = ref(false)
const open = ref(false)
const result = ref<UpdateCheckResult | null>(null)

/** 失败原因到中文文案的映射 */
const ERROR_TEXT: Record<UpdateErrorReason, string> = {
  network: '网络不可用，请检查网络后重试',
  timeout: '请求超时，请稍后重试',
  'rate-limited': '请求过于频繁，请稍后再试',
  unreadable: '无法读取发行版信息，请确认仓库可访问',
  unknown: '发生未知错误'
}

const buttonText = computed(() => (checking.value ? '检查中…' : '检查更新'))

const currentVersion = computed(() => result.value?.currentVersion ?? '')

/** 仅在「发现新版本」时返回发行版信息，供模板渲染正文 */
const release = computed(() =>
  result.value?.status === 'update-available' ? result.value.release : null
)

const errorText = computed(() => {
  const current = result.value
  return current?.status === 'error' ? ERROR_TEXT[current.reason] : ''
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
  switch (result.value?.status) {
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
  switch (result.value?.status) {
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

const handleClick = async (): Promise<void> => {
  if (checking.value) return
  checking.value = true
  try {
    result.value = await window.api.update.check()
  } catch {
    result.value = {
      status: 'error',
      currentVersion: '',
      reason: 'unknown'
    }
  } finally {
    checking.value = false
  }
  open.value = true
}

const openReleasePage = (): void => {
  if (result.value?.status === 'update-available') {
    window.open(result.value.release.pageUrl)
  }
}
</script>

<template>
  <Tooltip v-if="collapsed">
    <TooltipTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        aria-label="检查更新"
        title="检查更新"
        class="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-auto w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-sm font-normal"
        :disabled="checking"
        @click="handleClick"
      >
        <Loader2 v-if="checking" class="size-4 shrink-0 animate-spin" />
        <DownloadCloud v-else class="size-4 shrink-0" />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right">检查更新</TooltipContent>
  </Tooltip>

  <Button
    v-else
    type="button"
    variant="ghost"
    class="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-auto w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-sm font-normal"
    :disabled="checking"
    @click="handleClick"
  >
    <Loader2 v-if="checking" class="size-4 shrink-0 animate-spin" />
    <DownloadCloud v-else class="size-4 shrink-0" />
    <span class="truncate">{{ buttonText }}</span>
  </Button>

  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{ dialogDescription }}</DialogDescription>
      </DialogHeader>

      <div v-if="release" class="flex flex-col gap-3 py-2">
        <p class="text-sm">
          当前版本 {{ currentVersion }} → 新版本 {{ release?.version }}
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
