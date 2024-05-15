# LuminaryWorks — 批量更新本地 git remote
# Usage: .\scripts\update-git-remotes.ps1 [-WhatIf]
#        pwsh scripts/update-git-remotes.ps1

param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib\workspace.ps1"

function Find-GitRoot {
  param([string]$Start)
  if (Test-Path (Join-Path $Start ".git")) { return $Start }
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
  if ($current -and ($current -ieq $NewUrl)) {
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

Write-Host "=== Update git remotes (workspace=$script:LwWorkspaceRoot) ===" -ForegroundColor Cyan

foreach ($m in $script:LwProductRepos) {
  $url = "git@github.com:$($m.Org)/$($m.Repo).git"
  Set-RemoteIfNeeded -RepoPath (Get-ProductDir $m.Dir) -NewUrl $url
}

foreach ($sub in @("docs", "identity", "shared")) {
  $p = Join-Path $script:LwMetaRoot $sub
  if (Test-Path (Join-Path $p ".git")) {
    Set-RemoteIfNeeded -RepoPath $p -NewUrl "git@github.com:LuminaryWorks/$sub.git"
  }
}

$doerRoot = Join-Path (Get-ProductDir "DoerFlow") "repos"
if (Test-Path $doerRoot) {
  Get-ChildItem $doerRoot -Directory | ForEach-Object {
    if (Test-Path (Join-Path $_.FullName ".git")) {
      Set-RemoteIfNeeded -RepoPath $_.FullName -NewUrl "git@github.com:DoerFlow/$($_.Name).git"
    }
  }
}

$vrRoot = Get-ProductDir "VistaRemote"
$manifest = Join-Path $vrRoot ".meta/manifest.json"
if (Test-Path $manifest) {
  $m = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($prop in $m.projects.PSObject.Properties) {
    $path = Join-Path $vrRoot $prop.Value.path
    if ($prop.Value.remote) {
      Set-RemoteIfNeeded -RepoPath $path -NewUrl $prop.Value.remote
    }
  }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Yellow
