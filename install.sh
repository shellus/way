#!/usr/bin/env bash
set -euo pipefail

WAY_REPO="shellus/way"
RESTIC_VERSION="0.17.1"
YQ_VERSION="4.52.2"

echo "=== way installer ==="

# 检测架构
ARCH=""
case "$(uname -m)" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *)
        echo "Error: unsupported architecture: $(uname -m)"
        exit 1
        ;;
esac

echo "Architecture: $ARCH"

# 安装 way
install_way() {
    if command -v way &>/dev/null; then
        echo "way is already installed: $(way --version)"
    else
        echo "Installing way..."
        curl -fsSL "https://github.com/$WAY_REPO/releases/latest/download/way" -o /usr/local/bin/way
        chmod +x /usr/local/bin/way
        echo "way installed: $(way --version)"
    fi
}

# 安装 restic
install_restic() {
    if command -v restic &>/dev/null; then
        echo "restic is already installed: $(restic version)"
    else
        echo "Installing restic v${RESTIC_VERSION}..."

        if ! command -v bunzip2 &>/dev/null; then
            echo "Installing bzip2..."
            apt update -qq && apt install -y -qq bzip2
        fi

        local url="https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${ARCH}.bz2"
        local tmpdir=$(mktemp -d)
        curl -fsSL "$url" -o "$tmpdir/restic.bz2"
        bunzip2 "$tmpdir/restic.bz2"
        mv "$tmpdir/restic" /usr/local/bin/restic
        chmod +x /usr/local/bin/restic
        rm -rf "$tmpdir"
        echo "restic installed: $(restic version)"
    fi
}

# 安装 yq
install_yq() {
    if command -v yq &>/dev/null; then
        echo "yq is already installed: $(yq --version)"
    else
        echo "Installing yq v${YQ_VERSION}..."
        local url="https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${ARCH}"
        curl -fsSL "$url" -o /usr/local/bin/yq
        chmod +x /usr/local/bin/yq
        echo "yq installed: $(yq --version)"
    fi
}

install_restic
install_yq
install_way

# 初始化配置目录
init_config() {
    local way_dir="$HOME/.way"
    local base_url="https://github.com/$WAY_REPO/releases/latest/download"

    mkdir -p "$way_dir"

    if [[ ! -f "$way_dir/repositories.yaml" ]]; then
        curl -fsSL "$base_url/repositories.yaml.example" -o "$way_dir/repositories.yaml.example"
        echo "Created: $way_dir/repositories.yaml.example"
    fi

    if [[ ! -f "$way_dir/rules.yaml" ]]; then
        curl -fsSL "$base_url/rules.yaml.example" -o "$way_dir/rules.yaml.example"
        echo "Created: $way_dir/rules.yaml.example"
    fi
}

init_config

echo ""
echo "=== Done ==="
echo "Config directory: $HOME/.way"
echo ""
echo "Next steps:"
echo "  cp ~/.way/repositories.yaml.example ~/.way/repositories.yaml"
echo "  cp ~/.way/rules.yaml.example ~/.way/rules.yaml"
echo "  # Edit the files, then run: way snapshots"
