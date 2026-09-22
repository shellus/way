import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import cron from 'node-cron'
import { daemon, resolvePrunePushUrl, runPruneWithNotification } from '../../src/commands/daemon'
import { gc } from '../../src/commands/gc'
import { loadConfig } from '../../src/core/config'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(),
  },
}))

vi.mock('../../src/core/config', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/commands/backup', () => ({
  backup: vi.fn().mockResolvedValue({ succeeded: [], failed: [], duration: 0 }),
}))

vi.mock('../../src/commands/gc', () => ({
  gc: vi.fn(),
}))

vi.mock('../../src/commands/replicate', () => ({
  replicate: vi.fn(),
}))

describe('daemon prune notification', () => {
  const originalFetch = globalThis.fetch

  function notificationUrls(): URL[] {
    return vi.mocked(globalThis.fetch).mock.calls.map(([input]) => new URL(String(input)))
  }

  beforeEach(() => {
    vi.mocked(gc).mockResolvedValue(undefined)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  it('prune 通知地址优先使用 maintenance.prune 配置，否则回退到全局地址', () => {
    expect(resolvePrunePushUrl({
      projects: {},
      uptime_kuma: { push_url: 'https://uptime.example.com/api/push/global' },
      maintenance: { prune: { uptime_kuma: { push_url: 'https://uptime.example.com/api/push/prune' } } },
    })).toBe('https://uptime.example.com/api/push/prune')

    expect(resolvePrunePushUrl({
      projects: {},
      uptime_kuma: { push_url: 'https://uptime.example.com/api/push/global' },
    })).toBe('https://uptime.example.com/api/push/global')

    expect(resolvePrunePushUrl({ projects: {} })).toBeUndefined()
  })

  it('prune 成功时推送 UP', async () => {
    await runPruneWithNotification('default', 'https://uptime.example.com/api/push/prune')

    expect(gc).toHaveBeenCalledWith({ remote: 'default', dryRun: false })
    const [url] = notificationUrls()
    expect(url.pathname).toBe('/api/push/prune')
    expect(url.searchParams.get('status')).toBe('up')
    expect(url.searchParams.get('msg')).toBe('Prune succeeded')
  })

  it('prune 失败时推送带原因的 DOWN 并继续抛出错误', async () => {
    vi.mocked(gc).mockRejectedValue(new Error('repository is already locked'))

    await expect(runPruneWithNotification('default', 'https://uptime.example.com/api/push/prune'))
      .rejects.toThrow('repository is already locked')

    const [url] = notificationUrls()
    expect(url.searchParams.get('status')).toBe('down')
    expect(url.searchParams.get('msg')).toBe('Prune failed: repository is already locked')
  })

  it('过长的失败原因会被截断', async () => {
    vi.mocked(gc).mockRejectedValue(new Error('x'.repeat(500)))

    await expect(runPruneWithNotification('default', 'https://uptime.example.com/api/push/prune')).rejects.toThrow()

    expect(notificationUrls()[0].searchParams.get('msg')).toHaveLength(200)
  })

  it('未配置通知地址时不发送通知', async () => {
    vi.mocked(gc).mockRejectedValue(new Error('failed'))

    await expect(runPruneWithNotification('default', undefined)).rejects.toThrow('failed')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('通知请求失败不改变 prune 结果', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runPruneWithNotification('default', 'https://uptime.example.com/api/push/prune')).resolves.toBeUndefined()

    consoleError.mockRestore()
  })

  it('daemon 定时 prune 使用解析后的通知地址', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      repository: { type: 'local', path: '/tmp/repo', credentials: { password: 'test123' } },
      rules: {
        projects: {},
        uptime_kuma: { push_url: 'https://uptime.example.com/api/push/global' },
        maintenance: { prune: { schedule: '30 4 * * 0' } },
      },
    })

    await daemon({ remote: 'default' })

    const pruneSchedule = vi.mocked(cron.schedule).mock.calls.find(([schedule]) => schedule === '30 4 * * 0')
    expect(pruneSchedule).toBeDefined()
    ;(pruneSchedule![1] as () => void)()

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    expect(notificationUrls()[0].pathname).toBe('/api/push/global')
    expect(notificationUrls()[0].searchParams.get('status')).toBe('up')
  })
})
