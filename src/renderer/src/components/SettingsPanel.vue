<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Download, DownloadCloud, FolderOpen, Loader2 } from 'lucide-vue-next'
import type { AppModuleId } from '@shared/navigation'
import type { AppSettings, AppTheme } from '@shared/settings'
import { DEFAULT_APP_SETTINGS } from '@shared/settings'
import SettingsRow from '@/components/SettingsRow.vue'
import VideoEngineForm from '@/components/VideoEngineForm.vue'
import { MODULES } from '@/lib/modules'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/composables/useSettings'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import { useVideo } from '@/composables/useVideo'

const {
  settings,
  appVersion,
  dataDir,
  autoLaunchSupported,
  loading,
  saving,
  error,
  update,
  openDataDir,
  exportBackup
} = useSettings()

const { checking, check } = useUpdateCheck()

const { loadEngine, engineSettings } = useVideo()

/** 口播引擎表单实例，读取配置后刷新草稿 */
const engineForm = ref<{ reset: () => void } | null>(null)

/** 进入设置页时读取数据库中的最新引擎配置，再刷新表单草稿 */
onMounted(async () => {
  await loadEngine()
  engineForm.value?.reset()
})

// 设置数据加载完成后表单才挂载，此时用已读取的引擎配置刷新草稿；
// 保存成功后引擎配置变化也会同步回表单，保证两处入口展示一致。
watch(
  [engineForm, engineSettings],
  () => {
    engineForm.value?.reset()
  },
  { flush: 'post' }
)

/** 设置分类标识 */
type SettingsTab = 'general' | 'modules' | 'video' | 'data' | 'about'

interface SettingsTabItem {
  id: SettingsTab
  label: string
}

const SETTINGS_TABS: SettingsTabItem[] = [
  { id: 'general', label: '通用' },
  { id: 'modules', label: '模块' },
  { id: 'video', label: '短视频' },
  { id: 'data', label: '数据' },
  { id: 'about', label: '关于' }
]

/** 当前分类，默认通用 */
const activeTab = ref<SettingsTab>('general')
const tablistRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

/** 切换分类后内容回到顶部 */
watch(activeTab, () => {
  contentRef.value?.scrollTo({ top: 0, behavior: 'auto' })
})

const selectTab = (id: SettingsTab): void => {
  activeTab.value = id
}

