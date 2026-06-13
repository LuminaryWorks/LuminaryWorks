# LuminaryWorks — Cloudflare DNS: docs.{domain} CNAME → {org}.github.io
# Usage:
#   $env:CF_API_TOKEN = '<cloudflare-dns-token>'
#   .\scripts\setup-cloudflare-docs-dns.ps1 [-WhatIf] [-Skip dataluminary] [-Only vistacast]
#
# Token needs Zone:DNS:Edit on all six apex zones.
# GitHub Pages requires DNS-only (proxied=false) for automatic HTTPS.

param(
  [switch]$WhatIf,
  [string[]]$Skip = @(),
  [string[]]$Only = @(),
  [string]$CfApiToken = $env:CF_API_TOKEN
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\docs-sites.config.ps1"

$CfBase = "https://api.cloudflare.com/client/v4"

function Get-CfHeaders {
  param([string]$Token)
  @{
    Authorization = "Bearer $Token"
    "Content-Type" = "application/json"
  }
}

function Test-CfToken {
  param([string]$Token)
  if (-not $Token) {
    Write-Host "CF_API_TOKEN not set. Example:" -ForegroundColor Red
    Write-Host '  $env:CF_API_TOKEN = "cfut_..."' -ForegroundColor Yellow
    Write-Host "  .\scripts\setup-cloudflare-docs-dns.ps1"
    exit 1
  }

  $resp = Invoke-RestMethod -Uri "$CfBase/user/tokens/verify" -Headers (Get-CfHeaders $Token) -Method Get
  if (-not $resp.success) {
    throw "Cloudflare token verify failed"
  }
  Write-Host "Cloudflare token OK (status: $($resp.result.status))" -ForegroundColor Green
}

function Get-CfZoneId {
  param(
    [string]$Token,
    [string]$Domain
  )
  $uri = "$CfBase/zones?name=$Domain"
  $resp = Invoke-RestMethod -Uri $uri -Headers (Get-CfHeaders $Token) -Method Get
  if (-not $resp.success -or $resp.result.Count -eq 0) {
    throw "Zone not found in Cloudflare account: $Domain"
  }
  return $resp.result[0].id
}

function Get-CfDnsRecord {
  param(
    [string]$Token,
    [string]$ZoneId,
    [string]$Name,
    [string]$Type = "CNAME"
  )
  $q = [uri]::EscapeDataString($Name)
  $uri = "$CfBase/zones/$ZoneId/dns_records?type=$Type&name=$q"
  $resp = Invoke-RestMethod -Uri $uri -Headers (Get-CfHeaders $Token) -Method Get
  if (-not $resp.success) {
    throw "Failed to list DNS records for $Name"
  }
  if ($resp.result.Count -eq 0) { return $null }
  return $resp.result[0]
}

function Set-CfDocsCname {
  param(
    [hashtable]$Site,
    [string]$Token
  )

  $domain = $Site.Domain
  $docsHost = Get-DocsHost -Domain $domain
  $target = Get-GithubPagesCname -Org $Site.Org

  Write-Host ""
  Write-Host "=== $docsHost → $target ===" -ForegroundColor Cyan

  if ($WhatIf) {
    Write-Host "[WhatIf] CNAME docs.$domain → $target (proxied=false)" -ForegroundColor Cyan
    return "whatif"
  }

  $zoneId = Get-CfZoneId -Token $Token -Domain $domain
  $existing = Get-CfDnsRecord -Token $Token -ZoneId $zoneId -Name $docsHost -Type "CNAME"

  $body = @{
    type    = "CNAME"
    name    = "docs"
    content = $target
    ttl     = 1
    proxied = $false
  }

  if ($existing) {
    if ($existing.content -eq $target -and $existing.proxied -eq $false) {
      Write-Host "  already correct" -ForegroundColor DarkGray
      return "unchanged"
    }
    $uri = "$CfBase/zones/$zoneId/dns_records/$($existing.id)"
    $resp = Invoke-RestMethod -Uri $uri -Headers (Get-CfHeaders $Token) -Method Put -Body ($body | ConvertTo-Json)
    if (-not $resp.success) { throw "Failed to update CNAME for $docsHost" }
    Write-Host "  updated CNAME" -ForegroundColor Green
    return "updated"
  }

  $uri = "$CfBase/zones/$zoneId/dns_records"
  $resp = Invoke-RestMethod -Uri $uri -Headers (Get-CfHeaders $Token) -Method Post -Body ($body | ConvertTo-Json)
  if (-not $resp.success) { throw "Failed to create CNAME for $docsHost" }
  Write-Host "  created CNAME" -ForegroundColor Green
  return "created"
}

Write-Host "=== LuminaryWorks Cloudflare docs DNS ===" -ForegroundColor Cyan
Test-CfToken -Token $CfApiToken

$sites = $script:DocsSites
if ($Only.Count -gt 0) {
  $sites = $sites | Where-Object { $Only -contains $_.Org -or $Only -contains $_.Brand }
}
if ($Skip.Count -gt 0) {
  $sites = $sites | Where-Object { $Skip -notcontains $_.Org -and $Skip -notcontains $_.Brand }
}

$results = @{}
foreach ($site in $sites) {
  try {
    $results[$site.Org] = Set-CfDocsCname -Site $site -Token $CfApiToken
  } catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $results[$site.Org] = "failed"
  }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$results.GetEnumerator() | Sort-Object Name | ForEach-Object {
  Write-Host ("  {0,-14} {1}" -f $_.Key, $_.Value)
}

Write-Host ""
Write-Host "DNS propagation + GitHub Pages cert may take up to 24h." -ForegroundColor Yellow
Write-Host "Verify: .\scripts\verify-docs-deployment.ps1"
