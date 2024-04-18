# Verify {org}/docs GitHub Pages + Cloudflare DNS
# Usage:
#   .\scripts\verify-docs-deployment.ps1 [-Only LuminaryWorks] [-CheckHttp]

param(
  [switch]$CheckHttp,
  [string[]]$Only = @(),
  [string]$CfApiToken = $env:CF_API_TOKEN
)

$ErrorActionPreference = "Continue"
. "$PSScriptRoot\docs-sites.config.ps1"

$CfBase = "https://api.cloudflare.com/client/v4"
$allOk = $true

function Test-CfCname {
  param(
    [string]$Fqdn,
    [string]$ExpectedTarget,
    [bool]$ExpectProxied = $true
  )
  if (-not $env:CF_API_TOKEN) { return $null }
  try {
    $domain = if ($Fqdn -match '^[^.]+\.(.+)$') { $Matches[1] } else { $Fqdn }
    $headers = @{ Authorization = "Bearer $env:CF_API_TOKEN" }
    $zoneId = (Invoke-RestMethod -Uri "$CfBase/zones?name=$domain" -Headers $headers).result[0].id
    $q = [uri]::EscapeDataString($Fqdn)
    $recs = Invoke-RestMethod -Uri "$CfBase/zones/$zoneId/dns_records?type=CNAME&name=$q" -Headers $headers
    if ($recs.result.Count -eq 0) { return $false }
    $r = $recs.result[0]
    return ($r.content -eq $ExpectedTarget -and $r.proxied -eq $ExpectProxied)
  } catch {
    return $false
  }
}

$sites = $script:DocsSites
if ($Only.Count -gt 0) {
  $sites = $sites | Where-Object { $Only -contains $_.Org -or $Only -contains $_.Brand }
}

Write-Host "=== Site deployment verification ===" -ForegroundColor Cyan
Write-Host ("{0,-14} {1,-28} {2,-6} {3,-6} {4,-6} {5}" -f "Org", "Site URL", "Repo", "Pages", "Domain", "DNS")
Write-Host ("-" * 90)

foreach ($site in $sites) {
  $org = $site.Org
  $siteHost = Get-SiteHost -Site $site
  $cnameTarget = Get-GithubPagesCname -Org $org
  $repo = "$org/docs"

  $repoOk = $false
  gh repo view $repo --json name 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $repoOk = $true }

  $pagesOk = $false
  $domainOk = $false
  if ($repoOk) {
    gh api "repos/$repo/pages" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $pagesOk = $true
      $cname = gh api "repos/$repo/pages" --jq '.cname' 2>$null
      if ($cname -eq $siteHost) { $domainOk = $true }
    }
  }

  $dnsOk = $false
  if (Test-SiteUsesApex -Site $site) {
    $dnsOk = Test-CfCname -Fqdn $site.Domain -ExpectedTarget $cnameTarget
  } else {
    $dnsOk = Test-CfCname -Fqdn $siteHost -ExpectedTarget $cnameTarget
  }
  $dnsLabel = if ($null -eq $dnsOk) { "n/a" } elseif ($dnsOk) { "yes" } else { "no" }

  $rowOk = $repoOk -and $pagesOk -and $domainOk
  if ($env:CF_API_TOKEN) { $rowOk = $rowOk -and $dnsOk }
  if (-not $rowOk) { $allOk = $false }

  Write-Host ("{0,-14} {1,-28} {2,-6} {3,-6} {4,-6} {5}" -f `
    $org, $siteHost, `
    $(if ($repoOk) { "yes" } else { "no" }), `
    $(if ($pagesOk) { "yes" } else { "no" }), `
    $(if ($domainOk) { "yes" } else { "no" }), `
    $dnsLabel)
}

if ($CheckHttp) {
  Write-Host ""
  Write-Host "HTTP checks:" -ForegroundColor Cyan
  foreach ($site in $sites) {
    $siteHost = Get-SiteHost -Site $site
    $url = "https://$siteHost/"
    try {
      $resp = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 20 -MaximumRedirection 5
      Write-Host ("  {0} -> {1}" -f $siteHost, $resp.StatusCode) -ForegroundColor Green
    } catch {
      Write-Host ("  {0} -> FAIL ({1})" -f $siteHost, $_.Exception.Message) -ForegroundColor Red
      $allOk = $false
    }

    if (Test-SiteUsesApex -Site $site -and $site.RedirectLegacyDocs) {
      $legacy = Get-LegacyDocsHost -Site $site
      try {
        $r = Invoke-WebRequest -Uri "https://$legacy/" -Method Head -TimeoutSec 20 -MaximumRedirection 0 -ErrorAction Stop
      } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 301 -or $_.Exception.Response.StatusCode.value__ -eq 302) {
          $loc = $_.Exception.Response.Headers.Location
          Write-Host ("  {0} -> {1} -> {2}" -f $legacy, $_.Exception.Response.StatusCode.value__, $loc) -ForegroundColor Green
        } else {
          Write-Host ("  {0} -> FAIL ({1})" -f $legacy, $_.Exception.Message) -ForegroundColor Red
          $allOk = $false
        }
      }
    }
  }
}

Write-Host ""
if ($allOk) {
  Write-Host "All verified." -ForegroundColor Green
  exit 0
}

Write-Host "Not complete. Run:" -ForegroundColor Yellow
Write-Host "  .\scripts\setup-docs-all.ps1 -Only LuminaryWorks"
exit 1
