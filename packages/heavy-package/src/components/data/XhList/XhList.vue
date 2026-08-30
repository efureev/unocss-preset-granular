<script setup lang="ts">
import XhDataHeader from '../shared/XhDataHeader.vue'
</script>

<template>
  <div class="xh-list divide-y">
    <XhDataHeader label="list" />
    <slot />
  </div>
</template>
