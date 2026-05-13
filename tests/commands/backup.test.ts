import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { backup } from '../../src/commands/backup'
import { loadConfig } from '../../src/core/config'
import { execRestic } from '../../src/core/restic'

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

  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({
      repository: {
        type: 'local',
        path: '/tmp/repo',
        credentials: { password: 'test123' },
      },
      rules: {
        uptime_kuma: { push_url: 'https://uptime.example.com/api/push/token' },
        projects: {
          data: { paths: ['/data'] },
        },
        global_excludes: [],
      },
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

  it('include_dirs 项目通过 files-from 备份匹配目录', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'way-include-dirs-'))
    const dataDir = path.join(testDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'www/xhj/app/node_modules'), { recursive: true })

    vi.mocked(loadConfig).mockReturnValue({
      repository: {
        type: 'local',
        path: '/tmp/repo',
        credentials: { password: 'test123' },
      },
      rules: {
        projects: {
          deps: { paths: [dataDir], include_dirs: ['www/xhj/*/node_modules'], schedule: false },
        },
        global_excludes: ['node_modules'],
      },
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
})
