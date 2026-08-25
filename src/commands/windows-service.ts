import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadConfig } from '../core/config'

export type WindowsServiceAction = 'show' | 'install' | 'uninstall' | 'status'

export interface WindowsServiceOptions {
  remote: string
  action: WindowsServiceAction
}

export interface DaemonLaunch {
  command: string
  args: string[]
}

export interface WindowsServiceDependencies {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  argv?: string[]
  execPath?: string
  execFileSync?: typeof execFileSync
  writeFileSync?: typeof fs.writeFileSync
  unlinkSync?: typeof fs.unlinkSync
  existsSync?: typeof fs.existsSync
  mkdtempSync?: typeof fs.mkdtempSync
}

export const WINDOWS_TASK_NAME = 'Way Backup Daemon'
export const WINDOWS_RUNNER_NAME = 'way-daemon.cmd'

function assertWindows(platform: NodeJS.Platform): void {
  if (platform !== 'win32') throw new Error('windows-service is only available on Windows')
}

function assertSafeCmdValue(value: string, name: string): void {
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} cannot contain line breaks or NUL bytes`)
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function resolveDaemonLaunch(options: Pick<WindowsServiceDependencies, 'env' | 'argv' | 'execPath'> = {}): DaemonLaunch {
  const env = options.env ?? process.env
  const argv = options.argv ?? process.argv
  const execPath = options.execPath ?? process.execPath

  if (env.WAY_BIN) return { command: env.WAY_BIN, args: ['daemon'] }
  if (argv[1] && (path.isAbsolute(argv[1]) || path.win32.isAbsolute(argv[1]))) {
    return { command: execPath, args: [argv[1], 'daemon'] }
  }
  return { command: execPath, args: ['daemon'] }
}

export function renderWindowsDaemonRunner(wayDir: string, launch: DaemonLaunch, resticBin?: string): string {
  for (const [name, value] of Object.entries({ wayDir, command: launch.command, resticBin })) {
    if (value) assertSafeCmdValue(value, name)
  }
  for (const arg of launch.args) assertSafeCmdValue(arg, 'daemon argument')

  const setRestic = resticBin ? `set "WAY_RESTIC_BIN=${resticBin}"\r\n` : ''
  const args = launch.args.map((arg) => `"${arg.replace(/"/g, '""')}"`).join(' ')
  const command = `"${launch.command.replace(/"/g, '""')}"`

  return `@echo off\r\nsetlocal\r\nset "WAY_DIR=${wayDir}"\r\n${setRestic}${command} ${args}\r\n`
}

export function renderWindowsTaskXml(runnerPath: string): string {
  assertSafeCmdValue(runnerPath, 'runner path')
  const argumentsValue = `/d /s /c ""${runnerPath}""`

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Way Backup Daemon</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>${xmlEscape(argumentsValue)}</Arguments></Exec></Actions>
</Task>`
}

function resolveResticPath(env: NodeJS.ProcessEnv, run: typeof execFileSync): string | undefined {
  if (env.WAY_RESTIC_BIN) return env.WAY_RESTIC_BIN
  try {
    return run('where.exe', ['restic.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]
  } catch {
    return undefined
  }
}

export async function windowsService(options: WindowsServiceOptions, dependencies: WindowsServiceDependencies = {}): Promise<void> {
  const platform = dependencies.platform ?? process.platform
  assertWindows(platform)

  const env = dependencies.env ?? process.env
  const run = dependencies.execFileSync ?? execFileSync
  const writeFile = dependencies.writeFileSync ?? fs.writeFileSync
  const unlink = dependencies.unlinkSync ?? fs.unlinkSync
  const exists = dependencies.existsSync ?? fs.existsSync
  const makeTempDir = dependencies.mkdtempSync ?? fs.mkdtempSync
  const wayDir = env.WAY_DIR || path.join(os.homedir(), '.way')
  const runnerPath = path.join(wayDir, WINDOWS_RUNNER_NAME)
  const launch = resolveDaemonLaunch({ env, argv: dependencies.argv, execPath: dependencies.execPath })
  const runner = renderWindowsDaemonRunner(wayDir, launch, resolveResticPath(env, run))
  const taskXml = renderWindowsTaskXml(runnerPath)

  if (options.action === 'show') {
    console.log(`=== ${WINDOWS_TASK_NAME} ===`)
    console.log(taskXml)
    console.log(`=== ${runnerPath} ===`)
    console.log(runner)
    return
  }

  if (options.action === 'install') {
    loadConfig(wayDir, options.remote)
    fs.mkdirSync(wayDir, { recursive: true })
    writeFile(runnerPath, runner, { encoding: 'utf8' })
    const tempDir = makeTempDir(path.join(os.tmpdir(), 'way-windows-service-'))
    const xmlPath = path.join(tempDir, 'way-backup.xml')
    try {
      writeFile(xmlPath, `\uFEFF${taskXml}`, { encoding: 'utf16le' })
      run('schtasks.exe', ['/Create', '/TN', WINDOWS_TASK_NAME, '/XML', xmlPath, '/F'], { stdio: 'inherit' })
      run('schtasks.exe', ['/Run', '/TN', WINDOWS_TASK_NAME], { stdio: 'inherit' })
      console.log('Windows Way daemon task installed and started')
    } finally {
      if (exists(xmlPath)) unlink(xmlPath)
      try { fs.rmdirSync(tempDir) } catch {}
    }
    return
  }

  if (options.action === 'uninstall') {
    try {
      run('schtasks.exe', ['/End', '/TN', WINDOWS_TASK_NAME], { stdio: 'ignore' })
    } catch {}
    try {
      run('schtasks.exe', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'], { stdio: 'inherit' })
    } catch {}
    if (exists(runnerPath)) unlink(runnerPath)
    console.log('Windows Way daemon task uninstalled')
    return
  }

  run('schtasks.exe', ['/Query', '/TN', WINDOWS_TASK_NAME, '/FO', 'LIST', '/V'], { stdio: 'inherit' })
}
