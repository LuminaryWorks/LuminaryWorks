# Cross-platform workspace layout. Dot-source from scripts in scripts/.
# {workspace} = parent of this MetaRepo — never hardcode D:\www / C:\www.

$script:LwLibDir = Split-Path $PSCommandPath -Parent
$script:LwScriptsDir = Split-Path $script:LwLibDir -Parent
$script:LwMetaRoot = Split-Path $script:LwScriptsDir -Parent
$script:LwWorkspaceRoot = Split-Path $script:LwMetaRoot -Parent

$script:LwProductRepos = @(
  @{ Key = "dataluminary"; Dir = "DataLuminary"; Org = "DataLuminary"; Repo = "DataLuminary"; Required = $true },
  @{ Key = "blockyedu";    Dir = "BlockyEdu";    Org = "BlockyEdu";    Repo = "BlockyEdu";    Required = $true },
  @{ Key = "doerflow";     Dir = "DoerFlow";     Org = "DoerFlow";     Repo = "DoerFlow";     Required = $true },
  @{ Key = "vistaremote";  Dir = "VistaRemote";  Org = "VistaRemote";  Repo = "VistaRemote";  Required = $true },
  @{ Key = "vistacast";    Dir = "VistaCast";    Org = "VistaCast";    Repo = "VistaCast";    Required = $false },
  @{ Key = "syncrobrain";  Dir = "SyncroBrain";  Org = "SyncroBrain";  Repo = "SyncroBrain";  Required = $true }
)

function Resolve-WorkspacePath {
  param([Parameter(Mandatory = $true)][string[]]$Segments)
  $current = $script:LwWorkspaceRoot
  foreach ($seg in $Segments) {
    if ([string]::IsNullOrWhiteSpace($seg)) { continue }
    $exact = Join-Path $current $seg
    if (Test-Path -LiteralPath $exact) {
      $current = (Resolve-Path -LiteralPath $exact).Path
      continue
    }
    $found = Get-ChildItem -LiteralPath $current -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $seg } |
      Select-Object -First 1
    if ($found) {
      $current = $found.FullName
    } else {
      $current = $exact
    }
  }
  return $current
}

function Get-ProductDir {
  param([Parameter(Mandatory = $true)][string]$KeyOrDir)
  $hit = $script:LwProductRepos | Where-Object {
    $_.Key -eq $KeyOrDir -or $_.Dir -eq $KeyOrDir
  } | Select-Object -First 1
  if ($hit) { return (Resolve-WorkspacePath $hit.Dir) }
  return (Resolve-WorkspacePath $KeyOrDir)
}
