import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

type ExistsSync = (file: string) => boolean

export interface ResolveResticBinOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
  packageRoot?: string
  existsSync?: ExistsSync
}

export function getBundledResticBin(packageRoot: string): string {
  return path.join(packageRoot, 'vendor/restic/linux-x64/restic')
}

export function findPackageRoot(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  let current = startDir

  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current

    const parent = path.dirname(current)
    if (parent === current) return startDir
    current = parent
  }
}

export function resolveResticBin(options: ResolveResticBinOptions = {}): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const packageRoot = options.packageRoot ?? findPackageRoot()
  const existsSync = options.existsSync ?? fs.existsSync

  if (env.WAY_RESTIC_BIN) return env.WAY_RESTIC_BIN

  if (platform === 'linux' && arch === 'x64') {
    const bundled = getBundledResticBin(packageRoot)
    if (existsSync(bundled)) return bundled
  }

  return 'restic'
}
