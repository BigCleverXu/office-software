<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import {
  normalizeQuickSiteTargets,
  normalizeQuickSiteUrl,
  QUICK_SITE_NAME_MAX_LENGTH,
  type DetectedBrowser,
  type QuickSite,
  type QuickSiteDraft,
  type QuickSiteTarget
} from '@shared/quick-sites'
import { Button } from '@/components/ui/button'
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
import QuickSiteTargetEditor from '@/components/QuickSiteTargetEditor.vue'
import type { QuickSitePreset } from '@/lib/site-visuals'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    site?: QuickSite | null
    preset?: QuickSitePreset | null
    browsers?: DetectedBrowser[]
    scanning?: boolean
    saving?: boolean
    error?: string
  }>(),
  {
    browsers: () => [],
    scanning: false,
    saving: false,
    error: ''
  }
)

const emit = defineEmits<{
  submit: [draft: QuickSiteDraft]
  rescan: []
}>()

const name = ref('')
const url = ref('')
/** 已选打开方式列表 */
const targets = ref<QuickSiteTarget[]>([])

watch(
  open,
  (isOpen) => {
    if (!isOpen) {
      return
    }
    const site = props.site
    if (site) {
      name.value = site.name
      url.value = site.url
      targets.value = site.targets.map((target) => ({ ...target }))
      return
    }
    name.value = props.preset?.name ?? ''
    url.value = props.preset?.url ?? ''
    targets.value = normalizeQuickSiteTargets([])
  },
  { immediate: true }
)

const isEdit = computed(() => Boolean(props.site))

const normalizedUrl = computed(() => normalizeQuickSiteUrl(url.value))

const urlError = computed(() => {
  if (url.value.trim() === '') {
    return ''
  }
  return normalizedUrl.value === '' ? '请输入 http / https 开头的网址' : ''
})

const canSave = computed(
  () => normalizedUrl.value !== '' && targets.value.length > 0 && !props.saving
)

const handleSubmit = (): void => {
  if (!canSave.value) {
    return
  }
  const nextUrl = normalizeQuickSiteUrl(url.value)
  if (nextUrl === '') {
    return
  }
  emit('submit', {
    name: name.value.trim(),
    url: nextUrl,
    targets: targets.value.map((target) => ({ ...target }))
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex max-h-[calc(100vh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-lg"
    >
      <DialogHeader class="shrink-0">
        <DialogTitle>{{ isEdit ? '编辑站点' : '新增站点' }}</DialogTitle>
        <DialogDescription>
          收藏常用网站，可同时指定多个浏览器 / 角色，点一下全部打开。
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2 pr-1">
        <div class="flex flex-col gap-2">
          <Label for="quick-site-name">名称（可选）</Label>
          <Input
            id="quick-site-name"
            v-model="name"
            :maxlength="QUICK_SITE_NAME_MAX_LENGTH"
            placeholder="留空则使用域名"
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="quick-site-url">网址</Label>
          <Input
            id="quick-site-url"
            v-model="url"
            placeholder="https://example.com"
            spellcheck="false"
            :aria-invalid="urlError !== ''"
          />
          <p v-if="urlError" class="text-destructive text-xs">{{ urlError }}</p>
          <p
            v-else-if="url.trim() !== '' && normalizedUrl !== ''"
            class="text-muted-foreground text-xs break-all"
          >
            将保存为 {{ normalizedUrl }}
          </p>
        </div>

        <QuickSiteTargetEditor
          v-model="targets"
          :browsers="browsers"
          :scanning="scanning"
          @rescan="emit('rescan')"
        />

        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <DialogFooter class="shrink-0">
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!canSave" @click="handleSubmit">
          <Loader2 v-if="saving" class="animate-spin" aria-hidden="true" />
          {{ saving ? '保存中' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
