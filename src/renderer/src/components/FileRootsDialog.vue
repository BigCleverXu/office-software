<script setup lang="ts">
import { ref } from 'vue'
import { FolderPlus, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useFileSearch } from '@/composables/useFileSearch'

const open = defineModel<boolean>('open', { default: false })

const { state, addRoots, removeRoot } = useFileSearch()

/** 增删进行中，避免重复触发 */
const busy = ref(false)

const handleAdd = async (): Promise<void> => {
  if (busy.value) return
  busy.value = true
  try {
    await addRoots()
  } finally {
    busy.value = false
  }
}

const handleRemove = async (root: string): Promise<void> => {
  if (busy.value) return
  busy.value = true
  try {
    await removeRoot(root)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>管理搜索目录</DialogTitle>
        <DialogDescription>
          添加需要检索的本地目录，移除目录会同步清理其索引条目。
        </DialogDescription>
      </DialogHeader>

      <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto py-1">
        <div
          v-if="state.roots.length === 0"
          class="empty-state text-muted-foreground py-10"
        >
          <span class="empty-state-icon"><FolderPlus class="size-6" /></span>
          <p class="text-sm">还没有搜索目录</p>
        </div>

        <div
          v-for="root in state.roots"
          :key="root"
          class="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-2"
        >
          <span
            class="text-foreground min-w-0 flex-1 truncate text-xs"
            :title="root"
          >
            {{ root }}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0"
            :disabled="busy"
            aria-label="移除目录"
            @click="handleRemove(root)"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
      </div>

      <p class="text-muted-foreground text-xs">
        扫描在后台进行，文件较多时可能需要一会儿。
      </p>

      <DialogFooter>
        <Button variant="outline" @click="open = false">关闭</Button>
        <Button :disabled="busy" @click="handleAdd">
          <FolderPlus data-icon="inline-start" />
          添加目录
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
