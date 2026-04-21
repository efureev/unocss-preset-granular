export function splitClassTokens(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}