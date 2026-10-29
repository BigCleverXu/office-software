<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import {
  ExternalLink,
  File,
  FileWarning,
  FolderOpen,
  Loader2
} from 'lucide-vue-next'
import { FILE_KIND_LABELS } from '@shared/files'
import type { FileEntry, FilePreview } from '@shared/files'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatBytes, formatModifiedAt } from '@/lib/file-format'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ path: string }>()

const loading = ref(false)
const error = ref('')
const hint = ref('')
const entry = ref<FileEntry | null>(null)
const preview = ref<FilePreview | null>(null)
const mediaError = ref<boolean>(false)

/** 递增请求号：关闭或换文件时丢弃过期响应 */
let requestId = 0

const { start: startHintTimer } = useTimeoutFn(
  () => {
    hint.value = ''
  },
  3000,
  { immediate: false }
)

const showHint = (message: string): void => {
  hint.value = message
  startHintTimer()
}

/** 预览失败时展示的错误文案 */
const errorText = computed<string>(() => error.value || '无法预览该文件')

/** 当前预览是否为媒体类型 */
const isMediaPreview = computed<boolean>(() => {
  const type = preview.value?.type
  return type === 'image' || type === 'audio' || type === 'video'
})

/** 图片/音频/视频加载失败 */
const handleMediaError = (): void => {
  mediaError.value = true
}

const fileName = computed<string>(() => {
  if (entry.value) return entry.value.name
  return props.path.split(/[\\/]/).pop() || props.path
})

const kindLabel = computed<string>(() =>
  entry.value ? FILE_KIND_LABELS[entry.value.kind] : '文件'
)

const dirLabel = computed<string>(() => entry.value?.dir ?? '')

const sizeLabel = computed<string>(() =>
  entry.value ? formatBytes(entry.value.size) : ''
)

const modifiedLabel = computed<string>(() =>
  entry.value ? formatModifiedAt(entry.value.modifiedAt) : ''
)

const resetState = (): void => {
  requestId += 1
  loading.value = false
  error.value = ''
  hint.value = ''
  mediaError.value = false
  entry.value = null
  preview.value = null
}

const load = async (): Promise<void> => {
  const current = ++requestId
  error.value = ''
  hint.value = ''
  mediaError.value = false
  entry.value = null
  preview.value = null

  if (!props.path) {
    error.value = '无法预览该文件'
    return
  }

  loading.value = true
  try {
    const result = await window.api.files.preview(props.path)
    if (current !== requestId) return
    entry.value = result.entry ?? null
    if (!result.ok || !result.preview) {
      error.value = result.error ?? ''
      return
    }
    preview.value = result.preview
  } catch {
    if (current !== requestId) return
    error.value = ''
  } finally {
    if (current === requestId) {
      loading.value = false
    }
  }
}

watch([open, () => props.path], ([isOpen]) => {
  if (isOpen) {
    void load()
    return
  }
  mediaError.value = false
  resetState()
})

const handleOpen = async (): Promise<void> => {
  try {
    const result = await window.api.files.open(props.path)
    if (!result.ok) {
      showHint(result.error ?? '无法用默认程序打开该文件')
    }
  } catch {
    showHint('无法用默认程序打开该文件')
  }
}

const handleReveal = async (): Promise<void> => {
  try {
    const result = await window.api.files.reveal(props.path)
    if (!result.ok) {
      showHint(result.error ?? '无法在文件夹中显示该文件')
    }
  } catch {
    showHint('无法在文件夹中显示该文件')
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 pr-8">
          <span class="truncate" :title="path">{{ fileName }}</span>
          <Badge variant="secondary" class="shrink-0">{{ kindLabel }}</Badge>
        </DialogTitle>
        <DialogDescription class="flex flex-col gap-0.5 text-xs">
          <span v-if="dirLabel" class="max-w-full truncate" :title="dirLabel">
            {{ dirLabel }}
          </span>
          <span class="flex items-center gap-1.5">
            <span v-if="sizeLabel">{{ sizeLabel }}</span>
            <span v-if="sizeLabel && modifiedLabel" aria-hidden="true">·</span>
            <span v-if="modifiedLabel">{{ modifiedLabel }}</span>
          </span>
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-24">
        <div
          v-if="loading"
          class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
        >
          <Loader2 class="size-4 animate-spin" aria-hidden="true" />
          正在加载预览…
        </div>

        <div v-else-if="error" class="empty-state py-12">
          <span class="empty-state-icon"><FileWarning class="size-6" /></span>
          <p class="text-destructive text-sm">{{ errorText }}</p>
          <p class="text-muted-foreground text-xs">可以尝试用默认程序打开</p>
        </div>

        <template v-else-if="preview">
          <div v-if="isMediaPreview && mediaError" class="empty-state py-12">
            <span class="empty-state-icon"><FileWarning class="size-6" /></span>
            <p class="text-destructive text-sm">无法加载预览内容</p>
            <p class="text-muted-foreground text-xs">
              请使用默认程序打开该文件
            </p>
          </div>

          <div
            v-else-if="preview.type === 'image'"
            class="bg-muted/40 flex items-center justify-center rounded-xl p-4"
          >
            <img
              :src="preview.url"
              alt="文件预览"
              class="max-h-[60vh] w-auto object-contain"
              @error="handleMediaError"
            />
          </div>

          <div v-else-if="preview.type === 'text'" class="flex flex-col gap-2">
            <p
              v-if="preview.truncated"
              class="text-muted-foreground bg-muted/40 rounded-md px-3 py-1.5 text-xs"
            >
              文件较大，仅展示前 200 KB
            </p>
            <pre
              class="bg-muted/40 max-h-[60vh] overflow-auto rounded-xl p-3 font-mono text-xs break-all whitespace-pre-wrap select-text"
              >{{ preview.content }}</pre>
          </div>

          <div
            v-else-if="preview.type === 'audio'"
            class="bg-muted/40 rounded-xl p-4"
          >
            <audio
              :src="preview.url"
              controls
              class="w-full"
              @error="handleMediaError"
            >
              当前环境不支持音频播放
            </audio>
          </div>

          <div
            v-else-if="preview.type === 'video'"
            class="bg-muted/40 flex justify-center rounded-xl p-2"
          >
            <video
              :src="preview.url"
              controls
              class="max-h-[60vh] w-full rounded-lg bg-black"
              @error="handleMediaError"
            >
              当前环境不支持视频播放
            </video>
          </div>

          <div v-else class="empty-state py-12">
            <span class="empty-state-icon"><File class="size-6" /></span>
            <p class="text-foreground text-sm font-semibold">
              该类型暂不支持内嵌预览
            </p>
            <p class="text-muted-foreground text-xs">
              请使用默认程序打开该文件
            </p>
          </div>
        </template>
      </div>

      <p v-if="hint" class="text-destructive text-xs">{{ hint }}</p>

      <DialogFooter>
        <Button variant="outline" @click="open = false">关闭</Button>
        <Button variant="outline" @click="handleReveal">
          <FolderOpen data-icon="inline-start" />
          在文件夹中显示
        </Button>
        <Button @click="handleOpen">
          <ExternalLink data-icon="inline-start" />
          用默认程序打开
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
