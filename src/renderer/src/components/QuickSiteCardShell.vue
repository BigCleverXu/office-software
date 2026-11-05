<script setup lang="ts">
import { Loader2, Pencil, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{
    opening?: boolean
    editLabel: string
    removeLabel: string
  }>(),
  { opening: false }
)

const emit = defineEmits<{
  open: []
  edit: []
  remove: []
}>()

const handleOpen = (): void => {
  if (props.opening) {
    return
  }
  emit('open')
}

/** 仅响应卡片自身键盘事件，避免子按钮的 Enter / Space 触发打开 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.target !== event.currentTarget) {
    return
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  event.preventDefault()
  handleOpen()
}
</script>

<template>
  <article
    role="button"
    :tabindex="opening ? -1 : 0"
    :aria-busy="opening"
    class="group relative flex flex-col gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:border-foreground/20 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    :class="{ 'cursor-pointer': !opening, 'cursor-default': opening }"
    @click="handleOpen"
    @keydown="handleKeydown"
  >
    <slot />

    <div class="absolute top-2 right-2">
      <div
        v-if="opening"
        class="text-muted-foreground flex size-6 items-center justify-center"
        aria-hidden="true"
      >
        <Loader2 class="size-3.5 animate-spin" />
      </div>
      <div
        v-else
        class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="editLabel"
              @click.stop="emit('edit')"
            >
              <Pencil aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              class="text-destructive hover:text-destructive"
              :aria-label="removeLabel"
              @click.stop="emit('remove')"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <footer class="mt-auto flex items-center">
      <slot name="footer" />
    </footer>
  </article>
</template>
