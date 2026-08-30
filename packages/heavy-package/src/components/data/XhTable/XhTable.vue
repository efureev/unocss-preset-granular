<script setup lang="ts">
import XhDataHeader from '../shared/XhDataHeader.vue'
</script>

<template>
  <table class="xh-table w-full">
    <caption>
      <XhDataHeader label="table" />
    </caption>
    <tbody>
      <tr class="odd:bg-[var(--xh-table-stripe)]">
        <td class="p-[var(--xh-space-2)]">
          <slot />
        </td>
      </tr>
    </tbody>
  </table>
</template>
