import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('way E2E', () => {
  const testDir = path.join(os.tmpdir(), 'way-e2e-' + Date.now())
  const repoPath = path.join(testDir, 'repo')
  const dataPath = path.join(testDir, 'data')
  const wayBin = path.join(process.cwd(), 'dist/cli.js')

  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' })

    fs.mkdirSync(testDir, { recursive: true })
    fs.mkdirSync(dataPath, { recursive: true })
    fs.writeFileSync(path.join(dataPath, 'file1.txt'), 'content1')
    fs.writeFileSync(path.join(dataPath, 'file2.txt'), 'content2')

    fs.writeFileSync(path.join(testDir, 'repositories.yaml'), `
default: local
repositories:
  local:
    type: local
    path: ${repoPath}
    credentials:
      password: test123
`)
    fs.writeFileSync(path.join(testDir, 'rules.yaml'), `
defaults:
  schedule: "0 */2 * * *"
  retention:
    keep_daily: 7
    keep_weekly: 4
    keep_monthly: 6
projects:
  data:
    paths:
      - ${dataPath}
    excludes:
      - "*.log"
global_excludes:
  - node_modules
`)

    execSync(`restic init --repo ${repoPath} --password-file <(echo test123)`, { shell: '/bin/bash' })
  })

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('way --version', () => {
    const output = execSync(`${wayBin} --version`, { encoding: 'utf8' })
    expect(output.trim()).toBe('0.5.0')
  })

  it('way run 执行备份', () => {
    execSync(`WAY_DIR=${testDir} ${wayBin} run`, { stdio: 'inherit' })
    const snapshots = execSync(`WAY_DIR=${testDir} ${wayBin} snapshots --json`, { encoding: 'utf8' })
    expect(snapshots).toContain('way:data')
  })

  it('way snapshots 查看快照', () => {
    const output = execSync(`WAY_DIR=${testDir} ${wayBin} snapshots`, { encoding: 'utf8' })
    expect(output).toContain('way:data')
  })

  it('way gc 清理快照', () => {
    execSync(`WAY_DIR=${testDir} ${wayBin} gc --dry-run`, { stdio: 'inherit' })
  })

  it('way systemd show 显示 systemd 配置', () => {
    const output = execSync(`WAY_DIR=${testDir} ${wayBin} systemd show`, { encoding: 'utf8' })
    expect(output).toContain('way-backup.service')
    expect(output).toContain('Way Backup Daemon')
  })
})
