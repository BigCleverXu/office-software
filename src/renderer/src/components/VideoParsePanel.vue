<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertCircle,
  Captions,
  Download,
  Link2,
  LoaderCircle,
  Video
} from 'lucide-vue-next'
import { PLATFORM_META, VIDEO_PLATFORMS } from '@shared/video'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import VideoResultCard from '@/components/VideoResultCard.vue'
import { useVideo } from '@/composables/useVideo'

const { input, parsing, resource, parseError, parse, clearInput } = useVideo()

/** 首次解析且还没有结果时展示骨架 */
const showSkeleton = computed(() => parsing.value && resource.value === null)

/** 解析按钮展示加载态 */
const handleParse = (): void => {
  void parse()
}

/** Ctrl / Cmd + Enter 快捷解析 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.isComposing) return
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return
  event.preventDefault()
  void parse()
}
</script>

<template>
  <div class="flex h-full min-w-0 flex-col overflow-hidden">
    <section class="shrink-0 px-3 pt-3 sm:px-5 sm:pt-5">
      <Card class="shadow-soft min-w-0">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <span
              class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg"
            >
              <Link2 class="size-4" aria-hidden="true" />
            </span>
            解析分享链接
          </CardTitle>
          <CardDescription>
            支持抖音、快手、小红书与哔哩哔哩的分享链接或整段分享文案
          </CardDescription>
        </CardHeader>

        <CardContent class="flex flex-col gap-3">
          <textarea
            v-model="input"
            rows="2"
            placeholder="粘贴分享链接或分享文案，Ctrl + Enter 快速解析"
            aria-label="分享链接或分享文案"
            class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground min-h-20 w-full min-w-0 resize-y rounded-lg border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none transition-colors focus-visible:ring-3"
            @keydown="handleKeydown"
          ></textarea>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                v-for="platform in VIDEO_PLATFORMS"
                :key="platform"
                class="text-muted-foreground bg-muted/40 border-border rounded-full border px-2 py-0.5 text-[11px]"
              >
                {{ PLATFORM_META[platform].label }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="parsing || input.trim().length === 0"
                @click="clearInput"
              >
                清空
              </Button>
              <Button size="sm" :disabled="parsing" @click="handleParse">
                <LoaderCircle
                  v-if="parsing"
                  data-icon="inline-start"
                  class="animate-spin motion-reduce:animate-none"
                />
                {{ parsing ? '解析中' : '解析' }}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        v-if="parseError"
        class="border-destructive/30 bg-destructive/5 text-destructive mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-xs"
        role="alert"
      >
        <span class="flex min-w-0 items-center gap-2">
          <AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 break-words">{{ parseError }}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="parsing || input.trim().length === 0"
          @click="handleParse"
        >
          重试
        </Button>
      </div>
    </section>

    <div
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5"
    >
      <div class="flex flex-col gap-4">
        <div
          v-if="showSkeleton"
          class="stagger-list"
          role="status"
          aria-busy="true"
        >
          <span class="sr-only">正在解析分享链接</span>
          <Card class="skeleton-shimmer h-40"></Card>
        </div>

        <section
          v-else-if="resource === null"
          class="bg-muted/10 border-dashed rounded-xl border px-4 py-8 sm:px-6 sm:py-10"
        >
          <div class="empty-state text-muted-foreground">
            <span class="empty-state-icon">
              <Video class="size-6" aria-hidden="true" />
            </span>
            <div class="flex flex-col gap-1">
              <p class="text-foreground text-sm font-semibold">
                粘贴链接，三步拿到视频与口播
              </p>
              <p class="text-xs">解析、下载与转写都在本地完成</p>
            </div>

            <div
              class="mt-2 grid w-full grid-cols-1 gap-3 text-left md:grid-cols-3"
            >
              <div
                class="bg-card/60 border-border/60 flex items-start gap-2.5 rounded-lg border p-3"
              >
                <span
                  class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg"
                >
                  <Link2 class="size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <p class="text-foreground text-xs font-medium">粘贴链接</p>
                  <p class="text-[11px] leading-relaxed break-words">
                    从平台复制分享内容，粘贴到上方输入区
                  </p>
                </div>
              </div>

              <div
                class="bg-card/60 border-border/60 flex items-start gap-2.5 rounded-lg border p-3"
              >
                <span
                  class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg"
                >
                  <Download class="size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <p class="text-foreground text-xs font-medium">
                    选择清晰度下载
                  </p>
                  <p class="text-[11px] leading-relaxed break-words">
                    支持断点续传，图文笔记直接查看全部图片
                  </p>
                </div>
              </div>

              <div
                class="bg-card/60 border-border/60 flex items-start gap-2.5 rounded-lg border p-3"
              >
                <span
                  class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg"
                >
                  <Captions class="size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <p class="text-foreground text-xs font-medium">提取口播</p>
                  <p class="text-[11px] leading-relaxed break-words">
                    下载完成后离线识别，可编辑并导出 TXT
                  </p>
                </div>
              </div>
            </div>

            <p class="mt-1 text-[11px]">
              口播提取需先在「设置」中配置本地 whisper 与 ffmpeg
            </p>
          </div>
        </section>

        <div v-else class="stagger-list flex min-w-0 flex-col gap-4">
          <VideoResultCard />
        </div>

        <p class="text-muted-foreground pb-1 text-xs break-words">
          仅处理公开可访问内容，解析成功率受平台风控与接口变化影响。
        </p>
      </div>
    </div>
  </div>
</template>
