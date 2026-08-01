[CmdletBinding()]
param(
    [switch]$Remote,
    [switch]$Local
)

$ErrorActionPreference = "Stop"
if ($Remote -eq $Local) { throw "Choose exactly one of -Remote or -Local" }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $RepoRoot
try {
    python scripts/build_postal.py --source-zip data/source/utf_ken_all.zip --project-root .
    if ($LASTEXITCODE -ne 0) { throw "Postal data build failed" }

    $Mode = if ($Remote) { "--remote" } else { "--local" }
    $Manifest = Get-Content -Raw .generated/postal/manifest.json | ConvertFrom-Json
    $FileCount = @($Manifest.files).Count
    $FileIndex = 0
    foreach ($FileName in $Manifest.files) {
        $FileIndex += 1
        $FilePath = Join-Path ".generated/postal" $FileName
        $ImportOutput = & npx wrangler d1 execute yubin-hiki $Mode --file $FilePath --yes 2>&1
        if ($LASTEXITCODE -ne 0) {
            $Failure = @($ImportOutput | Select-Object -Last 30) -join [Environment]::NewLine
            throw "D1 import failed for $FileName`n$Failure"
        }
        Write-Progress -Activity "Importing postal rows" -Status "$FileIndex / $FileCount" -PercentComplete (($FileIndex / $FileCount) * 100)
    }
    Write-Progress -Activity "Importing postal rows" -Completed

    $CountQuery = npx wrangler d1 execute yubin-hiki $Mode --command "SELECT COUNT(*) AS rows FROM postal_entries" --json | ConvertFrom-Json
    $ImportedRows = [int]$CountQuery[0].results[0].rows
    if ($ImportedRows -ne [int]$Manifest.rows) {
        throw "Expected $($Manifest.rows) imported rows, found $ImportedRows"
    }

    [ordered]@{
        environment = if ($Remote) { "production" } else { "local" }
        rows = $ImportedRows
        sha256 = $Manifest.data_sha256
    } | ConvertTo-Json
}
finally {
    Pop-Location
}
