# Open GitHub org rename settings (manual Phase A)
# Use when gh token lacks admin:org scope.
# After rename in browser, run: .\scripts\verify-migration.ps1

$renames = @(
  @{ Current = "AgentSkillMesh";   Target = "doerflow";      Url = "https://github.com/organizations/AgentSkillMesh/settings/profile" },
  @{ Current = "VistaRemote";      Target = "vistacast";     Url = "https://github.com/organizations/VistaRemote/settings/profile" },
  @{ Current = "LuminaryIoTChain"; Target = "syncrobrain";   Url = "https://github.com/organizations/LuminaryIoTChain/settings/profile" }
)

Write-Host "=== Manual org rename (GitHub Settings) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "For each org: Profile -> Change organization name -> enter target name" -ForegroundColor Yellow
Write-Host ""

foreach ($r in $renames) {
  $exists = gh api "orgs/$($r.Target)" --jq '.login' 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[done] $($r.Target) already exists as $exists" -ForegroundColor Green
    continue
  }
  Write-Host "$($r.Current) -> $($r.Target)" -ForegroundColor White
  Write-Host "  $($r.Url)" -ForegroundColor DarkGray
  Start-Process $r.Url
}

Write-Host ""
Write-Host "After all three renames, run:" -ForegroundColor Yellow
Write-Host "  .\scripts\verify-migration.ps1" -ForegroundColor Yellow
Write-Host "  .\scripts\migrate-all.ps1 -RemotesOnly" -ForegroundColor Yellow
