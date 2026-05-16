import cron from 'node-cron'
import { loadConfig } from '../core/config'
import { backup } from './backup'
import { gc } from './gc'
import type { Project, RulesConfig } from '../types'

export interface DaemonOptions {
  remote: string
}

let isRunning = false
const taskQueue: Array<() => Promise<void>> = []

type Schedule = string | false | undefined

export function resolveProjectSchedule(project: Pick<Project, 'schedule'>, defaults: RulesConfig['defaults'] = {}): string | false {
  if (project.schedule !== undefined) return project.schedule
  return defaults?.schedule ?? false
}

export function isEnabledSchedule(schedule: Schedule): schedule is string {
  return typeof schedule === 'string'
}

export function assertValidSchedule(schedule: Schedule, label: string): void {
  if (schedule === '') {
    throw new Error(`${label} must be a cron expression or false. Use false to disable scheduling.`)
  }
}

function addScheduledBackup(scheduledBackups: Map<string, string[]>, schedule: string, projectName: string): void {
  const projects = scheduledBackups.get(schedule) || []
  projects.push(projectName)
  scheduledBackups.set(schedule, projects)
}

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

  const scheduledBackups = new Map<string, string[]>()

  // 按相同 schedule 汇总项目，避免同一轮调度对同一个监控反复上报成功/失败。
  for (const [name, project] of Object.entries(config.rules.projects)) {
    const schedule = resolveProjectSchedule(project, config.rules.defaults)
    assertValidSchedule(schedule, `projects.${name}.schedule`)

    if (!isEnabledSchedule(schedule)) {
      console.log(`Skipped scheduled backup for ${name}`)
      continue
    }

    addScheduledBackup(scheduledBackups, schedule, name)
  }

  for (const [schedule, projects] of scheduledBackups.entries()) {
    cron.schedule(schedule, () => {
      executeTask(async () => {
        console.log(`[${new Date().toISOString()}] Running backup: ${projects.join(', ')}`)
        await backup({ remote: options.remote, projects })
      })
    })

    console.log(`Scheduled backup for ${projects.join(', ')}: ${schedule}`)
  }

  // 维护任务：prune
  const pruneSchedule = config.rules.maintenance?.prune?.schedule
  assertValidSchedule(pruneSchedule, 'maintenance.prune.schedule')
  if (isEnabledSchedule(pruneSchedule)) {
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
  assertValidSchedule(checkSchedule, 'maintenance.check.schedule')
  if (isEnabledSchedule(checkSchedule)) {
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
