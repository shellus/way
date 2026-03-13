import { loadConfig } from '../core/config'
import { execSync } from 'child_process'
import fs from 'fs'

export interface CronOptions {
  remote: string
  action: 'show' | 'install'
}

export async function cron(options: CronOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const markerStart = '# === way backup schedule ==='
  const markerEnd = '# === way backup schedule end ==='

  const generateCron = (): string => {
    const lines = [markerStart]

    const backupSchedules = config.rules.schedule?.backup || []
    for (const schedule of backupSchedules) {
      lines.push(`${schedule} /usr/local/bin/way run`)
    }

    if (config.rules.schedule?.prune) {
      lines.push(`${config.rules.schedule.prune} /usr/local/bin/way gc`)
    }

    if (config.rules.schedule?.check) {
      lines.push(`${config.rules.schedule.check} /usr/local/bin/way check`)
    }

    lines.push(markerEnd)
    return lines.join('\n')
  }

  if (options.action === 'show') {
    console.log(generateCron())
    return
  }

  if (options.action === 'install') {
    if (!fs.existsSync('/usr/local/bin/way')) {
      throw new Error('Error: /usr/local/bin/way not found')
    }

    let existing = ''
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' })
    } catch {}

    const filtered = existing.split('\n').filter(line => {
      return !line.includes(markerStart) && !line.includes(markerEnd)
    }).join('\n')

    const newCrontab = filtered + '\n' + generateCron()
    execSync('crontab -', { input: newCrontab })

    console.log('Crontab installed successfully')
    execSync('crontab -l | grep -A100 "' + markerStart + '" | head -20', { stdio: 'inherit', shell: '/bin/bash' })
  }
}
