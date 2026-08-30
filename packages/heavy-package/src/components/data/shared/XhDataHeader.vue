<script setup lang="ts">
/** Общий SFC группы `data`: уезжает в `dist/groups/data/shared/`. */
defineProps<{ label?: string }>()
</script>

<template>
  <div class="xh-data-header px-[var(--xh-space-3)] py-[var(--xh-space-2)] bg-[var(--xh-table-head-bg)] font-[var(--xh-weight-medium)]">
    {{ label }}
    <slot />
  </div>
</template>
