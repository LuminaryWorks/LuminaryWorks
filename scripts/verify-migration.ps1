# Verify GitHub org rename + local remotes alignment
# Resolves {workspace} as parent of this MetaRepo.

$MetaRoot = Split-Path $PSScriptRoot -Parent
$Www = Split-Path $MetaRoot -Parent

$checks = @(
  @{ Org = "dataluminary"; Remote = "git@github.com:dataluminary/DataLuminary-Platform.git"; Path = (Join-Path $Www "dataluminary"); Repo = "DataLuminary-Platform"; Required = $true },
  @{ Org = "blockyedu";    Remote = "git@github.com:blockyedu/VibeEdu.git";                   Path = (Join-Path $Www "blockyedu");    Repo = "VibeEdu"; Required = $true },
  @{ Org = "doerflow";     Remote = "git@github.com:doerflow/VibeAgent.git";                Path = (Join-Path $Www "doerflow");     Repo = "VibeAgent"; Required = $true },
  @{ Org = "VistaRemote";  Remote = "git@github.com:VistaRemote/vibeCode.git";              Path = (Join-Path $Www "vistaremote");  Repo = "vibeCode"; Required = $true },
  @{ Org = "VistaCast";     Remote = "git@github.com:VistaCast/vistacast.git";               Path = (Join-Path $Www "vistacast");     Repo = "vistacast"; Required = $false },
  @{ Org = "syncrobrain";  Remote = "git@github.com:syncrobrain/LuminaryIoTChain.git";       Path = (Join-Path $Www "syncrobrain");  Repo = "LuminaryIoTChain"; Required = $true }
)

# VistaCast: docs-only MetaRepo (no implementation subrepos yet)
$optional = @(
  @{ Org = "VistaCast"; Path = (Join-Path $Www "vistacast"); Note = "docs/spec MetaRepo — VistaCast/vistacast" }
)

function Find-GitRoot([string]$Start) {
  if (-not (Test-Path $Start)) { return $null }
  if (Test-Path "$Start\.git") { return $Start }
  $c = Get-ChildItem $Start -Directory -EA SilentlyContinue | Where-Object { Test-Path "$($_.FullName)\.git" }
  if ($c.Count -eq 1) { return $c[0].FullName }
  return $null
}

Write-Host "=== Migration verification (workspace=$Www) ===" -ForegroundColor Cyan
$allOk = $true

foreach ($c in $checks) {
  $orgOk = $false
  $null = gh api "orgs/$($c.Org)" --jq '.login' 2>$null
  if ($LASTEXITCODE -eq 0) { $orgOk = $true }

  $gitRoot = Find-GitRoot $c.Path
  $remoteOk = $false
  $cur = $null
  if ($gitRoot) {
    $cur = git -C $gitRoot remote get-url origin 2>$null
    $remoteOk = [string]::Equals($cur, $c.Remote, [StringComparison]::Ordinal)
  }

  $pathOk = $null -ne $gitRoot
  $status = if ($orgOk -and $remoteOk -and $pathOk) { "OK" } else { "PENDING"; $allOk = $false }
  $color = if ($status -eq "OK") { "Green" } else { "Yellow" }
  Write-Host "[$status] $($c.Org) ($($c.Path))" -ForegroundColor $color
  if (-not $orgOk) { Write-Host "  GitHub org missing" -ForegroundColor DarkYellow }
  if (-not $pathOk) { Write-Host "  local path missing" -ForegroundColor DarkYellow }
  if (-not $remoteOk) { Write-Host "  remote: $cur want: $($c.Remote)" -ForegroundColor DarkYellow }
}

foreach ($o in $optional) {
  $exists = Test-Path $o.Path
  Write-Host "[INFO] $($o.Org) ($($o.Path)) exists=$exists — $($o.Note)" -ForegroundColor DarkGray
}

if ($allOk) { exit 0 }
exit 1
