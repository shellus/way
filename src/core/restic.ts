import { execa } from 'execa'
import fs from 'fs'
import path from 'path'
import { resolveResticBin } from './restic-bin'
import type { Repository, Project } from '../types'

export function buildResticEnv(repo: Repository): Record<string, string> {
  const env: Record<string, string> = {}

  switch (repo.type) {
    case 's3':
      env.RESTIC_REPOSITORY = `s3:https://${repo.endpoint}/${repo.bucket}`
      break
    case 'local':
      env.RESTIC_REPOSITORY = repo.path!
      break
    case 'sftp':
      env.RESTIC_REPOSITORY = `sftp:${repo.host}:${repo.path}`
      break
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

export function matchIncludeDir(dir: string, includeDirs: string[]): boolean {
  const name = path.basename(dir)
  return includeDirs.includes(name)
}

export function collectIncludeDirs(paths: string[], includeDirs: string[], options: CollectIncludeDirsOptions = {}): string[] {
  const readdirSync = options.readdirSync ?? ((dir: string) => fs.readdirSync(dir, { withFileTypes: true }))
  const matches: string[] = []

  function isDirectoryEntry(entry: DirEntry): boolean {
    return typeof entry.isDirectory === 'function' ? entry.isDirectory() : entry.isDirectory
  }

  function visit(dir: string): void {
    let entries: DirEntry[]
    try {
      entries = readdirSync(dir)
    } catch (error) {
      console.error(`Failed to scan ${dir}:`, error)
      return
    }

    for (const entry of entries) {
      if (!isDirectoryEntry(entry)) continue

      const child = path.join(dir, entry.name)
      if (matchIncludeDir(child, includeDirs)) {
        matches.push(child)
        continue
      }

      visit(child)
    }
  }

  for (const sourcePath of paths) {
    const normalized = path.resolve(sourcePath)
    if (matchIncludeDir(normalized, includeDirs)) {
      matches.push(normalized)
      continue
    }
    visit(normalized)
  }

  return matches
}

export interface RestoreArgsOptions {
  target: string
  snapshot?: string
  host?: string
  dryRun?: boolean
  delete?: boolean
  verbose?: boolean
}

export function buildRestoreArgs(name: string, project: Project, options: RestoreArgsOptions): string[] {
  const args = [
    'restore',
    options.snapshot || 'latest',
    `--tag=way:${name}`,
  ]

  if (options.host) args.push(`--host=${options.host}`)
  args.push(`--target=${options.target}`)

  for (const path of project.paths) args.push(`--include=${path}`)
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
  return options
}

export async function execRestic(args: string[], env: Record<string, string>, s3Options: string[] = []): Promise<void> {
  try {
    await execa(resolveResticBin(), [...s3Options, ...args], { env: { ...process.env, ...env }, stdio: 'inherit' })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('Error: restic not found. Linux x64 packages include restic; other platforms must install it first.')
      console.error('Set WAY_RESTIC_BIN to use a custom restic binary, or visit: https://restic.net/')
      process.exit(1)
    }
    throw error
  }
}
