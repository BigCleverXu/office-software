<script setup lang="ts">
import { ref, useId } from 'vue'
import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-vue-next'
import type {
  VideoEngineConfig,
  VideoEngineLanguage,
  VideoPickKind
} from '@shared/video'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useVideo } from '@/composables/useVideo'

const LANGUAGE_OPTIONS: readonly {
  value: VideoEngineLanguage
  label: string
}[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'auto', label: '自动检测' }
]

const emit = defineEmits<{ saved: [] }>()

const {
  engineSettings,
  engineProbe,
  engineProbing,
  probeEngine,
  updateEngineSettings,
  pickEnginePath
} = useVideo()

/** 表单实例唯一前缀，避免弹窗与设置页同时挂载时 id 冲突 */
const idPrefix = `video-engine-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

/** 表单草稿，reset 时从共享设置重新复制 */
const draft = ref<VideoEngineConfig>({ ...engineSettings.value.engine })
const draftDownloadDir = ref(engineSettings.value.downloadDir)
const saving = ref(false)
const saveError = ref<string | null>(null)

/** 从共享设置刷新草稿，并清空探测结果与错误 */
const reset = (): void => {
  draft.value = { ...engineSettings.value.engine }
  draftDownloadDir.value = engineSettings.value.downloadDir
  saveError.value = null
  engineProbe.value = null
}

defineExpose({ reset })

/** 选择文件后写入草稿字段，取消则保持原值 */
const choose = async (
  kind: VideoPickKind,
  apply: (path: string) => void
): Promise<void> => {
  const picked = await pickEnginePath(kind)
  if (picked !== null) {
    apply(picked)
  }
}

const chooseWhisper = (): void => {
  void choose('whisper', (path) => {
    draft.value.whisperBinary = path
  })
}

const chooseModel = (): void => {
  void choose('model', (path) => {
    draft.value.whisperModel = path
  })
}

const chooseFfmpeg = (): void => {
  void choose('ffmpeg', (path) => {
    draft.value.ffmpegPath = path
  })
}

const chooseDownloadDir = (): void => {
  void choose('directory', (path) => {
    draftDownloadDir.value = path
  })
}

const handleLanguageUpdate = (value: unknown): void => {
  if (
    typeof value === 'string' &&
    LANGUAGE_OPTIONS.some((option) => option.value === value)
  ) {
    draft.value.language = value as VideoEngineLanguage
  }
}

const handleProbe = (): void => {
  void probeEngine()
}

const handleSave = async (): Promise<void> => {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  const saved = await updateEngineSettings({
    engine: { ...draft.value },
    downloadDir: draftDownloadDir.value.trim()
  })
  saving.value = false
  if (saved) {
    emit('saved')
  } else {
    saveError.value = '保存引擎设置失败，请稍后重试'
  }
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <Label :for="`${idPrefix}-whisper`">whisper 可执行文件</Label>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          :id="`${idPrefix}-whisper`"
          v-model="draft.whisperBinary"
          class="min-w-48 flex-1"
          placeholder="留空自动探测，如 whisper-cli.exe"
        />
        <Button variant="outline" @click="chooseWhisper">选择</Button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label :for="`${idPrefix}-model`">模型文件</Label>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          :id="`${idPrefix}-model`"
          v-model="draft.whisperModel"
          class="min-w-48 flex-1"
          placeholder="留空自动探测，如 ggml-medium.bin"
        />
        <Button variant="outline" @click="chooseModel">选择</Button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label :for="`${idPrefix}-ffmpeg`">ffmpeg 路径</Label>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          :id="`${idPrefix}-ffmpeg`"
          v-model="draft.ffmpegPath"
          class="min-w-48 flex-1"
          placeholder="留空自动探测 ffmpeg-static 或系统 PATH"
        />
        <Button variant="outline" @click="chooseFfmpeg">选择</Button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label :for="`${idPrefix}-download-dir`">下载目录</Label>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          :id="`${idPrefix}-download-dir`"
          v-model="draftDownloadDir"
          class="min-w-48 flex-1"
          placeholder="留空使用系统下载目录"
        />
        <Button variant="outline" @click="chooseDownloadDir">选择</Button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label :for="`${idPrefix}-language`">识别语言</Label>
      <Select
        :model-value="draft.language"
        :disabled="saving"
        @update:model-value="handleLanguageUpdate"
      >
        <SelectTrigger
          :id="`${idPrefix}-language`"
          class="w-40 max-w-full"
          aria-label="识别语言"
        >
          <SelectValue placeholder="选择语言" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in LANGUAGE_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div
      class="border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <p class="text-xs font-medium">本地引擎检测</p>
        <p class="text-muted-foreground text-[11px]">
          检测 whisper、模型与 ffmpeg 是否可用
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="engineProbing"
        @click="handleProbe"
      >
        <LoaderCircle
          v-if="engineProbing"
          data-icon="inline-start"
          class="animate-spin motion-reduce:animate-none"
        />
        {{ engineProbing ? '检测中' : '检测引擎' }}
      </Button>
    </div>

    <div
      v-if="engineProbe"
      class="rounded-lg border p-3 text-xs"
      aria-live="polite"
      :class="
        engineProbe.ok
          ? 'border-emerald-600/30 bg-emerald-600/5 dark:border-emerald-400/30 dark:bg-emerald-400/5'
          : 'border-destructive/30 bg-destructive/5'
      "
    >
      <div class="flex items-start gap-2">
        <CheckCircle2
          v-if="engineProbe.ok"
          class="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <XCircle
          v-else
          class="text-destructive mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-col gap-1">
          <p
            class="font-medium"
            :class="
              engineProbe.ok
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-destructive'
            "
          >
            {{ engineProbe.ok ? '引擎就绪' : '引擎不可用' }}
          </p>
          <p class="text-muted-foreground break-words">
            {{ engineProbe.message }}
          </p>
          <dl
            v-if="engineProbe.ok"
            class="text-muted-foreground flex flex-col gap-0.5 text-[11px]"
          >
            <div v-if="engineProbe.binary" class="flex min-w-0 gap-1">
              <dt class="shrink-0">whisper</dt>
              <dd class="truncate" :title="engineProbe.binary">
                {{ engineProbe.binary }}
              </dd>
            </div>
            <div v-if="engineProbe.model" class="flex min-w-0 gap-1">
              <dt class="shrink-0">模型</dt>
              <dd class="truncate" :title="engineProbe.model">
                {{ engineProbe.model }}
              </dd>
            </div>
            <div v-if="engineProbe.ffmpeg" class="flex min-w-0 gap-1">
              <dt class="shrink-0">ffmpeg</dt>
              <dd class="truncate" :title="engineProbe.ffmpeg">
                {{ engineProbe.ffmpeg }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <p v-if="saveError" class="text-destructive text-xs" role="alert">
        {{ saveError }}
      </p>
      <div class="flex justify-end">
        <Button :disabled="saving" @click="handleSave">
          <LoaderCircle
            v-if="saving"
            data-icon="inline-start"
            class="animate-spin motion-reduce:animate-none"
          />
          保存
        </Button>
      </div>
    </div>
  </div>
</template>
