import { loadConfig } from '../core/config'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface SystemdOptions {
  remote: string
  action: 'show' | 'install' | 'uninstall' | 'status'
}

export async function systemd(options: SystemdOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  // 动态获取 way 命令路径
  const wayPath = execSync('which way', { encoding: 'utf-8' }).trim()

  const serviceContent = `[Unit]
Description=Way Backup Daemon
After=network.target

[Service]
Type=simple
ExecStart=${wayPath} daemon
Restart=always
RestartSec=10
Environment="WAY_DIR=${wayDir}"

[Install]
WantedBy=default.target
`

  if (options.action === 'show') {
    console.log('=== way-backup.service ===')
    console.log(serviceContent)
    return
  }

  const systemdDir = `${process.env.HOME}/.config/systemd/user`
  const servicePath = path.join(systemdDir, 'way-backup.service')

  if (options.action === 'install') {
    fs.mkdirSync(systemdDir, { recursive: true })
    fs.writeFileSync(servicePath, serviceContent)

    execSync('systemctl --user daemon-reload')
    execSync('systemctl --user enable way-backup.service')
    execSync('systemctl --user start way-backup.service')

    console.log('Systemd service installed and started')
    execSync('systemctl --user --no-pager status way-backup.service', { stdio: 'inherit' })
  }

  if (options.action === 'uninstall') {
    try {
      execSync('systemctl --user stop way-backup.service', { stdio: 'ignore' })
    } catch {}
    try {
      execSync('systemctl --user disable way-backup.service', { stdio: 'ignore' })
    } catch {}

    if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath)

    execSync('systemctl --user daemon-reload')
    console.log('Systemd service uninstalled')
  }

  if (options.action === 'status') {
    execSync('systemctl --user --no-pager status way-backup.service', { stdio: 'inherit' })
  }
}
