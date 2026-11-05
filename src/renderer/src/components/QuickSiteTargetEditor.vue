<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, Globe, Plus, RefreshCw, X } from 'lucide-vue-next'
import {
  normalizeQuickSiteProfileId,
  SYSTEM_BROWSER_ID,
  targetKeyOf,
  type BrowserId,
  type DetectedBrowser,
  type QuickSiteTarget
} from '@shared/quick-sites'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { BROWSER_LABELS } from '@/lib/site-visuals'

const props = withDefaults(
  defineProps<{
    browsers?: DetectedBrowser[]
    scanning?: boolean
  }>(),
  {
    browsers: () => [],
    scanning: false
  }
)

const emit = defineEmits<{
  rescan: []
}>()

const targets = defineModel<QuickSiteTarget[]>({ required: true })

/** 角色下拉的默认项：SelectItem 不允许空字符串 value */
const DEFAULT_PROFILE_VALUE = '__default__'

/** 待添加的浏览器与角色 */
const draftBrowserId = ref<BrowserId>(SYSTEM_BROWSER_ID)
const draftProfileValue = ref(DEFAULT_PROFILE_VALUE)
/** 重复添加提示 */
const duplicateHint = ref(false)

interface BrowserOption {
  id: BrowserId
  label: string
}

/** 添加行的浏览器选项：系统默认 + 已检测浏览器 */
const browserOptions = computed<BrowserOption[]>(() => {
  const options: BrowserOption[] = [
    { id: SYSTEM_BROWSER_ID, label: BROWSER_LABELS.system }
  ]

  for (const browser of props.browsers) {
    if (browser.id === SYSTEM_BROWSER_ID) {
      continue
    }
    options.push({
      id: browser.id,
      label:
        browser.profiles.length > 0
          ? `${browser.name} · ${browser.profiles.length} 个角色`
          : browser.name
    })
  }

  return options
})

const draftBrowser = computed(() =>
  props.browsers.find((browser) => browser.id === draftBrowserId.value)
)

const draftIsSystem = computed(() => draftBrowserId.value === SYSTEM_BROWSER_ID)

interface ProfileOption {
  value: string
  label: string
}

/** 添加行的角色选项：默认角色 + 当前浏览器的角色 */
const draftProfileOptions = computed<ProfileOption[]>(() => {
  const options: ProfileOption[] = [
    { value: DEFAULT_PROFILE_VALUE, label: '默认角色（跟随浏览器）' }
  ]

  for (const profile of draftBrowser.value?.profiles ?? []) {
    options.push({ value: profile.id, label: profile.name })
  }

  return options
})

const draftProfileEnabled = computed(() => !draftIsSystem.value)

const draftProfileHint = computed(() =>
  draftIsSystem.value ? '由系统默认浏览器打开' : ''
)

/** 除系统默认之外是否检测到了可指定的浏览器 */
const detectedBrowserCount = computed(
  () =>
    props.browsers.filter((browser) => browser.id !== SYSTEM_BROWSER_ID).length
)

interface TargetRow {
  key: string
  label: string
  warn: boolean
}

/** 已选目标的展示文案：随 props.browsers 变化自动更新 */
const targetRows = computed<TargetRow[]>(() =>
  targets.value.map((target) => {
    const key = targetKeyOf(target)
    if (target.browserId === SYSTEM_BROWSER_ID) {
      return { key, label: BROWSER_LABELS.system, warn: false }
    }
    const browser = props.browsers.find((item) => item.id === target.browserId)
    if (browser === undefined) {
      return {
        key,
        label: `${BROWSER_LABELS[target.browserId]}（未检测到）`,
        warn: true
      }
    }
    if (target.profileId === '') {
      return { key, label: `${browser.name} · 默认角色`, warn: false }
    }
    const profile = browser.profiles.find(
      (item) => item.id === target.profileId
    )
    if (profile === undefined) {
      return {
        key,
        label: `${browser.name} · 角色（未检测到）`,
        warn: true
      }
    }
    return { key, label: `${browser.name} · ${profile.name}`, warn: false }
  })
)

