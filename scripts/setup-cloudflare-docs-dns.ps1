# LuminaryWorks — Cloudflare DNS for docs sites / apex marketing sites
# Usage:
#   $env:CF_API_TOKEN = '<token>'
#   .\scripts\setup-cloudflare-docs-dns.ps1 [-Only LuminaryWorks] [-Proxied]
#
# Host modes (docs-sites.config.ps1):
#   default  -> docs.{domain} CNAME -> {org}.github.io
#   apex     -> @ + www CNAME -> github.io; docs.{domain} 301 -> https://{domain}

param(
  [switch]$WhatIf,
  [switch]$Proxied,
  [switch]$DnsOnly,
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
    Write-Host "CF_API_TOKEN not set." -ForegroundColor Red
    exit 1
  }
  $resp = Invoke-RestMethod -Uri "$CfBase/user/tokens/verify" -Headers (Get-CfHeaders $Token) -Method Get
  if (-not $resp.success) { throw "Cloudflare token verify failed" }
  Write-Host "Cloudflare token OK (status: $($resp.result.status))" -ForegroundColor Green
}

function Get-CfZoneId {
  param([string]$Token, [string]$Domain)
  $resp = Invoke-RestMethod -Uri "$CfBase/zones?name=$Domain" -Headers (Get-CfHeaders $Token) -Method Get
  if (-not $resp.success -or $resp.result.Count -eq 0) {
    throw "Zone not found: $Domain"
  }
  return $resp.result[0].id
}

function Get-CfDnsRecord {
  param(
    [string]$Token,
    [string]$ZoneId,
    [string]$Name,
    [string]$Type
  )
  $q = [uri]::EscapeDataString($Name)
  $uri = "$CfBase/zones/$ZoneId/dns_records?type=$Type&name=$q"
  $resp = Invoke-RestMethod -Uri $uri -Headers (Get-CfHeaders $Token) -Method Get
  if (-not $resp.success) { throw "Failed to list DNS for $Name" }
  if ($resp.result.Count -eq 0) { return $null }
  return $resp.result[0]
}

function Set-CfCname {
  param(
    [string]$Token,
    [string]$ZoneId,
    [string]$Label,
    [string]$Fqdn,
    [string]$Target,
    [bool]$UseProxy,
    [switch]$WhatIf
  )

  $proxyLabel = if ($UseProxy) { "proxied" } else { "DNS only" }
  Write-Host "  CNAME $Label -> $Target ($proxyLabel)" -ForegroundColor DarkGray

  if ($WhatIf) { return "whatif" }

  $existing = Get-CfDnsRecord -Token $Token -ZoneId $ZoneId -Name $Fqdn -Type "CNAME"
  $body = @{
    type    = "CNAME"
    name    = $Label
    content = $Target
    ttl     = 1
    proxied = $UseProxy
  } | ConvertTo-Json

  if ($existing) {
    if ($existing.content -eq $Target -and $existing.proxied -eq $UseProxy) { return "unchanged" }
    $resp = Invoke-RestMethod -Uri "$CfBase/zones/$ZoneId/dns_records/$($existing.id)" `
      -Headers (Get-CfHeaders $Token) -Method Put -Body $body
    if (-not $resp.success) { throw "Failed to update CNAME $Fqdn" }
    return "updated"
  }

  $resp = Invoke-RestMethod -Uri "$CfBase/zones/$ZoneId/dns_records" `
    -Headers (Get-CfHeaders $Token) -Method Post -Body $body
  if (-not $resp.success) { throw "Failed to create CNAME $Fqdn" }
  return "created"
}

function Set-CfSubdomainRedirect {
  param(
    [string]$Token,
    [string]$ZoneId,
    [string]$FromHost,
    [string]$ToHost,
    [switch]$WhatIf
  )

  $ruleDesc = "Redirect $FromHost to $ToHost"
  Write-Host "  redirect rule: $FromHost -> https://$ToHost" -ForegroundColor DarkGray

  if ($WhatIf) { return "whatif" }

  try {
    $entryUri = "$CfBase/zones/$ZoneId/rulesets/phases/http_request_dynamic_redirect/entrypoint"
    $entry = $null
    try {
      $entry = Invoke-RestMethod -Uri $entryUri -Headers (Get-CfHeaders $Token) -Method Get
    } catch {
      $entry = $null
    }

    $newRule = @{
      expression        = "(http.host eq `"$FromHost`")"
      description       = $ruleDesc
      action            = "redirect"
      action_parameters = @{
        from_value = @{
          status_code           = 301
          preserve_query_string = $true
          target_url            = @{
            expression = "concat(`"https://$ToHost`", http.request.uri.path)"
          }
        }
      }
    }

    if ($entry -and $entry.result -and $entry.result.id) {
      $rulesetId = $entry.result.id
      $rules = @($entry.result.rules | Where-Object { $_.description -ne $ruleDesc })
      $rules += $newRule
      $body = @{ rules = $rules } | ConvertTo-Json -Depth 10
      $resp = Invoke-RestMethod -Uri "$CfBase/zones/$ZoneId/rulesets/$rulesetId" `
        -Headers (Get-CfHeaders $Token) -Method Put -Body $body
      if ($resp.success) { return "updated" }
    } else {
      $body = @{
        name  = "default"
        kind  = "zone"
        phase = "http_request_dynamic_redirect"
        rules = @($newRule)
      } | ConvertTo-Json -Depth 10

      try {
        $resp = Invoke-RestMethod -Uri $entryUri -Headers (Get-CfHeaders $Token) -Method Put -Body $body
        if ($resp.success) { return "created" }
      } catch { }

      $resp = Invoke-RestMethod -Uri "$CfBase/zones/$ZoneId/rulesets" `
        -Headers (Get-CfHeaders $Token) -Method Post -Body $body
      if ($resp.success) { return "created" }
    }
  } catch { }

  Write-Host "  WARN: redirect rule needs Zone:Rules:Edit (add manually in dashboard):" -ForegroundColor Yellow
  Write-Host "    Rules -> Redirect Rules -> Custom rule" -ForegroundColor Yellow
  Write-Host "    If hostname equals $FromHost -> Static 301 -> https://$ToHost/`${http.request.uri.path}" -ForegroundColor Yellow
  return "manual"
}

