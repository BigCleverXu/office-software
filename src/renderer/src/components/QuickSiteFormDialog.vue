<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2, RefreshCw } from 'lucide-vue-next'
import {
  normalizeQuickSiteUrl,
  QUICK_SITE_NAME_MAX_LENGTH,
  SYSTEM_BROWSER_ID,
  type BrowserId,
  type DetectedBrowser,
  type QuickSite,
  type QuickSiteDraft
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { BROWSER_LABELS } from '@/lib/site-visuals'
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

/** 角色下拉的默认项：SelectItem 不允许空字符串 value */
const DEFAULT_PROFILE_VALUE = '__default__'

const name = ref('')
const url = ref('')
const browserId = ref<BrowserId>(SYSTEM_BROWSER_ID)
const profileValue = ref(DEFAULT_PROFILE_VALUE)

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
      browserId.value = site.browserId
      profileValue.value = site.profileId || DEFAULT_PROFILE_VALUE
      return
    }
    if (props.preset) {
      name.value = props.preset.name
      url.value = props.preset.url
      browserId.value = SYSTEM_BROWSER_ID
      profileValue.value = DEFAULT_PROFILE_VALUE
      return
    }
    name.value = ''
    url.value = ''
    browserId.value = SYSTEM_BROWSER_ID
    profileValue.value = DEFAULT_PROFILE_VALUE
  },
  { immediate: true }
)

const isEdit = computed(() => Boolean(props.site))

const isSystem = computed(() => browserId.value === SYSTEM_BROWSER_ID)

const normalizedUrl = computed(() => normalizeQuickSiteUrl(url.value))

const urlError = computed(() => {
  if (url.value.trim() === '') {
    return ''
  }
  return normalizedUrl.value === '' ? '请输入 http / https 开头的网址' : ''
})

const canSave = computed(() => normalizedUrl.value !== '' && !props.saving)

interface BrowserOption {
  id: BrowserId
  label: string
  roleCount: number
}

/** 打开方式选项：系统默认 + 已检测浏览器，编辑时保留已卸载的浏览器 */
const browserOptions = computed<BrowserOption[]>(() => {
  const options: BrowserOption[] = [
    { id: SYSTEM_BROWSER_ID, label: BROWSER_LABELS.system, roleCount: 0 }
  ]

  for (const browser of props.browsers) {
    if (browser.id === SYSTEM_BROWSER_ID) {
      continue
    }
    options.push({
      id: browser.id,
      label: browser.name,
      roleCount: browser.profiles.length
    })
  }

  const site = props.site
  if (
    site &&
    site.browserId !== SYSTEM_BROWSER_ID &&
    !options.some((option) => option.id === site.browserId)
  ) {
    options.push({
      id: site.browserId,
      label: `${BROWSER_LABELS[site.browserId]}（未检测到）`,
      roleCount: 0
    })
  }

  return options
})

const browserOptionLabel = (option: BrowserOption): string =>
  option.roleCount > 0
    ? `${option.label} · ${option.roleCount} 个角色`
    : option.label

const selectedBrowser = computed(() =>
  props.browsers.find((browser) => browser.id === browserId.value)
)

/** 除系统默认之外是否检测到了可指定的浏览器 */
const detectedBrowserCount = computed(
  () =>
    props.browsers.filter((browser) => browser.id !== SYSTEM_BROWSER_ID).length
)

/** 编辑时原浏览器已卸载 */
const selectedBrowserMissing = computed(
  () => !isSystem.value && selectedBrowser.value === undefined
)

const browserHint = computed(() => {
  if (selectedBrowserMissing.value) {
    return '原浏览器未检测到，请重新选择'
  }
  if (detectedBrowserCount.value === 0) {
    return '未检测到可指定的浏览器，仍可使用系统默认打开'
  }
  return ''
})

const selectedProfiles = computed(() => selectedBrowser.value?.profiles ?? [])

/** 编辑时原角色已不在当前浏览器角色列表中 */
const missingProfile = computed(() => {
  const site = props.site
  if (!site || isSystem.value || site.profileId === '') {
    return false
  }
  if (site.browserId !== browserId.value) {
    return false
  }
  return !selectedProfiles.value.some(
    (profile) => profile.id === site.profileId
  )
})

interface ProfileOption {
  value: string
  label: string
}

/** 角色选项：默认角色 + 浏览器角色，编辑时保留缺失的角色 */
const profileOptions = computed<ProfileOption[]>(() => {
  const options: ProfileOption[] = [
    { value: DEFAULT_PROFILE_VALUE, label: '默认角色（跟随浏览器）' }
  ]

  for (const profile of selectedProfiles.value) {
    options.push({ value: profile.id, label: profile.name })
  }

  const site = props.site
  if (
    missingProfile.value &&
    site &&
    site.profileId !== '' &&
    !options.some((option) => option.value === site.profileId)
  ) {
    options.push({ value: site.profileId, label: '未检测到的角色' })
  }

  return options
})

const profileEnabled = computed(
  () =>
    !isSystem.value &&
    (selectedProfiles.value.length > 0 || missingProfile.value)
)

const profileHint = computed(() => {
  if (isSystem.value) {
    return '由系统默认浏览器打开'
  }
  if (missingProfile.value) {
    return '原角色未检测到，请重新选择'
  }
  if (selectedProfiles.value.length === 0) {
    return '该浏览器未检测到多个角色，将使用默认角色'
  }
  return ''
})

/** 切换浏览器时重置角色，编辑初始化不经过该事件 */
const handleBrowserChange = (value: unknown): void => {
  browserId.value = String(value) as BrowserId
  profileValue.value = DEFAULT_PROFILE_VALUE
}

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
    browserId: browserId.value,
    profileId:
      isSystem.value || profileValue.value === DEFAULT_PROFILE_VALUE
        ? ''
        : profileValue.value
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? '编辑站点' : '新增站点' }}</DialogTitle>
        <DialogDescription>
          收藏常用网站，可指定浏览器与角色，点一下直达。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-2">
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

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <Label for="quick-site-browser">打开方式</Label>
            <Button
              variant="ghost"
              size="xs"
              :disabled="scanning"
              aria-label="重新扫描浏览器"
              @click="emit('rescan')"
            >
              <RefreshCw
                :class="{ 'animate-spin': scanning }"
                aria-hidden="true"
              />
              重新扫描
            </Button>
          </div>
          <Select
            :model-value="browserId"
            @update:model-value="handleBrowserChange"
          >
            <SelectTrigger id="quick-site-browser" class="w-full">
              <SelectValue placeholder="选择打开方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in browserOptions"
                :key="option.id"
                :value="option.id"
              >
                {{ browserOptionLabel(option) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="browserHint" class="text-muted-foreground text-xs">
            {{ browserHint }}
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="quick-site-profile">角色</Label>
          <Select v-model="profileValue" :disabled="!profileEnabled">
            <SelectTrigger id="quick-site-profile" class="w-full">
              <SelectValue placeholder="默认角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in profileOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="profileHint" class="text-muted-foreground text-xs">
            {{ profileHint }}
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
