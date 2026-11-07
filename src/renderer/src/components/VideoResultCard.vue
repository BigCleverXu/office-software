<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import {
  AlertCircle,
  Captions,
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  FolderSearch,
  RefreshCw,
  User,
  X
} from 'lucide-vue-next'
import {
  formatByteSize,
  formatDuration,
  platformLabel,
  videoErrorMessage
} from '@shared/video'
import type {
  VideoContainer,
  VideoDownloadProgress,
  VideoDownloadSnapshot,
  VideoVariant
} from '@shared/video'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useVideo } from '@/composables/useVideo'

type DownloadingSnapshot = Extract<
  VideoDownloadSnapshot,
  { status: 'downloading' }
>
type CompletedSnapshot = Extract<VideoDownloadSnapshot, { status: 'completed' }>
type FailedSnapshot = Extract<VideoDownloadSnapshot, { status: 'failed' }>

const CONTAINER_LABELS: Record<VideoContainer, string> = {
  mp4: 'MP4',
  flv: 'FLV',
  m4s: 'M4S',
  unknown: '未知格式'
}

const {
  resource,
  selectedVariantId,
  selectedVariant,
  selectVariant,
  downloadSnapshot,
  download,
  cancelDownload,
  openDownloaded,
  showInFolder,
  transcriptStart,
  transcriptBusy,
  actionError
} = useVideo()

/** 封面加载失败后改用平台首字占位 */
const coverFailed = ref(false)

const coverUrl = computed<string>(() => resource.value?.cover?.url ?? '')

const showCover = computed<boolean>(
  () => coverUrl.value !== '' && !coverFailed.value
)

const platformName = computed<string>(() =>
  resource.value === null ? '' : platformLabel(resource.value.platform)
)

const platformInitial = computed<string>(() => platformName.value.slice(0, 1))

const kindLabel = computed<string>(() =>
  resource.value?.kind === 'note' ? '图文' : '视频'
)

const author = computed<string>(() => resource.value?.author.trim() ?? '')

const description = computed<string>(
  () => resource.value?.description?.trim() ?? ''
)

const hasDuration = computed<boolean>(
  () => typeof resource.value?.durationSec === 'number'
)

const durationLabel = computed<string>(() =>
  formatDuration(resource.value?.durationSec)
)

/** 发布时间格式化为日期，非法或缺失时返回空串 */
const publishedLabel = computed<string>(() => {
  const raw = resource.value?.publishedAt
  if (typeof raw !== 'string' || raw.trim() === '') return ''
  const parsed = dayjs(raw)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : ''
})

const variants = computed<VideoVariant[]>(() => resource.value?.variants ?? [])

const images = computed(() => resource.value?.images ?? [])

/** 图文图片加载失败的索引集合，失败时展示占位而非破图 */
const failedImages = ref<Set<number>>(new Set())

/** 当前预览的图片索引，null 表示弹窗关闭 */
const previewIndex = ref<number | null>(null)

const previewImage = computed(() => {
  const index = previewIndex.value
  return index === null ? null : (images.value[index] ?? null)
})

const previewTitle = computed<string>(() => {
  const index = previewIndex.value
  if (index === null) return ''
  return `第 ${index + 1} / 共 ${images.value.length} 张`
})

const previewFailed = computed<boolean>(() => {
  const index = previewIndex.value
  return index !== null && failedImages.value.has(index)
})

const previewAlt = computed<string>(() => {
  const index = previewIndex.value
  const title = resource.value?.title ?? ''
  return index === null ? title : `${title} 图片 ${index + 1}`
})

/** 记录失败索引，重新赋值保证 Set 变更可被追踪 */
function markImageFailed(index: number): void {
  failedImages.value = new Set(failedImages.value).add(index)
}

/** 弹窗关闭时清空预览索引 */
const handlePreviewOpenChange = (open: boolean): void => {
  if (!open) previewIndex.value = null
}

