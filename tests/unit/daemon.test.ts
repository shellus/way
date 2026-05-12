import { describe, it, expect } from 'vitest'
import { resolveProjectSchedule, isEnabledSchedule, assertValidSchedule } from '../../src/commands/daemon'

describe('resolveProjectSchedule', () => {
  it('没有全局和项目 schedule 时不调度', () => {
    expect(resolveProjectSchedule({}, {})).toBe(false)
  })

  it('全局 schedule 为 false 时不调度', () => {
    expect(resolveProjectSchedule({}, { schedule: false })).toBe(false)
  })

  it('项目 schedule 为 false 时覆盖全局配置并禁用调度', () => {
    expect(resolveProjectSchedule({ schedule: false }, { schedule: '0 3 * * *' })).toBe(false)
  })

  it('项目 schedule 覆盖全局 schedule', () => {
    expect(resolveProjectSchedule({ schedule: '0 3 * * *' }, { schedule: '0 */2 * * *' })).toBe('0 3 * * *')
  })

  it('项目缺省时继承全局 schedule', () => {
    expect(resolveProjectSchedule({}, { schedule: '0 */2 * * *' })).toBe('0 */2 * * *')
  })
})

describe('isEnabledSchedule', () => {
  it('只有字符串 schedule 会启用调度', () => {
    expect(isEnabledSchedule('0 3 * * *')).toBe(true)
    expect(isEnabledSchedule(false)).toBe(false)
    expect(isEnabledSchedule(undefined)).toBe(false)
  })
})

describe('assertValidSchedule', () => {
  it('拒绝空字符串 schedule', () => {
    expect(() => assertValidSchedule('', 'projects.data.schedule')).toThrow('Use false to disable scheduling')
  })

  it('接受 cron 字符串、false 和 undefined', () => {
    expect(() => assertValidSchedule('0 3 * * *', 'projects.data.schedule')).not.toThrow()
    expect(() => assertValidSchedule(false, 'projects.data.schedule')).not.toThrow()
    expect(() => assertValidSchedule(undefined, 'projects.data.schedule')).not.toThrow()
  })
})
