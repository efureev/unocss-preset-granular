<script setup lang="ts">
import { computed } from 'vue'

import { layerZIndex } from '../shared/overlayZ'

const props = withDefaults(defineProps<{ depth?: number }>(), { depth: 0 })

// Имя токена здесь не упоминается: дефолт живёт в общем модуле. Ровно
// поэтому статический скан этого компонента про `--xh-z-dropdown` не знает.
const style = computed(() => ({ zIndex: layerZIndex(props.depth) }))
</script>

<template>
  <div class="xh-overlay fixed rounded-[var(--xh-radius-lg)] bg-[var(--xh-surface)] text-[var(--xh-surface-fg)]" :style="style">
    <slot />
  </div>
</template>
