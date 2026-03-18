import { loadConfig } from '../core/config'
import { buildResticEnv, buildS3Options, execRestic } from '../core/restic'

export interface GcOptions {
  remote: string
  dryRun?: boolean
}

export async function gc(options: GcOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const retention = config.rules.defaults?.retention || {}
  const keepDaily = retention.keep_daily || 7
  const keepWeekly = retention.keep_weekly || 4
  const keepMonthly = retention.keep_monthly || 6
  const keepYearly = retention.keep_yearly

  console.log('=== Cleaning snapshots ===')
  console.log(`Policy: daily=${keepDaily}, weekly=${keepWeekly}, monthly=${keepMonthly}${keepYearly ? `, yearly=${keepYearly}` : ''}`)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)

  const args = [
    'forget',
    '--prune',
    `--keep-daily=${keepDaily}`,
    `--keep-weekly=${keepWeekly}`,
    `--keep-monthly=${keepMonthly}`,
  ]

  if (keepYearly) args.push(`--keep-yearly=${keepYearly}`)
  if (options.dryRun) args.push('--dry-run')

  await execRestic(args, env, s3Options)
}
