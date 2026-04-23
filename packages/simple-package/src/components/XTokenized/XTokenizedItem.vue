<script setup lang="ts">
withDefaults(defineProps<{
  disabled: boolean,
}>(), {
  disabled: false,
})
</script>
<template>
  <div class="m-2 border rounded-md" :class="disabled ? 'border-red' : 'border-green'">
    <slot/>
  </div>
</template>