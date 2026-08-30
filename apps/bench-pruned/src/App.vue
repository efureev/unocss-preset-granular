<script setup lang="ts">
import { XhPanel } from '@feugene/heavy-package/components/XhPanel'
</script>

<template>
  <!--
    Ни одного СОБСТВЕННОГО класса — намеренно. Всё, что окажется в
    `app-*.css`, пришло из компонента, и только поэтому этот ассет можно
    приписать библиотеке. Первая же утилита здесь ломает атрибуцию, и это
    ловит `expected-css.mjs`.

    Имя утилиты в этом комментарии не пишется — тоже намеренно: UnoCSS
    сканирует ТЕКСТ файла, а не разметку, и сгенерировал бы правило прямо
    отсюда. Проверено: строка с примером класса дала его в `app-*.css`.
  -->
  <main>
    <XhPanel>
      <template #title>bench-pruned</template>
      <template #note>Подопытный стенд: один компонент поверх полного фундамента.</template>
      <template #action>Действие</template>
      <template #hint>Подсказка</template>
      Содержимое карточки.
    </XhPanel>
  </main>
</template>
