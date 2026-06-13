# Shared config for docs.{domain} -> GitHub Pages
# Dot-source from setup-github-docs.ps1 / setup-cloudflare-docs-dns.ps1

$script:DocsSites = @(
  @{
    Brand   = "LuminaryWorks"
    Chinese = "启明工坊"
    Domain  = "luminaryworks.dev"
    Org     = "LuminaryWorks"
    Tagline = "AI ecosystem orchestration, shared identity and standards"
  },
  @{
    Brand   = "DataLuminary"
    Chinese = "数据明鉴"
    Domain  = "dataluminary.dev"
    Org     = "dataluminary"
    Tagline = "AI data insight and business intelligence"
  },
  @{
    Brand   = "BlockyEdu"
    Chinese = "智码工坊"
    Domain  = "blockyedu.com"
    Org     = "blockyedu"
    Tagline = "AI-powered programming education with Blockly"
  },
  @{
    Brand   = "DoerFlow"
    Chinese = "智工网"
    Domain  = "doerflow.dev"
    Org     = "doerflow"
    Tagline = "The liquidity protocol for autonomous agents"
  },
  @{
    Brand   = "VistaCast"
    Chinese = "视界云遥"
    Domain  = "vistacast.dev"
    Org     = "vistacast"
    Tagline = "AI-powered visual intelligence, streamed"
  },
  @{
    Brand   = "SyncroBrain"
    Chinese = "万物智脑"
    Domain  = "syncrobrain.com"
    Org     = "syncrobrain"
    Tagline = "An AI-native operating system for connected devices"
  }
)

function Get-DocsHost {
  param([string]$Domain)
  "docs.$Domain"
}

function Get-GithubPagesCname {
  param([string]$Org)
  "$($Org.ToLower()).github.io"
}
