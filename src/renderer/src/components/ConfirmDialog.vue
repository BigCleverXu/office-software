<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { confirmState, settleConfirm } from '@/composables/useConfirm'

const state = computed(() => confirmState.value)

/** 按钮自带的关闭逻辑晚于捕获阶段，需提前结算才能区分确认与取消 */
const onFooterClick = (event: MouseEvent): void => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-slot="alert-dialog-action"]')) {
    settleConfirm(true)
    return
  }
  if (target.closest('[data-slot="alert-dialog-cancel"]')) {
    settleConfirm(false)
  }
}

/** Esc 等关闭操作视为取消，状态已清空时 settle 为无操作 */
const onOpenChange = (open: boolean): void => {
  if (!open) settleConfirm(false)
}
</script>

<template>
  <AlertDialog :open="state !== null" @update:open="onOpenChange">
    <AlertDialogContent v-if="state">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ state.title }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ state.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter @click.capture="onFooterClick">
        <AlertDialogCancel>{{ state.cancelText }}</AlertDialogCancel>
        <AlertDialogAction
          :variant="state.destructive ? 'destructive' : 'default'"
        >
          {{ state.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
