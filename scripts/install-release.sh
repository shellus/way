#!/usr/bin/env sh
set -eu

PREFIX="${PREFIX:-/usr/local}"
BINDIR="${WAY_BINDIR:-$PREFIX/bin}"
LIBDIR="${WAY_LIBDIR:-$PREFIX/lib/way}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "$BINDIR" "$LIBDIR/vendor/restic/linux-x64"

install -m 755 "$SCRIPT_DIR/bin/way" "$BINDIR/way"
install -m 755 "$SCRIPT_DIR/vendor/restic/linux-x64/restic" "$LIBDIR/vendor/restic/linux-x64/restic"
install -m 644 "$SCRIPT_DIR/repositories.yaml.example" "$LIBDIR/repositories.yaml.example"
install -m 644 "$SCRIPT_DIR/rules.yaml.example" "$LIBDIR/rules.yaml.example"

if [ -f "$SCRIPT_DIR/vendor/restic/linux-x64/LICENSE" ]; then
  install -m 644 "$SCRIPT_DIR/vendor/restic/linux-x64/LICENSE" "$LIBDIR/vendor/restic/linux-x64/LICENSE"
fi

if [ -f "$SCRIPT_DIR/vendor/restic/linux-x64/VERSION" ]; then
  install -m 644 "$SCRIPT_DIR/vendor/restic/linux-x64/VERSION" "$LIBDIR/vendor/restic/linux-x64/VERSION"
fi

echo "way installed to $BINDIR/way"
echo "restic sidecar installed to $LIBDIR/vendor/restic/linux-x64/restic"
