export * from './components/XhCard'
export * from './components/XhButton'
export * from './components/XhAlert'
export * from './components/XhOverlay'
export * from './components/XhPanel'

// `XhTable` и `XhList` в баррель НЕ входят намеренно: их исходники лежат
// глубже `src/components/<Name>/` (`data/`), и второй потребитель сделал бы
// общий SFC группы обычным чанком мимо скана. Импортировать их следует
// подпутём — `@feugene/heavy-package/components/XhTable`.
