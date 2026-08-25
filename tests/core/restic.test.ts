import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildResticEnv, buildBackupArgs, buildRestoreArgs, buildS3Options, execRestic, execResticCapture, collectIncludeDirs, normalizeResticPath } from '../../src/core/restic'

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

  it('构建 S3 region 和 bucket lookup 选项', () => {
    const repo: Repository = {
      type: 's3',
      endpoint: 's3.example.com',
      bucket: 'my-bucket',
      region: 'region-1',
      options: { bucket_lookup: 'dns' },
      credentials: {},
    }

    expect(buildS3Options(repo)).toEqual([
      '-o', 's3.bucket-lookup=dns',
      '-o', 's3.region=region-1',
    ])
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
    const project: Project = { paths: ['/data'], include_dirs: ['www/xhj/*/node_modules'] }
    const args = buildBackupArgs('deps', project, [], '/tmp/way-include-dirs.txt')

    expect(args).toEqual([
      'backup',
      '--tag=way:deps',
      '--files-from=/tmp/way-include-dirs.txt',
    ])
  })

  it('include_dirs 项目显式配置 excludes 时报错', () => {
    const project: Project = { paths: ['/data'], include_dirs: ['www/xhj/*/node_modules'], excludes: ['cache'] }

    expect(() => buildBackupArgs('deps', project, [], '/tmp/way-include-dirs.txt')).toThrow('cannot use excludes with include_dirs')
  })
})

describe('collectIncludeDirs', () => {
  it('按相对 paths 的目录 glob 展开 include_dirs', () => {
    const root = path.resolve('/data')
    const www = path.join(root, 'www')
    const xhj = path.join(www, 'xhj')
    const app1 = path.join(xhj, 'app1')
    const app2 = path.join(xhj, 'app2')
    const entries: Record<string, Array<{ name: string, isDirectory: boolean }>> = {
      [root]: [
        { name: 'www', isDirectory: true },
      ],
      [www]: [
        { name: 'xhj', isDirectory: true },
        { name: 'other', isDirectory: true },
      ],
      [xhj]: [
        { name: 'app1', isDirectory: true },
        { name: 'app2', isDirectory: true },
      ],
      [app1]: [
        { name: 'node_modules', isDirectory: true },
      ],
      [app2]: [
        { name: 'node_modules', isDirectory: true },
      ],
    }

    const visited: string[] = []
    const matches = collectIncludeDirs([root], ['www/xhj/*/node_modules'], {
      readdirSync: (dir) => {
        visited.push(dir)
        return entries[dir] || []
      },
    })

    expect(matches).toEqual([path.join(app1, 'node_modules'), path.join(app2, 'node_modules')])
    expect(visited).not.toContain(path.join(app1, 'node_modules'))
    expect(visited).not.toContain(path.join(app2, 'node_modules'))
  })

  it('使用真实文件系统时只扫描目录', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'way-include-real-'))
    try {
      fs.mkdirSync(path.join(root, 'www/xhj/app1/node_modules'), { recursive: true })
      fs.writeFileSync(path.join(root, 'www/xhj/app1/file.txt'), 'content')

      expect(collectIncludeDirs([root], ['www/xhj/*/node_modules'])).toEqual([
        path.join(root, 'www/xhj/app1/node_modules'),
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('拒绝绝对 include_dirs 模式', () => {
    expect(() => collectIncludeDirs(['/data'], ['/data/www/xhj/*/node_modules'])).toThrow('must be relative')
  })

  it('拒绝递归 include_dirs 模式', () => {
    expect(() => collectIncludeDirs(['/data'], ['**/node_modules'])).toThrow('does not support **')
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

  it('允许恢复时传入相对快照路径', () => {
    const project: Project = { paths: ['C:\\Users\\shell\\.way'] }
    const args = buildRestoreArgs('config', project, {
      target: 'D:\\restore\\C\\Users\\shell',
      snapshot: 'latest:/C/Users/shell',
      includePaths: ['/.way'],
      platform: 'win32',
    })

    expect(args).toEqual([
      'restore',
      'latest:/C/Users/shell',
      '--tag=way:config',
      '--target=D:\\restore\\C\\Users\\shell',
      '--include=/.way',
    ])
  })
})

describe('normalizeResticPath', () => {
  it('将 Windows 驱动器路径转换为快照中的标准路径', () => {
    expect(normalizeResticPath('C:\\Users\\shell\\.way', 'win32')).toBe('/C/Users/shell/.way')
    expect(normalizeResticPath('d:/projects', 'win32')).toBe('/D/projects')
  })

  it('保留非 Windows 路径', () => {
    expect(normalizeResticPath('/data/projects', 'linux')).toBe('/data/projects')
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

  it('捕获 restic 标准输出供结构化命令解析', async () => {
    process.env.WAY_RESTIC_BIN = '/custom/restic'
    vi.mocked(execa).mockResolvedValueOnce({ stdout: '[{"id":"snapshot"}]' } as never)

    const output = await execResticCapture(['snapshots', '--json'], { RESTIC_REPOSITORY: '/repo' })

    expect(output).toBe('[{"id":"snapshot"}]')
    expect(execa).toHaveBeenCalledWith(
      '/custom/restic',
      ['snapshots', '--json'],
      expect.objectContaining({
        stdout: 'pipe',
        stderr: 'inherit',
      }),
    )
  })
})
