<script setup lang="ts">
import { ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { codeFromSymbol, normalizeCode } from '@shared/market'
import type { AddWatchResult } from '@shared/market'
import AddWatchDialog from '@/components/AddWatchDialog.vue'
import IndexCard from '@/components/IndexCard.vue'
import WatchPanel from '@/components/WatchPanel.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useMarket } from '@/composables/useMarket'

const {
  snapshot,
  watchlist,
  settings,
  addWatch,
  removeWatch,
  refreshNow,
  setPaused
} = useMarket()

const dialogOpen = ref(false)
const watchPanelRef = ref<InstanceType<typeof WatchPanel> | null>(null)

const openAddDialog = (): void => {
  dialogOpen.value = true
}

const onTogglePaused = (paused: boolean): void => {
  void setPaused(paused)
}

const handleRefresh = (): void => {
  void refreshNow()
}

/**
 * 添加入口：重复添加时高亮既有行 2 秒，其余结果原样返回给弹窗。
 */
const handleAdd = async (code: string): Promise<AddWatchResult> => {
  const result = await addWatch(code)
  if (!result.ok && result.reason === 'duplicate') {
    const normalized = normalizeCode(code)
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
  const confirmed = window.confirm(`确定删除自选股「${label}」吗？`)
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
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground text-sm">暂停刷新</span>
            <Switch
              :model-value="settings.paused"
              aria-label="暂停刷新"
              @update:model-value="onTogglePaused"
            />
          </div>
          <Button variant="outline" size="sm" @click="handleRefresh">
            <RefreshCw />
            刷新
          </Button>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <IndexCard
            v-for="quote in snapshot.indices"
            :key="quote.symbol"
            :quote="quote"
            :updated-at-label="snapshot.updatedAtLabel"
          />
        </div>

        <WatchPanel
          ref="watchPanelRef"
          :quotes="snapshot.quotes"
          :watchlist="watchlist"
          :snapshot="snapshot"
          @add="openAddDialog"
          @remove="handleRemove"
          @retry="handleRetry"
        />
      </div>
    </div>

    <footer class="text-muted-foreground border-t px-6 py-2 text-xs">
      数据来源：腾讯财经公开行情接口，行情可能存在延迟，仅供参考，不构成投资建议。
    </footer>

    <AddWatchDialog v-model:open="dialogOpen" :on-add="handleAdd" />
  </div>
</template>
