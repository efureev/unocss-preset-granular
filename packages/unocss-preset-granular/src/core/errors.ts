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
