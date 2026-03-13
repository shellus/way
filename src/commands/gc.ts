import { loadConfig } from '../core/config'
import { buildResticEnv, buildS3Options, execRestic } from '../core/restic'

export interface GcOptions {
  remote: string
  extraArgs?: string[]
}

export async function gc(options: GcOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const keepDaily = config.rules.retention?.keep_daily || 7
  const keepWeekly = config.rules.retention?.keep_weekly || 4
  const keepMonthly = config.rules.retention?.keep_monthly || 6

  console.log('=== Cleaning snapshots ===')
  console.log(`Policy: daily=${keepDaily}, weekly=${keepWeekly}, monthly=${keepMonthly}`)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)

  const args = [
    'forget',
    '--prune',
    `--keep-daily=${keepDaily}`,
    `--keep-weekly=${keepWeekly}`,
    `--keep-monthly=${keepMonthly}`,
  ]

  if (options.extraArgs) args.push(...options.extraArgs)

  await execRestic(args, env, s3Options)
}
