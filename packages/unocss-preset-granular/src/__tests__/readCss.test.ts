import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearCssCache, CSS_CACHE_MAX_ENTRIES, getCssCacheSize, readCss } from '../fs/readCss'

describe('readCss (mtime cache)', () => {
  it('декодирует data URL без обращения к FS', async () => {
    expect(await readCss('data:text/css,.a{color:red}')).toBe('.a{color:red}')
    expect(await readCss('data:text/css;base64,LmF7fQ==')).toBe('.a{}')
  })

  it('читает файл и возвращает свежее содержимое после изменения', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'granular-readcss-'))
    const file = join(dir, 'x.css')

    writeFileSync(file, '.a{}')
    expect(await readCss(file)).toBe('.a{}')
    // повторное чтение без изменений — то же содержимое (cache hit)
    expect(await readCss(file)).toBe('.a{}')

    // изменение содержимого (другой размер) → кэш инвалидируется
    writeFileSync(file, '.a{color:red}')
    expect(await readCss(file)).toBe('.a{color:red}')
  })

  it('clearCssCache сбрасывает кэш без ошибок', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'granular-readcss-'))
    const file = join(dir, 'y.css')
    writeFileSync(file, '.y{}')
    expect(await readCss(file)).toBe('.y{}')
    clearCssCache()
    expect(await readCss(file)).toBe('.y{}')
  })

  it('пробрасывает ошибку на несуществующем файле', async () => {
    await expect(readCss(join(tmpdir(), 'granular-does-not-exist-xyz.css'))).rejects.toThrow()
  })
})

describe('cssCache: верхняя граница (AUDIT C6)', () => {
  it('вытесняет самые давние записи, не растёт бесконечно', async () => {
    clearCssCache()
    const dir = mkdtempSync(join(tmpdir(), 'granular-css-lru-'))
    try {
      const files: string[] = []
      for (let i = 0; i < CSS_CACHE_MAX_ENTRIES + 10; i++) {
        const f = join(dir, `f${i}.css`)
        writeFileSync(f, `.c${i}{color:red}`, 'utf8')
        files.push(f)
        await readCss(f)
      }

      expect(getCssCacheSize()).toBe(CSS_CACHE_MAX_ENTRIES)

      // Содержимое по-прежнему отдаётся корректно — вытеснение означает
      // повторное чтение с диска, а не потерю данных.
      expect(await readCss(files[0])).toBe('.c0{color:red}')
      expect(await readCss(files.at(-1)!)).toBe(`.c${files.length - 1}{color:red}`)
      expect(getCssCacheSize()).toBe(CSS_CACHE_MAX_ENTRIES)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
      clearCssCache()
    }
  })

  it('повторный запрос освежает запись, вытесняется «холодная»', async () => {
    clearCssCache()
    const dir = mkdtempSync(join(tmpdir(), 'granular-css-lru2-'))

    // Пишем с ФИКСИРОВАННЫМ mtime, округлённым до секунды: иначе
    // `utimesSync` не воспроизведёт исходный `mtimeMs` точь-в-точь (на APFS
    // у него субмиллисекундная часть), и инвалидация сработает раньше LRU.
    const stamp = new Date(Math.floor(Date.now() / 1000) * 1000)
    const write = (file: string, content: string): void => {
      writeFileSync(file, content, 'utf8')
      utimesSync(file, stamp, stamp)
    }

    // Подменяет содержимое, СОХРАНЯЯ mtime и размер: закэшированная запись
    // после этого продолжит отдавать старый текст, а вытесненная — новый.
    // Это единственный способ снаружи отличить «отдано из кэша» от
    // «перечитано с диска».
    const rewriteInPlace = write

    try {
      const hot = join(dir, 'hot.css')
      const cold = join(dir, 'cold.css')
      write(hot, '.aaa{}')
      write(cold, '.bbb{}')
      await readCss(hot)
      await readCss(cold)

      // Заполняем кэш до предела, поддерживая `hot` горячим.
      for (let i = 0; i < CSS_CACHE_MAX_ENTRIES; i++) {
        const f = join(dir, `f${i}.css`)
        write(f, `.c${i}{}`)
        await readCss(f)
        await readCss(hot)
      }

      expect(getCssCacheSize()).toBe(CSS_CACHE_MAX_ENTRIES)

      rewriteInPlace(hot, '.zzz{}')
      rewriteInPlace(cold, '.yyy{}')

      // `hot` запрашивался постоянно — остался в кэше (старый текст).
      expect(await readCss(hot)).toBe('.aaa{}')
      // `cold` вытеснен — перечитан с диска (новый текст).
      expect(await readCss(cold)).toBe('.yyy{}')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
      clearCssCache()
    }
  })
})
