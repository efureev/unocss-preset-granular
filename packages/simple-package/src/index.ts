export * from './components/XTest1'
export * from './components/XTestStyled'
export * from './components/XTokenized'
export { XNested, XNestedFooter, XNestedHeader } from './components/XNested'

// `XNestedReverse`, `XGroupAOne` и `XGroupATwo` в баррель НЕ входят намеренно.
// Их исходники лежат глубже `src/components/<Name>/` (`reverses/`, `groupA/`),
// поэтому дефолтный `componentModuleRegex` из `granularChunkFileNames()` их не
// узнаёт. Пока у SFC один потребитель — свой entry, — чанка не возникает вовсе
// и всё цело. Второй импорт (этот баррель) делает SFC общим чанком, и он
// уезжает во flat `dist/chunks/`, мимо скана: сборка зелёная, а классы
// компонента исчезают из CSS приложения (ловится `yarn verify:apps`, app-4).
// Импортировать их следует подпутём — `@feugene/simple-package/components/…`.
