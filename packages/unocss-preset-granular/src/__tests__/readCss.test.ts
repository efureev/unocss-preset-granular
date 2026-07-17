import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearCssCache, readCss } from '../fs/readCss'

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
