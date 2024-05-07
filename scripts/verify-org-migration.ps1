# Verify GitHub org names match migration targets and local remotes
# Usage: .\scripts\verify-org-migration.ps1

$ErrorActionPreference = "Continue"
$MetaRoot = Split-Path $PSScriptRoot -Parent
$Www = Split-Path $MetaRoot -Parent

$expected = @(
  @{ Target = "dataluminary"; RemotePath = (Join-Path $Www "dataluminary"); Repo = "DataLuminary-Platform" },
  @{ Target = "blockyedu";    RemotePath = (Join-Path $Www "blockyedu");    Repo = "VibeEdu" },
  @{ Target = "doerflow";     RemotePath = (Join-Path $Www "doerflow");     Repo = "VibeAgent" },
  @{ Target = "VistaRemote";  RemotePath = (Join-Path $Www "vistaremote");  Repo = "vibeCode" },
  @{ Target = "syncrobrain";  RemotePath = (Join-Path $Www "syncrobrain");  Repo = "LuminaryIoTChain" }
)

function Find-GitRoot([string]$Start) {
  if (-not (Test-Path $Start)) { return $null }
  if (Test-Path "$Start\.git") { return $Start }
  $c = Get-ChildItem $Start -Directory -EA SilentlyContinue | Where-Object { Test-Path "$($_.FullName)\.git" }
  if ($c.Count -eq 1) { return $c[0].FullName }
  return $null
}

Write-Host "=== Org migration verification (workspace=$Www) ===" -ForegroundColor Cyan
$allOk = $true

foreach ($e in $expected) {
  $orgOk = $false
  $login = gh api "orgs/$($e.Target)" --jq '.login' 2>$null
  if ($LASTEXITCODE -eq 0) { $orgOk = ($login -eq $e.Target) }

  $gitRoot = Find-GitRoot $e.RemotePath
  $remoteOk = $false
  $want = "git@github.com:$($e.Target)/$($e.Repo).git"
  if ($gitRoot) {
    $cur = git -C $gitRoot remote get-url origin 2>$null
    $remoteOk = [string]::Equals($cur, $want, [StringComparison]::Ordinal)
  }

  $pathOk = $null -ne $gitRoot
  $status = if ($orgOk -and $remoteOk -and $pathOk) { "OK" } else { "PENDING"; $allOk = $false }
  Write-Host ("{0,-14} org={1,-5} remote={2,-5} path={3,-5}  {4}" -f $e.Target, $(if($orgOk){"yes"}else{"no"}), $(if($remoteOk){"yes"}else{"no"}), $(if($pathOk){"yes"}else{"no"}), $status)
}

Write-Host "[INFO] VistaCast ($(Join-Path $Www 'vistacast')) — docs/spec MetaRepo VistaCast/vistacast" -ForegroundColor DarkGray
Write-Host ""
if ($allOk) {
  Write-Host "All verified." -ForegroundColor Green
  exit 0
}
Write-Host "Not complete. Run .\scripts\update-git-remotes.ps1 or clone missing repos." -ForegroundColor Yellow
exit 1
