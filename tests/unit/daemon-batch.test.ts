import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import cron from 'node-cron'
import { daemon } from '../../src/commands/daemon'
import { backup } from '../../src/commands/backup'
import { loadConfig } from '../../src/core/config'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(),
  },
}))

vi.mock('../../src/core/config', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/commands/backup', () => ({
  backup: vi.fn().mockResolvedValue({ succeeded: [], failed: [], duration: 0 }),
}))

vi.mock('../../src/commands/gc', () => ({
  gc: vi.fn(),
}))

describe('daemon scheduled backup batching', () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({
      repository: {
        type: 'local',
        path: '/tmp/repo',
        credentials: { password: 'test123' },
      },
      rules: {
        defaults: { schedule: '3 * * * *' },
        projects: {
          profile: { paths: ['/root'] },
          data: { paths: ['/data'] },
          reference: { paths: ['/root/reference-repos'], schedule: '7 * * * *' },
        },
        global_excludes: [],
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  it('同一个 schedule 的项目汇总成一次 backup 调用', async () => {
    await daemon({ remote: 'default' })

    expect(cron.schedule).toHaveBeenCalledTimes(2)
    const sharedSchedule = vi.mocked(cron.schedule).mock.calls.find(([schedule]) => schedule === '3 * * * *')
    expect(sharedSchedule).toBeDefined()

    const callback = sharedSchedule![1] as () => void
    callback()

    expect(backup).toHaveBeenCalledTimes(1)
    expect(backup).toHaveBeenCalledWith({ remote: 'default', projects: ['profile', 'data'] })
  })
})
