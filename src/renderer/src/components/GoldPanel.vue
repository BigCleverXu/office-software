<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertCircle, Coins, RefreshCw } from 'lucide-vue-next'
import {
  computeGoldSummary,
  formatGrams,
  formatGoldAmount,
  formatGoldPrice,
  formatSignedGoldAmount,
  GOLD_NAMES,
  GOLD_UNITS,
  hasHolding,
  quoteOf,
  xauCnyPerGram
} from '@shared/gold'
import type { GoldQuote, GoldSymbol } from '@shared/gold'
import GoldHoldingDialog from '@/components/GoldHoldingDialog.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useGold } from '@/composables/useGold'
import { formatPercent, formatSigned, toneClass } from '@/lib/market-format'

const { snapshot, holding, updateHolding, refreshNow } = useGold()

const dialogOpen = ref(false)

/** 数据缺失时不使用旧值参与着色与展示 */
const goldValue = (
  quote: GoldQuote | null,
  value: number | null
): number | null => (quote && !quote.missing ? value : null)

const auQuote = computed(() => quoteOf(snapshot.value, 'au9999'))
const xauQuote = computed(() => quoteOf(snapshot.value, 'xau'))
const cnhQuote = computed(() => quoteOf(snapshot.value, 'cnh'))

const auPrice = computed(() =>
  goldValue(auQuote.value, auQuote.value?.price ?? null)
)
const auChange = computed(() =>
  goldValue(auQuote.value, auQuote.value?.change ?? null)
)
const auChangePercent = computed(() =>
  goldValue(auQuote.value, auQuote.value?.changePercent ?? null)
)

const auTone = computed(() => toneClass(auChange.value))

const auPriceText = computed(() => formatGoldPrice(auPrice.value))
const auChangeText = computed(() => formatSigned(auChange.value))
const auChangePercentText = computed(() => formatPercent(auChangePercent.value))

interface Detail {
  label: string
  value: string
}

/** 主卡下方的小字：今开 / 最高 / 最低 / 数据时间 */
const auDetails = computed<Detail[]>(() => {
  const quote = auQuote.value
  return [
    {
      label: '今开',
      value: formatGoldPrice(goldValue(quote, quote?.open ?? null))
    },
    {
      label: '最高',
      value: formatGoldPrice(goldValue(quote, quote?.high ?? null))
    },
    {
      label: '最低',
      value: formatGoldPrice(goldValue(quote, quote?.low ?? null))
    },
    {
      label: '数据时间',
      value: quote && !quote.missing && quote.quoteTime ? quote.quoteTime : '--'
    }
  ]
})

/** 伦敦金折算人民币克价；缺汇率或缺价时为 null */
const xauCny = computed(() =>
  xauCnyPerGram(
    goldValue(xauQuote.value, xauQuote.value?.price ?? null),
    goldValue(cnhQuote.value, cnhQuote.value?.price ?? null)
  )
)

interface SideQuote {
  key: GoldSymbol
  name: string
  unit: string
  price: string
  changePercent: string
  tone: string
  note: string | null
}

/** 副卡：伦敦金与离岸人民币 */
const sideQuotes = computed<SideQuote[]>(() => [
  {
    key: 'xau',
    name: GOLD_NAMES.xau,
    unit: GOLD_UNITS.xau,
    price: formatGoldPrice(
      goldValue(xauQuote.value, xauQuote.value?.price ?? null)
    ),
    changePercent: formatPercent(
      goldValue(xauQuote.value, xauQuote.value?.changePercent ?? null)
    ),
    tone: toneClass(goldValue(xauQuote.value, xauQuote.value?.change ?? null)),
    note:
      xauCny.value === null ? '--' : `≈ ${formatGoldPrice(xauCny.value)} 元/克`
  },
  {
    key: 'cnh',
    name: GOLD_NAMES.cnh,
    unit: GOLD_UNITS.cnh,
    price: formatGoldPrice(
      goldValue(cnhQuote.value, cnhQuote.value?.price ?? null)
    ),
    changePercent: formatPercent(
      goldValue(cnhQuote.value, cnhQuote.value?.changePercent ?? null)
    ),
    tone: toneClass(goldValue(cnhQuote.value, cnhQuote.value?.change ?? null)),
    note: null
  }
])

const held = computed(() => hasHolding(holding.value))

const summary = computed(() => computeGoldSummary(auQuote.value, holding.value))

const costPerGramText = computed(() =>
  holding.value.costPerGram > 0
    ? formatGoldPrice(holding.value.costPerGram)
    : '--'
)