/** 左右方向键循环、Home / End 跳首尾，并移动焦点 */
const handleTabKeydown = (event: KeyboardEvent): void => {
  const current = SETTINGS_TABS.findIndex((tab) => tab.id === activeTab.value)
  if (current < 0) return
  let next = current
  if (event.key === 'ArrowRight') {
    next = (current + 1) % SETTINGS_TABS.length
  } else if (event.key === 'ArrowLeft') {
    next = (current - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
  } else if (event.key === 'Home') {
    next = 0
  } else if (event.key === 'End') {
    next = SETTINGS_TABS.length - 1
  } else {
    return
  }
  event.preventDefault()
  activeTab.value = SETTINGS_TABS[next].id
  const buttons =
    tablistRef.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[next]?.focus()
}

/** 设置尚未加载时使用默认值渲染，读取控件值时不会取到 undefined */
const current = computed<AppSettings>(
  () => settings.value ?? DEFAULT_APP_SETTINGS
)

const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

/** 保存失败的字段，用于在对应行展示错误 */
const failedField = ref<keyof AppSettings | null>(null)

const launchError = computed(() =>
  failedField.value === 'launchAtLogin' ? '保存失败，请重试' : ''
)

const themeError = computed(() =>
  failedField.value === 'theme' ? '保存失败，请重试' : ''
)

/** 当前可见模块集合 */
const visibleSet = computed(() => new Set(current.value.visibleModules))
const visibleCount = computed(() => current.value.visibleModules.length)
const isModuleVisible = (id: AppModuleId): boolean => visibleSet.value.has(id)

/** 模块开关保存失败提示 */
const moduleError = computed(() =>
  failedField.value === 'visibleModules' ? '保存失败，请重试' : ''
)

/** 切换某模块显示；仅剩一个可见模块时不允许关闭 */
const toggleModule = (id: AppModuleId, value: boolean): void => {
  if (!value && visibleCount.value <= 1) return
  const next = MODULES.filter((module) =>
    module.id === id ? value : visibleSet.value.has(module.id)
  ).map((module) => module.id)
  void save({ visibleModules: next })
}

/** 一键恢复全部模块 */
const showAllModules = (): void => {
  if (visibleCount.value === MODULES.length) return
  void save({ visibleModules: MODULES.map((module) => module.id) })
}

const launchDescription = computed(() =>
  autoLaunchSupported.value
    ? '登录系统后自动启动应用'
    : '登录系统后自动启动应用，当前系统暂不支持'
)

const loadingText = computed(() => {
  if (error.value) return error.value
  return loading.value ? '正在加载设置…' : '暂无设置数据'
})

/** 保存设置并按 patch 的首个字段标记失败行 */
const save = async (patch: Partial<AppSettings>): Promise<void> => {
  failedField.value = null
  const ok = await update(patch)
  if (!ok) {
    const field = Object.keys(patch)[0]
    failedField.value = field ? (field as keyof AppSettings) : null
  }
}

const handleLaunchAtLogin = (value: boolean): void => {
  void save({ launchAtLogin: value })
}

const handleTheme = (value: unknown): void => {
  if (value !== 'system' && value !== 'light' && value !== 'dark') return
  void save({ theme: value })
}

const openingDir = ref(false)
const dirError = ref('')
const exporting = ref(false)
const exportError = ref('')
const exportPath = ref('')

const handleOpenDataDir = async (): Promise<void> => {
  dirError.value = ''
  openingDir.value = true
  try {
    const result = await openDataDir()
    if (!result.ok) {
      dirError.value = result.error ?? '打开目录失败'
    }
  } catch {
    dirError.value = '打开目录失败'
  } finally {
    openingDir.value = false
  }
}

/** 导出备份：取消不提示，失败展示错误，成功展示保存路径 */
const handleExportBackup = async (): Promise<void> => {
  exportError.value = ''
  exportPath.value = ''
  exporting.value = true
  try {
    const result = await exportBackup()
    if (result.canceled) return
    if (result.error) {
      exportError.value = result.error
      return
    }
    exportPath.value = result.filePath ?? ''
  } catch {
    exportError.value = '导出备份失败，请重试'
  } finally {
    exporting.value = false
  }
}

const handleCheckUpdate = (): void => {
  void check()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <template v-if="settings">
      <!-- 顶部固定 Tab 栏 -->
      <div class="shrink-0 px-6 pt-4">
        <div
          ref="tablistRef"
          role="tablist"
          aria-label="设置分类"
          class="bg-muted ring-foreground/5 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg p-1 ring-1"
        >
          <Button
            v-for="tab in SETTINGS_TABS"
            :id="`settings-tab-${tab.id}`"
            :key="tab.id"
            role="tab"
            size="sm"
            class="transition-all duration-200"
            :variant="activeTab === tab.id ? 'secondary' : 'ghost'"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`settings-panel-${tab.id}`"
            :tabindex="activeTab === tab.id ? 0 : -1"
            :class="activeTab === tab.id ? 'shadow-soft' : ''"
            @click="selectTab(tab.id)"
            @keydown="handleTabKeydown"
          >
            {{ tab.label }}
          </Button>
        </div>
      </div>

      <!-- 独立滚动内容区 -->
      <div ref="contentRef" class="min-h-0 flex-1 overflow-y-auto scroll-py-4">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
          <section
            v-show="activeTab === 'general'"
            id="settings-panel-general"
            role="tabpanel"
            aria-labelledby="settings-tab-general"
            class="stagger-list flex flex-col gap-5"
          >
            <Card class="shadow-soft">
              <CardHeader>
                <CardTitle>通用</CardTitle>
                <CardDescription>应用启动与系统行为</CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col">
                <SettingsRow
                  title="开机自启"
                  :description="launchDescription"
                  :error="launchError"
                >
                  <Switch
                    :model-value="current.launchAtLogin"
                    :disabled="!autoLaunchSupported || saving"
                    aria-label="开机自启"
                    @update:model-value="handleLaunchAtLogin"
                  />
                </SettingsRow>
              </CardContent>
            </Card>

            <Card class="shadow-soft">
              <CardHeader>
                <CardTitle>外观</CardTitle>
                <CardDescription>界面配色，切换后立即生效</CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col">
                <SettingsRow
                  title="主题"
                  description="跟随系统时随系统浅色 / 深色外观自动切换"
                  :error="themeError"
                >
                  <Select
                    :model-value="current.theme"
                    :disabled="saving"
                    @update:model-value="handleTheme"
                  >
                    <SelectTrigger class="w-32" aria-label="主题">
                      <SelectValue placeholder="选择主题" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="option in THEME_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>
              </CardContent>
            </Card>
          </section>

          <section
            v-show="activeTab === 'modules'"
            id="settings-panel-modules"
            role="tabpanel"
            aria-labelledby="settings-tab-modules"
            class="stagger-list flex flex-col gap-5"
          >
            <Card class="shadow-soft">
              <CardHeader>
                <CardTitle>模块</CardTitle>
                <CardDescription>
                  选择侧边栏显示的模块，隐藏后数据仍会保留
                </CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col gap-3">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-muted-foreground text-xs">
                    已显示 {{ visibleCount }} / {{ MODULES.length }} 个模块
                  </p>
                  <Button
                    v-if="visibleCount < MODULES.length"
                    variant="outline"
                    size="sm"
                    :disabled="saving"
                    @click="showAllModules"
                  >
                    全部显示
                  </Button>
                </div>

                <div class="grid gap-2 sm:grid-cols-2">
                  <div
                    v-for="module in MODULES"
                    :key="module.id"
                    class="border-border/60 flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <div
                      class="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
                    >
                      <component
                        :is="module.icon"
                        class="size-4"
                        aria-hidden="true"
                      />
                    </div>
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p class="truncate text-sm font-medium">
                        {{ module.label }}
                      </p>
                      <p class="text-muted-foreground truncate text-xs">
                        {{ module.description }}
                      </p>
                    </div>
                    <Switch
                      :model-value="isModuleVisible(module.id)"
                      :disabled="saving"
                      :aria-label="`显示${module.label}模块`"
                      @update:model-value="
                        (value) => toggleModule(module.id, value)
                      "
                    />
                  </div>
                </div>

                <p
                  v-if="visibleCount === 1"
                  class="text-muted-foreground text-xs"
                  role="status"
                >
                  至少保留一个模块
                </p>
                <p v-if="moduleError" class="text-destructive text-xs">
                  {{ moduleError }}
                </p>
              </CardContent>
            </Card>
          </section>

          <section
            v-show="activeTab === 'video'"
            id="settings-panel-video"
            role="tabpanel"
            aria-labelledby="settings-tab-video"
            class="stagger-list flex flex-col gap-5"
          >
            <Card class="shadow-soft">
              <CardHeader>
                <CardTitle>短视频</CardTitle>
                <CardDescription>
                  口播引擎与下载目录，识别过程完全离线
                </CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col">
                <VideoEngineForm ref="engineForm" />
              </CardContent>
            </Card>
          </section>

          <section
            v-show="activeTab === 'data'"
            id="settings-panel-data"
            role="tabpanel"
            aria-labelledby="settings-tab-data"
            class="stagger-list flex flex-col gap-5"
          >
            <Card class="shadow-soft">
              <CardHeader>
                <CardTitle>数据</CardTitle>
                <CardDescription>本地数据位置与备份</CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col">
                <div class="flex flex-col gap-1 py-3">
                  <p class="text-sm font-medium">数据目录</p>
                  <p
                    class="text-muted-foreground select-text font-mono text-xs break-all"
                  >
                    {{ dataDir }}
                  </p>
                </div>

                <SettingsRow
                  title="打开目录"
                  description="在系统文件管理器中定位数据目录"
                  :error="dirError"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="openingDir"
                    @click="handleOpenDataDir"
                  >
                    <Loader2 v-if="openingDir" class="animate-spin" />
                    <FolderOpen v-else />
                    打开目录
                  </Button>
                </SettingsRow>

                <SettingsRow
                  title="导出备份"
                  description="将当前数据库导出为 .db 文件，便于迁移或留存"
                  :error="exportError"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="exporting"
                    @click="handleExportBackup"
                  >
                    <Loader2 v-if="exporting" class="animate-spin" />
                    <Download v-else />
                    {{ exporting ? '导出中…' : '导出备份' }}
                  </Button>
                </SettingsRow>

                <p
                  v-if="exportPath"
                  class="text-muted-foreground select-text pt-3 font-mono text-xs break-all"
                >
                  已保存到 {{ exportPath }}
                </p>
              </CardContent>
            </Card>
          </section>

          <section
            v-show="activeTab === 'about'"
            id="settings-panel-about"
            role="tabpanel"
            aria-labelledby="settings-tab-about"
            class="stagger-list flex flex-col gap-5"
          >
            <Card class="shadow-soft">
              <CardHeader>
                <CardTitle>关于</CardTitle>
                <CardDescription>版本信息与更新检查</CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col">
                <SettingsRow
                  title="应用版本"
                  description="当前安装的应用版本号"
                >
                  <span class="font-mono text-sm">v{{ appVersion }}</span>
                </SettingsRow>

                <SettingsRow
                  title="检查更新"
                  description="从发布仓库获取最新版本信息"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="checking"
                    @click="handleCheckUpdate"
                  >
                    <Loader2 v-if="checking" class="animate-spin" />
                    <DownloadCloud v-else />
                    {{ checking ? '检查中…' : '检查更新' }}
                  </Button>
                </SettingsRow>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </template>

    <div
      v-else
      class="animate-fade-in flex h-full flex-1 flex-col items-center justify-center gap-3"
    >
      <Loader2
        v-if="loading"
        class="text-muted-foreground size-6 animate-spin"
      />
      <p class="text-muted-foreground text-sm">{{ loadingText }}</p>
    </div>
  </div>
</template>
