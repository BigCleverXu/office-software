<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import {
  codeFromSymbol,
  normalizeCode,
  normalizeUsSymbol
} from '@shared/market'
import type { AddWatchResult, MarketRegion } from '@shared/market'
import AddWatchDialog from '@/components/AddWatchDialog.vue'
import IndexCard from '@/components/IndexCard.vue'
import MarketSwitch from '@/components/MarketSwitch.vue'
import WatchPanel from '@/components/WatchPanel.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
  removeWatch,
  refreshNow,
  setPaused,
  setRegion
} = useMarket()

const dialogOpen = ref(false)
const watchPanelRef = ref<InstanceType<typeof WatchPanel> | null>(null)

/** 当前市场展示的快照与自选股 */
const activeSnapshot = computed(() =>
  region.value === 'us' ? usSnapshot.value : snapshot.value
)

const activeWatchlist = computed(() =>
  region.value === 'us' ? usWatchlist.value : cnWatchlist.value
)

const FOOTER_TEXT =
  '数据来源：腾讯财经公开行情接口，行情可能存在延迟，仅供参考，不构成投资建议。'

const openAddDialog = (): void => {
  dialogOpen.value = true
}

const onTogglePaused = (paused: boolean): void => {
  void setPaused(paused)
}

const handleRefresh = (): void => {
  void refreshNow()
}

const handleRegionChange = (next: MarketRegion): void => {
  void setRegion(next)
}

/**
 * 添加入口：重复添加时高亮既有行 2 秒，其余结果原样返回给弹窗。
 * 符号规则按当前市场区分：A 股 6 位代码、美股 ticker。
 */
const handleAdd = async (code: string): Promise<AddWatchResult> => {
  const result = await addWatch(code)
  if (!result.ok && result.reason === 'duplicate') {
    const normalized =
      region.value === 'us' ? normalizeUsSymbol(code) : normalizeCode(code)
    if (normalized) {
      watchPanelRef.value?.highlight(normalized.symbol)
    }
  }
  return result
}

const handleRemove = (symbol: string): void => {
  const item = watchlist.value.find((entry) => entry.symbol === symbol)
  const label = item
    ? `${item.name || item.code}（${item.code}）`
    : codeFromSymbol(symbol)
  const noun = region.value === 'us' ? '美股自选' : '自选股'
  const confirmed = window.confirm(`确定删除${noun}「${label}」吗？`)
  if (confirmed) {
    void removeWatch(symbol)
  }
}

const handleRetry = (): void => {
  void refreshNow()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 overflow-y-auto">
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

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <IndexCard
            v-for="quote in activeSnapshot.indices"
            :key="quote.symbol"
            :quote="quote"
            :updated-at-label="activeSnapshot.updatedAtLabel"
          />
        </div>

        <WatchPanel
          ref="watchPanelRef"
          :region="region"
          :quotes="activeSnapshot.quotes"
          :watchlist="activeWatchlist"
          :snapshot="activeSnapshot"
          @add="openAddDialog"
          @remove="handleRemove"
          @retry="handleRetry"
        />
      </div>
    </div>

    <footer class="text-muted-foreground border-t px-6 py-2 text-xs">
      {{ FOOTER_TEXT }}
    </footer>

    <AddWatchDialog
      v-model:open="dialogOpen"
      :region="region"
      :on-add="handleAdd"
    />
  </div>
</template>
