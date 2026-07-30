<script setup lang="ts">
import {ref} from 'vue'
import {XTokenized} from '@feugene/simple-package/components/XTokenized'

import {themeLabel, themes} from './theme'

const current = ref(themes.get())
themes.subscribe(name => (current.value = name))
</script>

<template>
  <!-- Цвета берутся из токенов активной темы. Ни одного упоминания
       конкретной темы в разметке нет: переключение — это смена значения
       атрибута data-theme на <html>. -->
  <main
    class="min-h-screen bg-[var(--app-bg)] text-[var(--app-fg)]"
  >
    <div class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header class="flex flex-wrap items-center gap-3">
        <span class="font-bold">Тема:</span>
        <button
          v-for="name in themes.list()"
          :key="name"
          type="button"
          class="rounded border px-3 py-1"
          :style="{
            borderColor: 'var(--app-muted)',
            background: name === current ? 'var(--app-accent)' : 'transparent',
          }"
          @click="themes.set(name)"
        >
          {{ themeLabel(name) }}
        </button>
        <button
          type="button"
          class="ml-auto rounded border px-3 py-1"
          :style="{borderColor: 'var(--app-muted)'}"
          @click="themes.cycle()"
        >
          cycle
        </button>
      </header>

      <p class="text-sm">
        Активна: <b>{{ themeLabel(current) }}</b> ({{ current }}),
        схема: {{ themes.entry(current).colorScheme ?? '—' }}
      </p>

      <!-- Компонент провайдера. В emerald и ocean токен `--x-tokenized`
           переопределён приложением, в crimson — унаследован от темы `light`
           провайдера, которой в сборке нет. -->
      <XTokenized>
        XTokenized — цвет приходит из токена активной темы
      </XTokenized>

      <p class="text-sm">
        Провайдер поставляет <code>light</code> и <code>dark</code>; в этой
        сборке нет ни одной из них. Три темы приложения объявлены в
        <code>uno.config.ts</code> через <code>themes.define</code> и
        наследуют значения <code>light</code> через <code>extends</code>.
      </p>
    </div>
  </main>
</template>
