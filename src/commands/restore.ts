import path from 'path'
import { loadConfig } from '../core/config'
import { buildResticEnv, buildRestoreArgs, buildS3Options, execRestic } from '../core/restic'
import type { Project, RunResult } from '../types'

export interface RestoreOptions {
  remote: string
  projects?: string[]
  target?: string
  snapshot?: string
  host?: string
  dryRun?: boolean
  delete?: boolean
  verbose?: boolean
}

export interface WindowsRestorePlan {
  snapshot: string
  target: string
  includePaths: string[]
}

function isWithin(parent: string, child: string, pathApi: typeof path.win32): boolean {
  const relative = pathApi.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))
}

function findCommonParent(paths: string[], pathApi: typeof path.win32): string {
  let candidate = paths[0]

  while (!paths.every((item) => isWithin(candidate, item, pathApi))) {
    const parent = pathApi.dirname(candidate)
    if (parent === candidate) return candidate
    candidate = parent
  }

  return candidate
}

export function buildWindowsRestorePlans(
  project: Project,
  target: string,
  snapshot = 'latest',
): WindowsRestorePlan[] {
  const pathApi = path.win32
  const groups = new Map<string, string[]>()

  for (const sourcePath of project.paths) {
    const root = pathApi.parse(sourcePath).root.toLowerCase()
    const paths = groups.get(root) || []
    paths.push(sourcePath)
    groups.set(root, paths)
  }

  return Array.from(groups.values()).map((paths) => {
    const parent = findCommonParent(paths.map((item) => pathApi.dirname(item)), pathApi)
    const drive = parent[0].toUpperCase()
    const rest = parent.slice(2).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const snapshotPath = rest ? `/${drive}/${rest}` : `/${drive}`
    const includePaths = paths.map((item) => `/${pathApi.relative(parent, item).replace(/\\/g, '/')}`)
    const targetPath = pathApi.join(target, ...snapshotPath.split('/').filter(Boolean))

    return {
      snapshot: `${snapshot}:${snapshotPath}`,
      target: targetPath,
      includePaths: Array.from(new Set(includePaths)),
    }
  })
}

export async function restore(options: RestoreOptions): Promise<RunResult> {
  if (!options.target) throw new Error('--target is required')
  const target = options.target

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
      const plans = process.platform === 'win32' && project.paths.every((item) => /^[A-Za-z]:[\\/]/.test(item))
        ? buildWindowsRestorePlans(project, target, options.snapshot)
        : [{ snapshot: options.snapshot, target, includePaths: undefined }]

      for (const plan of plans) {
        const args = buildRestoreArgs(projectName, project, {
          target: plan.target,
          snapshot: plan.snapshot,
          host: options.host,
          dryRun: options.dryRun,
          delete: options.delete,
          verbose: options.verbose,
          includePaths: plan.includePaths,
        })
        await execRestic(args, env, s3Options)
      }
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
