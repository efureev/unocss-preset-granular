<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * Два канала потребления токенов, невидимых регекспу `var\(--…`:
 *
 *   1. ИМЯ токена ключом объекта инлайн-стиля (`PALETTE`) — так компонент
 *      ПРИСВАИВАЕТ покомпонентные точки кастомизации;
 *   2. имя строкой в `getPropertyValue` — так он ЧИТАЕТ токен фундамента.
 *
 * Разница между ними принципиальна для диагностики: присваивание объявления
 * не требует, чтение — требует.
 */
const props = withDefaults(defineProps<{ severity?: 'info' | 'danger' }>(), {
  severity: 'info',
})

const PALETTE = {
  info: {
    '--xh-alert-bg': 'var(--xh-blue-100)',
    '--xh-alert-fg': 'var(--xh-blue-900)',
    '--xh-alert-accent': 'var(--xh-blue-500)',
  },
  danger: {
    '--xh-alert-bg': 'var(--xh-red-100)',
    '--xh-alert-fg': 'var(--xh-red-900)',
    '--xh-alert-accent': 'var(--xh-red-500)',
  },
} as const

const root = ref<HTMLElement | null>(null)
const durationMs = ref(0)

const style = computed(() => PALETTE[props.severity])

onMounted(() => {
  if (!root.value)
    return
  // Чтение токена фундамента ПО ИМЕНИ: `var(` здесь нет, и статический скан
  // по `var(` этот токен не увидит.
  const raw = getComputedStyle(root.value).getPropertyValue('--xh-alert-duration')
  durationMs.value = Number.parseFloat(raw) || 0
})
</script>

<template>
  <div
    ref="root"
    class="xh-alert p-[var(--xh-space-3)] rounded-[var(--xh-radius-md)] bg-[var(--xh-alert-bg)] text-[var(--xh-alert-fg)]"
    :style="style"
    :data-duration="durationMs"
  >
    <slot />
  </div>
</template>

<style>
/* Акцентная полоса читает токен, который присваивается из JS. */
.xh-alert::before {
  content: '';
  display: block;
  height: var(--xh-border-thick);
  background: var(--xh-alert-accent);
}
</style>
