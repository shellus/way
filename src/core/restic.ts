import { execa } from 'execa'
import fs from 'fs'
import path from 'path'
import { resolveResticBin } from './restic-bin'
import type { Repository, Project } from '../types'

export function buildRepositoryLocation(repo: Repository): string {
  switch (repo.type) {
    case 's3':
      return `s3:https://${repo.endpoint}/${repo.bucket}`
    case 'local':
      return repo.path!
    case 'sftp':
      return `sftp:${repo.host}:${repo.path}`
  }
}

export function buildResticEnv(repo: Repository): Record<string, string> {
  const env: Record<string, string> = {
    RESTIC_REPOSITORY: buildRepositoryLocation(repo),
  }

  if (repo.credentials.password) env.RESTIC_PASSWORD = repo.credentials.password
  if (repo.credentials.access_key_id) env.AWS_ACCESS_KEY_ID = repo.credentials.access_key_id
  if (repo.credentials.secret_access_key) env.AWS_SECRET_ACCESS_KEY = repo.credentials.secret_access_key

  return env
}

export function buildBackupArgs(name: string, project: Project, globalExcludes: string[], filesFrom?: string): string[] {
  const args = ['backup', `--tag=way:${name}`]

  if (project.include_dirs?.length) {
    if (project.excludes?.length) {
      throw new Error(`Project ${name} cannot use excludes with include_dirs`)
    }
    if (!filesFrom) throw new Error(`Project ${name} uses include_dirs but no files-from list was provided`)
    args.push(`--files-from=${filesFrom}`)
    return args
  }

  const allExcludes = [...globalExcludes, ...(project.excludes || [])]
  for (const exclude of allExcludes) args.push(`--exclude=${exclude}`)
  args.push(...project.paths)
  return args
}

export interface DirEntry {
  name: string
  isDirectory: boolean | (() => boolean)
}

export interface CollectIncludeDirsOptions {
  readdirSync?: (dir: string) => DirEntry[]
}

export function collectIncludeDirs(paths: string[], includeDirs: string[], options: CollectIncludeDirsOptions = {}): string[] {
  const readdirSync = options.readdirSync ?? ((dir: string) => fs.readdirSync(dir, { withFileTypes: true }))
  const matches: string[] = []

  function isDirectoryEntry(entry: DirEntry): boolean {
    return typeof entry.isDirectory === 'function' ? entry.isDirectory() : entry.isDirectory
  }

  function readDirectoryEntries(dir: string): DirEntry[] {
    try {
      return readdirSync(dir)
    } catch (error) {
      console.error(`Failed to scan ${dir}:`, error)
      return []
    }
  }

  function validatePattern(pattern: string): void {
    if (path.isAbsolute(pattern)) {
      throw new Error(`include_dirs pattern must be relative to project paths: ${pattern}`)
    }
    if (pattern.split('/').includes('**')) {
      throw new Error(`include_dirs does not support **: ${pattern}`)
    }
  }

  function matchSegment(name: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (!pattern.includes('*')) return name === pattern
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    return new RegExp(`^${escaped}$`).test(name)
  }

  function expandPattern(root: string, pattern: string): string[] {
    const segments = pattern.split('/').filter(Boolean)
    let candidates = [path.resolve(root)]

    for (const segment of segments) {
      const nextCandidates: string[] = []

      for (const candidate of candidates) {
        const entries = readDirectoryEntries(candidate)
        for (const entry of entries) {
          if (!isDirectoryEntry(entry)) continue
          if (!matchSegment(entry.name, segment)) continue
          nextCandidates.push(path.join(candidate, entry.name))
        }
      }

      candidates = nextCandidates
      if (candidates.length === 0) break
    }

    return candidates
  }

  for (const pattern of includeDirs) validatePattern(pattern)

  for (const sourcePath of paths) {
    for (const pattern of includeDirs) {
      matches.push(...expandPattern(sourcePath, pattern))
    }
  }

  return Array.from(new Set(matches))
}

export interface RestoreArgsOptions {
  target: string
  snapshot?: string
  host?: string
  dryRun?: boolean
  delete?: boolean
  verbose?: boolean
  platform?: NodeJS.Platform
  includePaths?: string[]
}

export function normalizeResticPath(value: string, platform = process.platform): string {
  if (platform !== 'win32') return value

  const match = value.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!match) return value.replace(/\\/g, '/')
  return `/${match[1].toUpperCase()}/${match[2].replace(/\\/g, '/')}`
}

export function buildRestoreArgs(name: string, project: Project, options: RestoreArgsOptions): string[] {
  const args = [
    'restore',
    options.snapshot || 'latest',
    `--tag=way:${name}`,
  ]

  if (options.host) args.push(`--host=${options.host}`)
  args.push(`--target=${options.target}`)

  for (const path of options.includePaths || project.paths) args.push(`--include=${normalizeResticPath(path, options.platform)}`)
  if (options.dryRun) args.push('--dry-run')
  if (options.delete) args.push('--delete')
  if (options.verbose) args.push('--verbose=2')

  return args
}

export function buildS3Options(repo: Repository): string[] {
  const options: string[] = []
  if (repo.options?.bucket_lookup) {
    options.push('-o', `s3.bucket-lookup=${repo.options.bucket_lookup}`)
  }
  if (repo.region) {
    options.push('-o', `s3.region=${repo.region}`)
  }
  return options
}

export async function execRestic(args: string[], env: Record<string, string>, s3Options: string[] = []): Promise<void> {
  await runRestic(args, env, s3Options, false)
}

export async function execResticCapture(args: string[], env: Record<string, string>, s3Options: string[] = []): Promise<string> {
  return runRestic(args, env, s3Options, true)
}

async function runRestic(args: string[], env: Record<string, string>, s3Options: string[], capture: boolean): Promise<string> {
  try {
    const result = await execa(resolveResticBin(), [...s3Options, ...args], {
      env: { ...process.env, ...env },
      ...(capture ? { stdout: 'pipe', stderr: 'inherit' } : { stdio: 'inherit' }),
    })
    return typeof result.stdout === 'string' ? result.stdout : ''
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('Error: restic not found. Linux x64 packages include restic; other platforms must install it first.')
      console.error('Set WAY_RESTIC_BIN to use a custom restic binary, or visit: https://restic.net/')
      process.exit(1)
    }
    throw error
  }
}
