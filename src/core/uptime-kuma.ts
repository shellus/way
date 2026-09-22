export interface UptimeKumaPush {
  status: 'up' | 'down'
  msg: string
  ping: number
}

const MAX_MESSAGE_LENGTH = 200

// 通知失败只记录错误，不改变已经完成的备份或维护任务结果。
export async function notifyUptimeKuma(push: UptimeKumaPush, pushUrl: string): Promise<void> {
  const msg = push.msg.length > MAX_MESSAGE_LENGTH ? `${push.msg.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : push.msg
  const url = `${pushUrl}?status=${push.status}&msg=${encodeURIComponent(msg)}&ping=${push.ping}`

  try {
    const response = await fetch(url)
    if (response.ok) {
      console.log(`Uptime Kuma notified: status=${push.status}, ping=${push.ping}ms`)
    } else {
      console.error('Uptime Kuma notification failed')
    }
  } catch (error) {
    console.error('Uptime Kuma notification failed:', error)
  }
}
