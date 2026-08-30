<script setup lang="ts">
import { computed } from 'vue'

import { BASE_CLASS, PAD_STEP, TONE, type XhButtonSize, type XhButtonTone } from './btnStyles'

const props = withDefaults(defineProps<{ size?: XhButtonSize, tone?: XhButtonTone }>(), {
  size: 'md',
  tone: 'neutral',
})

// Именно эта конкатенация делает ступень недоказуемой по бандлу.
const classes = computed(() => `${BASE_CLASS} p-${PAD_STEP[props.size]} ${TONE[props.tone]}`)
</script>

<template>
  <button type="button" class="xh-button" :class="classes">
    <slot />
  </button>
</template>
