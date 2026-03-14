# 开发参考

## 项目结构

```
way/                         # 源码仓库
├── src/
│   ├── cli.ts              # CLI 入口
│   ├── commands/           # 命令实现
│   │   ├── run.ts
│   │   ├── gc.ts
│   │   └── systemd.ts
│   ├── core/               # 核心模块
│   │   ├── config.ts
│   │   └── restic.ts
│   └── types.ts
├── tests/
├── repositories.yaml.example
├── rules.yaml.example
└── README.md

~/.way/                      # 运行时配置目录（WAY_DIR 默认值）
├── repositories.yaml        # 备份目的地配置（包含凭证明文）
└── rules.yaml               # 备份规则配置
```

## 本地测试

### 1. 创建测试仓库

```bash
mkdir -p /tmp/way-backup-test
RESTIC_PASSWORD=test123 restic init --repo /tmp/way-backup-test
```

### 2. 配置使用本地仓库

编辑 `~/.way/repositories.yaml`，将 `default` 改为 `local`：

```yaml
default: local
repositories:
  local:
    type: local
    path: /tmp/way-backup-test
    credentials:
      password: test123
```

### 3. 测试命令

```bash
npm run build
way snapshots              # 透传测试
way run --dry-run          # 备份测试（不实际执行）
way gc --dry-run           # 清理测试
way systemd show           # 显示 systemd 配置
way env                    # 显示所有环境变量
```

## 架构

```
way [--remote=name] <command> [args...]
     │                │         │
     │                │         └── 透传给 restic 或自有命令
     │                └── run/gc/systemd/env 或 restic 命令
     └── 选择仓库（默认读取 repositories.yaml 的 default）
```

### 命令分发

| 命令 | 处理方式 |
|------|----------|
| `run` | `cmd_run()` - 按 rules.yaml 执行备份，完成后推送 Uptime Kuma 通知 |
| `gc` | `cmd_gc()` - 按 retention 策略清理 |
| `systemd` | `cmd_systemd()` - 管理 systemd 定时任务 |
| `env` | `cmd_env()` - 显示所有环境变量 |
| 其他 | 透传给 `restic` |

### Uptime Kuma 通知

`run` 命令完成后会推送状态到 Uptime Kuma（如配置了 `uptime_kuma.push_url`）：

| 推送参数 | 值 |
|---------|---|
| `status` | 全部成功 → `up`，有失败 → `down` |
| `msg` | `Succeeded: N, Failed: M` |
| `ping` | 备份总耗时（毫秒） |

## 安全设计（v0.4.0）

1. **移除 .env 文件**：避免被 `find .env` 发现
2. **systemd 替代 crontab**：避免在 crontab 留下痕迹
3. **凭证明文存储**：直接写在 `repositories.yaml`，设置权限 600
