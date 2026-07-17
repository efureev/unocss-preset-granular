<script setup lang="ts">
import {XgQuick} from "@feugene/extra-simple-package/components/XgQuick";
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10 text-slate-900">
    <XgQuick class="p-6 shadow-sm"/>

    <!-- XgQuick тянет транзитивный XTest1 (@feugene/simple-package) через
         component.dependencies + provider.dependencies. -->
    <div class="rounded-lg border-2 border-slate-900 p-4">
      XgQuick (extra-simple-package) + транзитивный XTest1 (simple-package)
    </div>
  </main>
</template>
