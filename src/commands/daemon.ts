import cron from 'node-cron'
import { loadConfig } from '../core/config'
import { backup } from './backup'
import { gc } from './gc'

export interface DaemonOptions {
  remote: string
}

let isRunning = false
const taskQueue: Array<() => Promise<void>> = []

async function executeTask(task: () => Promise<void>) {
  taskQueue.push(task)
  if (isRunning) return

  while (taskQueue.length > 0) {
    isRunning = true
    const nextTask = taskQueue.shift()!
    try {
      await nextTask()
    } catch (error) {
      console.error('Task failed:', error)
    }
  }
  isRunning = false
}

export async function daemon(options: DaemonOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  console.log('Way daemon started')

  // 为每个项目创建备份任务
  for (const [name, project] of Object.entries(config.rules.projects)) {
    const schedule = project.schedule || config.rules.defaults?.schedule || '0 */2 * * *'

    cron.schedule(schedule, () => {
      executeTask(async () => {
        console.log(`[${new Date().toISOString()}] Running backup: ${name}`)
        await backup({ remote: options.remote, projects: [name] })
      })
    })

    console.log(`Scheduled backup for ${name}: ${schedule}`)
  }

  // 维护任务：prune
  const pruneSchedule = config.rules.maintenance?.prune?.schedule
  if (pruneSchedule) {
    cron.schedule(pruneSchedule, () => {
      executeTask(async () => {
        console.log(`[${new Date().toISOString()}] Running prune`)
        await gc({ remote: options.remote, dryRun: false })
      })
    })
    console.log(`Scheduled prune: ${pruneSchedule}`)
  }

  // 维护任务：check
  const checkSchedule = config.rules.maintenance?.check?.schedule
  if (checkSchedule) {
    cron.schedule(checkSchedule, () => {
      executeTask(async () => {
        console.log(`[${new Date().toISOString()}] Running check`)
        // TODO: 实现 check 命令
      })
    })
    console.log(`Scheduled check: ${checkSchedule}`)
  }

  // 保持进程运行
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully')
    process.exit(0)
  })
}
