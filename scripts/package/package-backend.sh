#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
打包 cook-db 后端为 macOS/Linux 可分发 zip，默认包含 Chrome 扩展。

Usage:
  scripts/package/package-backend.sh [options]

Options:
  --out-dir DIR       输出目录，默认 dist。相对路径按仓库根目录解析。
  --target TARGET     可选 Rust target triple，例如 x86_64-unknown-linux-gnu。
  --skip-build        跳过 cargo build，复用已有 release 产物。
  --no-extension      不打包 extension 目录。
  --no-zip            只生成目录，不压缩。
  -h, --help          显示帮助。

Examples:
  scripts/package/package-backend.sh
  scripts/package/package-backend.sh --target aarch64-apple-darwin
  scripts/package/package-backend.sh --out-dir /tmp/cook-db-dist
EOF
}

die() {
  echo "错误: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "未找到命令: $1。请先安装并加入 PATH。"
}

resolve_out_root() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$repo_root/$1" ;;
  esac
}

make_zip() {
  local source_dir="$1"
  local zip_path="$2"
  local parent_dir base_name
  parent_dir="$(dirname "$source_dir")"
  base_name="$(basename "$source_dir")"

  rm -f "$zip_path"
  if command -v zip >/dev/null 2>&1; then
    (cd "$parent_dir" && zip -qr "$zip_path" "$base_name")
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$source_dir" "$zip_path" <<'PY'
import os
import sys
import zipfile

source_dir, zip_path = sys.argv[1], sys.argv[2]
root_parent = os.path.dirname(source_dir)
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
    for current, _, files in os.walk(source_dir):
        for name in files:
            path = os.path.join(current, name)
            archive.write(path, os.path.relpath(path, root_parent))
PY
  elif command -v ditto >/dev/null 2>&1; then
    ditto -c -k --sequesterRsrc --keepParent "$source_dir" "$zip_path"
  else
    die "未找到 zip、python3 或 ditto，无法生成 zip。"
  fi
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
backend_dir="$repo_root/backend"
out_dir="dist"
target=""
skip_build=0
include_extension=1
make_archive=1

while (($#)); do
  case "$1" in
    --out-dir)
      [[ $# -ge 2 ]] || die "--out-dir 需要参数"
      out_dir="$2"
      shift 2
      ;;
    --target)
      [[ $# -ge 2 ]] || die "--target 需要参数"
      target="$2"
      shift 2
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    --no-extension)
      include_extension=0
      shift
      ;;
    --no-zip)
      make_archive=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

[[ -d "$backend_dir" ]] || die "未找到后端目录: $backend_dir"
require_cmd cargo

out_root="$(resolve_out_root "$out_dir")"
stage_dir="$out_root/cook-db-backend"
exe_name="cook-db"

echo "[1/4] 编译 release..."
if [[ "$skip_build" -eq 0 ]]; then
  build_args=(build --release)
  if [[ -n "$target" ]]; then
    build_args+=(--target "$target")
  fi
  (cd "$backend_dir" && cargo "${build_args[@]}")
else
  echo "    已跳过 build"
fi

target_dir="$(cd "$backend_dir" && cargo metadata --format-version 1 --no-deps | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"
[[ -n "$target_dir" ]] || die "无法从 cargo metadata 解析 target_directory"

if [[ -n "$target" ]]; then
  release_dir="$target_dir/$target/release"
else
  release_dir="$target_dir/release"
fi

exe_path="$release_dir/$exe_name"
[[ -f "$exe_path" ]] || die "未找到产物: $exe_path"

echo "[2/4] 组织分发目录..."
rm -rf "$stage_dir"
mkdir -p "$stage_dir/config"

cp "$exe_path" "$stage_dir/$exe_name"
cp "$backend_dir/config/app.json" "$stage_dir/config/app.json"

if [[ "$include_extension" -eq 1 ]]; then
  ext_src="$repo_root/extension"
  [[ -d "$ext_src" ]] || die "未找到 Chrome 扩展目录: $ext_src"
  cp -R "$ext_src" "$stage_dir/extension"
  echo "    已包含 extension"
fi

echo "[3/4] 生成启动脚本与说明..."
cat > "$stage_dir/start-backend.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export RUST_LOG="${RUST_LOG:-cook_db=info,tower_http=info,sqlx=warn}"
exec ./cook-db
EOF
chmod +x "$stage_dir/start-backend.sh"

cat > "$stage_dir/README.txt" <<'EOF'
cook-db 后端 - macOS/Linux 运行包
================================

启动
  ./start-backend.sh

目录说明
  cook-db           后端可执行文件
  config/app.json   监听地址/端口配置
  start-backend.sh  启动脚本（自动切到本目录后运行）
  extension/        Chrome MV3 扩展，浏览器“加载已解压的扩展”指向此目录

注意
  - 可执行文件需要能在当前工作目录读到 config/app.json，建议使用 start-backend.sh。
  - 若要对外网机器开放，请把 config/app.json 的 host 改为 0.0.0.0。
  - macOS 首次运行若遇到安全拦截，可在系统设置中允许该二进制，或对可信产物执行：
      xattr -dr com.apple.quarantine cook-db start-backend.sh
EOF

echo "[4/4] 压缩为 zip..."
zip_path="$out_root/cook-db-backend.zip"
if [[ "$make_archive" -eq 1 ]]; then
  mkdir -p "$out_root"
  make_zip "$stage_dir" "$zip_path"
else
  echo "    已跳过 zip"
fi

exe_size="$(du -h "$stage_dir/$exe_name" | awk '{print $1}')"
echo
echo "完成！"
echo "  目录: $stage_dir"
if [[ "$make_archive" -eq 1 ]]; then
  echo "  压缩: $zip_path"
fi
echo "  二进制大小: $exe_size"
