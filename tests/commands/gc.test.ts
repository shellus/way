import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshotRetentionPlan, gc, type ResticSnapshot } from '../../src/commands/gc'
import { loadConfig } from '../../src/core/config'
import { buildResticEnv, buildS3Options, execRestic, execResticCapture } from '../../src/core/restic'

vi.mock('../../src/core/config', () => ({ loadConfig: vi.fn() }))
vi.mock('../../src/core/restic', () => ({
  buildResticEnv: vi.fn().mockReturnValue({ RESTIC_REPOSITORY: '/repo' }),
  buildS3Options: vi.fn().mockReturnValue(['-o', 's3.bucket-lookup=dns']),
  execRestic: vi.fn().mockResolvedValue(undefined),
  execResticCapture: vi.fn(),
}))

const snapshots: ResticSnapshot[] = [
  { id: 'keep-id', hostname: 'nb3', time: '2026-08-24T00:00:00.000Z', tags: ['way:data'] },
  { id: 'old-id', hostname: 'nb3', time: '2026-08-10T00:00:00.000Z', tags: ['way:data'] },
  { id: 'other-id', hostname: 'nb2', time: '2026-08-24T00:00:00.000Z', tags: ['way:data'] },
]

describe('buildSnapshotRetentionPlan', () => {
  it('只保留白名单主机在当前时间窗口内的快照', () => {
    const plan = buildSnapshotRetentionPlan(
      snapshots,
      { keep_hosts: ['nb3'], max_age_days: 7 },
      new Date('2026-08-25T00:00:00.000Z'),
    )

    expect(plan.cutoff.toISOString()).toBe('2026-08-18T00:00:00.000Z')
    expect(plan.keep.map((snapshot) => snapshot.id)).toEqual(['keep-id'])
    expect(plan.remove.map((snapshot) => snapshot.id)).toEqual(['old-id', 'other-id'])
  })

  it('保守保留白名单主机的未来时间快照', () => {
    const future = { id: 'future-id', hostname: 'nb3', time: '2026-08-26T00:00:00.000Z' }
    const plan = buildSnapshotRetentionPlan(
      [future],
      { keep_hosts: ['nb3'], max_age_days: 7 },
      new Date('2026-08-25T00:00:00.000Z'),
    )

    expect(plan.keep).toEqual([future])
  })

  it('拒绝把严格范围和计数保留混用', () => {
    expect(() => buildSnapshotRetentionPlan(
      snapshots,
      { keep_hosts: ['nb3'], max_age_days: 7, keep_daily: 7 },
      new Date('2026-08-25T00:00:00.000Z'),
    )).toThrow('cannot be combined')
  })
})

describe('gc strict retention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildResticEnv).mockReturnValue({ RESTIC_REPOSITORY: '/repo' })
    vi.mocked(buildS3Options).mockReturnValue(['-o', 's3.bucket-lookup=dns'])
    vi.mocked(execResticCapture).mockResolvedValue(JSON.stringify(snapshots))
    vi.mocked(loadConfig).mockReturnValue({
      repository: { type: 'local', path: '/repo', credentials: {} },
      rules: {
        defaults: { retention: { keep_hosts: ['nb3'], max_age_days: 7 } },
        maintenance: { prune: { retry_lock: '30m' } },
        projects: {},
      },
    })
  })

  it('dry-run 只读取和输出计划，不执行 forget', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    try {
      await gc({ remote: 'default', dryRun: true })
    } finally {
      vi.useRealTimers()
    }

    expect(execResticCapture).toHaveBeenCalledWith(
      ['snapshots', '--json', '--no-lock'],
      { RESTIC_REPOSITORY: '/repo' },
      ['-o', 's3.bucket-lookup=dns', '--retry-lock=30m'],
    )
    expect(execRestic).not.toHaveBeenCalled()
  })

  it('正式执行按明确 ID forget 并 prune', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    try {
      await gc({ remote: 'default' })
    } finally {
      vi.useRealTimers()
    }

    expect(execRestic).toHaveBeenCalledWith(
      ['forget', '--prune', 'old-id', 'other-id'],
      { RESTIC_REPOSITORY: '/repo' },
      ['-o', 's3.bucket-lookup=dns', '--retry-lock=30m'],
    )
  })

  it('未配置严格范围时保持原有计数保留参数', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      repository: { type: 'local', path: '/repo', credentials: {} },
      rules: {
        defaults: { retention: { keep_daily: 3, keep_weekly: 2, keep_monthly: 1 } },
        projects: {},
      },
    })

    await gc({ remote: 'default', dryRun: true })

    expect(execResticCapture).not.toHaveBeenCalled()
    expect(execRestic).toHaveBeenCalledWith(
      ['forget', '--prune', '--keep-daily=3', '--keep-weekly=2', '--keep-monthly=1', '--dry-run'],
      { RESTIC_REPOSITORY: '/repo' },
      ['-o', 's3.bucket-lookup=dns'],
    )
  })
})
