# LuminaryWorks — 一键组织迁移 + 更新 remote
# Usage: .\scripts\migrate-all.ps1 [-WhatIf]
#
# 1. 检查 gh auth（含 admin:org）
# 2. rename 组织（跳过大小写等价项）
# 3. 更新六产品 MetaRepo origin（VistaRemote 远程桌面）
# 4. 更新 DoerFlow / VistaRemote 子仓 origin（若已 clone）

param(
  [switch]$WhatIf,
  [switch]$RemotesOnly,
  [switch]$SkipAuthCheck
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "=== LuminaryWorks migrate-all ===" -ForegroundColor Cyan

if ($WhatIf) {
  if (-not $RemotesOnly) {
    & "$PSScriptRoot\rename-github-orgs.ps1" -WhatIf
  }
  & "$PSScriptRoot\update-git-remotes.ps1" -WhatIf
  exit 0
}

if (-not $RemotesOnly) {
  $renameArgs = @{ Force = $true }
  if ($SkipAuthCheck) { $renameArgs.SkipAuthCheck = $true }
  & "$PSScriptRoot\rename-github-orgs.ps1" @renameArgs
}
& "$PSScriptRoot\update-git-remotes.ps1"

# DoerFlow 子仓
$doerRoot = "D:\www\doerflow\repos"
if (Test-Path $doerRoot) {
  Get-ChildItem $doerRoot -Directory | ForEach-Object {
    $name = $_.Name
    if (Test-Path "$($_.FullName)\.git") {
      $url = "git@github.com:doerflow/$name.git"
      git -C $_.FullName remote set-url origin $url 2>$null
      Write-Host "✓ doerflow/$name remote" -ForegroundColor Green
    }
  }
}

# VistaRemote 子仓（远程桌面 MetaRepo）
$manifest = "D:\www\vistaremote\.meta\manifest.json"
if (Test-Path $manifest) {
  $m = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($prop in $m.projects.PSObject.Properties) {
    $path = Join-Path "D:\www\vistaremote" $prop.Value.path
    if (Test-Path "$path\.git") {
      $remote = $prop.Value.remote
      git -C $path remote set-url origin $remote 2>$null
      Write-Host "✓ VistaRemote/$($prop.Name) remote" -ForegroundColor Green
    }
  }
}

Write-Host ""
Write-Host "✓ migrate-all complete" -ForegroundColor Green
Write-Host "  更新 spec/github-org-migration.md §7 状态表" -ForegroundColor Yellow
