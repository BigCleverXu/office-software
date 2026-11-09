<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  AlertCircle,
  Captions,
  Check,
  Copy,
  FileText,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  X
} from 'lucide-vue-next'
import { videoErrorMessage } from '@shared/video'
import type { VideoTranscriptSnapshot } from '@shared/video'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { useVideo } from '@/composables/useVideo'

type RunningSnapshot = Extract<VideoTranscriptSnapshot, { status: 'running' }>
type CompletedSnapshot = Extract<
  VideoTranscriptSnapshot,
  { status: 'completed' }
>
type FailedSnapshot = Extract<VideoTranscriptSnapshot, { status: 'failed' }>

const {
  transcriptTarget,
  transcriptSnapshot,
  transcriptText,
  transcriptBusy,
  transcriptStart,
  transcriptCancel,
  updateTranscriptText,
  copyTranscript,
  exportTranscript,
  copied,
  exporting,
  exportNotice,
  loadEngine,
  restoreTranscriptState,
  pickTranscriptFile
} = useVideo()

onMounted(() => {
  void loadEngine()
  void restoreTranscriptState()
})

const runningState = computed<RunningSnapshot | null>(() =>
  transcriptSnapshot.value.status === 'running'
    ? transcriptSnapshot.value
    : null
)

const completedState = computed<CompletedSnapshot | null>(() =>
  transcriptSnapshot.value.status === 'completed'
    ? transcriptSnapshot.value
    : null
)

const failedState = computed<FailedSnapshot | null>(() =>
  transcriptSnapshot.value.status === 'failed' ? transcriptSnapshot.value : null
)

const stageLabel = computed<string>(() =>
  runningState.value?.stage === 'recognizing' ? '识别中' : '抽取音轨'
)

/** 目标来源徽标文案 */
const sourceLabel = computed<string>(() =>
  transcriptTarget.value?.source === 'download' ? '解析下载' : '本地文件'
)

/** 字数按 Unicode 字符统计，中文与英文都按字符计 */
const charCount = computed<number>(() => Array.from(transcriptText.value).length)

const elapsedLabel = computed<string>(() => {
  const current = completedState.value
  if (current === null || !Number.isFinite(current.elapsedMs)) return '--'
  return (Math.max(0, current.elapsedMs) / 1000).toFixed(1)
})

/** 引擎或 ffmpeg 缺失时提示前往设置页配置 */
const needsEngineConfig = computed<boolean>(() => {
  const current = failedState.value
  if (current === null) return false
  return (
    current.reason === 'engine-missing' || current.reason === 'ffmpeg-missing'
  )
})

const handleStart = (): void => {
  void transcriptStart()
}

const handlePickFile = (): void => {
  void pickTranscriptFile()
}

const handleInput = (event: Event): void => {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  updateTranscriptText(target.value)
}
</script>

