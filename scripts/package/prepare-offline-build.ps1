<#
.SYNOPSIS
    准备「内网离线编译」包：vendor 全部依赖 + 后端源码 + 离线 cargo 配置。

.DESCRIPTION
    在有网络的开发机执行。生成一个可在内网无网络机器上直接 `cargo build` 的自包含目录：
      - vendor/            所有 crate 依赖源码（cargo vendor）
      - backend 源码       src / Cargo.toml / Cargo.lock / config
      - .cargo/config.toml 把 crates.io 源替换为本地 vendor，实现完全离线编译
    Rust 工具链需另外离线安装（见生成的 README-offline-build.txt）。

.PARAMETER OutDir
    输出根目录，默认 dist。

.PARAMETER NoZip
    只生成目录，不压缩。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\package\prepare-offline-build.ps1
#>
[CmdletBinding()]
param(
    [string]$OutDir = "dist",
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    $root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    return $root.Path
}

function Resolve-OutRoot([string]$PathValue) {
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $repoRoot $PathValue
}

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到命令: $Name。请先安装并加入 PATH。"
    }
}

$repoRoot = Resolve-RepoRoot
$backendDir = Join-Path $repoRoot "backend"
$outRoot = Resolve-OutRoot $OutDir
$stageDir = Join-Path $outRoot "cook-db-offline-build"
$stageBackend = Join-Path $stageDir "backend"

if (-not (Test-Path $backendDir)) { throw "未找到后端目录: $backendDir" }
Assert-Command "cargo"

Write-Host "[1/5] 清理输出目录..." -ForegroundColor Cyan
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageBackend | Out-Null

Write-Host "[2/5] 拷贝后端源码..." -ForegroundColor Cyan
Copy-Item (Join-Path $backendDir "src") (Join-Path $stageBackend "src") -Recurse
Copy-Item (Join-Path $backendDir "config") (Join-Path $stageBackend "config") -Recurse
Copy-Item (Join-Path $backendDir "Cargo.toml") (Join-Path $stageBackend "Cargo.toml")
if (Test-Path (Join-Path $backendDir "Cargo.lock")) {
    Copy-Item (Join-Path $backendDir "Cargo.lock") (Join-Path $stageBackend "Cargo.lock")
}

Write-Host "[3/5] 执行 cargo vendor（收集全部依赖源码，可能较慢）..." -ForegroundColor Cyan
$vendorDir = Join-Path $stageBackend "vendor"
Push-Location $backendDir
try {
    # --no-delete 不影响；显式输出到 stage 的 vendor 目录
    cargo vendor --versioned-dirs $vendorDir | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "cargo vendor 失败 (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

Write-Host "[4/5] 写入离线 cargo 配置..." -ForegroundColor Cyan
$cargoCfgDir = Join-Path $stageBackend ".cargo"
New-Item -ItemType Directory -Path $cargoCfgDir | Out-Null
$cargoConfig = @"
# 离线编译配置：把 crates.io 源替换为随包 vendor 目录
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"

[net]
offline = true
"@
Set-Content -Path (Join-Path $cargoCfgDir "config.toml") -Value $cargoConfig -Encoding UTF8

Write-Host "[5/5] 生成说明并压缩..." -ForegroundColor Cyan
$readme = @"
cook-db 后端 - 内网离线编译包
================================

适用场景
  内网机器没有网络、也没有 Rust 工具链，需要在本机自行编译后端。
  （若内网机器只是运行，不必走这套流程，直接用 package-backend.ps1 产出的 exe 即可。）

本包内容
  backend\src\            后端源码
  backend\Cargo.toml/.lock 依赖清单（已锁定版本）
  backend\config\app.json 运行配置
  backend\vendor\         全部依赖的源码（离线，无需联网）
  backend\.cargo\config.toml 已配置为离线 + 使用本地 vendor

================================
第一步：在内网机器安装 Rust 工具链（离线）
================================
推荐使用「GNU 独立安装包」，自带 MinGW 链接器，无需安装 Visual Studio：

  1) 在有网机器下载（与内网同为 Windows x64）：
       https://forge.rust-lang.org/infra/other-installation-methods.html
     选择 standalone installers，下载：
       rust-<版本>-x86_64-pc-windows-gnu.msi
     （该 msi 含 rustc / cargo / 标准库 / rust-mingw 链接器，整套自包含）
  2) 把 msi 拷到内网机器，双击安装（默认装到 C:\Program Files\Rust ...）。
  3) 新开终端验证：
       cargo --version
       rustc --version

  备选（MSVC 工具链）：若坚持用 x86_64-pc-windows-msvc，则内网机器还需离线安装
  Visual Studio Build Tools 的「C++ 生成工具」（提供 link.exe），体积较大，不推荐。

================================
第二步：离线编译
================================
在本包的 backend 目录下执行：

  cd backend
  set RUSTFLAGS=-C target-feature=+crt-static
  cargo build --release --offline

  说明：
   - .cargo\config.toml 已设置 offline + vendor，无需联网。
   - crt-static 让运行时不依赖额外的 C/MinGW 运行库 DLL。
   - 若用 GNU 工具链且不加 crt-static，生成的 exe 会依赖
     libgcc_s_seh-1.dll / libwinpthread-1.dll，需一并拷贝；加上 crt-static 即可避免。

编译产物：
  GNU 工具链:  backend\target\x86_64-pc-windows-gnu\release\cook-db.exe
  或默认 target: backend\target\release\cook-db.exe

================================
第三步：运行
================================
  把 cook-db.exe 与 config\app.json 放在同一层级（config 作为子目录），
  在该目录执行 cook-db.exe。默认监听 127.0.0.1:8642。
  对外开放请把 config\app.json 的 host 改为 0.0.0.0。
"@
Set-Content -Path (Join-Path $stageDir "README-offline-build.txt") -Value $readme -Encoding UTF8

$vendorSize = "{0:N0} MB" -f ((Get-ChildItem $vendorDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)

if (-not $NoZip) {
    $zipPath = Join-Path $outRoot "cook-db-offline-build.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path $stageDir -DestinationPath $zipPath
}

Write-Host ""
Write-Host "完成！" -ForegroundColor Green
Write-Host "  目录: $stageDir"
if (-not $NoZip) { Write-Host "  压缩: $zipPath" }
Write-Host "  vendor 大小: $vendorSize"
Write-Host ""
Write-Host "下一步：另外准备 Rust GNU 独立安装包（见 README-offline-build.txt），一并拷入内网。" -ForegroundColor Yellow
