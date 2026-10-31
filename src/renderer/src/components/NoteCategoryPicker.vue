<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Plus, Tag } from 'lucide-vue-next'
import { NOTE_CATEGORY_MAX_LENGTH } from '@shared/notes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

const props = defineProps<{
  category: string
  categories: string[]
}>()

const emit = defineEmits<{
  change: [category: string]
}>()

const open = ref(false)
const draftCategory = ref('')

const isCategorized = computed(() => props.category.trim() !== '')

const triggerLabel = computed(() =>
  isCategorized.value ? props.category.trim() : '分类'
)

const triggerClass = computed(() =>
  isCategorized.value
    ? 'inline-flex w-fit items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] leading-none transition-colors hover:bg-foreground/10'
    : 'inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-border/70 bg-transparent px-2 py-0.5 text-[11px] leading-none text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
)

const OPTION_BASE_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground'

interface CategoryOption {
  value: string
  label: string
  selected: boolean
  class: string
}

const categoryOptions = computed<CategoryOption[]>(() => {
  const names = Array.from(
    new Set(props.categories.map((item) => item.trim()))
  ).filter((item) => item !== '')
  const trimmedCategory = props.category.trim()
  const options = [
    { value: '', label: '未分类', selected: !isCategorized.value },
    ...names.map((value) => ({
      value,
      label: value,
      selected: isCategorized.value && value === trimmedCategory
    }))
  ]
  return options.map((option) => ({
    ...option,
    class: option.selected
      ? `${OPTION_BASE_CLASS} bg-muted text-foreground`
      : `${OPTION_BASE_CLASS} text-muted-foreground`
  }))
})

const draftCategoryTrimmed = computed(() => draftCategory.value.trim())

const canCreateCategory = computed(() => draftCategoryTrimmed.value !== '')

function handleOpenChange(value: boolean): void {
  open.value = value
  if (value) {
    draftCategory.value = ''
  }
}

function selectCategory(value: string): void {
  open.value = false
  emit('change', value)
}

function createCategory(): void {
  if (!canCreateCategory.value) {
    return
  }
  const value = draftCategoryTrimmed.value
  open.value = false
  draftCategory.value = ''
  emit('change', value)
}
</script>

<template>
  <Popover :open="open" @update:open="handleOpenChange">
    <PopoverTrigger as-child>
      <button type="button" :class="triggerClass" aria-label="修改便签分类">
        <Tag v-if="isCategorized" class="size-3 shrink-0" aria-hidden="true" />
        <Plus v-else class="size-3 shrink-0" aria-hidden="true" />
        <span class="max-w-32 truncate">{{ triggerLabel }}</span>
      </button>
    </PopoverTrigger>

    <PopoverContent align="start" class="w-48 p-1.5">
      <div class="flex max-h-56 flex-col overflow-y-auto">
        <button
          v-for="option in categoryOptions"
          :key="option.value"
          type="button"
          :class="option.class"
          @click="selectCategory(option.value)"
        >
          <Check
            v-if="option.selected"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span v-else class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ option.label }}</span>
        </button>
      </div>

      <Separator class="my-1.5" />

      <div class="flex items-center gap-1">
        <Input
          v-model="draftCategory"
          :maxlength="NOTE_CATEGORY_MAX_LENGTH"
          placeholder="新分类名…"
          class="h-7 text-xs"
          @keydown.enter.prevent="createCategory"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="新建分类并应用"
          :disabled="!canCreateCategory"
          @click="createCategory"
        >
          <Plus class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
