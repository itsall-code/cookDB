# 项目打包脚本说明

本目录用于生成 cook-db 后端在内网环境使用的包：

- `package-backend.ps1`：在有网开发机上直接编译并产出可离线运行的 Windows 后端包。
- `package-backend.sh`：在 macOS/Linux 上编译并产出当前平台可运行的后端包。
- `prepare-offline-build.ps1`：准备可带到内网机器上编译的源码包，包含 `cargo vendor` 依赖。

脚本会自动从 `scripts/package/` 向上解析仓库根目录，输出默认写入仓库根目录下的 `dist/`。

## Windows

### 生成离线运行包

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package\package-backend.ps1
```

Chrome 扩展默认会打包进 zip。若不需要扩展：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package\package-backend.ps1 -NoExtension
```

常用参数：

- `-OutDir dist`：输出目录，可传相对仓库根目录的路径或绝对路径。
- `-SkipBuild`：跳过 `cargo build`，复用已有 `target/release/cook-db.exe`。
- `-Target x86_64-pc-windows-msvc`：指定 Rust target triple。
- `-NoExtension`：不打包 Chrome 扩展。
- `-NoZip`：只生成目录，不压缩。

产物：

- `dist/cook-db-backend/`
- `dist/cook-db-backend.zip`

### 生成内网离线编译包

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package\prepare-offline-build.ps1
```

常用参数：

- `-OutDir dist`：输出目录，可传相对仓库根目录的路径或绝对路径。
- `-NoZip`：只生成目录，不压缩。

产物：

- `dist/cook-db-offline-build/`
- `dist/cook-db-offline-build.zip`

注意：离线编译包只包含源码和 Rust crate vendor 依赖，Rust 工具链安装包仍需单独准备。

## Mac

```bash
chmod +x scripts/package/package-backend.sh
scripts/package/package-backend.sh
```

交叉编译 Apple Silicon 包示例：

```bash
scripts/package/package-backend.sh --target aarch64-apple-darwin
```

Chrome 扩展默认会打包进 zip。若不需要扩展：

```bash
scripts/package/package-backend.sh --no-extension
```

常用参数：

- `--out-dir dist`：输出目录，可传相对仓库根目录的路径或绝对路径。
- `--skip-build`：跳过 `cargo build`，复用已有 release 产物。
- `--target aarch64-apple-darwin`：指定 Rust target triple。
- `--no-extension`：不打包 Chrome 扩展。
- `--no-zip`：只生成目录，不压缩。

## Linux

```bash
chmod +x scripts/package/package-backend.sh
scripts/package/package-backend.sh
```

指定 target 示例：

```bash
scripts/package/package-backend.sh --target x86_64-unknown-linux-gnu
```

产物：

- `dist/cook-db-backend/`
- `dist/cook-db-backend.zip`
