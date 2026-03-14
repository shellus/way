import { describe, it, expect } from 'vitest'

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
