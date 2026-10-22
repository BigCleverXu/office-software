<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  error?: string
}>()
</script>

<template>
  <div
    class="border-border flex items-start justify-between gap-6 border-b py-3 last:border-b-0"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      <p class="text-sm font-medium">{{ title }}</p>
      <p v-if="description" class="text-muted-foreground text-xs">
        {{ description }}
      </p>
      <p v-if="error" class="text-destructive text-xs">{{ error }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot />
    </div>
  </div>
</template>
