import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildResticEnv, buildBackupArgs, buildRestoreArgs, execRestic, matchIncludeDir, collectIncludeDirs } from '../../src/core/restic'

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

  it('include_dirs 项目使用 files-from 列表而不是直接备份根路径', () => {
    const project: Project = { paths: ['/data'], include_dirs: ['node_modules'] }
    const args = buildBackupArgs('deps', project, [], '/tmp/way-include-dirs.txt')

    expect(args).toEqual([
      'backup',
      '--tag=way:deps',
      '--files-from=/tmp/way-include-dirs.txt',
    ])
  })

  it('include_dirs 项目显式配置 excludes 时报错', () => {
    const project: Project = { paths: ['/data'], include_dirs: ['node_modules'], excludes: ['cache'] }

    expect(() => buildBackupArgs('deps', project, [], '/tmp/way-include-dirs.txt')).toThrow('cannot use excludes with include_dirs')
  })
})

describe('matchIncludeDir', () => {
  it('按目录名匹配 include_dirs', () => {
    expect(matchIncludeDir('/data/app/node_modules', ['node_modules'])).toBe(true)
    expect(matchIncludeDir('/data/app/vendor', ['node_modules', 'vendor'])).toBe(true)
    expect(matchIncludeDir('/data/app/src', ['node_modules', 'vendor'])).toBe(false)
  })
})

describe('collectIncludeDirs', () => {
  it('匹配目录后不继续深入该目录', () => {
    const entries: Record<string, Array<{ name: string, isDirectory: boolean }>> = {
      '/data': [
        { name: 'app', isDirectory: true },
        { name: 'docs', isDirectory: true },
      ],
      '/data/app': [
        { name: 'node_modules', isDirectory: true },
        { name: 'src', isDirectory: true },
      ],
      '/data/app/node_modules': [
        { name: 'deep-package', isDirectory: true },
      ],
      '/data/app/src': [
        { name: 'vendor', isDirectory: true },
      ],
      '/data/docs': [],
    }

    const visited: string[] = []
    const matches = collectIncludeDirs(['/data'], ['node_modules', 'vendor'], {
      readdirSync: (dir) => {
        visited.push(dir)
        return entries[dir] || []
      },
    })

    expect(matches).toEqual(['/data/app/node_modules', '/data/app/src/vendor'])
    expect(visited).not.toContain('/data/app/node_modules')
    expect(visited).not.toContain('/data/app/src/vendor')
  })

  it('使用真实文件系统时只扫描目录', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'way-include-real-'))
    try {
      fs.mkdirSync(path.join(root, 'app/node_modules'), { recursive: true })
      fs.writeFileSync(path.join(root, 'app/file.txt'), 'content')

      expect(collectIncludeDirs([root], ['node_modules'])).toEqual([
        path.join(root, 'app/node_modules'),
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
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
      host: 'old-host',
    })

    expect(args).toEqual([
      'restore',
      'latest',
      '--tag=way:data',
      '--host=old-host',
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
