$ErrorActionPreference = 'Stop'
$archiveWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archiveOutput = [IO.Path]::GetFullPath((Join-Path $archiveWorkspace 'Intelligence-source.zip'))
if ([IO.Path]::GetDirectoryName($archiveOutput) -ne $archiveWorkspace) { throw 'Archive must stay inside the source workspace' }
# Archive the audited tracked source, never a recursive copy of the working directory.
Push-Location -LiteralPath $archiveWorkspace
try {
  & node scripts/verify-source.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Source publication audit failed' }
  $archiveTracked = @(& git ls-files)
  if ($LASTEXITCODE -ne 0 -or $archiveTracked.Count -eq 0) { throw 'Tracked source inventory unavailable' }
} finally { Pop-Location }
$archiveFiles = @()
foreach ($archiveRelative in $archiveTracked) {
  $archiveAbsolute = [IO.Path]::GetFullPath((Join-Path $archiveWorkspace $archiveRelative))
  if (-not $archiveAbsolute.StartsWith($archiveWorkspace + [IO.Path]::DirectorySeparatorChar)) { throw 'Source escaped workspace' }
  $archiveFiles += Get-Item -LiteralPath $archiveAbsolute
}
$archiveVersion = (Get-Content -LiteralPath (Join-Path $archiveWorkspace 'package.json') -Raw | ConvertFrom-Json).version
$archiveStream = [IO.File]::Open($archiveOutput,[IO.FileMode]::Create,[IO.FileAccess]::Write)
$archiveZip = [IO.Compression.ZipArchive]::new($archiveStream,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($archiveFile in ($archiveFiles | Sort-Object FullName -Unique)) {
    $archiveRelative = [IO.Path]::GetRelativePath($archiveWorkspace,$archiveFile.FullName).Replace('\','/')
    if ($archiveRelative.StartsWith('../') -or [IO.Path]::IsPathRooted($archiveRelative)) { throw 'Source escaped workspace' }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archiveZip,$archiveFile.FullName,$archiveRelative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archiveZip.Dispose(); $archiveStream.Dispose() }
$archiveRead = [IO.Compression.ZipFile]::OpenRead($archiveOutput)
try {
  $archiveNames = @($archiveRead.Entries | Select-Object -ExpandProperty FullName)
  foreach ($archiveRequired in @('README.md','CONTRIBUTING.md','SECURITY.md','.github/FUNDING.yml','.github/workflows/source-checks.yml','scripts/verify-source.mjs','AGENTS.md','LICENSE','COPYRIGHT','docs/LINUX_HANDOFF.md','docs/APPEARANCE.md','docs/VERIFICATION.md','docs/RELEASE_CHECKLIST.md','compose.yaml','Dockerfile','package-lock.json','package.json','electron/appearance-settings.mjs','electron/release-version.mjs','electron/agent.mjs','src/AppBackground.tsx','src/theme-extensions.css','scripts/verify-themes.mjs','tests/appearance.test.mjs','tests/release-version.test.mjs','public/assets/theme-provenance.json','public/licenses/GPL-3.0.txt','public/licenses/index.json','public/licenses/kokoro/index.json')) {
    if ($archiveRequired -notin $archiveNames) { throw "Missing $archiveRequired" }
  }
  foreach ($archiveTheme in @('festive','tech','astral','marble')) {
    foreach ($archiveRequired in @("public/assets/theme-$archiveTheme.webp", "public/assets/welcome-$archiveTheme.webp", "public/assets/background-detail-$archiveTheme.webp", "public/assets/originals/background-detail-$archiveTheme.png", "public/assets/originals/theme-$archiveTheme.png", "public/assets/originals/welcome-$archiveTheme.png")) {
      if ($archiveRequired -notin $archiveNames) { throw "Missing $archiveRequired" }
    }
  }
  if ('src/background-animation.ts' -in $archiveNames -or 'public/assets/hearth.png' -in $archiveNames) { throw 'Retired animation resources must not ship' }
  if ($archiveNames | Where-Object { $_ -match '^(node_modules|dist|release|\.git|\.cache|\.test-data|docs/screenshots)/|\.sqlite|\.env$|\.(gguf|onnx|bundle)$|private-history|docs/(V[12]_|NEXT_|PERSONAL_)' }) { throw 'Archive contains excluded data or internal development records' }
  [pscustomobject]@{ Path=$archiveOutput; Version=$archiveVersion; Files=$archiveNames.Count; Bytes=(Get-Item -LiteralPath $archiveOutput).Length; SHA256=(Get-FileHash -LiteralPath $archiveOutput -Algorithm SHA256).Hash } | ConvertTo-Json -Compress
} finally { $archiveRead.Dispose() }
