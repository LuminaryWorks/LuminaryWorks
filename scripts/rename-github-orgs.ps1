# LuminaryWorks - GitHub org rename (align org login with domain)
# Usage: .\scripts\rename-github-orgs.ps1 [-WhatIf] [-Skip dataluminary,blockyedu] [-Force]
#
# Requires: gh auth refresh -h github.com -s admin:org

param(
  [switch]$WhatIf,
  [string[]]$Skip = @(),
  [switch]$Force,
  [switch]$SkipAuthCheck
)

$ErrorActionPreference = "Stop"

$migrations = @(
  @{ Current = "DataLuminary";     Target = "dataluminary" },
  @{ Current = "blockyEdu";        Target = "blockyedu" },
  @{ Current = "AgentSkillMesh";   Target = "doerflow" },
  @{ Current = "VistaRemote";      Target = "vistacast" },
  @{ Current = "LuminaryIoTChain"; Target = "syncrobrain" }
)

function Test-GhAuth {
  $status = gh auth status 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Run: gh auth login -h github.com" -ForegroundColor Red
    exit 1
  }
  if (-not $SkipAuthCheck -and $status -notmatch 'admin:org') {
    Write-Host "Missing admin:org scope. Run:" -ForegroundColor Red
    Write-Host "  gh auth refresh -h github.com -s admin:org" -ForegroundColor Yellow
    Write-Host "Or rename manually: spec/github-org-migration.md section 2.1" -ForegroundColor Yellow
    exit 1
  }
  if ($SkipAuthCheck) {
    Write-Host "SkipAuthCheck: attempting rename without admin:org verification" -ForegroundColor Yellow
  } else {
    Write-Host "gh auth OK (admin:org present)" -ForegroundColor Green
  }
}

function Get-OrgId {
  param([string]$Name)
  $id = gh api "orgs/$Name" --jq '.id' 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return $id
}

function Test-OrgExists {
  param([string]$Name)
  gh api "orgs/$Name" 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Rename-Org {
  param(
    [string]$Current,
    [string]$Target
  )

  if ($Skip -contains $Target -or $Skip -contains $Current) {
    Write-Host "skip $Current -> $Target" -ForegroundColor DarkGray
    return "skipped"
  }

  $idA = Get-OrgId $Current
  $idB = Get-OrgId $Target
  if ($idA -and $idB -and ($idA -eq $idB)) {
    Write-Host "alias OK: $Current same as $Target (case-only)" -ForegroundColor Green
    return "alias"
  }

  if (-not (Test-OrgExists -Name $Current)) {
    if (Test-OrgExists -Name $Target) {
      Write-Host "done: $Target exists" -ForegroundColor Green
      return "done"
    }
    Write-Host "missing: $Current" -ForegroundColor Red
    return "missing"
  }

  if (Test-OrgExists -Name $Target) {
    Write-Host "conflict: $Target already taken" -ForegroundColor Red
    return "conflict"
  }

  if ($WhatIf) {
    Write-Host "[WhatIf] PATCH orgs/$Current login=$Target" -ForegroundColor Cyan
    return "whatif"
  }

  if (-not $Force) {
    $confirm = Read-Host "Rename $Current to $Target ? [y/N]"
    if ($confirm -notmatch '^[yY]') {
      return "cancelled"
    }
  }

  Write-Host "Renaming $Current -> $Target ..."
  $result = gh api -X PATCH "orgs/$Current" -f "login=$Target" --jq '.login'
  if ($LASTEXITCODE -ne 0) {
    Write-Host "failed: $Current" -ForegroundColor Red
    return "failed"
  }
  if ($result -ne $Target) {
    Write-Host "unexpected login=$result want=$Target" -ForegroundColor Red
    return "failed"
  }
  Write-Host "OK: $Current -> $Target" -ForegroundColor Green
  return "ok"
}

Write-Host "=== LuminaryWorks GitHub Org Rename ===" -ForegroundColor Cyan
Test-GhAuth

$results = @{}
foreach ($m in $migrations) {
  Write-Host ""
  $results[$m.Target] = Rename-Org -Current $m.Current -Target $m.Target
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$results.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }

$ok = @($results.Values | Where-Object { $_ -in @('ok', 'done', 'alias') }).Count
if ($ok -gt 0 -and -not $WhatIf) {
  Write-Host ""
  Write-Host 'Next: .\scripts\update-git-remotes.ps1' -ForegroundColor Yellow
}
