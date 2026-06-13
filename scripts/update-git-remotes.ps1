# LuminaryWorks — 批量更新本地 git remote（组织 rename 后执行）
# Usage: .\scripts\update-git-remotes.ps1 [-WhatIf]

param([switch]$WhatIf)

$ErrorActionPreference = "Stop"

# Phase C 本地路径（见 spec/local-paths.md）
$metaRepos = @(
  @{
    Path   = "D:\www\dataluminary"
    NewOrg = "dataluminary"
    Repo   = "DataLuminary-Platform"
  },
  @{
    Path   = "D:\www\blockyedu"
    NewOrg = "blockyedu"
    Repo   = "VibeEdu"
  },
  @{
    Path   = "D:\www\doerflow"
    NewOrg = "doerflow"
    Repo   = "VibeAgent"
  },
  @{
    Path   = "D:\www\vistaremote"
    NewOrg = "VistaRemote"
    Repo   = "vibeCode"
  },
  @{
    Path   = "D:\www\syncrobrain"
    NewOrg = "syncrobrain"
    Repo   = "LuminaryIoTChain"
  }
)

function Find-GitRoot {
  param([string]$Start)
  if (Test-Path "$Start\.git") { return $Start }
  $children = Get-ChildItem $Start -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName ".git") }
  if ($children.Count -eq 1) { return $children[0].FullName }
  return $null
}

function Set-RemoteIfNeeded {
  param(
    [string]$RepoPath,
    [string]$NewUrl
  )

  if (-not (Test-Path $RepoPath)) {
    Write-Host "skip (missing): $RepoPath" -ForegroundColor DarkGray
    return
  }

  $gitRoot = Find-GitRoot $RepoPath
  if (-not $gitRoot) {
    Write-Host "skip (no .git): $RepoPath" -ForegroundColor DarkGray
    return
  }

  $current = git -C $gitRoot remote get-url origin 2>$null
  if ([string]::Equals($current, $NewUrl, [StringComparison]::Ordinal)) {
    Write-Host "= unchanged: $gitRoot"
    return
  }

  if ($WhatIf) {
    Write-Host "[WhatIf] $gitRoot" -ForegroundColor Cyan
    Write-Host "  $current" -ForegroundColor DarkGray
    Write-Host "  -> $NewUrl" -ForegroundColor Green
    return
  }

  git -C $gitRoot remote set-url origin $NewUrl
  Write-Host "OK: $gitRoot -> $NewUrl" -ForegroundColor Green
}

Write-Host "=== Update git remotes ===" -ForegroundColor Cyan

foreach ($m in $metaRepos) {
  $url = "git@github.com:$($m.NewOrg)/$($m.Repo).git"
  Set-RemoteIfNeeded -RepoPath $m.Path -NewUrl $url
}

$lwRoot = Split-Path $PSScriptRoot -Parent
foreach ($sub in @("docs", "identity", "shared")) {
  $p = Join-Path $lwRoot $sub
  if (Test-Path "$p\.git") {
    Set-RemoteIfNeeded -RepoPath $p -NewUrl "git@github.com:LuminaryWorks/$sub.git"
  }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Yellow
