# LuminaryWorks — bootstrap {org}/docs repos on GitHub Pages (VitePress)
# Usage:
#   .\scripts\setup-github-docs.ps1 [-WhatIf] [-Force] [-Skip LuminaryWorks,doerflow] [-Only vistacast]
#
# Requires: gh auth login (repo + admin:org for org repos)
# Does NOT touch Cloudflare — run setup-cloudflare-docs-dns.ps1 after Pages is live.

param(
  [switch]$WhatIf,
  [switch]$Force,
  [string[]]$Skip = @(),
  [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\docs-sites.config.ps1"

$TemplateRoot = Join-Path $PSScriptRoot "templates\docs-vitepress"
$WorkRoot = Join-Path $env:TEMP "luminary-docs-bootstrap"

function Test-GhAuth {
  $status = gh auth status 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Run: gh auth login -h github.com" -ForegroundColor Red
    exit 1
  }
  Write-Host "gh auth OK" -ForegroundColor Green
}

function Test-RepoExists {
  param([string]$Org)
  gh repo view "$Org/docs" --json name 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Get-RepoDefaultBranch {
  param([string]$Org)
  $branch = gh repo view "$Org/docs" --json defaultBranchRef --jq '.defaultBranchRef.name' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $branch) { return "main" }
  return $branch
}

function Test-RepoHasCommits {
  param([string]$Org)
  $count = gh api "repos/$Org/docs/commits" --jq 'length' 2>$null
  return ($LASTEXITCODE -eq 0 -and [int]$count -gt 0)
}

function Expand-DocsTemplate {
  param(
    [hashtable]$Site,
    [string]$Dest
  )

  if (-not (Test-Path $TemplateRoot)) {
    throw "Template missing: $TemplateRoot"
  }

  if (Test-Path $Dest) {
    Remove-Item $Dest -Recurse -Force
  }
  Copy-Item $TemplateRoot $Dest -Recurse

  $docsHost = Get-DocsHost -Domain $Site.Domain
  $replacements = @{
    '{{BRAND}}'    = $Site.Brand
    '{{CHINESE}}'  = $Site.Chinese
    '{{DOMAIN}}'   = $Site.Domain
    '{{ORG}}'      = $Site.Org
    '{{DOCS_HOST}}'= $docsHost
    '{{TAGLINE}}'  = $Site.Tagline
    '{{YEAR}}'     = (Get-Date).Year.ToString()
  }

  Get-ChildItem $Dest -Recurse -File | ForEach-Object {
    $raw = [System.IO.File]::ReadAllText($_.FullName)
    foreach ($key in $replacements.Keys) {
      $raw = $raw.Replace($key, $replacements[$key])
    }
    [System.IO.File]::WriteAllText($_.FullName, $raw)
  }
}

function Push-DocsContent {
  param(
    [hashtable]$Site,
    [string]$SourceDir
  )

  $org = $Site.Org
  $repo = "$org/docs"
  $cloneDir = Join-Path $WorkRoot $org
  $branch = "main"

  if (Test-Path $cloneDir) {
    Remove-Item $cloneDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $cloneDir -Force | Out-Null

  if (Test-RepoExists -Org $org) {
    gh repo clone $repo $cloneDir -- --depth 1 2>$null
    if ($LASTEXITCODE -ne 0) {
      # Empty repo (no commits yet) — init locally instead of clone
      git -C $cloneDir init -b main | Out-Null
      git -C $cloneDir remote add origin "https://github.com/$repo.git"
    } else {
      $branch = Get-RepoDefaultBranch -Org $org
    }
  } else {
    git -C $cloneDir init -b main | Out-Null
    git -C $cloneDir remote add origin "https://github.com/$repo.git"
  }

  Get-ChildItem $SourceDir -Force | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $cloneDir $_.Name) -Recurse -Force
  }

  git -C $cloneDir add -A
  git -C $cloneDir diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  no content changes for $repo" -ForegroundColor DarkGray
    return "unchanged"
  }

  git -C $cloneDir -c user.name="LuminaryWorks Bot" -c user.email="bot@luminaryworks.dev" `
    commit -m "chore(docs): bootstrap VitePress site for $($Site.Brand)"
  if ($LASTEXITCODE -ne 0) {
    throw "git commit failed for $repo"
  }

  if (Test-RepoExists -Org $org) {
    git -C $cloneDir push origin "HEAD:$branch"
  } else {
    git -C $cloneDir push -u origin $branch
  }
  if ($LASTEXITCODE -ne 0) {
    throw "git push failed for $repo"
  }
  return "pushed"
}

function Enable-GithubPages {
  param([hashtable]$Site)

  $org = $Site.Org
  $repo = "$org/docs"
  $docsHost = Get-DocsHost -Domain $Site.Domain

  if (-not (Test-RepoExists -Org $org)) {
    Write-Host "  skip Pages: $repo does not exist" -ForegroundColor Yellow
    return "no-repo"
  }

  $pages = gh api "repos/$repo/pages" 2>$null
  if ($LASTEXITCODE -ne 0) {
    gh api "repos/$repo/pages" -X POST -f build_type=workflow | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to enable Pages on $repo" }
    Write-Host "  Pages enabled (workflow) on $repo" -ForegroundColor Green
  } else {
    gh api "repos/$repo/pages" -X PUT -f build_type=workflow | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to update Pages on $repo" }
    Write-Host "  Pages already enabled on $repo" -ForegroundColor DarkGray
  }

  $domains = gh api "repos/$repo/pages/domains" --jq '.[].name' 2>$null
  if ($domains -notcontains $docsHost) {
    gh api "repos/$repo/pages/domains" -X POST -f "domain=$docsHost" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to set custom domain $docsHost on $repo" }
    Write-Host "  custom domain set: $docsHost" -ForegroundColor Green
  } else {
    Write-Host "  custom domain OK: $docsHost" -ForegroundColor DarkGray
  }

  return "ok"
}

function New-GithubDocsRepo {
  param([hashtable]$Site)

  $org = $Site.Org
  $repo = "$org/docs"
  $docsHost = Get-DocsHost -Domain $Site.Domain
  $desc = "$($Site.Brand) ($($Site.Chinese)) documentation — https://$docsHost"

  Write-Host ""
  Write-Host "=== $org/docs ($docsHost) ===" -ForegroundColor Cyan

  $exists = Test-RepoExists -Org $org
  if (-not $exists) {
    if ($WhatIf) {
      Write-Host "[WhatIf] gh repo create $repo --public" -ForegroundColor Cyan
    } else {
      gh repo create $repo --public --description $desc --disable-wiki --disable-issues 2>$null
      if ($LASTEXITCODE -ne 0) {
        # org repos may need explicit org flag
        gh repo create $repo --public --description $desc --disable-wiki --disable-issues -y 2>$null
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to create $repo (need org admin?)"
      }
      Write-Host "  created $repo" -ForegroundColor Green
    }
  } else {
    Write-Host "  repo exists: $repo" -ForegroundColor DarkGray
  }

  $hasCommits = $exists -and (Test-RepoHasCommits -Org $org)
  if ($hasCommits -and -not $Force) {
    Write-Host "  skip scaffold (repo has commits; use -Force to overwrite template)" -ForegroundColor Yellow
  } else {
    if ($WhatIf) {
      Write-Host "[WhatIf] push VitePress template to $repo" -ForegroundColor Cyan
    } else {
      $staging = Join-Path $WorkRoot "staging-$org"
      Expand-DocsTemplate -Site $Site -Dest $staging
      $pushResult = Push-DocsContent -Site $Site -SourceDir $staging
      Write-Host "  content: $pushResult" -ForegroundColor Green
    }
  }

  if ($WhatIf) {
    Write-Host "[WhatIf] enable Pages + custom domain $docsHost" -ForegroundColor Cyan
    return "whatif"
  }

  return Enable-GithubPages -Site $Site
}

Write-Host "=== LuminaryWorks GitHub Docs Bootstrap ===" -ForegroundColor Cyan
Test-GhAuth

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
    $results[$site.Org] = New-GithubDocsRepo -Site $site
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
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  1) Wait for GitHub Actions deploy on each org/docs repo"
Write-Host "  2) `$env:CF_API_TOKEN = '<token>'; .\scripts\setup-cloudflare-docs-dns.ps1"
Write-Host "  3) .\scripts\verify-docs-deployment.ps1"