const handleDraftBrowserChange = (value: unknown): void => {
  draftBrowserId.value = String(value) as BrowserId
  draftProfileValue.value = DEFAULT_PROFILE_VALUE
  duplicateHint.value = false
}

const handleDraftProfileChange = (value: unknown): void => {
  draftProfileValue.value = String(value)
  duplicateHint.value = false
}

/** 添加打开方式：重复目标不加入，仅在已有目标中提示 */
const handleAddTarget = (): void => {
  const profileId = normalizeQuickSiteProfileId(
    draftProfileValue.value === DEFAULT_PROFILE_VALUE
      ? ''
      : draftProfileValue.value,
    draftBrowserId.value
  )
  const target: QuickSiteTarget = {
    browserId: draftBrowserId.value,
    profileId
  }
  const key = targetKeyOf(target)
  if (targets.value.some((item) => targetKeyOf(item) === key)) {
    duplicateHint.value = true
    return
  }
  targets.value = [...targets.value, target]
  draftProfileValue.value = DEFAULT_PROFILE_VALUE
  duplicateHint.value = false
}

const handleRemoveTarget = (key: string): void => {
  if (targets.value.length <= 1) {
    return
  }
  targets.value = targets.value.filter((item) => targetKeyOf(item) !== key)
  duplicateHint.value = false
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <Label>打开方式</Label>
      <Button
        variant="ghost"
        size="xs"
        :disabled="scanning"
        aria-label="重新扫描浏览器"
        @click="emit('rescan')"
      >
        <RefreshCw :class="{ 'animate-spin': scanning }" aria-hidden="true" />
        重新扫描
      </Button>
    </div>

    <div class="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <Select
        :model-value="draftBrowserId"
        @update:model-value="handleDraftBrowserChange"
      >
        <SelectTrigger
          class="w-full min-w-0 [&>span]:truncate"
          aria-label="选择浏览器"
        >
          <SelectValue placeholder="选择浏览器" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in browserOptions"
            :key="option.id"
            :value="option.id"
          >
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Select
          class="min-w-0"
          :model-value="draftProfileValue"
          :disabled="!draftProfileEnabled"
          @update:model-value="handleDraftProfileChange"
        >
          <SelectTrigger
            class="w-full min-w-0 [&>span]:truncate"
            aria-label="选择角色"
          >
            <SelectValue placeholder="默认角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="option in draftProfileOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0"
          aria-label="添加打开方式"
          @click="handleAddTarget"
        >
          <Plus aria-hidden="true" />
          添加
        </Button>
      </div>

      <p
        v-if="draftProfileHint"
        class="text-muted-foreground text-xs break-words"
      >
        {{ draftProfileHint }}
      </p>
      <p
        v-else-if="detectedBrowserCount === 0"
        class="text-muted-foreground text-xs break-words"
      >
        未检测到可指定的浏览器，仍可使用系统默认打开
      </p>
      <p v-if="duplicateHint" class="text-destructive text-xs break-words">
        该打开方式已添加
      </p>
    </div>

    <div v-if="targetRows.length > 0" class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-2">
        <p class="text-muted-foreground text-xs">
          已选 {{ targets.length }} 个打开方式
        </p>
        <p
          v-if="targets.length === 1"
          class="text-muted-foreground shrink-0 text-xs"
        >
          至少保留一个打开方式
        </p>
      </div>

      <ul class="flex flex-col gap-1.5" aria-label="已选打开方式">
        <li
          v-for="row in targetRows"
          :key="row.key"
          class="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
        >
          <AlertTriangle
            v-if="row.warn"
            class="text-destructive size-3 shrink-0"
            aria-hidden="true"
          />
          <Globe v-else class="size-3 shrink-0 opacity-70" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 truncate"
            :class="{ 'text-destructive': row.warn }"
            :title="row.label"
          >
            {{ row.label }}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0"
            :disabled="targets.length <= 1"
            :aria-label="`移除打开方式 ${row.label}`"
            @click="handleRemoveTarget(row.key)"
          >
            <X aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <p v-if="targets.length === 0" class="text-destructive text-xs">
      请至少添加一个打开方式
    </p>
  </div>
</template>
