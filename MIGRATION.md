# 从 Bash 版本迁移到 TypeScript 版本

## 兼容性

TypeScript 版本 (v0.3.0+) 与 Bash 版本 (v0.2.0) 完全兼容：

- 配置文件格式不变（repositories.yaml, rules.yaml, .env）
- 命令行接口不变
- 所有功能保持一致

## 迁移步骤

### 1. 卸载旧版本

```bash
rm /usr/local/bin/way
```

### 2. 安装新版本

```bash
npm install -g @shellus/way
```

### 3. 验证

```bash
way --version  # 应显示 0.3.0
way snapshots  # 应正常工作
```

配置文件无需修改，直接使用。

## 回滚

如需回滚到 Bash 版本：

```bash
npm uninstall -g @shellus/way
curl -fsSL https://github.com/shellus/way/releases/download/v0.2.0/install.sh | bash
```