function Set-CfSiteDns {
  param(
    [hashtable]$Site,
    [string]$Token,
    [bool]$UseProxy,
    [switch]$WhatIf
  )

  $domain = $Site.Domain
  $target = Get-GithubPagesCname -Org $Site.Org
  $siteHost = Get-SiteHost -Site $Site
  $zoneId = if ($WhatIf) { "" } else { Get-CfZoneId -Token $Token -Domain $domain }

  Write-Host ""
  Write-Host "=== $siteHost ($($Site.Org)) ===" -ForegroundColor Cyan

  if (Test-SiteUsesApex -Site $Site) {
    $apex = Set-CfCname -Token $Token -ZoneId $zoneId -Label "@" -Fqdn $domain `
      -Target $target -UseProxy $UseProxy -WhatIf:$WhatIf
    $www = Set-CfCname -Token $Token -ZoneId $zoneId -Label "www" -Fqdn "www.$domain" `
      -Target $target -UseProxy $UseProxy -WhatIf:$WhatIf

    $redirect = "skipped"
    if ($Site.RedirectLegacyDocs) {
      $legacy = Get-LegacyDocsHost -Site $Site
      $docsDns = Set-CfCname -Token $Token -ZoneId $zoneId -Label "docs" -Fqdn $legacy `
        -Target $target -UseProxy $UseProxy -WhatIf:$WhatIf
      $redirect = Set-CfSubdomainRedirect -Token $Token -ZoneId $zoneId `
        -FromHost $legacy -ToHost $domain -WhatIf:$WhatIf
      if ($redirect -eq "manual") {
        return "apex:$apex,www:$www,docs:$docsDns,redirect:manual"
      }
      return "apex:$apex,www:$www,docs:$docsDns,redirect:$redirect"
    }
    return "apex:$apex,www:$www"
  }

  $docsHost = Get-DocsHost -Domain $domain
  $result = Set-CfCname -Token $Token -ZoneId $zoneId -Label "docs" -Fqdn $docsHost `
    -Target $target -UseProxy $UseProxy -WhatIf:$WhatIf
  return $result
}

$useCloudflareProxy = $true
if ($DnsOnly) { $useCloudflareProxy = $false }
if ($Proxied) { $useCloudflareProxy = $true }

Write-Host "=== LuminaryWorks Cloudflare site DNS ===" -ForegroundColor Cyan
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
    $results[$site.Org] = Set-CfSiteDns -Site $site -Token $CfApiToken -UseProxy $useCloudflareProxy -WhatIf:$WhatIf
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
if ($useCloudflareProxy) {
  Write-Host "Cloudflare proxy on. Dashboard: SSL/TLS -> Flexible; Edge Certificates -> Always Use HTTPS" -ForegroundColor Yellow
}
Write-Host "Verify: .\scripts\verify-docs-deployment.ps1 -Only LuminaryWorks -CheckHttp"
