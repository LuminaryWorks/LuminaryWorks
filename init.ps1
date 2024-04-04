# LuminaryWorks MetaRepo — 克隆子仓到嵌套目录
# Usage: .\init.ps1
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Org = "git@github.com:LuminaryWorks"

$repos = @(
  @{ name = "docs";     path = "docs" },
  @{ name = "identity"; path = "identity" },
  @{ name = "shared";   path = "shared" }
)

foreach ($r in $repos) {
  $dest = Join-Path $Root $r.path
  if (Test-Path (Join-Path $dest ".git")) {
    Write-Host "= $($r.name) already cloned at $($r.path)/"
    continue
  }
  Write-Host "+ cloning $($r.name) -> $($r.path)/"
  git clone "$Org/$($r.name).git" $dest
}

Write-Host "`nDone. Next: pnpm bootstrap"
