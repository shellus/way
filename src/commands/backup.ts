import { loadConfig } from '../core/config'
import { buildResticEnv, buildBackupArgs, buildS3Options, collectIncludeDirs, execRestic } from '../core/restic'
import type { Project, ProjectHook, RunResult } from '../types'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execa } from 'execa'

export interface BackupOptions {
  remote: string
  projects?: string[]
  extraArgs?: string[]
  dryRun?: boolean
}

interface ProjectRunResult extends RunResult {
  pushUrl?: string
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
  const projectResults: ProjectRunResult[] = []
  const startTime = Date.now()

  for (const projectName of projects) {
    const projectStartTime = Date.now()
    const project = config.rules.projects[projectName]
    const pushUrl = resolveUptimeKumaPushUrl(project, config.rules.uptime_kuma?.push_url)

    if (!project) {
      console.error(`Project not found: ${projectName}`)
      failed.push(projectName)
      projectResults.push({
        succeeded: [],
        failed: [projectName],
        duration: Date.now() - projectStartTime,
        pushUrl,
      })
      continue
    }

    console.log(`=== Backing up: ${projectName} ===`)

    let filesFrom: string | undefined
    let projectSucceeded = false

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
          projectSucceeded = true
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
      projectSucceeded = true
    } catch (error) {
      console.error(`Failed to backup ${projectName}:`, error)
      failed.push(projectName)
    } finally {
      if (filesFrom) fs.rmSync(filesFrom, { force: true })
      projectResults.push({
        succeeded: projectSucceeded ? [projectName] : [],
        failed: projectSucceeded ? [] : [projectName],
        duration: Date.now() - projectStartTime,
        pushUrl,
      })
    }
  }

  const duration = Date.now() - startTime

  console.log('\n=== Summary ===')
  if (succeeded.length > 0) console.log('Succeeded:', succeeded.join(', '))
  if (failed.length > 0) console.log('Failed:', failed.join(', '))

  if (!dryRun) {
    for (const [pushUrl, result] of groupUptimeKumaResults(projectResults)) {
      await notifyUptimeKuma(result, pushUrl)
    }
  }

  return { succeeded, failed, duration }
}

function resolveUptimeKumaPushUrl(project: Project | undefined, globalPushUrl: string | undefined): string | undefined {
  return project?.uptime_kuma?.push_url || globalPushUrl
}

function groupUptimeKumaResults(projectResults: ProjectRunResult[]): Map<string, RunResult> {
  const groupedResults = new Map<string, RunResult>()

  for (const projectResult of projectResults) {
    if (!projectResult.pushUrl) continue

    const result = groupedResults.get(projectResult.pushUrl) || {
      succeeded: [],
      failed: [],
      duration: 0,
    }
    result.succeeded.push(...projectResult.succeeded)
    result.failed.push(...projectResult.failed)
    result.duration += projectResult.duration
    groupedResults.set(projectResult.pushUrl, result)
  }

  return groupedResults
}

interface HookContext {
  projectName: string
  remote: string
  wayDir: string
  dryRun: boolean
  label: 'before_backup' | 'after_backup'
}

const HOOK_FORCE_KILL_DELAY_MS = 1_000

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

function isMissingProcessError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (isMissingProcessError(error)) return false
    throw error
  }
}

function hookTimedOut(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'timedOut' in error
    && error.timedOut === true
}

async function terminateProcessGroup(pid: number): Promise<void> {
  if (!signalProcessGroup(pid, 'SIGTERM')) return

  await new Promise((resolve) => setTimeout(resolve, HOOK_FORCE_KILL_DELAY_MS))
  signalProcessGroup(pid, 'SIGKILL')
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
    const subprocess = execa(normalized.run, {
      shell: true,
      stdio: 'inherit',
      timeout: parseTimeout(normalized.timeout),
      detached: process.platform !== 'win32',
      env: {
        WAY_PROJECT: context.projectName,
        WAY_REMOTE: context.remote,
        WAY_DIR: context.wayDir,
        WAY_DRY_RUN: context.dryRun ? '1' : '0',
      },
    })
    const processGroupPid = process.platform === 'win32' ? undefined : subprocess.pid
    const cleanupOnExit = processGroupPid === undefined
      ? undefined
      : () => signalProcessGroup(processGroupPid, 'SIGTERM')

    if (cleanupOnExit) process.once('exit', cleanupOnExit)

    try {
      await subprocess
    } catch (error) {
      if (processGroupPid !== undefined && hookTimedOut(error)) {
        await terminateProcessGroup(processGroupPid)
      }
      throw error
    } finally {
      if (cleanupOnExit) process.removeListener('exit', cleanupOnExit)
    }
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