/** 预览大图加载失败时记录索引，弹窗内展示占位 */
const handlePreviewImageError = (): void => {
  const index = previewIndex.value
  if (index !== null) markImageFailed(index)
}

const downloadingState = computed<DownloadingSnapshot | null>(() =>
  downloadSnapshot.value.status === 'downloading'
    ? downloadSnapshot.value
    : null
)

const completedState = computed<CompletedSnapshot | null>(() =>
  downloadSnapshot.value.status === 'completed' ? downloadSnapshot.value : null
)

const failedState = computed<FailedSnapshot | null>(() =>
  downloadSnapshot.value.status === 'failed' ? downloadSnapshot.value : null
)

const downloading = computed<boolean>(() => downloadingState.value !== null)

/** 档位附加信息：容器与分辨率 */
function variantMeta(variant: VideoVariant): string {
  const parts = [CONTAINER_LABELS[variant.container]]
  if (typeof variant.width === 'number' && typeof variant.height === 'number') {
    parts.push(`${variant.width}×${variant.height}`)
  }
  return parts.join(' · ')
}

/** 当前档位的大小，未知时返回空串 */
const selectedVariantSize = computed<string>(() => {
  const variant = selectedVariant.value
  if (variant?.size === undefined || variant.size <= 0) return ''
  return formatByteSize(variant.size)
})

function totalLabel(progress: VideoDownloadProgress): string {
  return progress.total > 0 ? formatByteSize(progress.total) : '未知大小'
}

function speedLabel(progress: VideoDownloadProgress): string {
  if (progress.speedBytesPerSec <= 0) return '计算速度中'
  return `${formatByteSize(progress.speedBytesPerSec)}/s`
}

