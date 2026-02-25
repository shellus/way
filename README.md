# way - 策略备份

将备份作为持续运营的项目，而非一次性任务。基于 restic 的策略封装。

推荐在所有地方使用策略备份：开发环境、个人电脑、生产服务器。

## 设计原理

### 1. 备份目的

- 意外修改或删除时，从备份提取
- 硬盘损毁、机房失联时，从备份重建
- 需要追溯历史状态时，查阅备份

### 2. 不备份可重建内容

可重建的内容不备份：docker 镜像、node_modules、缓存、构建产物等。判断标准不是"是否有价值"，而是"能否从其他来源恢复"。

### 3. 备份是项目

备份保护所有项目，其重要性是所有项目的总和。应作为最重要的项目持续运营。

### 4. 频率匹配变化

备份频率应匹配数据变化频率。高频变化时段多备份，低频时段少备份。

### 5. 可验证原则

未经验证的备份等于没有备份。定期验证备份可恢复，失败时必须有告警。

### 6. 定期清理

定期清理旧快照，防止存储膨胀。

### 7. 同步不等于备份

同步工具（如 Syncthing）会将误操作实时传播到所有节点。真正的备份必须具备版本历史和回滚能力。

### 8. 备份隔离原则

假设本机被入侵，攻击者不应能通过本机凭证定位或删除备份数据。

### 9. 多层冗余原则

单一备份链路存在单点故障风险。应在多个维度建立冗余：
- 时间周期：高频 + 每日 + 每周
- 存储介质：云存储 + 本地硬盘 + 异地服务器

### 10. 恢复演练原则

定期执行实际恢复演练，确认备份可解密、可读取，恢复时间在可接受范围内。

---

## 依赖

- [restic](https://restic.net/) - 备份引擎
- [yq](https://github.com/mikefarah/yq/) - YAML 解析

首次安装时，install.sh 会自动安装 way 及其依赖（restic、yq）。

## 快速开始

```bash
# 安装（way + restic + yq）
curl -fsSL https://github.com/shellus/way/releases/latest/download/install.sh | bash

# way 自己的命令（不与 restic 冲突）
way run                 # 执行备份（读取 rules.yaml 的项目和排除规则）
way run data            # 只备份 data 项目
way gc                  # 按 retention 策略清理旧快照
way cron install        # 安装定时任务
way cron show           # 显示将要安装的 crontab

# 透传 restic（way 只设置环境变量）
way snapshots           # → restic snapshots
way restore abc123      # → restic restore abc123
way check               # → restic check
way stats               # → restic stats
way prune               # → restic prune（直接透传）

# 指定 repository（默认用 repositories.yaml 中的 default）
way --remote=oss snapshots
```

---

## 配置说明

复制示例文件并填入实际值：

```bash
cp repositories.yaml.example repositories.yaml
cp rules.yaml.example rules.yaml
```

### rules.yaml

备份规则配置，参考 [`rules.yaml`](rules.yaml)：

- **projects**: 备份项目、路径、专属排除规则
- **schedule**: 备份时间、清理任务的 cron 表达式
- **retention**: 快照保留策略
- **global_excludes**: 全局排除规则

#### 排除规则通配符语法

restic 使用 Go 的 filepath.Match 语法：

- `*` 匹配任意字符，但**不跨越目录分隔符**
- `**` 匹配任意子目录

示例：
- `*Cache*` 只匹配当前目录下含 Cache 的文件/目录
- `**/*Cache*` 匹配任意深度子目录下含 Cache 的文件/目录

### repositories.yaml

备份目的地配置，参考 [`repositories.yaml`](repositories.yaml)。

### .env

敏感凭证通过环境变量注入，在 `.env` 中定义：

```bash
RESTIC_PASSWORD=your-restic-password
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

在 `repositories.yaml` 中使用 `${VAR}` 语法引用：

```yaml
credentials:
  password: ${RESTIC_PASSWORD}
  access_key_id: ${AWS_ACCESS_KEY_ID}
```

## 凭证离线备份

`repositories.yaml` 和 `.env` 包含 restic 仓库密码和云存储凭证。这两个文件被 `.gitignore` 排除，不会进入版本控制，也不会被 way 自身备份。

**如果本机不可访问且遗忘了这些凭证，所有备份数据将永久无法恢复。**

必须在本机之外单独保存一份：

- 密码管理器（推荐）
- 加密笔记
- 离线存储（U 盘、纸质打印）

需要保存的信息：

| 项目 | 来源 |
|------|------|
| restic 仓库密码 | `.env` 中的 `RESTIC_PASSWORD` |
| S3 访问凭证 | `.env` 中的 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` |
| 仓库地址 | `repositories.yaml` 中的 `url` |

## 数据恢复

way 透传所有 restic 命令，恢复数据时只需通过 way 调用 restic 的恢复相关命令。way 负责设置仓库连接和认证环境变量，无需手动配置。

### 1. 查看快照列表

```bash
way snapshots                    # 列出所有快照
way snapshots --tag=way:home     # 只看 home 项目的快照
way snapshots --tag=way:data     # 只看 data 项目的快照
```

### 2. 浏览快照内容

```bash
way ls <snapshot-id>             # 列出快照中的所有文件
way ls <snapshot-id> /root/.ssh  # 列出快照中指定目录的文件
way find --snapshot <id> <filename>  # 在快照中搜索文件
```

### 3. 恢复文件

```bash
# 恢复整个快照到指定目录
way restore <snapshot-id> --target /tmp/restore

# 只恢复特定路径
way restore <snapshot-id> --target /tmp/restore --include /root/.ssh

# 恢复单个文件到标准输出（适合快速查看）
way dump <snapshot-id> /root/.gitconfig
```

### 4. 从其他仓库恢复

```bash
way --remote=oss snapshots
way --remote=oss restore <snapshot-id> --target /tmp/restore
```

## 开发

参见 [CLAUDE.md](CLAUDE.md)。