<template>
  <div
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5"
  >
    <Card class="shadow-soft min-w-0">
      <CardHeader>
        <div class="flex min-w-0 flex-col gap-1">
          <CardTitle class="flex items-center gap-2">
            <Captions
              class="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
            口播提取
          </CardTitle>
          <CardDescription>
            本地离线识别，音视频不会上传到网络
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent class="flex flex-col gap-3">
        <div
          v-if="transcriptTarget"
          class="bg-muted/20 border-border/60 flex flex-col gap-2 rounded-lg border p-3"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex min-w-0 flex-col gap-0.5">
              <p
                class="text-foreground truncate text-xs font-medium"
                :title="transcriptTarget.fileName"
              >
                {{ transcriptTarget.fileName }}
              </p>
              <p class="text-muted-foreground text-[11px] break-all">
                {{ transcriptTarget.filePath }}
              </p>
            </div>
            <Badge variant="outline" class="shrink-0 text-[11px]">
              {{ sourceLabel }}
            </Badge>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              :disabled="transcriptBusy"
              @click="handleStart"
            >
              <Captions data-icon="inline-start" />
              开始识别
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="transcriptBusy"
              @click="handlePickFile"
            >
              <FolderOpen data-icon="inline-start" />
              更换文件
            </Button>
          </div>
        </div>

        <div
          v-else
          class="bg-muted/10 flex flex-col items-start gap-2 rounded-lg border border-dashed px-4 py-6"
        >
          <p class="text-muted-foreground text-xs leading-relaxed break-words">
            请选择视频或从解析下载页带入文件
          </p>
          <Button size="sm" @click="handlePickFile">
            <FolderOpen data-icon="inline-start" />
            选择文件
          </Button>
        </div>

        <p
          v-if="transcriptSnapshot.status === 'idle'"
          class="text-muted-foreground text-xs leading-relaxed break-words"
        >
          用本地 whisper 抽取音轨并识别口播文字，完成后可编辑、复制或导出
          TXT。
        </p>

        <div
          v-else-if="runningState"
          class="bg-muted/20 border-border/60 flex flex-col gap-2 rounded-lg border p-3"
          aria-live="polite"
        >
          <div class="flex items-start gap-2">
            <LoaderCircle
              class="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <div class="flex min-w-0 flex-col gap-0.5">
              <p class="text-foreground text-xs font-medium">
                {{ runningState.message }}
              </p>
              <p class="text-muted-foreground text-[11px]">
                当前阶段：{{ stageLabel }} · 耗时取决于视频时长
              </p>
            </div>
          </div>
          <div class="flex justify-end">
            <Button variant="outline" size="sm" @click="transcriptCancel">
              <X data-icon="inline-start" />
              取消
            </Button>
          </div>
        </div>

        <div v-else-if="completedState" class="flex flex-col gap-2">
          <textarea
            :value="transcriptText"
            rows="8"
            placeholder="识别结果为空，可手动输入口播文本"
            aria-label="口播文本内容"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground min-h-40 w-full min-w-0 resize-y rounded-lg border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none transition-colors focus-visible:ring-3"
            @input="handleInput"
          ></textarea>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-muted-foreground min-w-0 text-xs break-words">
              {{ charCount }} 字
              <template v-if="completedState.engine">
                · {{ completedState.engine }}
              </template>
              · 耗时 {{ elapsedLabel }} 秒
            </span>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="transcriptText === ''"
                @click="copyTranscript"
              >
                <Check
                  v-if="copied"
                  data-icon="inline-start"
                  class="text-emerald-600 dark:text-emerald-400"
                />
                <Copy v-else data-icon="inline-start" />
                {{ copied ? '已复制' : '复制' }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="exporting || transcriptText.trim() === ''"
                @click="exportTranscript"
              >
                <LoaderCircle
                  v-if="exporting"
                  data-icon="inline-start"
                  class="animate-spin motion-reduce:animate-none"
                />
                <FileText v-else data-icon="inline-start" />
                导出 TXT
              </Button>
            </div>
          </div>

          <p
            v-if="exportNotice"
            class="text-muted-foreground break-words text-[11px]"
          >
            {{ exportNotice }}
          </p>
        </div>

        <div
          v-else-if="failedState"
          class="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3"
          role="alert"
        >
          <div class="text-destructive flex items-start gap-2 text-xs">
            <AlertCircle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div class="flex min-w-0 flex-col gap-0.5">
              <p>
                {{ failedState.message || videoErrorMessage(failedState.reason) }}
              </p>
              <p
                v-if="failedState.detail"
                class="text-muted-foreground break-words text-[11px]"
              >
                {{ failedState.detail }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              :disabled="transcriptTarget === null"
              @click="handleStart"
            >
              <RotateCcw data-icon="inline-start" />
              重试
            </Button>
          </div>
          <p
            v-if="needsEngineConfig"
            class="text-muted-foreground text-[11px] leading-relaxed break-words"
          >
            请先在设置页配置本地 whisper 与 ffmpeg
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