/** 剩余时间：秒级估算，超过一分钟按分秒展示 */
function remainingLabel(progress: VideoDownloadProgress): string {
  const remaining = progress.remainingMs
  if (remaining === null || !Number.isFinite(remaining)) {
    return '剩余时间未知'
  }
  const seconds = Math.max(0, Math.round(remaining / 1000))
  if (seconds < 5) return '即将完成'
  if (seconds < 60) return `剩余约 ${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0
    ? `剩余约 ${minutes} 分钟`
    : `剩余约 ${minutes} 分 ${rest} 秒`
}

const handleVariantUpdate = (value: unknown): void => {
  if (typeof value === 'string') {
    selectVariant(value)
  }
}

watch(
  () => resource.value?.id ?? '',
  () => {
    coverFailed.value = false
    failedImages.value = new Set()
    previewIndex.value = null
  }
)
</script>

<template>
  <Card v-if="resource" class="shadow-soft min-w-0 overflow-hidden">
    <div class="bg-muted relative h-36 w-full overflow-hidden sm:h-44">
      <img
        v-if="showCover"
        :src="coverUrl"
        :alt="resource.title"
        referrerpolicy="no-referrer"
        loading="lazy"
        class="h-full w-full object-cover"
        @error="coverFailed = true"
      />
      <div
        v-else
        class="from-muted via-muted/70 to-accent/70 flex h-full w-full items-center justify-center bg-gradient-to-br"
      >
        <span
          class="text-muted-foreground text-3xl font-semibold tracking-[0.2em]"
        >
          {{ platformInitial }}
        </span>
      </div>

      <div
        class="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3"
      >
        <Badge
          variant="secondary"
          class="bg-background/85 text-foreground border-border/60 backdrop-blur"
        >
          {{ kindLabel }}
        </Badge>
        <div class="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            class="bg-background/85 text-foreground border-border/60 backdrop-blur"
          >
            {{ platformName }}
          </Badge>
          <span
            v-if="hasDuration"
            class="bg-background/85 text-foreground border-border/60 rounded-full border px-2 py-0.5 text-[11px] tabular-nums backdrop-blur"
          >
            {{ durationLabel }}
          </span>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-3 p-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h2
          class="text-lg leading-snug font-semibold tracking-tight break-words"
        >
          {{ resource.title }}
        </h2>
        <div
          class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
          <span v-if="author" class="flex min-w-0 items-center gap-1">
            <User class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ author }}</span>
          </span>
          <span v-if="publishedLabel" class="flex items-center gap-1">
            <Clock class="size-3 shrink-0" aria-hidden="true" />
            {{ publishedLabel }}
          </span>
        </div>
      </div>

      <p
        v-if="description"
        class="text-muted-foreground line-clamp-2 text-sm leading-relaxed break-words"
      >
        {{ description }}
      </p>

      <div
        v-if="resource.kind === 'video'"
        class="border-border/60 flex flex-col gap-3 border-t pt-4"
      >
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
        >
          <div class="flex min-w-0 flex-col gap-1.5">
            <label for="video-variant" class="text-xs font-medium">
              清晰度
            </label>
            <Select
              v-if="variants.length > 0"
              :model-value="selectedVariantId"
              :disabled="downloading"
              @update:model-value="handleVariantUpdate"
            >
              <SelectTrigger
                id="video-variant"
                class="w-full sm:w-72"
                aria-label="视频清晰度"
              >
                <SelectValue placeholder="选择清晰度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="variant in variants"
                  :key="variant.id"
                  :value="variant.id"
                >
                  {{ variant.label }} · {{ variantMeta(variant) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-else class="text-muted-foreground text-xs">
              未获取到可下载的清晰度，请重新解析
            </p>
          </div>

          <p
            v-if="selectedVariant"
            class="text-muted-foreground text-xs tabular-nums break-words sm:text-right"
          >
            {{ variantMeta(selectedVariant) }}
            <template v-if="selectedVariantSize">
              · {{ selectedVariantSize }}
            </template>
          </p>
        </div>

        <div
          v-if="downloadingState"
          class="flex flex-col gap-2"
          aria-live="polite"
        >
          <div
            class="flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span class="text-foreground font-medium tabular-nums">
              下载中 {{ downloadingState.progress.percent }}%
            </span>
            <span class="text-muted-foreground tabular-nums break-words">
              {{ formatByteSize(downloadingState.progress.transferred) }} /
              {{ totalLabel(downloadingState.progress) }}
            </span>
          </div>
          <Progress
            :model-value="downloadingState.progress.percent"
            class="h-2"
            aria-label="视频下载进度"
          />
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-muted-foreground text-xs">
              {{ speedLabel(downloadingState.progress) }} ·
              {{ remainingLabel(downloadingState.progress) }}
            </span>
            <Button variant="outline" size="sm" @click="cancelDownload">
              <X data-icon="inline-start" />
              取消
            </Button>
          </div>
          <p class="text-muted-foreground text-[11px]">
            取消后保留未完成文件，可稍后续传
          </p>
        </div>

        <div
          v-else-if="failedState"
          class="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3"
          role="alert"
        >
          <div class="text-destructive flex items-start gap-2 text-xs">
            <AlertCircle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div class="min-w-0 flex flex-col gap-0.5">
              <p>{{ videoErrorMessage(failedState.reason) }}</p>
              <p
                v-if="failedState.detail"
                class="text-muted-foreground break-words text-[11px]"
              >
                {{ failedState.detail }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <template v-if="failedState.resumable">
              <Button size="sm" @click="download(false)">
                <Download data-icon="inline-start" />
                继续下载
              </Button>
              <Button variant="outline" size="sm" @click="download(true)">
                重新下载
              </Button>
            </template>
            <Button v-else size="sm" @click="download(true)">
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </div>
          <p
            v-if="failedState.resumable"
            class="text-muted-foreground text-[11px]"
          >
            继续下载会从已写入位置续传
          </p>
        </div>

        <div
          v-else-if="completedState"
          class="bg-muted/20 border-border/60 flex flex-col gap-2 rounded-lg border p-3"
        >
          <div class="flex items-start gap-2">
            <CheckCircle2
              class="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <div class="min-w-0 flex flex-col gap-0.5">
              <p class="text-foreground text-xs font-medium">下载完成</p>
              <p
                class="text-muted-foreground truncate text-[11px]"
                :title="completedState.fileName"
              >
                {{ completedState.fileName }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" @click="openDownloaded">
              <FolderOpen data-icon="inline-start" />
              打开文件
            </Button>
            <Button variant="outline" size="sm" @click="showInFolder">
              <FolderSearch data-icon="inline-start" />
              所在文件夹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :disabled="transcriptBusy"
              @click="transcriptStart"
            >
              <Captions data-icon="inline-start" />
              重新提取口播
            </Button>
          </div>
        </div>

        <Button
          v-else
          class="w-full sm:w-auto"
          size="sm"
          :disabled="selectedVariant === null"
          @click="download()"
        >
          <Download data-icon="inline-start" />
          下载视频
        </Button>

        <p v-if="actionError" class="text-destructive text-xs">
          {{ actionError }}
        </p>
      </div>

      <div v-else class="border-border/60 flex flex-col gap-2 border-t pt-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium">图文图片</p>
          <span class="text-muted-foreground text-xs">
            {{ images.length }} 张
          </span>
        </div>

        <div
          v-if="images.length > 0"
          class="grid max-w-3xl grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 lg:grid-cols-6"
        >
          <button
            v-for="(image, index) in images"
            :key="`${image.url}-${index}`"
            type="button"
            class="bg-muted border-border/60 focus-visible:ring-ring/50 relative aspect-square w-full min-w-0 overflow-hidden rounded-lg border transition-opacity outline-none hover:opacity-90 focus-visible:ring-3"
            :aria-label="`查看${resource.title} 图片 ${index + 1}`"
            @click="previewIndex = index"
          >
            <img
              v-if="!failedImages.has(index)"
              :src="image.url"
              :alt="`${resource.title} 图片 ${index + 1}`"
              referrerpolicy="no-referrer"
              loading="lazy"
              class="h-full w-full object-cover"
              @error="markImageFailed(index)"
            />
            <span
              v-else
              class="bg-muted/40 text-muted-foreground dark:bg-muted/60 flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]"
            >
              <span class="text-base font-medium tabular-nums">
                {{ index + 1 }}
              </span>
              加载失败
            </span>
            <span
              class="bg-background/85 text-foreground border-border/60 absolute right-1 bottom-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none tabular-nums backdrop-blur"
            >
              {{ index + 1 }}
            </span>
          </button>
        </div>
        <p v-else class="text-muted-foreground text-xs">
          该图文笔记没有可展示的图片
        </p>
      </div>
    </div>

    <Dialog
      :open="previewIndex !== null"
      @update:open="handlePreviewOpenChange"
    >
      <DialogContent
        class="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <div
          class="border-border/60 flex items-center justify-between gap-2 border-b px-4 py-2.5 pr-12"
        >
          <DialogTitle class="text-sm font-medium tabular-nums">
            {{ previewTitle }}
          </DialogTitle>
        </div>

        <div class="bg-muted flex items-center justify-center">
          <img
            v-if="previewImage && !previewFailed"
            :src="previewImage.url"
            :alt="previewAlt"
            referrerpolicy="no-referrer"
            class="bg-muted max-h-[80vh] w-full object-contain"
            @error="handlePreviewImageError"
          />
          <div
            v-else
            class="text-muted-foreground bg-muted/40 flex min-h-40 w-full flex-col items-center justify-center gap-1 text-xs"
          >
            <span class="text-foreground text-lg font-medium tabular-nums">
              {{ previewIndex === null ? '' : previewIndex + 1 }}
            </span>
            图片加载失败
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </Card>
</template>
