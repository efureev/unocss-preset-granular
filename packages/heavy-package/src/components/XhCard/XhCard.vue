<script setup lang="ts">
/**
 * Честный компонент: все классы статические, `safelist` пуст.
 * Всё, что он потребляет, находит файловый скан `dist/components/XhCard/`.
 */
</script>

<template>
  <div
    class="xh-card rounded-[var(--xh-radius-md)] p-[var(--xh-space-3)] bg-[var(--xh-card-bg)] text-[var(--xh-card-fg)] border border-[var(--xh-card-border)] shadow-[var(--xh-shadow-sm)]"
  >
    <slot />
  </div>
</template>

<style>
/* Собственный CSS компонента: уезжает в `components/XhCard/styles.css`. */
.xh-card > * + * {
  margin-top: var(--xh-space-2);
}
</style>
