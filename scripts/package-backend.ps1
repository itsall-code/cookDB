<#
.SYNOPSIS
    打包 cook-db 后端为离线可分发目录（供内网无网络机器运行）。

.DESCRIPTION
    在有网络的开发机上执行：编译 release 版本（静态链接 MSVC CRT，避免目标机缺少
    vcruntime140.dll），并收集 exe + 配置 + 可选扩展到 dist 目录，最后压缩成 zip。
    目标内网机器只需解压、运行 start-backend.bat，无需安装 Rust 或联网。

.PARAMETER OutDir
    输出目录，默认 dist。

.PARAMETER IncludeExtension
    是否一并打包 Chrome 扩展（extension 目录）。

.PARAMETER SkipBuild
    跳过 cargo build（已编译好时复用现有产物）。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\package-backend.ps1 -IncludeExtension
#>
[CmdletBinding()]
param(
    [string]$OutDir = "dist",
    [switch]$IncludeExtension,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$exeName = "cook-db.exe"

Write-Host "[1/4] 编译 release（静态 CRT）..." -ForegroundColor Cyan
if (-not $SkipBuild) {
    Push-Location $backendDir
    try {
        # 静态链接 C 运行时，目标机无需安装 VC++ 运行库
        $env:RUSTFLAGS = "-C target-feature=+crt-static"
        cargo build --release
        if ($LASTEXITCODE -ne 0) { throw "cargo build 失败 (exit $LASTEXITCODE)" }
    }
    finally {
        Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
        Pop-Location
    }
}
else {
    Write-Host "    已跳过 build" -ForegroundColor DarkGray
}

# 通过 cargo metadata 解析真实 target 目录（兼容 CARGO_TARGET_DIR 重定向）
Push-Location $backendDir
try {
    $meta = cargo metadata --format-version 1 --no-deps | ConvertFrom-Json
    $targetDir = $meta.target_directory
}
finally {
    Pop-Location
}
$exePath = Join-Path $targetDir "release\$exeName"
if (-not (Test-Path $exePath)) { throw "未找到产物: $exePath" }

Write-Host "[2/4] 组织分发目录..." -ForegroundColor Cyan
$stageDir = Join-Path $repoRoot "$OutDir\cook-db-backend"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageDir "config") | Out-Null

Copy-Item $exePath (Join-Path $stageDir $exeName)
Copy-Item (Join-Path $backendDir "config\app.json") (Join-Path $stageDir "config\app.json")

if ($IncludeExtension) {
    $extSrc = Join-Path $repoRoot "extension"
    if (Test-Path $extSrc) {
        Copy-Item $extSrc (Join-Path $stageDir "extension") -Recurse
        Write-Host "    已包含 extension" -ForegroundColor DarkGray
    }
}

Write-Host "[3/4] 生成启动脚本与说明..." -ForegroundColor Cyan
$startBat = @"
@echo off
rem 在 exe 所在目录启动，确保能读到 config\app.json
cd /d "%~dp0"
set RUST_LOG=cook_db=info,tower_http=info,sqlx=warn
"%~dp0$exeName"
pause
"@
Set-Content -Path (Join-Path $stageDir "start-backend.bat") -Value $startBat -Encoding ASCII

$readme = @"
cook-db 后端 - 离线运行包
==========================

运行环境
  - Windows x64（与编译机同架构）
  - 无需安装 Rust 或联网；CRT 已静态链接，无需 VC++ 运行库

启动
  双击 start-backend.bat，或在本目录执行：
      cook-db.exe
  默认监听 config\app.json 中配置的地址（默认 127.0.0.1:8642）。

目录说明
  cook-db.exe        后端可执行文件
  config\app.json    监听地址/端口配置
  start-backend.bat  启动脚本（自动切到本目录后运行）
  extension\         （可选）Chrome MV3 扩展，浏览器"加载已解压的扩展"指向此目录

注意
  - exe 必须能在当前工作目录读到 config\app.json，务必用 start-backend.bat
    或先 cd 到本目录再运行。
  - 若要对外网机器开放，请把 config\app.json 的 host 改为 0.0.0.0。
  - MySQL 大文件导入默认使用内置高速导入器，无需安装 mysql 客户端。
"@
Set-Content -Path (Join-Path $stageDir "README.txt") -Value $readme -Encoding UTF8

Write-Host "[4/4] 压缩为 zip..." -ForegroundColor Cyan
$zipPath = Join-Path $repoRoot "$OutDir\cook-db-backend.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $stageDir -DestinationPath $zipPath

$exeSize = "{0:N1} MB" -f ((Get-Item (Join-Path $stageDir $exeName)).Length / 1MB)
Write-Host ""
Write-Host "完成！" -ForegroundColor Green
Write-Host "  目录: $stageDir"
Write-Host "  压缩: $zipPath"
Write-Host "  exe大小: $exeSize"
Write-Host ""
Write-Host "把 zip 拷到内网机器解压，运行 start-backend.bat 即可。" -ForegroundColor Yellow
