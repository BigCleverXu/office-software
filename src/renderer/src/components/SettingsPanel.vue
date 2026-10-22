<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, DownloadCloud, FolderOpen, Loader2 } from 'lucide-vue-next'
import type { AppSettings, AppTheme } from '@shared/settings'
import { DEFAULT_APP_SETTINGS } from '@shared/settings'
import SettingsRow from '@/components/SettingsRow.vue'
import UpdateCheckDialog from '@/components/UpdateCheckDialog.vue'
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

const {
  checking,
  open: updateOpen,
  result: updateResult,
  check
} = useUpdateCheck()

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
  <div class="h-full overflow-y-auto">
    <div
      v-if="settings"
      class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6"
    >
      <Card>
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

      <Card>
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

      <Card>
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

      <Card>
        <CardHeader>
          <CardTitle>关于</CardTitle>
          <CardDescription>版本信息与更新检查</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col">
          <SettingsRow title="应用版本" description="当前安装的应用版本号">
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
    </div>

    <div v-else class="flex h-full flex-col items-center justify-center gap-3">
      <Loader2
        v-if="loading"
        class="text-muted-foreground size-6 animate-spin"
      />
      <p class="text-muted-foreground text-sm">{{ loadingText }}</p>
    </div>

    <UpdateCheckDialog
      v-model:open="updateOpen"
      :checking="checking"
      :result="updateResult"
    />
  </div>
</template>
