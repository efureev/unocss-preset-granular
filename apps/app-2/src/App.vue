<script setup lang="ts">
import {XTestStyled} from "@feugene/simple-package/components/XTestStyled";
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10 text-slate-900">
    <XTestStyled class="p-6 shadow-sm">
      Test
    </XTestStyled>

    <!-- Визуализация токенов, созданных приложением через tokenOverrides.light:
         рамка красится в --brd, текст — в --card-fg. -->
    <div class="rounded-lg border-2 border-[var(--brd)] p-4 text-[var(--card-fg)]">
      tokenOverrides.light → border=<code>--brd</code>, text=<code>--card-fg</code>
    </div>
  </main>
</template>