interface Metric {
  label: string
  value: string
  tone: string
}

const metrics = computed<Metric[]>(() => {
  const data = summary.value
  return [
    {
      label: '持有克数',
      value: `${formatGrams(data.grams)} 克`,
      tone: 'text-foreground'
    },
    {
      label: '每克成本',
      value:
        costPerGramText.value === '--' ? '--' : `${costPerGramText.value} 元`,
      tone: 'text-foreground'
    },
    {
      label: '持仓市值',
      value: formatGoldAmount(data.marketValue),
      tone: 'text-foreground'
    },
    {
      label: '今日盈亏',
      value: formatSignedGoldAmount(data.todayPnl),
      tone: toneClass(data.todayPnl)
    },
    {
      label: '累计盈亏',
      value: formatSignedGoldAmount(data.totalPnl),
      tone: toneClass(data.totalPnl)
    },
    {
      label: '累计收益率',
      value: formatPercent(data.totalPnlPercent),
      tone: toneClass(data.totalPnlPercent)
    }
  ]
})

const hasQuotes = computed(() => snapshot.value.quotes.length > 0)

const showSkeleton = computed(
  () => snapshot.value.status === 'loading' && !hasQuotes.value
)

const showBanner = computed(
  () => hasQuotes.value && snapshot.value.status === 'failed'
)

const showEmpty = computed(() => !showSkeleton.value && !hasQuotes.value)

const refreshing = computed(() => snapshot.value.status === 'refreshing')

const statusTone = computed(() =>
  snapshot.value.status === 'failed'
    ? 'text-destructive'
    : 'text-muted-foreground'
)

/** 顶部更新时间 / 加载状态 */
const updatedText = computed(() => {
  const { status, updatedAtLabel } = snapshot.value
  const label = updatedAtLabel ?? '--'
  switch (status) {
    case 'loading':
      return '加载中…'
    case 'refreshing':
      return updatedAtLabel ? `刷新中 · 上次更新 ${label}` : '刷新中…'
    case 'failed':
      return updatedAtLabel ? `刷新失败 · 上次成功 ${label}` : '刷新失败'
    default:
      return updatedAtLabel ? `已更新 ${label}` : '已更新'
  }
})

const errorMessage = computed(() =>
  snapshot.value.updatedAtLabel
    ? `行情刷新失败，请稍后重试（上次成功 ${snapshot.value.updatedAtLabel}）`
    : '积存金行情获取失败，请稍后重试'
)

const openDialog = (): void => {
  dialogOpen.value = true
}

const handleRefresh = (): void => {
  void refreshNow()
}

const handleSaveHolding = (payload: {
  grams: number
  costPerGram: number
}): Promise<boolean> => updateHolding(payload.grams, payload.costPerGram)

