import { Command } from 'commander'
import { backup } from './commands/backup'
import { restore } from './commands/restore'
import { gc } from './commands/gc'
import { systemd } from './commands/systemd'
import { daemon } from './commands/daemon'
import { execRestic, buildResticEnv, buildS3Options } from './core/restic'
import { loadConfig } from './core/config'

const program = new Command()

program
  .name('way')
  .version('0.6.0')
  .description('策略备份工具 - 基于 restic 的策略封装')
  .option('--remote <name>', '指定仓库', 'default')
  .addHelpText('after', `
示例:
  $ way backup                 执行所有项目备份
  $ way backup data            只备份 data 项目
  $ way backup --dry-run       模拟备份（不实际写入）
  $ way restore data --target /tmp/restore --dry-run
  $ way gc                     清理旧快照
  $ way systemd install        安装定时任务
  $ way restic snapshots       查看快照列表
  $ way restic restore abc123 --target /tmp/restore
  $ way --remote=s3 restic snapshots  使用 s3 仓库

文档: https://github.com/shellus/way
`)

function collectBackupArgs(command: Command): string[] {
  return command.args.filter((a: string) => a.startsWith('-') && !['--dry-run'].includes(a))
}

program
  .command('backup [projects...]')
  .description('按 rules.yaml 执行备份')
  .option('--dry-run', '模拟备份（不实际写入）')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async function(projects) {
    const remote = this.parent.opts().remote
    const dryRun = this.opts().dryRun
    const extraArgs = collectBackupArgs(this)
    await backup({ remote, projects: projects.filter((p: string) => !p.startsWith('-')), extraArgs, dryRun })
  })

program
  .command('restore [projects...]')
  .description('按 rules.yaml 恢复项目')
  .requiredOption('--target <dir>', '恢复目标目录')
  .option('--snapshot <snapshot>', '快照 ID 或 latest', 'latest')
  .option('--dry-run', '模拟恢复（不实际写入）')
  .option('--delete', '删除目标中快照不存在的文件')
  .option('-v, --verbose', '显示详细恢复计划（传递 --verbose=2 给 restic）')
  .action(async function(projects, cmdOptions) {
    const remote = this.parent.opts().remote
    await restore({
      remote,
      projects,
      target: cmdOptions.target,
      snapshot: cmdOptions.snapshot,
      dryRun: cmdOptions.dryRun,
      delete: cmdOptions.delete,
      verbose: cmdOptions.verbose,
    })
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
  .command('restic [args...]')
  .description('显式透传给 restic')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async function(args) {
    const remote = this.parent.opts().remote
    const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
    const config = loadConfig(wayDir, remote)
    const env = buildResticEnv(config.repository)
    const s3Options = buildS3Options(config.repository)
    await execRestic(args, env, s3Options)
  })

if (process.argv.length <= 2) {
  program.outputHelp()
  process.exit(0)
}

program.parse()
