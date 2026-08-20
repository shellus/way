# Way 项目维护规则

## 功能边界

- Way 是 restic 的策略封装层，不实现备份引擎、存储后端或内容加密。
- 通用能力进入 Way；单台主机的数据库导出、一致性快照、恢复脚本和网络配置继续由运行环境负责，不硬编码进源码。
- 新功能实现前先检查现有命令、配置解析、restic 参数构造和测试辅助代码，复用已有实现并保持 TypeScript 风格一致。

## 备份与调度语义

- `backup()` 必须继续执行本轮全部目标项目并返回完整 `RunResult`；任一项目失败时 CLI 退出码为 `1`。
- daemon 按相同 cron 表达式合并项目，避免同一轮调度重复执行和重复通知。
- Uptime Kuma 的有效 Push 地址按项目配置、全局配置、无通知的顺序解析；相同有效地址只发送一次汇总通知。
- 同一通知组任一项目失败时状态为 DOWN，不同地址之间不得互相覆盖。
- `--dry-run` 不执行项目 hook、不写入仓库、不发送通知。
- Linux 上的项目 hook 超时后必须终止 shell 及其全部后代进程；不得只结束直接子进程并留下仍在运行的数据库导出、压缩或同步任务。修改 hook 执行逻辑时必须用真实孙进程增加或维护回归测试。
- Windows 的 daemon 守护由 Way 自己生成和注册原生任务计划程序定义，不依赖 NSSM；任务只负责开机启动和失败重启，项目备份频率仍以 daemon 读取的规则为准。
- 通知请求失败只记录错误，不得把已经成功写入仓库的备份改判为失败。

## 配置与安全

- 配置变更保持向后兼容；废弃旧格式时必须提供明确错误和迁移入口。
- `repositories.yaml` 和运行时 `rules.yaml` 可以包含真实凭证，但源码、测试 fixture、公开文档和示例只能使用占位值。
- 项目 hook 继续通过 `WAY_PROJECT`、`WAY_REMOTE`、`WAY_DIR` 和 `WAY_DRY_RUN` 获取上下文。
- `maintenance.check` 尚未实现，不得仅添加调度配置或输出就宣称该能力可用。

## 测试与发布

- 新功能必须增加覆盖核心逻辑的测试；修复缺陷必须增加回归测试。
- 发布前执行 `npm run test:run`、`npm run build` 和 `npm run package:linux-x64`，并检查 `git diff --check`。
- 发布版本需要同步更新 `package.json`、`package-lock.json` 和 `src/cli.ts`。
- npm 发布由 GitHub Actions Trusted Publishing 完成；推送版本标签后由 release workflow 运行测试、构建发行包、发布 npm 包和创建 GitHub Release。

## 文档职责

- `README.md` 记录公开功能、配置和使用方式。
- `CONTRIBUTING.md` 记录开发环境、测试和发布流程。
- `AGENTS.md` 只记录项目维护时不能猜错的规则，不记录具体主机、部署路径、域名、监控 token 或一次性操作过程。
