<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Repeat, Trash2 } from 'lucide-vue-next'
import type { Alarm } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { primaryTimeLabel, repeatSummary } from '@/lib/format'

const props = defineProps<{ alarm: Alarm }>()

const emit = defineEmits<{
  toggle: [enabled: boolean]
  edit: []
  remove: []
}>()

const summary = computed(() => repeatSummary(props.alarm))

const timeLabel = computed(() => primaryTimeLabel(props.alarm))

const onToggle = (value: boolean): void => emit('toggle', value)
</script>

<template>
  <Card
    class="gap-0 py-0 transition-colors"
    :class="{ 'opacity-60': !alarm.enabled }"
  >
    <CardContent class="flex items-center gap-4 px-4 py-3">
      <div class="font-mono text-2xl font-semibold tabular-nums tracking-tight">
        {{ timeLabel }}
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          class="truncate text-sm font-medium"
          :class="{ 'line-through': !alarm.enabled }"
        >
          {{ alarm.label }}
        </span>
        <Badge variant="secondary" class="gap-1">
          <Repeat class="size-3" />
          {{ summary }}
        </Badge>
      </div>

      <Switch
        :model-value="alarm.enabled"
        aria-label="启用或禁用提醒"
        @update:model-value="onToggle"
      />

      <div class="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="编辑提醒"
              @click="emit('edit')"
            >
              <Pencil />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="删除提醒"
              class="text-destructive hover:text-destructive"
              @click="emit('remove')"
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </CardContent>
  </Card>
</template>