const FOOTER_TEXT =
  '数据来源：新浪财经公开行情（上金所 Au99.99 / 伦敦金 / 离岸人民币），仅供参考，不构成投资建议。'
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto scroll-py-2">
      <div class="flex flex-col gap-4 px-6 py-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <h1 class="text-sm font-semibold tracking-tight">积存金</h1>
            <span class="truncate text-xs" :class="statusTone">
              {{ updatedText }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="refreshing"
              aria-label="刷新积存金行情"
              @click="handleRefresh"
            >
              <RefreshCw
                aria-hidden="true"
                :class="{
                  'animate-spin motion-reduce:animate-none': refreshing
                }"
              />
              刷新
            </Button>
            <Button size="sm" aria-label="记录积存金持仓" @click="openDialog">
              <Coins aria-hidden="true" />
              {{ held ? '修改持仓' : '记录持仓' }}
            </Button>
          </div>
        </div>

        <div
          v-if="showBanner"
          class="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-xs"
        >
          <span class="flex min-w-0 items-center gap-2">
            <AlertCircle class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ errorMessage }}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="重试刷新积存金行情"
            @click="handleRefresh"
          >
            重试
          </Button>
        </div>

        <div
          v-if="showSkeleton"
          class="stagger-list grid gap-4 lg:grid-cols-2"
          role="status"
          aria-busy="true"
        >
          <span class="sr-only">正在加载积存金行情</span>
          <Card class="skeleton-shimmer h-52"></Card>
          <div class="flex flex-col gap-4">
            <Card class="skeleton-shimmer h-28"></Card>
            <Card class="skeleton-shimmer h-28"></Card>
          </div>
        </div>

        <section
          v-else-if="showEmpty"
          class="bg-card shadow-soft empty-state text-muted-foreground rounded-2xl border border-border/70 px-6 py-16"
        >
          <span class="empty-state-icon">
            <Coins class="size-6" aria-hidden="true" />
          </span>
          <p class="text-sm">积存金行情暂不可用</p>
          <Button
            variant="outline"
            size="sm"
            aria-label="重试加载积存金行情"
            @click="handleRefresh"
          >
            <RefreshCw aria-hidden="true" />
            重试
          </Button>
        </section>

        <template v-else>
          <div class="stagger-list grid gap-4 lg:grid-cols-2">
            <Card class="shadow-soft min-w-0">
              <CardContent class="flex flex-col gap-3 px-5 py-4">
                <span class="text-muted-foreground text-xs">
                  {{ GOLD_NAMES.au9999 }}
                </span>

                <div class="flex flex-wrap items-baseline gap-2">
                  <span
                    class="font-mono text-4xl font-semibold break-words tabular-nums"
                    :class="auTone"
                  >
                    {{ auPriceText }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ GOLD_UNITS.au9999 }}
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-3 text-sm">
                  <span class="font-mono tabular-nums" :class="auTone">
                    {{ auChangeText }}
                  </span>
                  <span class="font-mono tabular-nums" :class="auTone">
                    {{ auChangePercentText }}
                  </span>
                </div>

                <dl
                  class="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs sm:grid-cols-4"
                >
                  <div
                    v-for="item in auDetails"
                    :key="item.label"
                    class="flex min-w-0 flex-col gap-0.5"
                  >
                    <dt class="text-muted-foreground">{{ item.label }}</dt>
                    <dd class="truncate font-mono tabular-nums">
                      {{ item.value }}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <div class="flex min-w-0 flex-col gap-4">
              <Card
                v-for="quote in sideQuotes"
                :key="quote.key"
                class="shadow-soft min-w-0"
              >
                <CardContent class="flex flex-col gap-2 px-5 py-4">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-muted-foreground text-xs">
                      {{ quote.name }}
                    </span>
                    <span class="text-muted-foreground text-xs">
                      {{ quote.unit }}
                    </span>
                  </div>
                  <div class="flex flex-wrap items-baseline gap-3">
                    <span
                      class="font-mono text-2xl font-semibold break-words tabular-nums"
                      :class="quote.tone"
                    >
                      {{ quote.price }}
                    </span>
                    <span
                      class="font-mono text-sm tabular-nums"
                      :class="quote.tone"
                    >
                      {{ quote.changePercent }}
                    </span>
                  </div>
                  <p
                    v-if="quote.note"
                    class="text-muted-foreground text-xs break-words"
                  >
                    人民币参考价 {{ quote.note }}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card class="shadow-soft min-w-0">
            <CardContent class="flex flex-col gap-3 px-5 py-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span class="text-sm font-medium">我的持仓</span>
                  <span
                    v-if="held"
                    class="text-muted-foreground text-xs break-words"
                  >
                    {{ formatGrams(summary.grams) }} 克 · 成本
                    {{ costPerGramText }} 元/克
                  </span>
                </div>
                <Button
                  v-if="held"
                  variant="outline"
                  size="sm"
                  aria-label="修改积存金持仓"
                  @click="openDialog"
                >
                  修改持仓
                </Button>
              </div>

              <div v-if="held" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div
                  v-for="metric in metrics"
                  :key="metric.label"
                  class="flex min-w-0 flex-col gap-0.5"
                >
                  <span class="text-muted-foreground text-xs">
                    {{ metric.label }}
                  </span>
                  <span
                    class="font-mono text-sm font-semibold break-words tabular-nums"
                    :class="metric.tone"
                  >
                    {{ metric.value }}
                  </span>
                </div>
              </div>

              <div
                v-else
                class="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between"
              >
                <p class="text-muted-foreground text-xs">
                  填写持有克数与成本后自动统计盈亏
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="记录积存金持仓"
                  @click="openDialog"
                >
                  <Coins aria-hidden="true" />
                  记录持仓
                </Button>
              </div>
            </CardContent>
          </Card>
        </template>
      </div>
    </div>

    <footer
      class="bg-muted/30 text-muted-foreground border-t px-6 py-2 text-xs"
    >
      {{ FOOTER_TEXT }}
    </footer>

    <GoldHoldingDialog
      v-model:open="dialogOpen"
      :holding="holding"
      :on-save="handleSaveHolding"
    />
  </div>
</template>
