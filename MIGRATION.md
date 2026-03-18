# 迁移指南

## v0.4.x → v0.5.0（破坏性变更）

### 主要变更

1. **daemon 模式替代 systemd timer**
   - 使用常驻进程 + node-cron 实现调度
   - systemd service 管理 daemon 进程（自动重启）
   - 支持项目级 schedule 配置

2. **配置格式变更**
   - 移除顶层 `schedule` 和 `retention` 字段
   - 新增 `defaults` 字段（包含 schedule 和 retention）
   - 新增 `maintenance` 字段（prune 和 check 配置）
   - 项目可覆盖默认 schedule 和 retention

### 迁移步骤

#### 自动迁移（推荐）

运行迁移脚本自动转换配置：

```bash
# 如果已安装 v0.5.0
migrate-to-v0.5.sh

# 或使用 npx 直接运行
npx --yes @shellus/way@latest migrate-to-v0.5.sh
```

脚本会：
- 备份原配置到 `~/.way/rules.yaml.v0.4.backup`
- 转换配置格式
- 自动升级 systemd 服务（从 timer 改为 daemon service）

#### 手动迁移

**旧格式（v0.4.x）**：
```yaml
schedule:
  backup:
    - "0 */2 * * *"
  prune:
    - "0 4 * * 0"

retention:
  keep_daily: 7
  keep_weekly: 4

projects:
  data:
    paths: [/data]
```

**新格式（v0.5.0）**：
```yaml
defaults:
  schedule: "0 */2 * * *"
  retention:
    keep_daily: 7
    keep_weekly: 4

maintenance:
  prune:
    schedule: "0 4 * * 0"

projects:
  data:
    paths: [/data]
    # 可选：覆盖默认 schedule
    schedule: "0 3 * * *"
```

#### 升级 systemd 服务

```bash
# 卸载旧 timer
systemctl --user stop way-backup.timer
systemctl --user disable way-backup.timer
rm ~/.config/systemd/user/way-backup.timer

# 安装新 daemon service
way systemd install
way systemd status
```

### 验证

```bash
way systemd status    # 检查 daemon 是否运行
journalctl --user -u way-backup.service -f  # 查看日志
```

### 回滚到 v0.4.x

```bash
# 恢复配置
mv ~/.way/rules.yaml.v0.4.backup ~/.way/rules.yaml

# 降级版本
npm install -g @shellus/way@0.4.0
```

---

## v0.3.x → v0.4.0（破坏性变更）

### 主要变更

1. **移除 .env 文件支持**
   - 不再支持 `${VAR}` 环境变量语法
   - 凭证直接写在 `repositories.yaml` 中

2. **systemd 替代 crontab**
   - `way cron` 命令已移除
   - 新增 `way systemd` 命令

### 迁移步骤

#### 1. 更新 repositories.yaml

**旧格式（v0.3.x）**：
```yaml
repositories:
  local:
    credentials:
      password: ${RESTIC_PASSWORD}
```

**新格式（v0.4.0）**：
```yaml
repositories:
  local:
    credentials:
      password: test123  # 直接明文
```

将所有 `${VAR}` 替换为实际值（从 `.env` 文件复制）。

#### 2. 设置文件权限

```bash
chmod 600 ~/.way/repositories.yaml
```

#### 3. 删除 .env 文件

```bash
rm ~/.way/.env
```

#### 4. 卸载 crontab，安装 systemd

```bash
# 卸载旧的 crontab（如果有）
crontab -l | grep -v "way backup schedule" | crontab -

# 安装 systemd timer
way systemd install
```

#### 5. 验证

```bash
way systemd status
way run --dry-run
```

### 回滚到 v0.3.x

```bash
npm install -g @shellus/way@0.3.1
```

---

## v0.2.x (Bash) → v0.3.x (TypeScript)

配置文件格式完全兼容，参考旧版 MIGRATION.md。
