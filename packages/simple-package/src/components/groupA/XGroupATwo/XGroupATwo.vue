<script setup lang="ts">
import XGroupASharedHeader from '../shared/XGroupASharedHeader.vue'
</script>
<template>
  <section class="p-4 rounded-2xl border-dotted">
    <XGroupASharedHeader>
      <template #title>Two</template>
    </XGroupASharedHeader>
    <slot />
  </section>
</template>
