import { loadConfig } from '../core/config'
import { buildResticEnv, buildRestoreArgs, buildS3Options, execRestic } from '../core/restic'
import type { RunResult } from '../types'

export interface RestoreOptions {
  remote: string
  projects?: string[]
  target?: string
  snapshot?: string
  dryRun?: boolean
  delete?: boolean
  verbose?: boolean
}

export async function restore(options: RestoreOptions): Promise<RunResult> {
  if (!options.target) throw new Error('--target is required')

  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)

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

    console.log(`=== Restoring: ${projectName} ===`)

    try {
      const args = buildRestoreArgs(projectName, project, {
        target: options.target,
        snapshot: options.snapshot,
        dryRun: options.dryRun,
        delete: options.delete,
        verbose: options.verbose,
      })
      await execRestic(args, env, s3Options)
      succeeded.push(projectName)
    } catch (error) {
      console.error(`Failed to restore ${projectName}:`, error)
      failed.push(projectName)
    }
  }

  const duration = Date.now() - startTime

  console.log('\n=== Summary ===')
  if (succeeded.length > 0) console.log('Succeeded:', succeeded.join(', '))
  if (failed.length > 0) console.log('Failed:', failed.join(', '))

  return { succeeded, failed, duration }
}
