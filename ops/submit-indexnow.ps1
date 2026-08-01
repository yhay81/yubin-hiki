[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern("^https://")]
    [string]$BaseUrl
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PublicDirectory = Join-Path $RepoRoot "public"
$Meta = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot "src\generated\postal-meta.json") | ConvertFrom-Json
$NormalizedBaseUrl = $BaseUrl.TrimEnd("/")
$KeyFiles = @(
    Get-ChildItem -LiteralPath $PublicDirectory -File |
        Where-Object { $_.Name -match "^[a-zA-Z0-9-]{8,128}\.txt$" }
)
if ($KeyFiles.Count -ne 1) { throw "Expected exactly one IndexNow key file, found $($KeyFiles.Count)" }
$Key = (Get-Content -Raw -LiteralPath $KeyFiles[0].FullName).Trim()
if ($Key -ne $KeyFiles[0].BaseName) { throw "IndexNow key file name and content do not match" }

$KeyLocation = "$NormalizedBaseUrl/$Key.txt"
$KeyResponse = Invoke-WebRequest -Uri $KeyLocation -SkipHttpErrorCheck -TimeoutSec 30
if ($KeyResponse.StatusCode -ne 200 -or $KeyResponse.Content.Trim() -ne $Key) {
    throw "Published IndexNow key file is unavailable or mismatched"
}

$Stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$IndexResponse = Invoke-WebRequest -Uri "$NormalizedBaseUrl/sitemap.xml?v=$Stamp" -SkipHttpErrorCheck -TimeoutSec 30
if ($IndexResponse.StatusCode -ne 200) { throw "Published sitemap index is unavailable" }
$SitemapLocations = @([regex]::Matches($IndexResponse.Content, "<loc>([^<]+)</loc>") | ForEach-Object { $_.Groups[1].Value })
$ExpectedSitemaps = 1 + [Math]::Ceiling([int]$Meta.unique_postal_codes / 10000)
if ($SitemapLocations.Count -ne $ExpectedSitemaps) { throw "Expected $ExpectedSitemaps child sitemaps, found $($SitemapLocations.Count)" }

$Urls = [System.Collections.Generic.List[string]]::new()
foreach ($SitemapLocation in $SitemapLocations) {
    if (-not $SitemapLocation.StartsWith("$NormalizedBaseUrl/")) { throw "Sitemap location is outside the production origin" }
    $Response = Invoke-WebRequest -Uri "$SitemapLocation?v=$Stamp" -SkipHttpErrorCheck -TimeoutSec 30
    if ($Response.StatusCode -ne 200) { throw "Child sitemap is unavailable: $SitemapLocation" }
    foreach ($Match in [regex]::Matches($Response.Content, "<loc>([^<]+)</loc>")) {
        $Url = $Match.Groups[1].Value
        if (-not $Url.StartsWith("$NormalizedBaseUrl/")) { throw "Sitemap contains a URL outside the production origin" }
        $Urls.Add($Url)
    }
}
$ExpectedUrls = [int]$Meta.unique_postal_codes + 4
if ($Urls.Count -ne $ExpectedUrls) { throw "Expected $ExpectedUrls URLs, found $($Urls.Count)" }

$Submitted = 0
for ($Start = 0; $Start -lt $Urls.Count; $Start += 10000) {
    $End = [Math]::Min($Start + 9999, $Urls.Count - 1)
    $Batch = @($Urls[$Start..$End])
    $Payload = @{
        host = ([uri]$NormalizedBaseUrl).Host
        key = $Key
        keyLocation = $KeyLocation
        urlList = $Batch
    } | ConvertTo-Json -Depth 3
    $Response = Invoke-WebRequest -Uri "https://api.indexnow.org/indexnow" -Method Post -ContentType "application/json; charset=utf-8" -Body $Payload -SkipHttpErrorCheck -TimeoutSec 60
    if ($Response.StatusCode -notin @(200, 202)) { throw "IndexNow submission failed with HTTP $($Response.StatusCode)" }
    $Submitted += $Batch.Count
}

[ordered]@{
    submitted_at = (Get-Date).ToUniversalTime().ToString("o")
    service = ([uri]$NormalizedBaseUrl).Host
    status = 200
    url_count = $Submitted
    batches = [Math]::Ceiling($Submitted / 10000)
} | ConvertTo-Json -Depth 3
