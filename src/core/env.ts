export function expandEnv(value: string | null | undefined): string {
  if (!value) return ''

  const match = value.match(/^\$\{(.+)\}$/)
  if (match) {
    return process.env[match[1]] || ''
  }

  return value
}
