<script setup lang="ts">
import { XhAlert } from '../XhAlert'
import { XhButton } from '../XhButton'
import { XhCard } from '../XhCard'
import { XhOverlay } from '../XhOverlay'
import { layerZIndex } from '../shared/overlayZ'
</script>

<template>
  <section class="xh-panel" :style="{ zIndex: layerZIndex() }">
    <h2 class="xh-panel__title">
      <slot name="title" />
    </h2>

    <XhCard>
      <slot />
    </XhCard>

    <XhAlert severity="info">
      <slot name="note" />
    </XhAlert>

    <div class="flex gap-[var(--xh-space-2)]">
      <XhButton tone="accent" size="md">
        <slot name="action" />
      </XhButton>
    </div>

    <!--
      Оверлей рендерится по-настоящему, а не под `v-if="false"`: иначе
      бандлер вытрясет компонент целиком, и литерал `'--xh-z-dropdown'` не
      доедет до чанка. А он — единственное место, где этот токен вообще
      упоминается: `var()` собирается в рантайме.
    -->
    <XhOverlay>
      <slot name="overlay" />
    </XhOverlay>

    <p class="xh-panel__note">
      <slot name="hint" />
    </p>
  </section>
</template>
