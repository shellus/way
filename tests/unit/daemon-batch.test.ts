import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import cron from 'node-cron'
import { daemon } from '../../src/commands/daemon'
import { backup } from '../../src/commands/backup'
import { gc } from '../../src/commands/gc'
import { replicate } from '../../src/commands/replicate'
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

vi.mock('../../src/commands/replicate', () => ({
  replicate: vi.fn().mockResolvedValue({ succeeded: ['daily'], failed: [], duration: 0 }),
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
    expect(sharedSchedule![2]).toEqual({ missedExecutionTolerance: 5_000 })

    const callback = sharedSchedule![1] as () => void
    callback()

    expect(backup).toHaveBeenCalledTimes(1)
    expect(backup).toHaveBeenCalledWith({ remote: 'default', projects: ['profile', 'data'] })
  })

  it('调度仓库复制和目标仓库独立 prune', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      repository: {
        type: 'local',
        path: '/tmp/repo',
        credentials: { password: 'test123' },
      },
      rules: {
        projects: {},
        replications: {
          daily: {
            from: 'local',
            to: 'cos',
            schedule: '30 5 * * *',
            prune_schedule: '30 6 * * 0',
            retention: { keep_daily: 30, keep_weekly: 12 },
          },
        },
      },
    })

    await daemon({ remote: 'default' })

    expect(cron.schedule).toHaveBeenCalledTimes(2)
    const replicationCall = vi.mocked(cron.schedule).mock.calls.find(([schedule]) => schedule === '30 5 * * *')
    const pruneCall = vi.mocked(cron.schedule).mock.calls.find(([schedule]) => schedule === '30 6 * * 0')
    expect(replicationCall?.[2]).toEqual({ missedExecutionTolerance: 5_000 })
    expect(pruneCall?.[2]).toEqual({ missedExecutionTolerance: 5_000 })

    ;(replicationCall![1] as () => void)()
    await vi.waitFor(() => expect(replicate).toHaveBeenCalledWith({ names: ['daily'] }))
    ;(pruneCall![1] as () => void)()
    await vi.waitFor(() => expect(gc).toHaveBeenCalledWith({
      remote: 'cos',
      dryRun: false,
      retention: { keep_daily: 30, keep_weekly: 12 },
    }))
  })
})
