#!/bin/bash
# 迁移脚本：v0.4.x -> v0.5.0
# 将旧配置格式转换为新格式

set -e

WAY_DIR="${WAY_DIR:-$HOME/.way}"
RULES_FILE="$WAY_DIR/rules.yaml"
BACKUP_FILE="$WAY_DIR/rules.yaml.v0.4.backup"

if [ ! -f "$RULES_FILE" ]; then
  echo "错误: 未找到 $RULES_FILE"
  exit 1
fi

# 备份原配置
cp "$RULES_FILE" "$BACKUP_FILE"
echo "已备份原配置到: $BACKUP_FILE"

# 检查是否是旧格式
if ! grep -q "^schedule:" "$RULES_FILE"; then
  echo "配置已是新格式，无需迁移"
  exit 0
fi

# 提取旧配置的值
OLD_SCHEDULE=$(grep -A2 "^schedule:" "$BACKUP_FILE" | grep -A1 "backup:" | tail -1 | sed 's/.*"\(.*\)".*/\1/')
OLD_PRUNE=$(grep -A3 "^schedule:" "$BACKUP_FILE" | grep "prune:" | sed 's/.*"\(.*\)".*/\1/')
OLD_CHECK=$(grep -A4 "^schedule:" "$BACKUP_FILE" | grep "check:" | sed 's/.*"\(.*\)".*/\1/')

KEEP_DAILY=$(grep "keep_daily:" "$BACKUP_FILE" | sed 's/.*: \(.*\)/\1/')
KEEP_WEEKLY=$(grep "keep_weekly:" "$BACKUP_FILE" | sed 's/.*: \(.*\)/\1/')
KEEP_MONTHLY=$(grep "keep_monthly:" "$BACKUP_FILE" | sed 's/.*: \(.*\)/\1/')

# 生成新配置
cat > "$RULES_FILE" << EOF
# 备份规则配置 (v0.5.0)
# 旧配置已备份到: $(basename $BACKUP_FILE)

# 全局默认配置
defaults:
  schedule: "${OLD_SCHEDULE:-0 */2 * * *}"
  retention:
    keep_daily: ${KEEP_DAILY:-7}
    keep_weekly: ${KEEP_WEEKLY:-4}
    keep_monthly: ${KEEP_MONTHLY:-6}

EOF

# 复制 uptime_kuma 配置
if grep -q "^uptime_kuma:" "$BACKUP_FILE"; then
  echo "# Uptime Kuma 通知" >> "$RULES_FILE"
  grep -A1 "^uptime_kuma:" "$BACKUP_FILE" >> "$RULES_FILE"
  echo "" >> "$RULES_FILE"
fi

# 复制 projects 配置
echo "# 备份项目" >> "$RULES_FILE"
sed -n '/^projects:/,/^global_excludes:/p' "$BACKUP_FILE" | sed '$d' >> "$RULES_FILE"
echo "" >> "$RULES_FILE"

# 复制 global_excludes
sed -n '/^global_excludes:/,$p' "$BACKUP_FILE" >> "$RULES_FILE"

# 添加 maintenance 配置
if [ -n "$OLD_PRUNE" ] || [ -n "$OLD_CHECK" ]; then
  echo "" >> "$RULES_FILE"
  echo "# 维护任务" >> "$RULES_FILE"
  echo "maintenance:" >> "$RULES_FILE"
  if [ -n "$OLD_PRUNE" ]; then
    echo "  prune:" >> "$RULES_FILE"
    echo "    schedule: \"$OLD_PRUNE\"" >> "$RULES_FILE"
  fi
  if [ -n "$OLD_CHECK" ]; then
    echo "  check:" >> "$RULES_FILE"
    echo "    schedule: \"$OLD_CHECK\"" >> "$RULES_FILE"
  fi
fi

echo "✓ 配置迁移完成"

# 检测并升级 systemd 服务
TIMER_FILE="$HOME/.config/systemd/user/way-backup.timer"
SERVICE_FILE="$HOME/.config/systemd/user/way-backup.service"

if systemctl --user is-active way-backup.timer &>/dev/null || [ -f "$TIMER_FILE" ]; then
  echo ""
  echo "检测到旧版 systemd timer，正在升级为 daemon service..."

  # 停止并禁用旧 timer
  systemctl --user stop way-backup.timer 2>/dev/null || true
  systemctl --user disable way-backup.timer 2>/dev/null || true
  rm -f "$TIMER_FILE"

  # 停止旧 service（如果在运行）
  systemctl --user stop way-backup.service 2>/dev/null || true

  # 重新安装新版 service
  way systemd install

  echo "✓ systemd 服务已从 timer 升级为 daemon"
elif systemctl --user is-active way-backup.service &>/dev/null || [ -f "$SERVICE_FILE" ]; then
  echo ""
  echo "检测到 systemd service，正在重新安装..."

  # 重新安装以更新配置
  way systemd uninstall
  way systemd install

  echo "✓ systemd 服务已更新"
else
  echo ""
  echo "未检测到 systemd 服务，如需安装: way systemd install"
fi

echo ""
echo "如需回滚配置: mv $BACKUP_FILE $RULES_FILE"
