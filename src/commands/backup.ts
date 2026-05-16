import { loadConfig } from '../core/config'
import { buildResticEnv, buildBackupArgs, buildS3Options, collectIncludeDirs, execRestic } from '../core/restic'
import type { ProjectHook, RunResult } from '../types'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execaCommand } from 'execa'

export interface BackupOptions {
  remote: string
  projects?: string[]
  extraArgs?: string[]
  dryRun?: boolean
}

export async function backup(options: BackupOptions): Promise<RunResult> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)
  const globalExcludes = config.rules.global_excludes || []

  const projects = options.projects && options.projects.length > 0
    ? options.projects
    : Object.keys(config.rules.projects)

  const dryRun = options.dryRun || options.extraArgs?.includes('--dry-run') || false
  const extraArgs = options.extraArgs?.filter((arg) => arg !== '--dry-run') || []

  const succeeded: string[] = []
  const failed: string[] = []
  const startTime = Date.now()

  for (const projectName of projects) {
    const project = config.rules.projects[projectName]
    if (!project) {
      console.error(`Project not found: ${projectName}`)
      failed.push(projectName)
      continue
    }

    console.log(`=== Backing up: ${projectName} ===`)

    let filesFrom: string | undefined

    try {
      await runProjectHooks(project.hooks?.before_backup, {
        projectName,
        remote: options.remote,
        wayDir,
        dryRun,
        label: 'before_backup',
      })

      if (project.include_dirs?.length) {
        const includedDirs = collectIncludeDirs(project.paths, project.include_dirs)
        if (includedDirs.length === 0) {
          console.log(`No include_dirs matched for ${projectName}`)
          succeeded.push(projectName)
          continue
        }

        filesFrom = path.join(os.tmpdir(), `way-${projectName}-${Date.now()}-${process.pid}.files`)
        fs.writeFileSync(filesFrom, `${includedDirs.join('\n')}\n`)
      }

      const args = buildBackupArgs(projectName, project, globalExcludes, filesFrom)
      if (dryRun) args.push('--dry-run')
      args.push(...extraArgs)
      await execRestic(args, env, s3Options)

      await runProjectHooks(project.hooks?.after_backup, {
        projectName,
        remote: options.remote,
        wayDir,
        dryRun,
        label: 'after_backup',
      })

      succeeded.push(projectName)
    } catch (error) {
      console.error(`Failed to backup ${projectName}:`, error)
      failed.push(projectName)
    } finally {
      if (filesFrom) fs.rmSync(filesFrom, { force: true })
    }
  }

  const duration = Date.now() - startTime

  console.log('\n=== Summary ===')
  if (succeeded.length > 0) console.log('Succeeded:', succeeded.join(', '))
  if (failed.length > 0) console.log('Failed:', failed.join(', '))

  if (!dryRun && config.rules.uptime_kuma?.push_url) {
    await notifyUptimeKuma({ succeeded, failed, duration }, config.rules.uptime_kuma.push_url)
  }

  return { succeeded, failed, duration }
}

interface HookContext {
  projectName: string
  remote: string
  wayDir: string
  dryRun: boolean
  label: 'before_backup' | 'after_backup'
}

function normalizeHook(hook: ProjectHook): { run: string, timeout?: string | number } {
  if (typeof hook === 'string') return { run: hook }
  return hook
}

function parseTimeout(timeout: string | number | undefined): number | undefined {
  if (timeout === undefined) return undefined
  if (typeof timeout === 'number') return timeout

  const match = timeout.match(/^(\d+)(ms|s|m|h)?$/)
  if (!match) throw new Error(`Invalid hook timeout: ${timeout}`)

  const value = Number(match[1])
  const unit = match[2] || 'ms'
  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
  }
}

async function runProjectHooks(hooks: ProjectHook[] | undefined, context: HookContext): Promise<void> {
  if (!hooks?.length) return

  for (const hook of hooks) {
    const normalized = normalizeHook(hook)
    if (!normalized.run) throw new Error(`Project ${context.projectName} has an empty ${context.label} hook`)

    if (context.dryRun) {
      console.log(`[dry-run] ${context.label}: ${normalized.run}`)
      continue
    }

    console.log(`Running ${context.label} hook for ${context.projectName}: ${normalized.run}`)
    await execaCommand(normalized.run, {
      shell: true,
      stdio: 'inherit',
      timeout: parseTimeout(normalized.timeout),
      env: {
        WAY_PROJECT: context.projectName,
        WAY_REMOTE: context.remote,
        WAY_DIR: context.wayDir,
        WAY_DRY_RUN: context.dryRun ? '1' : '0',
      },
    })
  }
}

async function notifyUptimeKuma(result: RunResult, pushUrl: string): Promise<void> {
  const status = result.failed.length > 0 ? 'down' : 'up'
  const msg = `Succeeded: ${result.succeeded.length}, Failed: ${result.failed.length}`
  const url = `${pushUrl}?status=${status}&msg=${encodeURIComponent(msg)}&ping=${result.duration}`

  try {
    const response = await fetch(url)
    if (response.ok) {
      console.log(`Uptime Kuma notified: status=${status}, ping=${result.duration}ms`)
    } else {
      console.error('Uptime Kuma notification failed')
    }
  } catch (error) {
    console.error('Uptime Kuma notification failed:', error)
  }
}
