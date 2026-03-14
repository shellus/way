import { Command } from 'commander'
import { run } from './commands/run'
import { gc } from './commands/gc'
import { systemd } from './commands/systemd'
import { execRestic, buildResticEnv, buildS3Options } from './core/restic'
import { loadConfig } from './core/config'

const program = new Command()

program
  .name('way')
  .version('0.4.0')
  .description('策略备份工具 - 基于 restic 的策略封装')
  .option('--remote <name>', '指定仓库', 'default')
  .addHelpText('after', `
示例:
  $ way run                    执行所有项目备份
  $ way run data               只备份 data 项目
  $ way run --dry-run          模拟备份（不实际写入）
  $ way gc                     清理旧快照
  $ way systemd install        安装定时任务
  $ way snapshots              查看快照列表
  $ way --remote=s3 snapshots  使用 s3 仓库

文档: https://github.com/shellus/way
`)

program
  .command('run [project]')
  .description('执行备份')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (project, options, command) => {
    const remote = command.parent.opts().remote
    const allArgs = command.parent.args.slice(1)

    // 如果 project 以 -- 开头，说明没有指定项目，所有参数都是 extraArgs
    if (project?.startsWith('--')) {
      await run({ remote, project: undefined, extraArgs: allArgs })
    } else {
      const extraArgs = project ? allArgs.slice(1) : allArgs
      await run({ remote, project, extraArgs })
    }
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
  .command('systemd <action>')
  .description('管理 systemd 定时任务 (show|install|uninstall|status)')
  .action(async (action, options, command) => {
    const remote = command.parent.opts().remote
    await systemd({ remote, action: action as 'show' | 'install' | 'uninstall' | 'status' })
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
