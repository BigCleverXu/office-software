<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogScrollContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import VideoEngineForm from '@/components/VideoEngineForm.vue'
import { useVideo } from '@/composables/useVideo'

const { engineDialogOpen } = useVideo()

/** 表单实例，打开弹窗时刷新草稿 */
const form = ref<{ reset: () => void } | null>(null)

watch(
  engineDialogOpen,
  (isOpen) => {
    if (isOpen) {
      form.value?.reset()
    }
  },
  { flush: 'post' }
)

const handleSaved = (): void => {
  engineDialogOpen.value = false
}

const handleCancel = (): void => {
  engineDialogOpen.value = false
}
</script>

<template>
  <Dialog v-model:open="engineDialogOpen">
    <DialogScrollContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>口播引擎设置</DialogTitle>
        <DialogDescription>
          配置本地 whisper.cpp、模型与 ffmpeg，识别过程完全离线。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <VideoEngineForm ref="form" @saved="handleSaved" />

        <p class="text-muted-foreground text-[11px] leading-relaxed">
          whisper.cpp 与模型文件需自行下载放置；ffmpeg 可来自 ffmpeg-static
          依赖或系统 PATH。模型越大识别越准，速度也越慢。
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">取消</Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
