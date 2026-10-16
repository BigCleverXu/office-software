<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  Alarm,
  AlarmDraft,
  IntervalUnit,
  RepeatType,
  Weekday
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { REPEAT_OPTIONS, WEEKDAY_OPTIONS } from '@/lib/format'
import { INTERVAL_LIMITS, INTERVAL_UNIT_OPTIONS } from '@shared/interval'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ alarm?: Alarm | null }>()

const emit = defineEmits<{ submit: [draft: AlarmDraft] }>()

const label = ref('')
const time = ref('09:00')
const repeat = ref<RepeatType>('none')
const weekdays = ref<Weekday[]>([])
const intervalValue = ref(30)
const intervalUnit = ref<IntervalUnit>('minutes')
const enabled = ref(true)
const error = ref('')

const isEdit = computed(() => Boolean(props.alarm))

watch(open, (isOpen) => {
  if (!isOpen) return
  label.value = props.alarm?.label ?? ''
  time.value = props.alarm?.time ?? '09:00'
  repeat.value = props.alarm?.repeat ?? 'none'
  weekdays.value = props.alarm?.weekdays ? [...props.alarm.weekdays] : []
  intervalValue.value = props.alarm?.intervalValue || 30
  intervalUnit.value = props.alarm?.intervalUnit ?? 'minutes'
  enabled.value = props.alarm?.enabled ?? true
  error.value = ''
})

const isWeekly = computed(() => repeat.value === 'weekly')
const isInterval = computed(() => repeat.value === 'interval')

const toggleWeekday = (value: Weekday): void => {
  const index = weekdays.value.indexOf(value)
  if (index >= 0) {
    weekdays.value.splice(index, 1)
  } else {
    weekdays.value.push(value)
  }
}

const handleSubmit = (): void => {
  if (!label.value.trim()) {
    error.value = '请输入提醒内容'
    return
  }
  if (isInterval.value) {
    const value = intervalValue.value
    const { min, max } = INTERVAL_LIMITS[intervalUnit.value]
    if (!Number.isInteger(value) || value < min || value > max) {
      error.value = `间隔需为 ${min} 到 ${max} 之间的整数`
      return
    }
  } else if (!time.value) {
    error.value = '请选择提醒时间'
    return
  }
  if (isWeekly.value && weekdays.value.length === 0) {
    error.value = '请至少选择一个星期'
    return
  }

  emit('submit', {
    label: label.value.trim(),
    time: isInterval.value ? '' : time.value,
    repeat: repeat.value,
    weekdays: isWeekly.value ? [...weekdays.value] : [],
    intervalValue: isInterval.value ? intervalValue.value : 0,
    intervalUnit: isInterval.value ? intervalUnit.value : 'minutes',
    enabled: enabled.value
  })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? '编辑提醒' : '新建提醒' }}</DialogTitle>
        <DialogDescription>
          设定时间后，到点会通过系统通知提醒你。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <Label for="alarm-label">提醒内容</Label>
          <Input
            id="alarm-label"
            v-model="label"
            placeholder="例如：喝水、开会、抢票"
            maxlength="50"
          />
        </div>

        <div v-if="!isInterval" class="flex flex-col gap-2">
          <Label for="alarm-time">提醒时间</Label>
          <Input id="alarm-time" v-model="time" type="time" class="w-32" />
        </div>

        <div v-if="isInterval" class="flex flex-col gap-2">
          <Label for="alarm-interval">重复间隔</Label>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground text-sm">每隔</span>
            <Input
              id="alarm-interval"
              v-model.number="intervalValue"
              type="number"
              class="w-24"
              :min="INTERVAL_LIMITS[intervalUnit].min"
              :max="INTERVAL_LIMITS[intervalUnit].max"
              step="1"
            />
            <Select v-model="intervalUnit">
              <SelectTrigger class="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in INTERVAL_UNIT_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <span class="text-muted-foreground text-sm">提醒一次</span>
          </div>
          <p class="text-muted-foreground text-xs">
            保存后经过一个间隔首次提醒，之后按间隔循环。
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>重复周期</Label>
          <Select v-model="repeat">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择重复周期" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in REPEAT_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-if="isWeekly" class="flex flex-col gap-2">
          <Label>选择星期</Label>
          <div class="flex flex-wrap gap-4">
            <label
              v-for="option in WEEKDAY_OPTIONS"
              :key="option.value"
              class="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                :model-value="weekdays.includes(option.value)"
                @update:model-value="() => toggleWeekday(option.value)"
              />
              {{ option.label }}
            </label>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <Label for="alarm-enabled" class="cursor-pointer"
            >保存后立即启用</Label
          >
          <Switch id="alarm-enabled" v-model="enabled" />
        </div>

        <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button @click="handleSubmit">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
