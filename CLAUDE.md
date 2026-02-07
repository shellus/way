# 开发参考

## 项目结构

```
way/
├── way.sh               # 主脚本（软链接到 /usr/local/bin/way）
├── repositories.yaml    # 备份目的地配置
├── rules.yaml           # 备份规则配置
├── .env                 # 敏感凭证（不纳入版本控制）
└── README.md            # 项目说明
```

## 安装

```bash
# 创建软链接
ln -sf /root/projects/way/way.sh /usr/local/bin/way
```

## 本地测试

### 1. 创建测试仓库

```bash
mkdir -p /tmp/way-backup-test
RESTIC_PASSWORD=test123 restic init --repo /tmp/way-backup-test
```

### 2. 配置使用本地仓库

编辑 `repositories.yaml`，将 `default` 改为 `local`：

```yaml
default: local
```

### 3. 测试命令

```bash
way snapshots              # 透传测试
way run --dry-run          # 备份测试（不实际执行）
way gc --dry-run           # 清理测试
way cron show              # 显示 cron 条目
way env                    # 显示所有环境变量
```

## 脚本架构

```
way [--remote=name] <command> [args...]
     │                │         │
     │                │         └── 透传给 restic 或自有命令
     │                └── run/gc/cron/env 或 restic 命令
     └── 选择仓库（默认读取 repositories.yaml 的 default）
```

### 命令分发

| 命令 | 处理方式 |
|------|----------|
| `run` | `cmd_run()` - 按 rules.yaml 执行备份，完成后推送 Uptime Kuma 通知 |
| `gc` | `cmd_gc()` - 按 retention 策略清理 |
| `cron` | `cmd_cron()` - 管理定时任务 |
| `env` | `cmd_env()` - 显示所有环境变量 |
| 其他 | 透传给 `restic` |

### 环境变量

1. 加载 `$WAY_DIR/.env`（如存在）
2. 读取 yaml 配置，`${VAR}` 语法会展开为环境变量值
3. 设置 `RESTIC_REPOSITORY`、`RESTIC_PASSWORD` 等

**`expand_env()` 函数**：通用的 `${VAR}` 展开函数，目前用于：
- `repositories.yaml` 中的凭证字段
- `rules.yaml` 中的 `uptime_kuma.push_url`

如需让更多字段支持环境变量，调用 `expand_env "$(yq ...)"` 即可。

### Uptime Kuma 通知

`run` 命令完成后会推送状态到 Uptime Kuma（如配置了 `uptime_kuma.push_url`）：

| 推送参数 | 值 |
|---------|---|
| `status` | 全部成功 → `up`，有失败 → `down` |
| `msg` | `Succeeded: N, Failed: M` |
| `ping` | 备份总耗时（毫秒） |

## 注意事项

### set -euo pipefail 兼容性

脚本使用严格模式，条件表达式需要注意：

```bash
# 错误 - 条件失败会导致脚本退出
[[ -f "$file" ]] && source "$file"

# 正确 - 添加 || true 防止退出
[[ -f "$file" ]] && source "$file" || true
```

### 参数解析

`way run` 的参数解析规则：
- 第一个非 `--` 开头的参数是项目名
- 所有 `--` 开头的参数透传给 restic

```bash
way run --dry-run          # 备份所有项目
way run data --dry-run     # 只备份 data 项目
way run --dry-run data     # 同上
```
