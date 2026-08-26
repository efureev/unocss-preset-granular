export class ProviderNotRegisteredError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly referencedBy?: string,
  ) {
    const from = referencedBy ? ` (referenced by '${referencedBy}')` : ''
    super(
      `Provider '${providerId}' is not registered${from}. Add it to the 'providers' option of the preset.`,
    )
    this.name = 'ProviderNotRegisteredError'
  }
}

export class ComponentNotFoundError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly componentName: string,
    public readonly available: readonly string[],
    public readonly referencedBy?: string,
  ) {
    const from = referencedBy ? ` (referenced by '${referencedBy}')` : ''
    super(
      `Component '${providerId}:${componentName}' not found${from}. Available in '${providerId}': [${available.join(', ')}].`,
    )
    this.name = 'ComponentNotFoundError'
  }
}

/**
 * Строковый элемент селекции не разбирается как `providerId:ComponentName`.
 *
 * Разделитель — ПОСЛЕДНЕЕ двоеточие, обе стороны непустые; короткая форма
 * `'Name'` допустима только внутри `component.dependencies`, но не в
 * `options.components`.
 */
export class InvalidComponentKeyError extends Error {
  constructor(public readonly key: string) {
    super(
      `Invalid component key '${key}': expected 'providerId:ComponentName' `
      + `(short form 'Name' is only allowed inside a component's 'dependencies').`,
    )
    this.name = 'InvalidComponentKeyError'
  }
}

export class CircularDependencyError extends Error {
  constructor(public readonly chain: readonly string[]) {
    super(`Circular granular component dependency detected: ${chain.join(' -> ')}`)
    this.name = 'CircularDependencyError'
  }
}

export class DuplicateProviderIdError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly path?: readonly string[],
  ) {
    const where = path && path.length > 0 ? ` (at ${path.join(' -> ')})` : ''
    super(
      `Duplicate granular provider id: '${providerId}'${where}. Each provider must have a unique 'id', `
      + `and two different provider instances share the same id (possibly a version/build conflict).`,
    )
    this.name = 'DuplicateProviderIdError'
  }
}

export class UnsupportedContractVersionError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly version: number,
    public readonly supported: number,
  ) {
    super(
      `Granular provider '${providerId}' declares 'contractVersion: ${version}', `
      + `but this preset supports version ${supported}. `
      + `Upgrade '@feugene/unocss-preset-granular' (or the provider) so their contract versions match.`,
    )
    this.name = 'UnsupportedContractVersionError'
  }
}

export class DuplicateComponentNameError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly componentName: string,
  ) {
    super(
      `Granular provider '${providerId}' declares two components named '${componentName}'. `
      + `Component names must be unique within a provider — rename one of them.`,
    )
    this.name = 'DuplicateComponentNameError'
  }
}

export class CircularProviderDependencyError extends Error {
  constructor(public readonly chain: readonly string[]) {
    super(`Circular granular provider dependency detected: ${chain.join(' -> ')}`)
    this.name = 'CircularProviderDependencyError'
  }
}

export class UnresolvedProviderDependencyError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly referencedBy: string,
  ) {
    super(
      `Granular provider '${referencedBy}' declares a string dependency on '${providerId}', `
      + `but no provider with this id was found in the expanded registry. `
      + `Add the provider to the 'providers' option of the preset, or pass its instance in 'dependencies' directly.`,
    )
    this.name = 'UnresolvedProviderDependencyError'
  }
}

/** Причина, по которой провайдер не проходит валидацию при регистрации. */
export type InvalidProviderReason
  /** `id` пустой, не строка или состоит из пробельных символов. */
  = | 'invalid-id'
  /** `packageBaseUrl` не парсится как абсолютный URL. */
    | 'invalid-package-base-url'
  /** `packageBaseUrl` не заканчивается на `/`. */
    | 'package-base-url-not-a-directory'
  /** `components` не массив. */
    | 'invalid-components'
  /** Длины `cssFiles` и `cssFileAssetNames` не совпадают. */
    | 'css-files-length-mismatch'

/**
 * Провайдер объявлен некорректно. Бросается на РЕГИСТРАЦИИ (`expandProviders`),
 * а не в момент, когда некорректное значение впервые понадобилось FS-слою:
 * там те же дефекты выглядели как `console.warn` о пустом скане или как голый
 * `ERR_INVALID_URL_SCHEME` из `fileURLToPath`.
 */
export class InvalidProviderError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly reason: InvalidProviderReason,
    details: string,
    /** Компонент, из-за которого провайдер невалиден (если применимо). */
    public readonly componentName?: string,
  ) {
    const where = componentName ? `component '${componentName}' of ` : ''
    super(`Invalid granular provider: ${where}'${providerId}' — ${details}`)
    this.name = 'InvalidProviderError'
  }
}
