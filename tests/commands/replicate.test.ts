import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../../src/core/config'
import { execRestic, execResticCapture } from '../../src/core/restic'
import { replicate, selectLatestProjectSnapshots } from '../../src/commands/replicate'
import type { Config } from '../../src/core/config'

vi.mock('../../src/core/config', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/core/restic', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/restic')>('../../src/core/restic')
  return {
    ...actual,
    execRestic: vi.fn(),
    execResticCapture: vi.fn(),
  }
})

const rules = {
  projects: {
    data: { paths: ['/data'] },
    config: { paths: ['/config'] },
  },
  replications: {
    daily: {
      from: 'local',
      to: 'cos',
      schedule: '30 5 * * *',
      snapshot_policy: 'latest-per-project' as const,
    },
  },
}

function configFor(remote: string): Config {
  if (remote === 'cos') {
    return {
      repository: {
        type: 's3',
        endpoint: 's3.example.com',
        bucket: 'backup',
        region: 'region-1',
        options: { bucket_lookup: 'dns' },
        credentials: { password: 'remote-password', access_key_id: 'key', secret_access_key: 'secret' },
      },
      rules,
    }
  }

  return {
    repository: {
      type: 'local',
      path: '/local-repository',
      credentials: { password: 'local-password' },
    },
    rules,
  }
}

describe('selectLatestProjectSnapshots', () => {
  it('每个项目只选择最新快照并保持项目顺序', () => {
    expect(selectLatestProjectSnapshots([
      { id: 'data-old', time: '2026-08-24T00:00:00Z', tags: ['way:data'] },
      { id: 'unrelated', time: '2026-08-25T10:00:00Z', tags: ['manual'] },
      { id: 'config-latest', time: '2026-08-25T01:00:00Z', tags: ['way:config'] },
      { id: 'data-latest', time: '2026-08-25T02:00:00Z', tags: ['way:data'] },
    ], ['data', 'config'])).toEqual(['data-latest', 'config-latest'])
  })

  it('拒绝时间戳无效的快照', () => {
    expect(() => selectLatestProjectSnapshots([
      { id: 'invalid', time: 'not-a-date', tags: ['way:data'] },
    ], ['data'])).toThrow('invalid timestamp')
  })
})

describe('replicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadConfig).mockImplementation((_wayDir, remote) => configFor(remote === 'default' ? 'local' : remote))
    vi.mocked(execResticCapture).mockResolvedValue(JSON.stringify([
      { id: 'data-old', time: '2026-08-24T00:00:00Z', tags: ['way:data'] },
      { id: 'data-latest', time: '2026-08-25T02:00:00Z', tags: ['way:data'] },
      { id: 'config-latest', time: '2026-08-25T01:00:00Z', tags: ['way:config'] },
    ]))
    vi.mocked(execRestic).mockResolvedValue(undefined)
  })

  it('初始化目标仓库并复制每个项目的最新快照', async () => {
    const result = await replicate({ names: ['daily'], initialize: true })

    expect(result.failed).toEqual([])
    expect(result.succeeded).toEqual(['daily'])
    expect(execResticCapture).toHaveBeenCalledWith(
      ['snapshots', '--json'],
      expect.objectContaining({ RESTIC_REPOSITORY: '/local-repository' }),
      [],
    )
    expect(execRestic).toHaveBeenCalledTimes(2)

    const initArgs = vi.mocked(execRestic).mock.calls[0][0]
    const copyArgs = vi.mocked(execRestic).mock.calls[1][0]
    expect(initArgs).toEqual(expect.arrayContaining([
      'init',
      '--from-repo=/local-repository',
      '--copy-chunker-params',
    ]))
    expect(copyArgs).toEqual(expect.arrayContaining([
      'copy',
      '--from-repo=/local-repository',
      'data-latest',
      'config-latest',
    ]))
    expect(copyArgs).not.toContain('data-old')
    expect(vi.mocked(execRestic).mock.calls[0][1]).toEqual(expect.objectContaining({
      RESTIC_REPOSITORY: 's3:https://s3.example.com/backup',
    }))
    expect(vi.mocked(execRestic).mock.calls[0][2]).toEqual([
      '-o', 's3.bucket-lookup=dns',
      '-o', 's3.region=region-1',
    ])

    const passwordArgument = initArgs.find((argument) => argument.startsWith('--from-password-file='))
    expect(passwordArgument).toBeDefined()
    expect(fs.existsSync(passwordArgument!.slice('--from-password-file='.length))).toBe(false)
  })

  it('日常复制不重复初始化目标仓库', async () => {
    const result = await replicate({ names: ['daily'] })

    expect(result.failed).toEqual([])
    expect(execRestic).toHaveBeenCalledTimes(1)
    expect(vi.mocked(execRestic).mock.calls[0][0]).toEqual(expect.arrayContaining([
      'copy',
      '--from-repo=/local-repository',
      'data-latest',
      'config-latest',
    ]))
    expect(vi.mocked(execRestic).mock.calls[0][0]).not.toContain('init')
  })

  it('找不到复制任务时返回失败且不调用 restic', async () => {
    const result = await replicate({ names: ['missing'] })

    expect(result.failed).toEqual(['missing'])
    expect(execRestic).not.toHaveBeenCalled()
  })
})
