import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { buildResticEnv, buildBackupArgs, buildRestoreArgs, execRestic } from '../../src/core/restic'

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({}),
}))
import type { Repository, Project } from '../../src/types'

describe('buildResticEnv', () => {
  it('构建 S3 环境变量', () => {
    const repo: Repository = {
      type: 's3',
      endpoint: 's3.example.com',
      bucket: 'my-bucket',
      credentials: { password: 'pass123', access_key_id: 'key', secret_access_key: 'secret' },
    }
    const env = buildResticEnv(repo)
    expect(env.RESTIC_REPOSITORY).toBe('s3:https://s3.example.com/my-bucket')
    expect(env.RESTIC_PASSWORD).toBe('pass123')
  })
})

describe('buildBackupArgs', () => {
  it('构建备份参数', () => {
    const project: Project = { paths: ['/data'], excludes: ['cache'] }
    const args = buildBackupArgs('test', project, ['node_modules'])
    expect(args).toContain('backup')
    expect(args).toContain('--tag=way:test')
    expect(args).toContain('--exclude=cache')
  })
})

describe('buildRestoreArgs', () => {
  it('按项目规则构建恢复参数', () => {
    const project: Project = { paths: ['/data', '/config'] }
    const args = buildRestoreArgs('data', project, {
      target: '/tmp/restore',
      snapshot: 'latest',
      dryRun: true,
      delete: true,
      verbose: true,
    })

    expect(args).toEqual([
      'restore',
      'latest',
      '--tag=way:data',
      '--target=/tmp/restore',
      '--include=/data',
      '--include=/config',
      '--dry-run',
      '--delete',
      '--verbose=2',
    ])
  })
})

describe('execRestic', () => {
  const originalWayResticBin = process.env.WAY_RESTIC_BIN

  beforeEach(() => {
    vi.mocked(execa).mockClear()
  })

  afterEach(() => {
    if (originalWayResticBin === undefined) {
      delete process.env.WAY_RESTIC_BIN
    } else {
      process.env.WAY_RESTIC_BIN = originalWayResticBin
    }
  })

  it('使用解析出的 restic 二进制执行命令', async () => {
    process.env.WAY_RESTIC_BIN = '/custom/restic'

    await execRestic(['snapshots'], { RESTIC_REPOSITORY: '/repo' }, ['-o', 's3.bucket-lookup=path'])

    expect(execa).toHaveBeenCalledWith(
      '/custom/restic',
      ['-o', 's3.bucket-lookup=path', 'snapshots'],
      expect.objectContaining({
        env: expect.objectContaining({ RESTIC_REPOSITORY: '/repo' }),
        stdio: 'inherit',
      }),
    )
  })
})
