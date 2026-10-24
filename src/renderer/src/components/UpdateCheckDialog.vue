<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UpdateCheckResult } from '@shared/update'
import {
  downloadAssetTypeLabel,
  downloadPlatformLabel,
  formatBytes,
  selectDownloadAsset
} from '@shared/update'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { UPDATE_ERROR_TEXT } from '@/composables/useUpdateCheck'
import { useUpdateDownload } from '@/composables/useUpdateDownload'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  checking: boolean
  result: UpdateCheckResult | null
}>()

const {
  state: downloadState,
  isDownloading,
  progress,
  errorText: downloadErrorText,
  errorDetail: downloadErrorDetail,
  start,
  cancel,
  retry,
  openFile,
  showInFolder,
  reset,
  sync
} = useUpdateDownload()

/** 运行安装程序失败时的提示，重新下载或切换版本时清空 */
const openFailed = ref(false)

const currentVersion = computed(() => props.result?.currentVersion ?? '')

/** 仅在「发现新版本」时返回发行版信息，供模板渲染正文 */
const release = computed(() =>
  props.result?.status === 'update-available' ? props.result.release : null
)

const errorText = computed(() => {
  const current = props.result
  return current?.status === 'error' ? UPDATE_ERROR_TEXT[current.reason] : ''
})

/** 当前系统对应的安装包，无匹配时为 null */
const selectedAsset = computed(() =>
  release.value
    ? selectDownloadAsset(
        release.value.assets,
        window.api.update.platform,
        window.api.update.arch
      )
    : null
)

/** 资产信息文案：平台名 + 类型 */
const assetMetaText = computed(() => {
  const asset = selectedAsset.value
  if (!asset) return ''
  const platform = downloadPlatformLabel(window.api.update.platform)
  return `${platform} · ${downloadAssetTypeLabel(asset)}`
})

/** 资产大小文案 */
const assetSizeText = computed(() =>
  selectedAsset.value ? formatBytes(selectedAsset.value.size) : ''
)

/** 已下载字节数文案，0 字节显示 0 B */
const transferredText = computed(() => {
  const transferred = progress.value?.transferred ?? 0
  return transferred > 0 ? formatBytes(transferred) : '0 B'
})

/** 总字节数文案，未知时显示「未知大小」 */
const totalText = computed(() => formatBytes(progress.value?.total ?? 0))

/** 百分比文案 */
const percentText = computed(() => `${progress.value?.percent ?? 0}%`)

/** 是否已完成下载 */
const isDownloaded = computed(() => downloadState.value.status === 'completed')

/** 是否下载失败 */
const isDownloadFailed = computed(() => downloadState.value.status === 'failed')

/** 已下载文件名 */
const downloadedFileName = computed(() => {
  const current = downloadState.value
  return current.status === 'completed' ? current.fileName : ''
})

const publishedText = computed(() => {
  const raw = release.value?.publishedAt ?? null
  if (!raw) return '未知'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN')
})

const notesText = computed(() => release.value?.notes.trim() ?? '')

const dialogTitle = computed(() => {
  switch (props.result?.status) {
    case 'update-available':
      return '发现新版本'
    case 'up-to-date':
      return '已是最新版本'
    case 'no-release':
      return '暂无发行版'
    default:
      return '检查更新失败'
  }
})

const dialogDescription = computed(() => {
  switch (props.result?.status) {
    case 'update-available':
      return `检测到有新版本 ${release.value?.version ?? ''} 可用。`
    case 'up-to-date':
      return `当前版本 ${currentVersion.value}，已是最新`
    case 'no-release':
      return `该仓库还没有发布过任何版本，当前版本 ${currentVersion.value}`
    case 'error':
      return `${errorText.value}（当前版本 ${currentVersion.value}）`
    default:
      return '检查更新结果'
  }
})

const openReleasePage = (): void => {
  if (props.result?.status === 'update-available') {
    window.open(props.result.release.pageUrl)
  }
}

/** 版本切换时清空上一次的下载状态与打开失败提示 */
watch(
  () => release.value?.version,
  () => {
    reset()
    openFailed.value = false
  }
)

/** 弹窗打开时从主进程快照恢复下载进度（关闭弹窗、渲染层重载后均生效） */
watch(open, (value) => {
  if (value) {
    void sync(selectedAsset.value)
  }
})

