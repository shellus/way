import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

type ExistsSync = (file: string) => boolean

export interface ResolveResticBinOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
  packageRoot?: string
  executablePath?: string
  existsSync?: ExistsSync
}

export function getBundledResticBin(packageRoot: string): string {
  return path.join(packageRoot, 'vendor/restic/linux-x64/restic')
}

export function getStandaloneResticBinCandidates(executablePath: string): string[] {
  const binDir = path.dirname(executablePath)
  const archiveRoot = path.dirname(binDir)
  const prefixRoot = path.dirname(binDir)

  return [
    path.join(archiveRoot, 'vendor/restic/linux-x64/restic'),
    path.join(prefixRoot, 'lib/way/vendor/restic/linux-x64/restic'),
  ]
}

export function getExampleConfigCandidates(file: string, packageRoot: string, executablePath: string): string[] {
  const binDir = path.dirname(executablePath)
  const archiveRoot = path.dirname(binDir)
  const prefixRoot = path.dirname(binDir)

  return [
    path.join(packageRoot, `${file}.example`),
    path.join(archiveRoot, `${file}.example`),
    path.join(prefixRoot, 'lib/way', `${file}.example`),
  ]
}

export function resolveExampleConfigPath(
  file: string,
  options: Pick<ResolveResticBinOptions, 'packageRoot' | 'executablePath' | 'existsSync'> = {},
): string {
  const packageRoot = options.packageRoot ?? findPackageRoot()
  const executablePath = options.executablePath ?? process.execPath
  const existsSync = options.existsSync ?? fs.existsSync

  for (const candidate of getExampleConfigCandidates(file, packageRoot, executablePath)) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(`Unable to find ${file}.example`)
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
  const executablePath = options.executablePath ?? process.execPath
  const existsSync = options.existsSync ?? fs.existsSync

  if (env.WAY_RESTIC_BIN) return env.WAY_RESTIC_BIN

  if (platform === 'linux' && arch === 'x64') {
    const bundled = getBundledResticBin(packageRoot)
    if (existsSync(bundled)) return bundled

    for (const candidate of getStandaloneResticBinCandidates(executablePath)) {
      if (existsSync(candidate)) return candidate
    }
  }

  return 'restic'
}
