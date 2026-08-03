import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { backup } from '../../src/commands/backup'
import { loadConfig } from '../../src/core/config'
import { execRestic } from '../../src/core/restic'
import type { RulesConfig } from '../../src/types'

vi.mock('../../src/core/config', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/core/restic', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/restic')>('../../src/core/restic')
  return {
    ...actual,
    execRestic: vi.fn().mockResolvedValue(undefined),
  }
})

describe('backup', () => {
  const originalFetch = globalThis.fetch
  const repository = {
    type: 'local' as const,
    path: '/tmp/repo',
    credentials: { password: 'test123' },
  }

  function mockRules(rules: RulesConfig) {
    vi.mocked(loadConfig).mockReturnValue({ repository, rules })
  }

  function notificationUrls(): URL[] {
    return vi.mocked(globalThis.fetch).mock.calls.map(([input]) => new URL(String(input)))
  }

  beforeEach(() => {
    mockRules({
      uptime_kuma: { push_url: 'https://uptime.example.com/api/push/token' },
      projects: {
        data: { paths: ['/data'] },
      },
      global_excludes: [],
    })
    vi.mocked(execRestic).mockResolvedValue(undefined)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
  })

  it('dryRun 选项会传递 restic dry-run 参数且不发送 Uptime Kuma 通知', async () => {
    await backup({ remote: 'local', dryRun: true })

    expect(execRestic).toHaveBeenCalledWith(
      ['backup', '--tag=way:data', '/data', '--dry-run'],
      expect.objectContaining({ RESTIC_REPOSITORY: '/tmp/repo' }),
      [],
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('extraArgs 中的 dry-run 参数也不发送 Uptime Kuma 通知', async () => {
    await backup({ remote: 'local', extraArgs: ['--dry-run'] })

    expect(execRestic).toHaveBeenCalledWith(
      ['backup', '--tag=way:data', '/data', '--dry-run'],
      expect.objectContaining({ RESTIC_REPOSITORY: '/tmp/repo' }),
      [],
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('只有全局 Push 地址时所有项目合并发送一次通知', async () => {
    mockRules({
      uptime_kuma: { push_url: 'https://uptime.example.com/api/push/global' },
      projects: {
        data: { paths: ['/data'] },
        root: { paths: ['/root'] },
      },
    })

    await backup({ remote: 'local' })

    const urls = notificationUrls()
    expect(urls).toHaveLength(1)
    expect(urls[0].pathname).toBe('/api/push/global')
    expect(urls[0].searchParams.get('status')).toBe('up')
    expect(urls[0].searchParams.get('msg')).toBe('Succeeded: 2, Failed: 0')
  })

  it('不同项目级 Push 地址分别发送通知', async () => {
    mockRules({
      projects: {
        data: {
          paths: ['/data'],
          uptime_kuma: { push_url: 'https://uptime.example.com/api/push/data' },
        },
        root: {
          paths: ['/root'],
          uptime_kuma: { push_url: 'https://uptime.example.com/api/push/root' },
        },
      },
    })

    await backup({ remote: 'local' })

    expect(notificationUrls().map((url) => url.pathname)).toEqual([
      '/api/push/data',
      '/api/push/root',
    ])
  })

  it('相同项目级 Push 地址合并发送一次通知', async () => {
    const sharedPushUrl = 'https://uptime.example.com/api/push/shared'
    mockRules({
      projects: {
        data: { paths: ['/data'], uptime_kuma: { push_url: sharedPushUrl } },
        root: { paths: ['/root'], uptime_kuma: { push_url: sharedPushUrl } },
      },
    })

    await backup({ remote: 'local' })

    const urls = notificationUrls()
    expect(urls).toHaveLength(1)
    expect(urls[0].searchParams.get('msg')).toBe('Succeeded: 2, Failed: 0')
  })

  it('项目级 Push 地址与全局回退地址分别发送通知', async () => {
    mockRules({
      uptime_kuma: { push_url: 'https://uptime.example.com/api/push/global' },
      projects: {
        data: {
          paths: ['/data'],
          uptime_kuma: { push_url: 'https://uptime.example.com/api/push/data' },
        },
        root: { paths: ['/root'] },
      },
    })

    await backup({ remote: 'local' })

    expect(notificationUrls().map((url) => url.pathname)).toEqual([
      '/api/push/data',
      '/api/push/global',
    ])
  })

  it('同一 Push 地址下任一项目失败时发送 DOWN', async () => {
    const sharedPushUrl = 'https://uptime.example.com/api/push/shared'
    mockRules({
      projects: {
        data: { paths: ['/data'], uptime_kuma: { push_url: sharedPushUrl } },
        root: { paths: ['/root'], uptime_kuma: { push_url: sharedPushUrl } },
      },
    })
    vi.mocked(execRestic).mockImplementation(async (args) => {
      if (args.includes('--tag=way:root')) throw new Error('backup failed')
    })

    await backup({ remote: 'local' })

    const urls = notificationUrls()
    expect(urls).toHaveLength(1)
    expect(urls[0].searchParams.get('status')).toBe('down')
    expect(urls[0].searchParams.get('msg')).toBe('Succeeded: 1, Failed: 1')
  })

  it('不同 Push 地址分别反映各自项目状态', async () => {
    mockRules({
      projects: {
        data: {
          paths: ['/data'],
          uptime_kuma: { push_url: 'https://uptime.example.com/api/push/data' },
        },
        root: {
          paths: ['/root'],
          uptime_kuma: { push_url: 'https://uptime.example.com/api/push/root' },
        },
      },
    })
    vi.mocked(execRestic).mockImplementation(async (args) => {
      if (args.includes('--tag=way:root')) throw new Error('backup failed')
    })

    await backup({ remote: 'local' })

    const statuses = Object.fromEntries(notificationUrls().map((url) => [
      url.pathname,
      url.searchParams.get('status'),
    ]))
    expect(statuses).toEqual({
      '/api/push/data': 'up',
      '/api/push/root': 'down',
    })
  })

  it('没有任何 Push 地址时不发送通知', async () => {
    mockRules({
      projects: {
        data: { paths: ['/data'] },
        root: { paths: ['/root'] },
      },
    })

    await backup({ remote: 'local' })

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('通知请求失败时保留已成功的备份结果', async () => {
    const notificationError = new Error('network unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(globalThis.fetch).mockRejectedValue(notificationError)

    try {
      const result = await backup({ remote: 'local' })

      expect(result.succeeded).toEqual(['data'])
      expect(result.failed).toEqual([])
      expect(consoleError).toHaveBeenCalledWith('Uptime Kuma notification failed:', notificationError)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('不存在的项目失败归入全局 Push 地址', async () => {
    const result = await backup({ remote: 'local', projects: ['missing'] })

    const urls = notificationUrls()
    expect(result.failed).toEqual(['missing'])
    expect(urls).toHaveLength(1)
    expect(urls[0].pathname).toBe('/api/push/token')
    expect(urls[0].searchParams.get('status')).toBe('down')
    expect(urls[0].searchParams.get('msg')).toBe('Succeeded: 0, Failed: 1')
  })

  it('include_dirs 项目通过 files-from 备份匹配目录', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'way-include-dirs-'))
    const dataDir = path.join(testDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'www/xhj/app/node_modules'), { recursive: true })

    mockRules({
      projects: {
        deps: { paths: [dataDir], include_dirs: ['www/xhj/*/node_modules'], schedule: false },
      },
      global_excludes: ['node_modules'],
    })

    try {
      await backup({ remote: 'local', projects: ['deps'], dryRun: true })

      const args = vi.mocked(execRestic).mock.calls[0][0]
      expect(args).toContain('--tag=way:deps')
      expect(args.some((arg) => arg.startsWith('--files-from='))).toBe(true)
      expect(args).not.toContain(dataDir)
      expect(args).not.toContain('--exclude=node_modules')
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('按 before_backup、restic、after_backup 的顺序执行项目钩子', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'way-hooks-'))
    const hookLog = path.join(testDir, 'hook.log')
    process.env.WAY_HOOK_LOG = hookLog

    mockRules({
      projects: {
        data: {
          paths: ['/data'],
          hooks: {
            before_backup: [
              { run: 'node -e "require(\'node:fs\').appendFileSync(process.env.WAY_HOOK_LOG, \'before:\' + process.env.WAY_PROJECT + \'\\n\')" ' },
            ],
            after_backup: [
              { run: 'node -e "require(\'node:fs\').appendFileSync(process.env.WAY_HOOK_LOG, \'after:\' + process.env.WAY_PROJECT + \'\\n\')" ' },
            ],
          },
        },
      },
      global_excludes: [],
    })
    vi.mocked(execRestic).mockImplementation(async () => {
      fs.appendFileSync(hookLog, 'restic:data\n')
    })

    try {
      const result = await backup({ remote: 'local', projects: ['data'] })

      expect(result.failed).toEqual([])
      expect(fs.readFileSync(hookLog, 'utf8')).toBe('before:data\nrestic:data\nafter:data\n')
    } finally {
      delete process.env.WAY_HOOK_LOG
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('before_backup 失败时跳过 restic 并标记项目失败', async () => {
    mockRules({
      projects: {
        data: {
          paths: ['/data'],
          hooks: {
            before_backup: [
              { run: 'node -e "process.exit(7)"' },
            ],
          },
        },
      },
      global_excludes: [],
    })

    const result = await backup({ remote: 'local', projects: ['data'] })

    expect(execRestic).not.toHaveBeenCalled()
    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual(['data'])
  })

  it.skipIf(process.platform === 'win32')('before_backup 超时后终止完整进程组', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'way-hook-timeout-'))
    const hookScript = path.join(testDir, 'hook.cjs')
    const descendantPidFile = path.join(testDir, 'descendant.pid')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.WAY_HOOK_DESCENDANT_PID = descendantPidFile

    fs.writeFileSync(hookScript, `
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
})
fs.writeFileSync(process.env.WAY_HOOK_DESCENDANT_PID, String(child.pid))
setInterval(() => {}, 1000)
`)

    mockRules({
      projects: {
        data: {
          paths: ['/data'],
          hooks: {
            before_backup: [
              { run: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookScript)}`, timeout: '300ms' },
            ],
          },
        },
      },
      global_excludes: [],
    })

    let descendantPid: number | undefined
    try {
      const result = await backup({ remote: 'local', projects: ['data'] })

      expect(result.failed).toEqual(['data'])
      expect(execRestic).not.toHaveBeenCalled()
      descendantPid = Number(fs.readFileSync(descendantPidFile, 'utf8'))

      await vi.waitFor(() => {
        expect(() => process.kill(descendantPid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
      }, { timeout: 3_000 })
    } finally {
      if (descendantPid !== undefined) {
        try {
          process.kill(descendantPid, 'SIGKILL')
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
        }
      }
      delete process.env.WAY_HOOK_DESCENDANT_PID
      consoleError.mockRestore()
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })
})
