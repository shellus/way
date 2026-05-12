# 开发指南

## 核心设计决策 (ADR)

### ADR-001: 为什么选择 TypeScript 而非 Bash

**决策**：v0.3.0 从 Bash 迁移到 TypeScript

**原因**：
- 更好的错误处理和类型安全
- 更容易测试和维护
- 跨平台兼容性更好
- 更丰富的生态系统

### ADR-002: 为什么使用 systemd 而非 crontab

**决策**：v0.4.0 使用 systemd timer 替代 crontab

**原因**：
- 安全性：避免在 crontab 留下备份痕迹
- 功能性：更好的日志、依赖管理、失败重试
- 现代化：systemd 是现代 Linux 的标准

### ADR-003: 为什么移除 .env 文件支持

**决策**：v0.4.0 移除环境变量支持，凭证直接写在 YAML

**原因**：
- 安全性：避免被 `find .env` 发现
- 简化：减少配置文件数量
- 一致性：所有配置集中在一处

### ADR-004: 为什么封装 restic 而非直接使用

**决策**：way 是 restic 的策略封装层

**原因**：
- 策略化：统一管理多个项目的备份规则
- 自动化：定时任务、清理策略、通知
- 简化：隐藏 restic 复杂参数

## 功能边界

### 我们做什么

- 封装 restic，提供策略化备份
- 管理多项目备份规则
- 自动化定时任务和清理
- 透传所有 restic 命令

### 我们不做什么

- ❌ 不实现备份引擎（使用 restic）
- ❌ 不提供 GUI（专注 CLI）
- ❌ 不支持非 restic 后端
- ❌ 不做备份内容加密（restic 已提供）
- ❌ 不做网络传输优化（restic 已提供）
- ❌ 不支持 Windows（systemd 限制）

## 项目结构

```
way/
├── src/
│   ├── cli.ts              # CLI 入口
│   ├── commands/           # 命令实现
│   │   ├── run.ts         # 备份命令
│   │   ├── gc.ts          # 清理命令
│   │   └── systemd.ts     # systemd 管理
│   ├── core/              # 核心模块
│   │   ├── config.ts      # 配置加载
│   │   └── restic.ts      # restic 封装
│   └── types.ts           # 类型定义
├── tests/
│   ├── unit/              # 单元测试
│   └── e2e/               # E2E 测试
├── repositories.yaml.example
├── rules.yaml.example
└── README.md
```

## 技术栈

- TypeScript (ES2022)
- Commander.js (CLI 框架)
- execa (进程执行)
- js-yaml (YAML 解析)
- Vitest (测试框架)
- tsup (构建工具)
- Bun (Linux x64 独立发行包构建)

## 开发环境

### 前置要求

- Node.js >= 18
- restic (备份引擎)
- Bun (仅发布独立发行包时需要)

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
# 构建
npm run build

# 构建 Linux x64 独立发行包
npm run package:linux-x64

# 监听模式
npm run dev

# 运行测试
npm test

# 运行单次测试
npm run test:run
```

### 本地测试

1. 创建测试仓库：

```bash
mkdir -p /tmp/way-backup-test
RESTIC_PASSWORD=test123 restic init --repo /tmp/way-backup-test
```

2. 配置测试环境：

```bash
mkdir -p ~/.way
cat > ~/.way/repositories.yaml << EOF
default: local
repositories:
  local:
    type: local
    path: /tmp/way-backup-test
    credentials:
      password: test123
EOF

cat > ~/.way/rules.yaml << EOF
projects:
  test:
    paths:
      - /tmp
    excludes:
      - "*.log"
global_excludes:
  - node_modules
retention:
  keep_daily: 7
  keep_weekly: 4
  keep_monthly: 6
EOF
```

3. 测试命令：

```bash
npm run build
node dist/cli.js --version
node dist/cli.js snapshots
node dist/cli.js run --dry-run
```

## 变更规范

### 提交信息格式

使用 Conventional Commits 规范：

```
<type>: <description>

