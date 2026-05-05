<script setup lang="ts">
import XGroupASharedHeader from '../shared/XGroupASharedHeader.vue'
</script>
<template>
  <section class="p-3 rounded-xl border-dashed">
    <XGroupASharedHeader>
      <template #title>One</template>
    </XGroupASharedHeader>
    <slot />
  </section>
</template>
