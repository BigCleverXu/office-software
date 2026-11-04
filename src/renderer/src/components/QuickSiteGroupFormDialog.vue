<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import {
  hostOf,
  QUICK_SITE_GROUP_NAME_MAX_LENGTH,
  type QuickSite,
  type QuickSiteGroup,
  type QuickSiteGroupDraft
} from '@shared/quick-sites'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    group?: QuickSiteGroup | null
    sites?: QuickSite[]
    saving?: boolean
    error?: string
  }>(),
  {
    sites: () => [],
    saving: false,
    error: ''
  }
)

const emit = defineEmits<{
  submit: [draft: QuickSiteGroupDraft]
}>()

const name = ref('')
const selectedIds = ref<string[]>([])

watch(
  open,
  (isOpen) => {
    if (!isOpen) {
      return
    }
    const group = props.group
    if (group) {
      name.value = group.name
      selectedIds.value = [...group.siteIds]
      return
    }
    name.value = ''
    selectedIds.value = []
  },
  { immediate: true }
)

const isEdit = computed(() => Boolean(props.group))

/** 站点行：预计算域名与勾选状态，避免在模板中调用方法 */
const siteRows = computed(() =>
  props.sites.map((site) => ({
    id: site.id,
    name: site.name,
    host: hostOf(site.url),
    selected: selectedIds.value.includes(site.id)
  }))
)

const canSave = computed(
  () =>
    name.value.trim() !== '' && selectedIds.value.length > 0 && !props.saving
)

const toggleSite = (id: string): void => {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
    return
  }
  selectedIds.value = [...selectedIds.value, id]
}

const selectAll = (): void => {
  selectedIds.value = props.sites.map((site) => site.id)
}

const clearSelection = (): void => {
  selectedIds.value = []
}

const handleSubmit = (): void => {
  if (!canSave.value) {
    return
  }
  emit('submit', {
    name: name.value.trim(),
    siteIds: [...selectedIds.value]
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? '编辑编组' : '新建编组' }}</DialogTitle>
        <DialogDescription>
          把常一起打开的网站编成一组，点一下即可全部打开。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <Label for="quick-site-group-name">编组名称</Label>
          <Input
            id="quick-site-group-name"
            v-model="name"
            :maxlength="QUICK_SITE_GROUP_NAME_MAX_LENGTH"
            placeholder="例如：日常办公"
          />
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <Label>选择网站</Label>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                :disabled="sites.length === 0 || saving"
                @click="selectAll"
              >
                全选
              </Button>
              <Button
                variant="ghost"
                size="xs"
                :disabled="selectedIds.length === 0 || saving"
                @click="clearSelection"
              >
                清空
              </Button>
            </div>
          </div>

          <div
            v-if="sites.length === 0"
            class="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-xs"
          >
            还没有快捷站点，先创建一个站点再编组
          </div>

          <div
            v-else
            class="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1.5"
          >
            <label
              v-for="site in siteRows"
              :key="site.id"
              class="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <Checkbox
                :model-value="site.selected"
                :disabled="saving"
                @update:model-value="toggleSite(site.id)"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate text-sm">{{ site.name }}</span>
                <span class="text-muted-foreground truncate text-[11px]">
                  {{ site.host }}
                </span>
              </span>
            </label>
          </div>

          <p class="text-muted-foreground text-xs">
            已选
            <span class="text-foreground font-medium">
              {{ selectedIds.length }}
            </span>
            个网站
          </p>
        </div>

        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!canSave" @click="handleSubmit">
          <Loader2 v-if="saving" class="animate-spin" aria-hidden="true" />
          {{ saving ? '保存中' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