[optional body]
```

类型：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档变更
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具变更

示例：
```
feat: 添加 systemd 定时任务支持
fix: 修复 cron 格式转换错误
docs: 更新安装文档
```

### 代码规范

- 使用 TypeScript strict 模式
- 函数和变量使用 camelCase
- 类型使用 PascalCase
- 导出的接口添加 JSDoc 注释
- 保持函数简洁，单一职责

### 测试要求

- 新功能必须包含测试
- 修复 bug 必须添加回归测试
- 测试覆盖核心逻辑
- E2E 测试覆盖主要流程

## 发布流程

### 1. 版本号规范

遵循语义化版本 (Semantic Versioning)：

- `MAJOR.MINOR.PATCH`
- MAJOR: 破坏性变更
- MINOR: 新功能（向后兼容）
- PATCH: bug 修复

### 2. 发布步骤

```bash
# 1. 确保所有测试通过
npm run test:run

# 2. 更新版本号
# 修改 package.json、src/cli.ts、tests/e2e/full.test.ts

# 3. 更新文档
# 更新 README.md、MIGRATION.md（如有破坏性变更）

# 4. 提交变更
git add -A
git commit -m "chore: 准备发布 v0.x.x"

# 5. 创建 tag
git tag v0.x.x
git push origin master --tags

# 6. GitHub Actions 自动创建 Release 资产
# 产物: way-linux-x64.tar.gz

# 7. 发布到 npm
npm publish

# 8. 验证 npm 安装
npm install -g @shellus/way@0.x.x
way --version

# 9. 验证 GitHub Release 独立发行包
curl -LO https://github.com/shellus/way/releases/download/v0.x.x/way-linux-x64.tar.gz
tar -xzf way-linux-x64.tar.gz
./way-linux-x64/bin/way --version
```

### 3. 破坏性变更

如果包含破坏性变更：

1. 升级 MAJOR 版本
2. 在 MIGRATION.md 中添加迁移指南
3. 在 README.md 中更新版本说明
4. 在 GitHub Release 中标注 Breaking Changes

## 架构设计

### 命令分发

```
way [--remote=name] <command> [args...]
     │                │         │
     │                │         └── 透传给 restic 或自有命令
     │                └── run/gc/systemd/env 或 restic 命令
     └── 选择仓库（默认读取 repositories.yaml 的 default）
```

### 配置加载

1. 读取 `WAY_DIR` 环境变量（默认 `~/.way`）
2. 加载 `repositories.yaml` 和 `rules.yaml`
3. 根据 `--remote` 参数选择仓库
4. 构建 restic 环境变量

### restic 封装

- `buildResticEnv()`: 构建环境变量
- `buildBackupArgs()`: 构建备份参数
- `buildS3Options()`: 构建 S3 选项
- `execRestic()`: 执行 restic 命令

## 故障排查

### restic 命令未找到

**症状**：`Error: restic not found`

**解决**：
```bash
# macOS
brew install restic

# Ubuntu/Debian
apt install restic

# 手动安装
wget https://github.com/restic/restic/releases/latest/download/restic_linux_amd64
chmod +x restic_linux_amd64
mv restic_linux_amd64 /usr/local/bin/restic
```

### systemd timer 未启动

**症状**：`Unit way-backup.timer could not be found`

**解决**：
```bash
# 检查配置文件
cat ~/.config/systemd/user/way-backup.timer

# 重新加载
systemctl --user daemon-reload

# 重新安装
way systemd uninstall
way systemd install
```

### 备份失败：权限错误

**症状**：`Permission denied`

**解决**：
```bash
# 检查仓库权限
ls -la ~/.way/repositories.yaml

# 设置正确权限
chmod 600 ~/.way/repositories.yaml

# 检查备份路径权限
ls -la /path/to/backup
```

### S3 连接失败

**症状**：`The access key Id format you provided is invalid`

**解决**：
1. 检查 `repositories.yaml` 中的凭证是否正确
2. 确认 endpoint 和 bucket 配置
3. 测试连接：`way --remote=s3 snapshots`

## 快速参考

### 添加新的备份项目

编辑 `~/.way/rules.yaml`：
```yaml
projects:
  new-project:
    description: 新项目描述
    paths:
      - /path/to/data
    excludes:
      - cache
