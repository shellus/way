import { describe, it, expect } from 'vitest'
import { resolveWayCommandPath } from '../../src/commands/systemd'

function cronToSystemd(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return 'daily'

  const [minute, hour, day, month, weekday] = parts

  if (day === '*' && month === '*' && weekday === '*') {
    return `*-*-* ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`
  }

  return 'daily'
}

describe('cronToSystemd', () => {
  it('转换每日定时', () => {
    expect(cronToSystemd('1 12 * * *')).toBe('*-*-* 12:01:00')
    expect(cronToSystemd('30 15 * * *')).toBe('*-*-* 15:30:00')
    expect(cronToSystemd('0 0 * * *')).toBe('*-*-* 00:00:00')
  })

  it('不支持的格式返回 daily', () => {
    expect(cronToSystemd('0 0 1 * *')).toBe('daily')
    expect(cronToSystemd('0 0 * * 0')).toBe('daily')
    expect(cronToSystemd('invalid')).toBe('daily')
  })
})

describe('resolveWayCommandPath', () => {
  it('优先使用 WAY_BIN 指定的命令路径', () => {
    const wayPath = resolveWayCommandPath({
      env: { WAY_BIN: '/custom/way' },
      argv: ['/usr/bin/node', '/repo/dist/cli.js', 'systemd', 'show'],
      execPath: '/usr/bin/node',
      whichWay: () => '/usr/local/bin/way',
    })

    expect(wayPath).toBe('/custom/way')
  })

  it('node 运行 dist/cli.js 时使用 argv 中的 CLI 路径', () => {
    const wayPath = resolveWayCommandPath({
      env: {},
      argv: ['/usr/bin/node', '/repo/dist/cli.js', 'systemd', 'show'],
      execPath: '/usr/bin/node',
      whichWay: () => {
        throw new Error('way not found')
      },
    })

    expect(wayPath).toBe('/repo/dist/cli.js')
  })

  it('独立可执行文件运行时使用 execPath', () => {
    const wayPath = resolveWayCommandPath({
      env: {},
      argv: ['/opt/way/bin/way', 'systemd', 'show'],
      execPath: '/opt/way/bin/way',
      whichWay: () => {
        throw new Error('way not found')
      },
    })

    expect(wayPath).toBe('/opt/way/bin/way')
  })
})
