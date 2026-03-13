import { describe, it, expect, beforeEach } from 'vitest'
import { expandEnv } from '../../src/core/env'

describe('expandEnv', () => {
  beforeEach(() => {
    process.env.TEST_VAR = 'test-value'
  })

  it('展开 ${VAR} 语法', () => {
    expect(expandEnv('${TEST_VAR}')).toBe('test-value')
  })

  it('不展开普通字符串', () => {
    expect(expandEnv('plain-text')).toBe('plain-text')
  })

  it('变量不存在返回空字符串', () => {
    expect(expandEnv('${NON_EXIST}')).toBe('')
  })

  it('处理 null 和 undefined', () => {
    expect(expandEnv(null as any)).toBe('')
    expect(expandEnv(undefined as any)).toBe('')
  })
})