```

### 修改定时任务

编辑 `~/.way/rules.yaml`：
```yaml
defaults:
  schedule: "0 9 * * *"   # 全局默认每天 9:00

projects:
  data:
    schedule: "0 */4 * * *"  # 覆盖为每 4 小时
```

重新安装：
```bash
way systemd uninstall
way systemd install
```

### 添加新的存储仓库

编辑 `~/.way/repositories.yaml`：
```yaml
repositories:
  new-repo:
    type: s3
    endpoint: s3.example.com
    bucket: my-bucket
    credentials:
      password: xxx
      access_key_id: xxx
      secret_access_key: xxx
```

使用：
```bash
way --remote=new-repo init
way --remote=new-repo run
```

## 完整功能添加示例

### 需求：添加 Slack 通知支持

#### 1. 需求分析

- 备份完成后发送 Slack 通知
- 支持成功/失败状态
- 配置在 rules.yaml

#### 2. 类型定义

编辑 `src/types.ts`：
```typescript
export interface RulesConfig {
  // ... 现有字段
  slack?: {
    webhook_url: string
  }
}
```

#### 3. 实现功能

编辑 `src/commands/run.ts`：
```typescript
async function notifySlack(config: RulesConfig, result: RunResult) {
  if (!config.slack?.webhook_url) return

  const message = {
    text: `Backup ${result.failed.length > 0 ? 'failed' : 'completed'}`,
    attachments: [{
      color: result.failed.length > 0 ? 'danger' : 'good',
      fields: [
        { title: 'Succeeded', value: result.succeeded.join(', ') },
        { title: 'Failed', value: result.failed.join(', ') || 'None' }
      ]
    }]
  }

  await fetch(config.slack.webhook_url, {
    method: 'POST',
    body: JSON.stringify(message)
  })
}

// 在 run() 函数末尾调用
await notifySlack(config.rules, result)
```

#### 4. 添加测试

创建 `tests/unit/slack.test.ts`：
```typescript
import { describe, it, expect, vi } from 'vitest'

describe('Slack notification', () => {
  it('发送成功通知', async () => {
    const fetch = vi.fn()
    global.fetch = fetch

    await notifySlack(config, { succeeded: ['data'], failed: [] })

    expect(fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/xxx',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
```

#### 5. 更新文档

编辑 `rules.yaml.example`：
```yaml
# Slack 通知
slack:
  webhook_url: "https://hooks.slack.com/services/xxx"
```

编辑 `README.md`：
```markdown
### Slack 通知

在 `rules.yaml` 中配置：
\`\`\`yaml
slack:
  webhook_url: "https://hooks.slack.com/services/xxx"
\`\`\`
```

#### 6. 测试

```bash
npm run test:run
npm run build
way run
```

#### 7. 提交

```bash
git add -A
git commit -m "feat: 添加 Slack 通知支持"
```

## 常见问题

### 如何添加新命令？

1. 在 `src/commands/` 创建新文件
2. 实现命令逻辑
3. 在 `src/cli.ts` 注册命令
4. 添加测试
5. 更新 README.md

### 如何支持新的存储后端？

1. 在 `src/types.ts` 添加类型
2. 在 `buildResticEnv()` 添加处理逻辑
3. 更新 `repositories.yaml.example`
4. 添加测试

### 如何调试？

```bash
# 使用 Node.js 调试器
node --inspect-brk dist/cli.js run

# 查看详细日志
DEBUG=* node dist/cli.js run
```

## 贡献流程

1. Fork 项目
2. 创建功能分支 (`git checkout -b feat/xxx`)
3. 提交变更 (`git commit -m 'feat: xxx'`)
4. 推送到分支 (`git push origin feat/xxx`)
5. 创建 Pull Request

## 许可证

MIT License - 详见 LICENSE 文件
