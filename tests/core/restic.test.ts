import { describe, it, expect } from 'vitest'
import { buildResticEnv, buildBackupArgs } from '../../src/core/restic'
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