/** 下载当前系统对应的安装包 */
const startDownload = (): void => {
  const asset = selectedAsset.value
  if (!asset) return
  openFailed.value = false
  void start(asset)
}

/** 取消当前下载 */
const cancelDownload = (): void => {
  void cancel()
}

/** 重试下载最近一次选择过的安装包 */
const retryDownload = (): void => {
  openFailed.value = false
  void retry()
}

/** 在文件管理器中显示已下载的安装包 */
const revealDownloaded = (): void => {
  const current = downloadState.value
  if (current.status !== 'completed') return
  void showInFolder(current.filePath)
}

/** 运行已下载的安装程序，失败时在弹窗内提示 */
const runInstaller = async (): Promise<void> => {
  const current = downloadState.value
  if (current.status !== 'completed') return
  const opened = await openFile(current.filePath)
  openFailed.value = opened.status === 'failed'
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{ dialogDescription }}</DialogDescription>
      </DialogHeader>

      <div v-if="release" class="flex flex-col gap-3 py-2">
        <p class="text-sm">
          当前版本 {{ currentVersion }} → 新版本 {{ release.version }}
        </p>
        <p class="text-muted-foreground text-sm">
          发布时间：{{ publishedText }}
        </p>
        <div class="max-h-64 overflow-y-auto rounded-md border p-3">
          <p v-if="notesText" class="whitespace-pre-wrap text-sm">
            {{ notesText }}
          </p>
          <p v-else class="text-muted-foreground text-sm">该版本未填写说明</p>
        </div>

        <div v-if="isDownloaded" class="rounded-md border p-3">
          <p class="text-sm font-medium">安装包已下载</p>
          <p class="text-muted-foreground text-xs break-all">
            {{ downloadedFileName }}
          </p>
        </div>

        <div
          v-else-if="selectedAsset"
          class="flex flex-col gap-2 rounded-md border p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-sm font-medium">{{ assetMetaText }}</span>
              <span class="text-muted-foreground text-xs break-all">
                {{ selectedAsset.name }}
              </span>
            </div>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{ assetSizeText }}
            </span>
          </div>

          <template v-if="isDownloading">
            <Progress :model-value="progress?.percent ?? 0" />
            <div class="text-muted-foreground flex justify-between text-xs">
              <span>{{ percentText }}</span>
              <span>已下载 {{ transferredText }} / {{ totalText }}</span>
            </div>
          </template>
        </div>

        <p v-else class="text-muted-foreground text-sm">
          当前系统暂无可直接下载的安装包
        </p>

        <p v-if="isDownloadFailed" class="text-destructive text-sm">
          {{ downloadErrorText }}
        </p>
        <p
          v-if="isDownloadFailed && downloadErrorDetail"
          class="text-muted-foreground text-xs break-all"
        >
          诊断信息：{{ downloadErrorDetail }}
        </p>
        <p v-if="openFailed" class="text-destructive text-sm">
          无法打开安装程序，请从文件夹中手动运行
        </p>
      </div>

      <DialogFooter>
        <template v-if="release">
          <template v-if="isDownloading">
            <Button variant="outline" @click="cancelDownload">
              取消下载
            </Button>
          </template>

          <template v-else-if="isDownloaded">
            <Button variant="outline" @click="open = false">关闭</Button>
            <Button variant="outline" @click="revealDownloaded">
              打开所在文件夹
            </Button>
            <Button @click="runInstaller">运行安装程序</Button>
          </template>

          <template v-else-if="isDownloadFailed">
            <Button variant="outline" @click="open = false">关闭</Button>
            <Button variant="outline" @click="openReleasePage">
              打开发行版页面
            </Button>
            <Button @click="retryDownload">重试</Button>
          </template>

          <template v-else-if="selectedAsset">
            <Button variant="outline" @click="open = false">稍后</Button>
            <Button variant="outline" @click="openReleasePage">
              打开发行版页面
            </Button>
            <Button @click="startDownload">下载安装包</Button>
          </template>

          <template v-else>
            <Button variant="outline" @click="open = false">稍后</Button>
            <Button @click="openReleasePage">打开发行版页面</Button>
          </template>
        </template>

        <Button v-else variant="outline" @click="open = false">关闭</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
