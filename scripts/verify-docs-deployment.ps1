# Verify {org}/docs GitHub Pages + Cloudflare CNAME for docs.{domain}
# Usage:
#   .\scripts\verify-docs-deployment.ps1
#   .\scripts\verify-docs-deployment.ps1 -CheckHttp   # also curl docs hosts

param(
  [switch]$CheckHttp,
  [string]$CfApiToken = $env:CF_API_TOKEN
)

$ErrorActionPreference = "Continue"
. "$PSScriptRoot\docs-sites.config.ps1"

$CfBase = "https://api.cloudflare.com/client/v4"
$allOk = $true

function Test-DnsCname {
  param(
    [string]$DocsHost,
    [string]$ExpectedTarget
  )
  if (-not $env:CF_API_TOKEN) {
    return $null
  }
  try {
    $domain = ($DocsHost -split '\.', 2)[1]
    $headers = @{ Authorization = "Bearer $env:CF_API_TOKEN" }
    $zones = Invoke-RestMethod -Uri "$CfBase/zones?name=$domain" -Headers $headers
    if ($zones.result.Count -eq 0) { return $false }
    $zoneId = $zones.result[0].id
    $q = [uri]::EscapeDataString($DocsHost)
    $recs = Invoke-RestMethod -Uri "$CfBase/zones/$zoneId/dns_records?type=CNAME&name=$q" -Headers $headers
    if ($recs.result.Count -eq 0) { return $false }
    $r = $recs.result[0]
    return ($r.content -eq $ExpectedTarget -and $r.proxied -eq $false)
  } catch {
    return $false
  }
}

Write-Host "=== Docs deployment verification ===" -ForegroundColor Cyan
Write-Host ("{0,-14} {1,-28} {2,-6} {3,-6} {4,-6} {5}" -f "Org", "Docs URL", "Repo", "Pages", "Domain", "DNS")
Write-Host ("-" * 90)

foreach ($site in $script:DocsSites) {
  $org = $site.Org
  $docsHost = Get-DocsHost -Domain $site.Domain
  $cnameTarget = Get-GithubPagesCname -Org $org
  $repo = "$org/docs"

  $repoOk = $false
  gh repo view $repo --json name 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $repoOk = $true }

  $pagesOk = $false
  $domainOk = $false
  if ($repoOk) {
    $pages = gh api "repos/$repo/pages" 2>$null
    if ($LASTEXITCODE -eq 0) {
      $pagesOk = $true
      $domains = gh api "repos/$repo/pages/domains" --jq '.[].name' 2>$null
      if ($domains -contains $docsHost) { $domainOk = $true }
    }
  }

  $dnsOk = Test-DnsCname -DocsHost $docsHost -ExpectedTarget $cnameTarget
  $dnsLabel = if ($null -eq $dnsOk) { "n/a" } elseif ($dnsOk) { "yes" } else { "no" }

  $rowOk = $repoOk -and $pagesOk -and $domainOk
  if ($env:CF_API_TOKEN) { $rowOk = $rowOk -and $dnsOk }
  if (-not $rowOk) { $allOk = $false }

  Write-Host ("{0,-14} {1,-28} {2,-6} {3,-6} {4,-6} {5}" -f `
    $org, `
    $docsHost, `
    $(if ($repoOk) { "yes" } else { "no" }), `
    $(if ($pagesOk) { "yes" } else { "no" }), `
    $(if ($domainOk) { "yes" } else { "no" }), `
    $dnsLabel)
}

if ($CheckHttp) {
  Write-Host ""
  Write-Host "HTTP checks:" -ForegroundColor Cyan
  foreach ($site in $script:DocsSites) {
    $docsHost = Get-DocsHost -Domain $site.Domain
    $url = "https://$docsHost/"
    try {
      $resp = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 15 -MaximumRedirection 5
      Write-Host ("  {0} → {1}" -f $docsHost, $resp.StatusCode) -ForegroundColor Green
    } catch {
      Write-Host ("  {0} → FAIL ({1})" -f $docsHost, $_.Exception.Message) -ForegroundColor Red
      $allOk = $false
    }
  }
}

Write-Host ""
if ($allOk) {
  Write-Host "All verified." -ForegroundColor Green
  exit 0
}

Write-Host "Not complete. Run:" -ForegroundColor Yellow
Write-Host "  .\scripts\setup-docs-all.ps1"
Write-Host "  .\scripts\verify-docs-deployment.ps1 -CheckHttp"
exit 1
