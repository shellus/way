import { describe, expect, it } from 'vitest'
import {
  renderWindowsDaemonRunner,
  renderWindowsTaskXml,
  resolveDaemonLaunch,
  windowsService,
  WINDOWS_RUNNER_NAME,
  WINDOWS_TASK_NAME,
} from '../../src/commands/windows-service'

describe('resolveDaemonLaunch', () => {
  it('Node 执行 CLI 脚本时保留 node 与脚本路径', () => {
    expect(resolveDaemonLaunch({
      env: {},
      argv: ['C:\\Program Files\\nodejs\\node.exe', 'D:\\projects\\way\\dist\\cli.js', 'windows-service', 'install'],
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
    })).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['D:\\projects\\way\\dist\\cli.js', 'daemon'],
    })
  })

  it('WAY_BIN 覆盖默认启动命令', () => {
    expect(resolveDaemonLaunch({
      env: { WAY_BIN: 'D:\\tools\\way.exe' },
      argv: [],
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
    })).toEqual({ command: 'D:\\tools\\way.exe', args: ['daemon'] })
  })
})

describe('Windows daemon task assets', () => {
  it('runner 固定 Way 配置目录并启动 daemon', () => {
    const runner = renderWindowsDaemonRunner('C:\\ProgramData\\Way', {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['D:\\projects\\way\\dist\\cli.js', 'daemon'],
    }, 'D:\\bin\\restic.exe')

    expect(runner).toContain('set "WAY_DIR=C:\\ProgramData\\Way"')
    expect(runner).toContain('set "WAY_RESTIC_BIN=D:\\bin\\restic.exe"')
    expect(runner).toContain('"C:\\Program Files\\nodejs\\node.exe" "D:\\projects\\way\\dist\\cli.js" "daemon"')
  })

  it('task 在开机后延迟启动、以 SYSTEM 运行并配置失败重启', () => {
    const xml = renderWindowsTaskXml(`C:\\ProgramData\\Way\\${WINDOWS_RUNNER_NAME}`)

    expect(xml).toContain('<BootTrigger>')
    expect(xml).toContain('<Delay>PT30S</Delay>')
    expect(xml).toContain('<UserId>S-1-5-18</UserId>')
    expect(xml).not.toContain('<LogonType>')
    expect(xml).toContain('<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>')
    expect(xml).toContain('cmd.exe')
  })

  it('show 不写入文件也不调用 schtasks', async () => {
    const calls: string[] = []
    await windowsService({ remote: 'default', action: 'show' }, {
      platform: 'win32',
      env: { WAY_DIR: 'C:\\ProgramData\\Way' },
      argv: ['node.exe', 'D:\\projects\\way\\dist\\cli.js'],
      execPath: 'node.exe',
      execFileSync: ((command: string) => {
        calls.push(command)
        return ''
      }) as typeof import('child_process').execFileSync,
    })

    expect(calls).toEqual(['where.exe'])
    expect(WINDOWS_TASK_NAME).toBe('Way Backup Daemon')
  })

  it('非 Windows 平台拒绝管理任务', async () => {
    await expect(windowsService({ remote: 'default', action: 'status' }, { platform: 'linux' }))
      .rejects.toThrow('only available on Windows')
  })
})
