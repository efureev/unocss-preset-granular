<script setup lang="ts">
import XNestedFooter from '../shared/XNestedFooter.vue'
import XNestedHeader from '../shared/XNestedHeader.vue'
</script>

<template>
  <section class="p-6 rounded-3xl border-2 border-red">
    <XNestedHeader/>
    <slot/>
    <XNestedFooter/>
  </section>
</template>
