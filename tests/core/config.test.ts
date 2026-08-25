import { describe, it, expect } from 'vitest'
import { loadConfig } from '../../src/core/config'
import fs from 'fs'
import os from 'os'
import path from 'path'

describe('loadConfig', () => {
  const fixturesDir = path.join(__dirname, '../fixtures')

  it('加载配置文件', () => {
    const config = loadConfig(fixturesDir, 'local')
    expect(config.repository.type).toBe('local')
    expect(config.repository.credentials.password).toBe('test123')
  })

  it('展开 repositories.yaml 的 merge anchor', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'way-config-merge-'))
    try {
      fs.writeFileSync(path.join(testDir, 'repositories.yaml'), `
defaults: &defaults
  type: s3
  endpoint: s3.example.com
  options:
    bucket_lookup: dns
  credentials:
    password: test-password
    access_key_id: test-key
    secret_access_key: test-secret

default: primary
repositories:
  primary:
    <<: *defaults
    bucket: test-bucket
`)
      fs.writeFileSync(path.join(testDir, 'rules.yaml'), 'projects: {}\n')

      const config = loadConfig(testDir, 'default')

      expect(config.repository).toEqual({
        type: 's3',
        endpoint: 's3.example.com',
        bucket: 'test-bucket',
        options: { bucket_lookup: 'dns' },
        credentials: {
          password: 'test-password',
          access_key_id: 'test-key',
          secret_access_key: 'test-secret',
        },
      })
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })
})
