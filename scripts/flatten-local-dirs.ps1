# Flatten Phase C layout: {workspace}/{org}/{MetaRepo} -> {workspace}/{org}
# Remove duplicate copies under old parent folders.
# Usage: .\scripts\flatten-local-dirs.ps1 [-WhatIf]

param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
$MetaRoot = Split-Path $PSScriptRoot -Parent
$Www = Split-Path $MetaRoot -Parent

function Flatten-Repo {
  param(
    [string]$OrgRoot,
    [string]$NestedName
  )

  $nested = Join-Path $OrgRoot $NestedName
  if (-not (Test-Path "$nested\.git")) {
    if (Test-Path "$OrgRoot\.git") {
      Write-Host "already flat: $OrgRoot" -ForegroundColor Green
      return
    }
    Write-Host "skip (no git): $nested" -ForegroundColor Yellow
    return
  }

  $temp = Join-Path $env:TEMP "lw-flatten-$(Split-Path $OrgRoot -Leaf)"
  if ($WhatIf) {
    Write-Host "[WhatIf] flatten $nested -> $OrgRoot" -ForegroundColor Cyan
    return
  }

  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
  Move-Item -LiteralPath $nested -Destination $temp
  Get-ChildItem $OrgRoot -Force | Where-Object { $_.Name -notin '.', '..' } | Remove-Item -Recurse -Force
  Get-ChildItem $temp -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination $OrgRoot
  }
  Remove-Item $temp -Force -Recurse -ErrorAction SilentlyContinue
  Write-Host "flattened: $OrgRoot" -ForegroundColor Green
}

function Remove-Duplicate {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  if ($WhatIf) {
    Write-Host "[WhatIf] remove duplicate $Path" -ForegroundColor Cyan
    return
  }
  Remove-Item $Path -Recurse -Force
  Write-Host "removed duplicate: $Path" -ForegroundColor DarkGray
}

Write-Host "=== Flatten local MetaRepo paths (workspace=$Www) ===" -ForegroundColor Cyan

Flatten-Repo -OrgRoot (Join-Path $Www "dataluminary") -NestedName "DataLuminary-Platform"
Flatten-Repo -OrgRoot (Join-Path $Www "blockyedu") -NestedName "VibeEdu"

Remove-Duplicate (Join-Path $Www "DataLuminary\DataLuminary-Platform")
Remove-Duplicate (Join-Path $Www "BlockyEdu\VibeEdu")
Remove-Duplicate (Join-Path $Www "DataLuminary")
Remove-Duplicate (Join-Path $Www "BlockyEdu")

Write-Host "Done." -ForegroundColor Green
