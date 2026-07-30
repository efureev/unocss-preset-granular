<script setup lang="ts">
import {ref} from 'vue'
import {XTokenized} from '@feugene/simple-package/components/XTokenized'

import {themes} from './theme'

const current = ref(themes.get())
themes.subscribe(name => (current.value = name))
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <header class="flex items-center gap-3">
      <span class="font-bold">Тема:</span>
      <button
        v-for="name in themes.list()"
        :key="name"
        type="button"
        class="rounded border px-3 py-1"
        :class="name === current ? 'font-bold' : 'op-60'"
        @click="themes.set(name)"
      >
        {{ name }}
      </button>
      <button type="button" class="ml-auto rounded border px-3 py-1" @click="themes.cycle()">
        cycle
      </button>
    </header>

    <!-- Компонент красится токеном `--x-tokenized`: light → red, dark → yellow.
         Значения уже в CSS, переключение лишь меняет атрибут на <html>. -->
    <XTokenized>
      XTokenized — цвет приходит из токена активной темы
    </XTokenized>

    <p class="text-sm op-70">
      Активная тема хранится в localStorage и восстанавливается при перезагрузке;
      без сохранённого выбора берётся системная цветовая схема.
    </p>
  </main>
</template>
