#!/bin/bash
# 端到端测试：使用本地仓库测试 daemon 模式

set -e

TEST_DIR="/tmp/way-e2e-test-$$"
REPO_DIR="$TEST_DIR/repo"
DATA_DIR="$TEST_DIR/data"
WAY_DIR="$TEST_DIR/.way"

echo "=== Way v0.5.0 端到端测试 ==="
echo ""

# 清理函数
cleanup() {
  echo ""
  echo "清理测试环境..."
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# 1. 创建测试环境
echo "1. 创建测试环境"
mkdir -p "$REPO_DIR" "$DATA_DIR/project1" "$DATA_DIR/project2" "$WAY_DIR"

echo "test file 1" > "$DATA_DIR/project1/file1.txt"
echo "test file 2" > "$DATA_DIR/project2/file2.txt"

# 2. 初始化 restic 仓库
echo ""
echo "2. 初始化 restic 仓库"
RESTIC_PASSWORD=test123 restic init --repo "$REPO_DIR"

# 3. 创建配置文件
echo ""
echo "3. 创建配置文件"

cat > "$WAY_DIR/repositories.yaml" << EOF
default: local
repositories:
  local:
    type: local
    path: $REPO_DIR
    credentials:
      password: test123
EOF

cat > "$WAY_DIR/rules.yaml" << EOF
defaults:
  schedule: "*/1 * * * *"  # 每分钟
  retention:
    keep_daily: 3

projects:
  project1:
    description: 测试项目1
    paths:
      - $DATA_DIR/project1
    excludes: []

  project2:
    description: 测试项目2（每2分钟）
    paths:
      - $DATA_DIR/project2
    schedule: "*/2 * * * *"
    excludes: []

maintenance:
  prune:
    schedule: "*/3 * * * *"  # 每3分钟清理

global_excludes:
  - "*.tmp"
EOF

echo "配置文件已创建"

# 4. 启动 daemon（后台运行）
echo ""
echo "4. 启动 daemon（后台运行 3 分钟）"
WAY_DIR="$WAY_DIR" timeout 180 node dist/cli.js daemon &
DAEMON_PID=$!

echo "Daemon PID: $DAEMON_PID"
echo ""
echo "等待调度执行..."

# 5. 等待并检查结果
sleep 150

# 6. 检查快照
echo ""
echo "5. 检查快照"
WAY_DIR="$WAY_DIR" node dist/cli.js snapshots

echo ""
echo "=== 测试完成 ==="
