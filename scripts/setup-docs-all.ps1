# LuminaryWorks — bootstrap docs repos + Cloudflare DNS (orchestrator)
# Usage:
#   .\scripts\setup-docs-all.ps1 [-WhatIf]
#   .\scripts\setup-docs-all.ps1 -GithubOnly
#   .\scripts\setup-docs-all.ps1 -DnsOnly
#
# Prerequisites:
#   gh auth login
#   $env:CF_API_TOKEN = '<cloudflare-dns-token>'   (for DNS step)

param(
  [switch]$WhatIf,
  [switch]$Force,
  [switch]$GithubOnly,
  [switch]$DnsOnly,
  [string[]]$Skip = @(),
  [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"

Write-Host "=== LuminaryWorks setup-docs-all ===" -ForegroundColor Cyan

$common = @{
  WhatIf = $WhatIf
  Skip   = $Skip
  Only   = $Only
}

if (-not $DnsOnly) {
  $ghArgs = @{ Force = $Force }
  foreach ($k in $common.Keys) { $ghArgs[$k] = $common[$k] }
  & "$PSScriptRoot\setup-github-docs.ps1" @ghArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $GithubOnly) {
  if (-not $env:CF_API_TOKEN -and -not $WhatIf) {
    Write-Host ""
    Write-Host "Skipping DNS: CF_API_TOKEN not set." -ForegroundColor Yellow
    Write-Host '  $env:CF_API_TOKEN = "cfut_..."; .\scripts\setup-cloudflare-docs-dns.ps1'
    exit 0
  }
  & "$PSScriptRoot\setup-cloudflare-docs-dns.ps1" @common
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "setup-docs-all complete" -ForegroundColor Green
