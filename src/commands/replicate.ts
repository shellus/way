import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadConfig } from '../core/config'
import { buildRepositoryLocation, buildResticEnv, buildS3Options, execRestic, execResticCapture } from '../core/restic'
import type { Replication, RunResult } from '../types'

export interface ReplicateOptions {
  names?: string[]
  initialize?: boolean
}

export interface ResticSnapshot {
  id: string
  time: string
  tags?: string[]
}

export function selectLatestProjectSnapshots(snapshots: ResticSnapshot[], projectNames: string[]): string[] {
  const selected = new Map<string, ResticSnapshot>()

  for (const snapshot of snapshots) {
    const snapshotTime = Date.parse(snapshot.time)
    if (Number.isNaN(snapshotTime)) {
      throw new Error(`Snapshot ${snapshot.id} has an invalid timestamp: ${snapshot.time}`)
    }

    for (const tag of snapshot.tags || []) {
      if (!tag.startsWith('way:')) continue
      const projectName = tag.slice('way:'.length)
      if (!projectNames.includes(projectName)) continue

      const current = selected.get(projectName)
      if (!current || snapshotTime > Date.parse(current.time)) {
        selected.set(projectName, snapshot)
      }
    }
  }

  return projectNames.flatMap((projectName) => {
    const snapshot = selected.get(projectName)
    return snapshot ? [snapshot.id] : []
  })
}

function validateReplication(name: string, replication: Replication, sourceType: string): void {
  if (replication.from === replication.to) {
    throw new Error(`Replication ${name} must use different source and destination repositories`)
  }
  if (sourceType !== 'local') {
    throw new Error(`Replication ${name} source repository must be local`)
  }
  if (replication.snapshot_policy && replication.snapshot_policy !== 'latest-per-project') {
    throw new Error(`Replication ${name} has unsupported snapshot_policy: ${replication.snapshot_policy}`)
  }
}

async function withSourcePasswordFile<T>(password: string | undefined, run: (passwordFile: string) => Promise<T>): Promise<T> {
  if (!password) throw new Error('Source repository password is required for replication')

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'way-replication-'))
  const passwordFile = path.join(tempDir, 'source-password')
  fs.writeFileSync(passwordFile, `${password}\n`, { encoding: 'utf8', mode: 0o600 })

  try {
    return await run(passwordFile)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function replicateOne(wayDir: string, name: string, replication: Replication, initialize: boolean): Promise<void> {
  const sourceConfig = loadConfig(wayDir, replication.from)
  const destinationConfig = loadConfig(wayDir, replication.to)
  validateReplication(name, replication, sourceConfig.repository.type)

  const sourceEnv = buildResticEnv(sourceConfig.repository)
  const destinationEnv = buildResticEnv(destinationConfig.repository)
  const sourceOptions = buildS3Options(sourceConfig.repository)
  const destinationOptions = buildS3Options(destinationConfig.repository)
  const snapshots = JSON.parse(
    await execResticCapture(['snapshots', '--json'], sourceEnv, sourceOptions),
  ) as ResticSnapshot[]
  if (!Array.isArray(snapshots)) throw new Error('restic snapshots --json did not return an array')
  const snapshotIds = selectLatestProjectSnapshots(snapshots, Object.keys(sourceConfig.rules.projects))

  await withSourcePasswordFile(sourceConfig.repository.credentials.password, async (passwordFile) => {
    const sourceArguments = [
      `--from-repo=${buildRepositoryLocation(sourceConfig.repository)}`,
      `--from-password-file=${passwordFile}`,
    ]

    if (initialize) {
      console.log(`Initializing replication destination ${replication.to} from ${replication.from}`)
      await execRestic(['init', ...sourceArguments, '--copy-chunker-params'], destinationEnv, destinationOptions)
    }

    if (snapshotIds.length === 0) {
      console.log(`No project snapshots available for replication ${name}`)
      return
    }

    console.log(`Replicating ${snapshotIds.length} latest project snapshots: ${replication.from} -> ${replication.to}`)
    await execRestic(['copy', ...sourceArguments, ...snapshotIds], destinationEnv, destinationOptions)
  })
}

export async function replicate(options: ReplicateOptions = {}): Promise<RunResult> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const defaultConfig = loadConfig(wayDir, 'default')
  const replications = defaultConfig.rules.replications || {}
  const names = options.names?.length ? options.names : Object.keys(replications)
  const succeeded: string[] = []
  const failed: string[] = []
  const startTime = Date.now()

  for (const name of names) {
    const replication = replications[name]
    if (!replication) {
      console.error(`Replication not found: ${name}`)
      failed.push(name)
      continue
    }

    try {
      await replicateOne(wayDir, name, replication, options.initialize || false)
      succeeded.push(name)
    } catch (error) {
      console.error(`Failed replication ${name}:`, error)
      failed.push(name)
    }
  }

  return { succeeded, failed, duration: Date.now() - startTime }
}
