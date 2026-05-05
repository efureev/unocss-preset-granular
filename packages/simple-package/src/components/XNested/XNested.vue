<script setup lang="ts">
import XNestedFooter from './parts/XNestedFooter.vue'
import XNestedHeader from './parts/XNestedHeader.vue'
</script>

<template>
  <section class="p-6 rounded-3xl">
    <XNestedHeader />
    <slot />
    <XNestedFooter />
  </section>
</template>
