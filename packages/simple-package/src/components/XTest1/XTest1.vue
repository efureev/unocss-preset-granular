<script setup lang="ts">
</script>
<template>
  <div class=":uno: border border-[var(--brd)] p-4 x-sp-test ">
    <slot/>
  </div>
</template>
<style>
.x-sp-test {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: stretch;

  @apply text-lg font-bold text-red-500;
}
</style>