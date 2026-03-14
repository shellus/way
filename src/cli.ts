import { Command } from 'commander'
import { run } from './commands/run'
import { gc } from './commands/gc'
import { cron } from './commands/cron'
import { execRestic, buildResticEnv, buildS3Options } from './core/restic'
import { loadConfig } from './core/config'

const program = new Command()

program
  .name('way')
  .version('0.3.1')
  .description('策略备份工具')
  .option('--remote <name>', '指定仓库', 'default')

program
  .command('run [project]')
  .description('执行备份')
  .action(async (project, options, command) => {
    const remote = command.parent.opts().remote
    const extraArgs = command.args.slice(1)
    await run({ remote, project, extraArgs })
  })

program
  .command('gc')
  .description('清理旧快照')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async function() {
    const remote = this.parent.opts().remote
    const extraArgs = this.parent.args.slice(1)
    await gc({ remote, extraArgs })
  })

program
  .command('cron <action>')
  .description('管理定时任务 (show|install)')
  .action(async (action, options, command) => {
    const remote = command.parent.opts().remote
    await cron({ remote, action: action as 'show' | 'install' })
  })

program
  .command('env')
  .description('显示环境变量')
  .action(() => {
    const env = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))
    for (const [key, value] of env) {
      console.log(`${key}=${value}`)
    }
  })

program
  .command('*', { isDefault: true })
  .description('透传给 restic')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async function(name) {
    const remote = this.parent.opts().remote
    const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
    const config = loadConfig(wayDir, remote)
    const env = buildResticEnv(config.repository)
    const s3Options = buildS3Options(config.repository)
    const args = this.parent.args
    await execRestic(args, env, s3Options)
  })

program.parse()
