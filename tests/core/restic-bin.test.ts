import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveResticBin, getBundledResticBin } from '../../src/core/restic-bin'

describe('resolveResticBin', () => {
  it('优先使用 WAY_RESTIC_BIN 指定的 restic', () => {
    const bin = resolveResticBin({
      env: { WAY_RESTIC_BIN: '/custom/restic' },
      platform: 'linux',
      arch: 'x64',
      packageRoot: '/pkg',
      existsSync: () => true,
    })

    expect(bin).toBe('/custom/restic')
  })

  it('linux x64 且内置二进制存在时使用包内 restic', () => {
    const bin = resolveResticBin({
      env: {},
      platform: 'linux',
      arch: 'x64',
      packageRoot: '/pkg',
      existsSync: (file) => file === path.join('/pkg', 'vendor/restic/linux-x64/restic'),
    })

    expect(bin).toBe(path.join('/pkg', 'vendor/restic/linux-x64/restic'))
  })

  it('非 linux x64 平台回退系统 restic', () => {
    const bin = resolveResticBin({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      packageRoot: '/pkg',
      existsSync: () => true,
    })

    expect(bin).toBe('restic')
  })

  it('linux x64 但内置二进制不存在时回退系统 restic', () => {
    const bin = resolveResticBin({
      env: {},
      platform: 'linux',
      arch: 'x64',
      packageRoot: '/pkg',
      existsSync: () => false,
    })

    expect(bin).toBe('restic')
  })

  it('独立包解压后从可执行文件上级目录查找内置 restic', () => {
    const archiveRoot = '/tmp/way-linux-x64'
    const bundledRestic = path.join(archiveRoot, 'vendor/restic/linux-x64/restic')

    const bin = resolveResticBin({
      env: {},
      platform: 'linux',
      arch: 'x64',
      packageRoot: '/not-a-package',
      executablePath: path.join(archiveRoot, 'bin/way'),
      existsSync: (file) => file === bundledRestic,
    })

    expect(bin).toBe(bundledRestic)
  })

  it('独立包安装到系统目录后从 lib/way 查找内置 restic', () => {
    const bundledRestic = '/usr/local/lib/way/vendor/restic/linux-x64/restic'

    const bin = resolveResticBin({
      env: {},
      platform: 'linux',
      arch: 'x64',
      packageRoot: '/not-a-package',
      executablePath: '/usr/local/bin/way',
      existsSync: (file) => file === bundledRestic,
    })

    expect(bin).toBe(bundledRestic)
  })
})

describe('getBundledResticBin', () => {
  it('返回 linux x64 内置 restic 路径', () => {
    expect(getBundledResticBin('/pkg')).toBe(path.join('/pkg', 'vendor/restic/linux-x64/restic'))
  })
})
