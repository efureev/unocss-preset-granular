<script setup lang="ts">
import {XNestedReverse} from "@feugene/simple-package/components/XNestedReverse";
</script>

<template>
  <main class="p-6 space-y-6">
    <!-- 1. Скан вложенных SFC: text-7xl / tracking-widest приходят из
         XNestedHeader и XNestedFooter, которые rolldown инлайнит в
         entry-чанк XNestedReverse — файловый скан видит их там. -->
    <XNestedReverse>
      body
    </XNestedReverse>

    <!-- 2. Правила из @feugene/unocss-mini-extra-rules. Без разметки,
         которая их использует, наборы правил подключены, но ничего не
         эмитят — проверять было бы нечего. -->
    <section class="divide-y divide-slate-300">
      <div class="flex items-center gap-3 p-4">
        <!-- animationRules + animationPreflights -->
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-400"/>
        <span>спиннер → animationRules + animationPreflights</span>
      </div>

      <!-- colorOpacityRules: bracket-цвет с /NN -->
      <div class="bg-[#0ea5e9]/30 border border-[#0ea5e9]/60 p-4">
        bracket-цвет с opacity → colorOpacityRules
      </div>

      <!-- filterRules: несколько фильтров на одном элементе -->
      <div class="p-4 blur-1 saturate-150 backdrop-blur-md">
        композиция blur / saturate / backdrop → filterRules
      </div>

      <!-- accessibilityRules: пара sr-only / not-sr-only в её обычном виде —
           ссылка, видимая только при навигации с клавиатуры. -->
      <div class="p-4">
        <a href="#main" class="sr-only focus:not-sr-only">перейти к содержимому</a>
        <span>скрытая от глаз ссылка → accessibilityRules</span>
      </div>
    </section>

    <!-- spacingRules + spacingVariants -->
    <section class="flex space-x-4">
      <span>первый</span>
      <span>второй → spacingRules + spacingVariants</span>
    </section>
  </main>
</template>
