import { loadConfig } from '../core/config'
import { buildResticEnv, buildS3Options, execRestic, execResticCapture } from '../core/restic'
import type { Retention } from '../types'

export interface GcOptions {
  remote: string
  dryRun?: boolean
}

export interface ResticSnapshot {
  id: string
  time: string
  hostname: string
  tags?: string[]
}

export interface SnapshotRetentionPlan {
  cutoff: Date
  keep: ResticSnapshot[]
  remove: ResticSnapshot[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function hasLegacyPolicy(retention: Retention): boolean {
  return [
    retention.keep_daily,
    retention.keep_weekly,
    retention.keep_monthly,
    retention.keep_yearly,
  ].some((value) => value !== undefined)
}

function isStrictPolicy(retention: Retention): boolean {
  return retention.keep_hosts !== undefined || retention.max_age_days !== undefined
}

function validateStrictPolicy(retention: Retention): { hosts: Set<string>, maxAgeDays: number } {
  if (!retention.keep_hosts?.length) {
    throw new Error('Strict retention requires at least one defaults.retention.keep_hosts entry')
  }
  if (!Number.isFinite(retention.max_age_days) || retention.max_age_days! <= 0) {
    throw new Error('Strict retention requires defaults.retention.max_age_days to be a positive number')
  }
  if (hasLegacyPolicy(retention)) {
    throw new Error('Strict keep_hosts/max_age_days retention cannot be combined with count-based keep_* retention')
  }

  const normalizedHosts = retention.keep_hosts.map((host) => host.trim())
  if (normalizedHosts.some((host) => host.length === 0)) {
    throw new Error('defaults.retention.keep_hosts cannot contain empty host names')
  }

  return { hosts: new Set(normalizedHosts), maxAgeDays: retention.max_age_days! }
}

export function buildSnapshotRetentionPlan(
  snapshots: ResticSnapshot[],
  retention: Retention,
  now = new Date(),
): SnapshotRetentionPlan {
  const { hosts, maxAgeDays } = validateStrictPolicy(retention)
  const cutoff = new Date(now.getTime() - maxAgeDays * DAY_MS)
  const keep: ResticSnapshot[] = []
  const remove: ResticSnapshot[] = []

  for (const snapshot of snapshots) {
    const snapshotTime = new Date(snapshot.time)
    if (Number.isNaN(snapshotTime.getTime())) {
      throw new Error(`Snapshot ${snapshot.id} has an invalid timestamp: ${snapshot.time}`)
    }

    if (hosts.has(snapshot.hostname) && snapshotTime >= cutoff) {
      keep.push(snapshot)
    } else {
      remove.push(snapshot)
    }
  }

  return { cutoff, keep, remove }
}

function printSnapshots(label: string, snapshots: ResticSnapshot[]): void {
  console.log(`${label} (${snapshots.length}):`)
  for (const snapshot of snapshots) {
    console.log(`  ${snapshot.id.slice(0, 8)}  ${snapshot.time}  ${snapshot.hostname}  ${(snapshot.tags || []).join(',') || '-'}`)
  }
}

function buildResticOptions(s3Options: string[], retryLock?: string): string[] {
  const options = [...s3Options]
  if (retryLock) options.push(`--retry-lock=${retryLock}`)
  return options
}

async function runStrictGc(
  retention: Retention,
  dryRun: boolean,
  env: Record<string, string>,
  resticOptions: string[],
): Promise<void> {
  const snapshotsJson = await execResticCapture(['snapshots', '--json', '--no-lock'], env, resticOptions)
  const snapshots = JSON.parse(snapshotsJson) as ResticSnapshot[]
  if (!Array.isArray(snapshots)) throw new Error('restic snapshots --json did not return an array')

  const plan = buildSnapshotRetentionPlan(snapshots, retention)
  console.log(`Policy: keep hosts=${retention.keep_hosts!.join(',')}, max age=${retention.max_age_days} days, cutoff=${plan.cutoff.toISOString()}`)
  printSnapshots('Keep snapshots', plan.keep)
  printSnapshots('Remove snapshots', plan.remove)

  if (dryRun) {
    console.log('Dry-run complete; no snapshots or repository data were modified.')
    return
  }
  if (plan.remove.length === 0) {
    console.log('No snapshots matched cleanup; prune was skipped.')
    return
  }

  await execRestic(['forget', '--prune', ...plan.remove.map((snapshot) => snapshot.id)], env, resticOptions)
}

export async function gc(options: GcOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)
  const retention = config.rules.defaults?.retention || {}
  const dryRun = options.dryRun || false

  console.log('=== Cleaning snapshots ===')

  const env = buildResticEnv(config.repository)
  const resticOptions = buildResticOptions(
    buildS3Options(config.repository),
    config.rules.maintenance?.prune?.retry_lock,
  )

  if (isStrictPolicy(retention)) {
    await runStrictGc(retention, dryRun, env, resticOptions)
    return
  }

  const keepDaily = retention.keep_daily || 7
  const keepWeekly = retention.keep_weekly || 4
  const keepMonthly = retention.keep_monthly || 6
  const keepYearly = retention.keep_yearly

  console.log(`Policy: daily=${keepDaily}, weekly=${keepWeekly}, monthly=${keepMonthly}${keepYearly ? `, yearly=${keepYearly}` : ''}`)

  const args = [
    'forget',
    '--prune',
    `--keep-daily=${keepDaily}`,
    `--keep-weekly=${keepWeekly}`,
    `--keep-monthly=${keepMonthly}`,
  ]

  if (keepYearly) args.push(`--keep-yearly=${keepYearly}`)
  if (dryRun) args.push('--dry-run')

  await execRestic(args, env, resticOptions)
}
