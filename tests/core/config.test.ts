import { describe, it, expect } from 'vitest'
import { loadConfig } from '../../src/core/config'
import path from 'path'

describe('loadConfig', () => {
  const fixturesDir = path.join(__dirname, '../fixtures')

  it('加载配置文件', () => {
    const config = loadConfig(fixturesDir, 'local')
    expect(config.repository.type).toBe('local')
    expect(config.repository.credentials.password).toBe('test123')
  })
})
