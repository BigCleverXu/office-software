<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { RefreshCw } from 'lucide-vue-next'
import {
  codeFromSymbol,
  computePositionSummary,
  normalizeCode,
  normalizeUsSymbol
} from '@shared/market'
import type {
  AddWatchResult,
  MarketPosition,
  MarketRegion,
  WatchItem
} from '@shared/market'
import AddWatchDialog from '@/components/AddWatchDialog.vue'
import IndexCard from '@/components/IndexCard.vue'
import MarketSwitch from '@/components/MarketSwitch.vue'
import PositionDialog from '@/components/PositionDialog.vue'
import PositionSummary from '@/components/PositionSummary.vue'
import WatchPanel from '@/components/WatchPanel.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { confirm } from '@/composables/useConfirm'
import { useMarket } from '@/composables/useMarket'

const {
  snapshot,
  usSnapshot,
  watchlist,
  cnWatchlist,
  usWatchlist,
  settings,
  region,
  addWatch,
  updatePosition,
  removeWatch,
  refreshNow,
  setPaused,
  setRegion
} = useMarket()

const dialogOpen = ref(false)
const positionDialogOpen = ref(false)
const editingItem = ref<WatchItem | null>(null)
const watchPanelRef = ref<InstanceType<typeof WatchPanel> | null>(null)

/** 写操作失败提示，3 秒后自动清除 */
const notice = ref('')

const { start: startNoticeTimer } = useTimeoutFn(
  () => {
    notice.value = ''
  },
  3000,
  { immediate: false }
)

const showNotice = (message: string): void => {
  notice.value = message
  startNoticeTimer()
}

/** 当前市场展示的快照与自选股 */
const activeSnapshot = computed(() =>
  region.value === 'us' ? usSnapshot.value : snapshot.value
)

const activeWatchlist = computed(() =>
  region.value === 'us' ? usWatchlist.value : cnWatchlist.value
)

/** 当前市场的持仓盈亏汇总 */
const positionSummary = computed(() =>
  computePositionSummary(activeSnapshot.value.quotes, activeWatchlist.value)
)

const FOOTER_TEXT =
  '数据来源：腾讯财经公开行情接口，行情可能存在延迟，仅供参考，不构成投资建议。'

const openAddDialog = (): void => {
  dialogOpen.value = true
}

const onTogglePaused = (paused: boolean): void => {
  void setPaused(paused).then((ok) => {
    if (!ok) showNotice('暂停刷新失败，请稍后重试')
  })
}

const handleRefresh = (): void => {
  void refreshNow()
}

const handleRegionChange = (next: MarketRegion): void => {
  void setRegion(next).then((ok) => {
    if (!ok) showNotice('切换市场失败，请稍后重试')
  })
}

/**
 * 添加入口：重复添加时高亮既有行 2 秒，其余结果原样返回给弹窗。
 * 符号规则按当前市场区分：A 股 6 位代码、美股 ticker。
 */
const handleAdd = async (
  code: string,
  position: MarketPosition
): Promise<AddWatchResult> => {
  const result = await addWatch(code, position)
  if (!result.ok && result.reason === 'duplicate') {
    const normalized =
      region.value === 'us' ? normalizeUsSymbol(code) : normalizeCode(code)
    if (normalized) {
      watchPanelRef.value?.highlight(normalized.symbol)
    }
  }
  return result
}

/** 打开编辑持仓弹窗，预填当前持仓 */
const handleEditPosition = (item: WatchItem): void => {
  editingItem.value = item
  positionDialogOpen.value = true
}

/** 保存持仓：成功返回 true，失败提示并保持弹窗打开 */
const handleSavePosition = async (
  position: MarketPosition
): Promise<boolean> => {
  const item = editingItem.value
  if (!item) {
    return false
  }
  const updated = await updatePosition(item.symbol, position)
  if (!updated) {
    showNotice('保存持仓失败，请稍后重试')
    return false
  }
  editingItem.value = updated
  return true
}

const handleRemove = async (symbol: string): Promise<void> => {
  const item = watchlist.value.find((entry) => entry.symbol === symbol)
  const label = item
    ? `${item.name || item.code}（${item.code}）`
    : codeFromSymbol(symbol)
  const noun = region.value === 'us' ? '美股自选' : '自选股'
  const confirmed = await confirm({
    title: '删除自选',
    description: `确定删除${noun}「${label}」吗？`,
    confirmText: '删除'
  })
  if (confirmed) {
    void removeWatch(symbol).then((ok) => {
      if (!ok) showNotice('删除自选失败，请稍后重试')
    })
  }
}

const handleRetry = (): void => {
  void refreshNow()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto scroll-py-2">
      <div class="flex flex-col gap-4 px-6 py-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <MarketSwitch :region="region" @update:region="handleRegionChange" />
          <div class="flex items-center gap-3">
            <span class="text-muted-foreground text-sm">暂停刷新</span>
            <Switch
              :model-value="settings.paused"
              aria-label="暂停刷新"
              @update:model-value="onTogglePaused"
            />
            <Button variant="outline" size="sm" @click="handleRefresh">
              <RefreshCw />
              刷新
            </Button>
          </div>
        </div>

        <p v-if="notice" class="text-destructive text-xs">{{ notice }}</p>

        <div class="stagger-list grid grid-cols-2 gap-3 lg:grid-cols-4">
          <IndexCard
            v-for="quote in activeSnapshot.indices"
            :key="quote.symbol"
            :quote="quote"
            :updated-at-label="activeSnapshot.updatedAtLabel"
          />
        </div>

        <PositionSummary :summary="positionSummary" :region="region" />

        <WatchPanel
          ref="watchPanelRef"
          :region="region"
          :quotes="activeSnapshot.quotes"
          :watchlist="activeWatchlist"
          :snapshot="activeSnapshot"
          @add="openAddDialog"
          @remove="handleRemove"
          @edit-position="handleEditPosition"
          @retry="handleRetry"
        />
      </div>
    </div>

    <footer
      class="bg-muted/30 text-muted-foreground border-t px-6 py-2 text-xs"
    >
      {{ FOOTER_TEXT }}
    </footer>

    <AddWatchDialog
      v-model:open="dialogOpen"
      :region="region"
      :on-add="handleAdd"
    />

    <PositionDialog
      v-model:open="positionDialogOpen"
      :item="editingItem"
      :on-save="handleSavePosition"
    />
  </div>
</template>
