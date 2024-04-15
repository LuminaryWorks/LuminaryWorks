# LuminaryWorks Phase C — rename local MetaRepo directories to match org/domain
# Usage: .\scripts\rename-local-dirs.ps1 [-WhatIf]

param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
$Www = "D:\www"

$moves = @(
  @{ From = "$Www\DataLuminary\DataLuminary-Platform"; To = "$Www\dataluminary" },
  @{ From = "$Www\BlockyEdu\VibeEdu";                 To = "$Www\blockyedu" },
  @{ From = "$Www\AgentSkillMesh\VibeAgent";           To = "$Www\doerflow" },
  @{ From = "$Www\VistaRemote";                        To = "$Www\vistacast" },
  @{ From = "$Www\LuminaryIoTChain";                  To = "$Www\syncrobrain" }
)

$removeAfter = @(
  "$Www\DataLuminary",
  "$Www\BlockyEdu",
  "$Www\AgentSkillMesh"
)

function Move-Dir {
  param([string]$From, [string]$To)
  if (-not (Test-Path $From)) {
    if (Test-Path $To) {
      Write-Host "skip (already moved): $To" -ForegroundColor DarkGray
      return
    }
    Write-Host "missing source: $From" -ForegroundColor Red
    return
  }
  if ((Resolve-Path $From).Path -eq (Resolve-Path $To -ErrorAction SilentlyContinue).Path) {
    Write-Host "same path: $To" -ForegroundColor DarkGray
    return
  }
  if (Test-Path $To) {
    $items = Get-ChildItem $To -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.' -and $_.Name -ne '..' }
    if ($items.Count -gt 0) {
      Write-Host "target not empty: $To" -ForegroundColor Red
      return
    }
    if ($WhatIf) {
      Write-Host "[WhatIf] remove empty $To" -ForegroundColor Cyan
    } else {
      Remove-Item $To -Force -Recurse
    }
  }
  if ($WhatIf) {
    Write-Host "[WhatIf] Move-Item $From -> $To" -ForegroundColor Cyan
  } else {
    Move-Item -LiteralPath $From -Destination $To
    Write-Host "OK: $From -> $To" -ForegroundColor Green
  }
}

Write-Host "=== Phase C: local directory rename ===" -ForegroundColor Cyan
foreach ($m in $moves) {
  Move-Dir -From $m.From -To $m.To
}

foreach ($d in $removeAfter) {
  if (-not (Test-Path $d)) { continue }
  $left = Get-ChildItem $d -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.' -and $_.Name -ne '..' }
  if ($left.Count -eq 0) {
    if ($WhatIf) {
      Write-Host "[WhatIf] Remove-Item empty $d" -ForegroundColor Cyan
    } else {
      Remove-Item $d -Force -Recurse
      Write-Host "removed empty: $d" -ForegroundColor DarkGray
    }
  } else {
    Write-Host "keep (not empty): $d" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Next: update scripts paths + docs site (done in repo)" -ForegroundColor Yellow
