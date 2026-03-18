import { loadConfig } from '../core/config'
import { buildResticEnv, buildBackupArgs, buildS3Options, execRestic } from '../core/restic'
import type { RunResult } from '../types'

export interface RunOptions {
  remote: string
  projects?: string[]
  extraArgs?: string[]
}

export async function run(options: RunOptions): Promise<RunResult> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)
  const globalExcludes = config.rules.global_excludes || []

  const projects = options.projects && options.projects.length > 0
    ? options.projects
    : Object.keys(config.rules.projects)

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

    try {
      const args = buildBackupArgs(projectName, project, globalExcludes)
      if (options.extraArgs) args.push(...options.extraArgs)
      await execRestic(args, env, s3Options)
      succeeded.push(projectName)
    } catch (error) {
      console.error(`Failed to backup ${projectName}:`, error)
      failed.push(projectName)
    }
  }

  const duration = Date.now() - startTime

  console.log('\n=== Summary ===')
  if (succeeded.length > 0) console.log('Succeeded:', succeeded.join(', '))
  if (failed.length > 0) console.log('Failed:', failed.join(', '))

  if (config.rules.uptime_kuma?.push_url) {
    await notifyUptimeKuma({ succeeded, failed, duration }, config.rules.uptime_kuma.push_url)
  }

  return { succeeded, failed, duration }
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
