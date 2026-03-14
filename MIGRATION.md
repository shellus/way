# 迁移指南

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
