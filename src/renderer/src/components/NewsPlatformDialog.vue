<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCheck, Eraser } from 'lucide-vue-next'
import { NEWS_PLATFORMS } from '@shared/news'
import type { NewsPlatformId } from '@shared/news'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{ selected: NewsPlatformId[] }>()

const emit = defineEmits<{ save: [platforms: NewsPlatformId[]] }>()

/** 弹窗内的草稿选择，打开时从外部选中项复制 */
const draft = ref<NewsPlatformId[]>([])

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    draft.value = [...props.selected]
  },
  { immediate: true }
)

const canSave = computed(() => draft.value.length > 0)

/** 切换单个平台的选中状态 */
const togglePlatform = (id: NewsPlatformId): void => {
  if (draft.value.includes(id)) {
    draft.value = draft.value.filter((item) => item !== id)
  } else {
    draft.value = [...draft.value, id]
  }
}

const selectAll = (): void => {
  draft.value = NEWS_PLATFORMS.map((platform) => platform.id)
}

const clearAll = (): void => {
  draft.value = []
}

const handleSave = (): void => {
  if (!canSave.value) return
  emit('save', [...draft.value])
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>选择新闻平台</DialogTitle>
        <DialogDescription>
          选择需要展示的热点来源，可随时调整
        </DialogDescription>
      </DialogHeader>

      <div class="flex items-center justify-between gap-2">
        <span class="text-muted-foreground text-xs">
          已选 {{ draft.length }} 个平台
        </span>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="sm" @click="selectAll">
            <CheckCheck data-icon="inline-start" />
            全选
          </Button>
          <Button variant="ghost" size="sm" @click="clearAll">
            <Eraser data-icon="inline-start" />
            清空
          </Button>
        </div>
      </div>

      <div class="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2">
        <label
          v-for="platform in NEWS_PLATFORMS"
          :key="platform.id"
          class="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          @click.prevent="togglePlatform(platform.id)"
        >
          <Checkbox
            :model-value="draft.includes(platform.id)"
            @click.stop
            @update:model-value="togglePlatform(platform.id)"
          />
          <span>{{ platform.name }}</span>
        </label>
      </div>

      <p v-if="!canSave" class="text-destructive text-xs">至少选择一个平台</p>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!canSave" @click="handleSave">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
