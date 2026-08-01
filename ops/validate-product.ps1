[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerPath = Join-Path $RepoRoot "src\worker.tsx"
$DomainPath = Join-Path $RepoRoot "src\domain\postal.ts"
$MigrationPath = Join-Path $RepoRoot "migrations\0001_postal_and_telemetry.sql"
$MetaPath = Join-Path $RepoRoot "src\generated\postal-meta.json"
$AppPath = Join-Path $RepoRoot "public\app.js"
$StylesPath = Join-Path $RepoRoot "public\styles.css"
$SourcePath = Join-Path $RepoRoot "SOURCE.md"
$BuilderPath = Join-Path $RepoRoot "scripts\build_postal.py"
$WranglerPath = Join-Path $RepoRoot "wrangler.jsonc"
$PublicDirectory = Join-Path $RepoRoot "public"

$RequiredFiles = @(
    "DECISIONS.md", "EXPERIMENT.md", "LICENSE", "METRICS.md", "PRIVACY.md", "README.md", "SECURITY.md", "SOURCE.md", "STACK.md",
    ".github\workflows\ci.yml", ".github\workflows\postal-refresh.yml", "data\source\utf_ken_all.zip",
    "migrations\0001_postal_and_telemetry.sql", "ops\import-postal.ps1", "ops\product-metrics.ps1", "ops\product-metrics.sql",
    "ops\submit-indexnow.ps1", "public\app.js", "public\favicon.svg", "public\manifest.webmanifest", "public\og.svg", "public\robots.txt",
    "scripts\build_postal.py", "src\domain\postal.ts", "src\generated\postal-meta.json", "src\worker.tsx"
)
foreach ($RelativePath in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $RelativePath))) { throw "Missing required release file: $RelativePath" }
}

$Worker = Get-Content -Raw -LiteralPath $WorkerPath
$Domain = Get-Content -Raw -LiteralPath $DomainPath
$Migration = Get-Content -Raw -LiteralPath $MigrationPath
$App = Get-Content -Raw -LiteralPath $AppPath
$Styles = Get-Content -Raw -LiteralPath $StylesPath
$Source = Get-Content -Raw -LiteralPath $SourcePath
$Builder = Get-Content -Raw -LiteralPath $BuilderPath
$Wrangler = Get-Content -Raw -LiteralPath $WranglerPath
$ProductSurface = @($Worker, $App) -join "`n"

if (-not $Worker.Contains('class="envelope"') -or -not $Worker.Contains('class="postal-boxes"') -or -not $ProductSurface.Contains('className = "address-card"') -or -not $Worker.Contains('class="saved-tray"')) { throw "Expected the envelope and address-slip visual system" }
if ($ProductSurface -match '(?i)public validation|success criteria|experiment|仮説|成功条件|市場スコア|移行候補|収益性') { throw "Research copy must not appear on the product surface" }
if ($Styles -match '(?i)gradient') { throw "Product CSS must not use gradients" }
if ($Styles -match '(?s)h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px') { throw "Primary heading is too large" }
if ($ProductSurface -match '(?i)innerHTML|eval\(|new Function') { throw "Postal data must not be interpreted as markup or code" }
if (-not $Worker.Contains('app.post("/api/search"') -or -not $Worker.Contains('c.header("Cache-Control", "no-store")')) { throw "Search must use a non-cacheable POST API" }
if ($Worker -match '/search\?q=|URLSearchParams\(.+query') { throw "Search text must not enter URLs" }
if ($Migration -match '(?i)search_query|query_text|address_value|postal_value|email|phone_number|telephone|advertising_id|password') { throw "Search, address, contact, advertising, and authentication data do not belong in telemetry storage" }
if (-not $Migration.Contains("CHECK(event_name IN") -or -not $Worker.Contains("35 * 86400")) { throw "Expected allowlisted telemetry and 35-day retention" }
if (-not $Domain.Contains('normalize("NFKC")') -or -not $Domain.Contains("toKatakana")) { throw "Expected normalized Japanese address search" }
if (-not $Worker.Contains(".bind(...values)") -or -not $Worker.Contains("instr(address, ?)")) { throw "Expected bound D1 address search" }
if (-not $Builder.Contains("EXPECTED_MINIMUM") -and -not $Builder.Contains("120_000")) { throw "Postal builds must validate completeness" }
if (-not $Source.Contains("著作権を主張せず") -or -not $Source.Contains("www.post.japanpost.jp")) { throw "Official source and redistribution boundary are incomplete" }
if ($ProductSurface -match '(?i)better-auth|betterAuth') { throw "Account authentication is not needed for a browser-only address tray" }
if ($Wrangler.Contains("00000000-0000-0000-0000-000000000000")) { throw "The production D1 database ID has not been configured" }
if ((Get-Item -LiteralPath (Join-Path $PublicDirectory "og.svg")).Length -lt 1500) { throw "Expected a product-specific OG SVG larger than 1.5 KB" }
if ((Get-Item -LiteralPath $AppPath).Length -lt 10000) { throw "Expected a substantial search and saved-address client" }

$Meta = Get-Content -Raw -LiteralPath $MetaPath | ConvertFrom-Json
if ([int]$Meta.rows -lt 120000) { throw "Expected at least 120,000 postal rows, found $($Meta.rows)" }
if ([int]$Meta.unique_postal_codes -lt 115000) { throw "Expected at least 115,000 postal codes, found $($Meta.unique_postal_codes)" }
if ([int]$Meta.prefectures -ne 47) { throw "Expected 47 prefectures, found $($Meta.prefectures)" }
$ActualDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RepoRoot "data\source\utf_ken_all.zip")).Hash.ToLowerInvariant()
if ($Meta.sha256 -ne $ActualDigest) { throw "Postal source digest does not match the committed archive" }

$SitemapFiles = @(Get-ChildItem -LiteralPath (Join-Path $PublicDirectory "sitemaps") -Filter "*.xml" -File)
if ($SitemapFiles.Count -ne 14) { throw "Expected 14 child sitemaps, found $($SitemapFiles.Count)" }
$SitemapIndex = Get-Content -Raw -LiteralPath (Join-Path $PublicDirectory "sitemap.xml")
if ([regex]::Matches($SitemapIndex, "<sitemap>").Count -ne 14) { throw "Sitemap index must reference 14 child sitemaps" }

$KeyFiles = @(Get-ChildItem -LiteralPath $PublicDirectory -File | Where-Object { $_.Name -match "^[a-zA-Z0-9-]{8,128}\.txt$" })
if ($KeyFiles.Count -ne 1) { throw "Expected exactly one generated IndexNow key file, found $($KeyFiles.Count)" }
$Key = (Get-Content -Raw -LiteralPath $KeyFiles[0].FullName).Trim()
if ($Key -ne $KeyFiles[0].BaseName) { throw "IndexNow key file name and content do not match" }

Write-Output "Product release contract is satisfied"
