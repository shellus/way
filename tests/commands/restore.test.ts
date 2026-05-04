import { describe, it, expect, vi, beforeEach } from 'vitest'
import { restore } from '../../src/commands/restore'
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

describe('restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadConfig).mockReturnValue({
      repository: {
        type: 'local',
        path: '/tmp/repo',
        credentials: { password: 'test123' },
      },
      rules: {
        projects: {
          data: { paths: ['/data'] },
          config: { paths: ['/home/user/.config', '/home/user/.ssh'] },
        },
        global_excludes: [],
      },
    })
    vi.mocked(execRestic).mockResolvedValue(undefined)
  })

  it('按指定项目规则恢复最新快照', async () => {
    await restore({ remote: 'local', projects: ['data'], target: '/tmp/restore', host: 'old-host' })

    expect(execRestic).toHaveBeenCalledTimes(1)
    expect(execRestic).toHaveBeenCalledWith(
      ['restore', 'latest', '--tag=way:data', '--host=old-host', '--target=/tmp/restore', '--include=/data'],
      expect.objectContaining({ RESTIC_REPOSITORY: '/tmp/repo' }),
      [],
    )
  })

  it('未指定项目时恢复所有项目', async () => {
    await restore({ remote: 'local', target: '/tmp/restore', snapshot: 'abc123', dryRun: true, delete: true })

    expect(execRestic).toHaveBeenCalledTimes(2)
    expect(execRestic).toHaveBeenNthCalledWith(
      1,
      ['restore', 'abc123', '--tag=way:data', '--target=/tmp/restore', '--include=/data', '--dry-run', '--delete'],
      expect.any(Object),
      [],
    )
    expect(execRestic).toHaveBeenNthCalledWith(
      2,
      [
        'restore',
        'abc123',
        '--tag=way:config',
        '--target=/tmp/restore',
        '--include=/home/user/.config',
        '--include=/home/user/.ssh',
        '--dry-run',
        '--delete',
      ],
      expect.any(Object),
      [],
    )
  })

  it('缺少 target 时拒绝恢复', async () => {
    await expect(restore({ remote: 'local' })).rejects.toThrow('--target is required')
    expect(execRestic).not.toHaveBeenCalled()
  })
})
