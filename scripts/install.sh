#!/usr/bin/env sh
set -eu

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64|Linux-amd64)
    ;;
  *)
    echo "way standalone installer currently supports Linux x64 only." >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

archive="$tmp/way-linux-x64.tar.gz"
url="https://github.com/shellus/way/releases/latest/download/way-linux-x64.tar.gz"

curl -fsSL "$url" -o "$archive"
tar -xzf "$archive" -C "$tmp"
sh "$tmp/way-linux-x64/install.sh"
