import { Command } from 'commander'
import { run } from './commands/run'
import { gc } from './commands/gc'
import { systemd } from './commands/systemd'
import { daemon } from './commands/daemon'
import { execRestic, buildResticEnv, buildS3Options } from './core/restic'
import { loadConfig } from './core/config'

const program = new Command()

program
  .name('way')
  .version('0.5.0')
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
  .command('run [projects...]')
  .description('执行备份')
  .option('--dry-run', '模拟备份（不实际写入）')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async function(projects) {
    const remote = this.parent.opts().remote
    const extraArgs = this.args.filter((a: string) => a.startsWith('-') && !['--dry-run'].includes(a))
    if (this.opts().dryRun) extraArgs.push('--dry-run')
    await run({ remote, projects: projects.filter((p: string) => !p.startsWith('-')), extraArgs })
  })

program
  .command('gc')
  .description('清理旧快照')
  .option('--dry-run', '模拟清理（不实际删除）')
  .action(async function(cmdOptions) {
    const remote = this.parent.opts().remote
    await gc({ remote, dryRun: cmdOptions.dryRun })
  })

program
  .command('systemd <action>')
  .description('管理 systemd 定时任务 (show|install|uninstall|status)')
  .action(async (action, options, command) => {
    const remote = command.parent.opts().remote
    await systemd({ remote, action: action as 'show' | 'install' | 'uninstall' | 'status' })
  })

program
  .command('daemon')
  .description('启动常驻进程，按配置定时执行备份')
  .action(async (options, command) => {
    const remote = command.parent.opts().remote
    await daemon({ remote })
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
