import { loadConfig } from '../core/config'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface SystemdOptions {
  remote: string
  action: 'show' | 'install' | 'uninstall' | 'status'
}

function cronToSystemd(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return 'daily'

  const [minute, hour, day, month, weekday] = parts

  // 简单转换：分钟 小时 * * * -> *-*-* HH:MM:00
  if (day === '*' && month === '*' && weekday === '*') {
    return `*-*-* ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`
  }

  return 'daily'
}

export async function systemd(options: SystemdOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const serviceContent = `[Unit]
Description=Way Backup Service
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/way run
Environment="WAY_DIR=${wayDir}"
`

  const timerContent = `[Unit]
Description=Way Backup Timer

[Timer]
OnCalendar=${cronToSystemd(config.rules.schedule?.backup?.[0] || 'daily')}
Persistent=true

[Install]
WantedBy=timers.target
`

  if (options.action === 'show') {
    console.log('=== way-backup.service ===')
    console.log(serviceContent)
    console.log('\n=== way-backup.timer ===')
    console.log(timerContent)
    return
  }

  const systemdDir = `${process.env.HOME}/.config/systemd/user`
  const servicePath = path.join(systemdDir, 'way-backup.service')
  const timerPath = path.join(systemdDir, 'way-backup.timer')

  if (options.action === 'install') {
    fs.mkdirSync(systemdDir, { recursive: true })
    fs.writeFileSync(servicePath, serviceContent)
    fs.writeFileSync(timerPath, timerContent)

    execSync('systemctl --user daemon-reload')
    execSync('systemctl --user enable way-backup.timer')
    execSync('systemctl --user start way-backup.timer')

    console.log('Systemd timer installed and started')
    execSync('systemctl --user status way-backup.timer', { stdio: 'inherit' })
  }

  if (options.action === 'uninstall') {
    try {
      execSync('systemctl --user stop way-backup.timer', { stdio: 'ignore' })
    } catch {}
    try {
      execSync('systemctl --user disable way-backup.timer', { stdio: 'ignore' })
    } catch {}

    if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath)
    if (fs.existsSync(timerPath)) fs.unlinkSync(timerPath)

    execSync('systemctl --user daemon-reload')
    console.log('Systemd timer uninstalled')
  }

  if (options.action === 'status') {
    execSync('systemctl --user status way-backup.timer', { stdio: 'inherit' })
  }
}
