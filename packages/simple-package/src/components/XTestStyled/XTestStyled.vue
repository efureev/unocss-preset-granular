<script setup lang="ts">
import {base} from "./dsStyles.ts";
</script>
<template>
  <div :class="base">
    <slot/>
  </div>
</template>