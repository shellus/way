import { loadConfig } from '../core/config'
import { buildResticEnv, buildBackupArgs, buildS3Options, collectIncludeDirs, execRestic } from '../core/restic'
import type { RunResult } from '../types'
import fs from 'fs'
import os from 'os'
import path from 'path'

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
