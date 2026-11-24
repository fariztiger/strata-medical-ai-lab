# STRATA ContentVault - reproducible Python & Apache-2.0 CJK font setup (Windows PowerShell).
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$VenvDir = Join-Path $RepoRoot ".venv"
$ReqFile = Join-Path $RepoRoot "packages\watermark-engine\requirements.txt"
$FontDir = Join-Path $RepoRoot "vendor\fonts\wqy-microhei"
$WqyUrl = "https://codeload.github.com/anthonyfok/fonts-wqy-microhei/tar.gz/refs/heads/master"
$ExpectedSha = "e4bca8df123ce01b104780f576ea1a58b9a5ff1662a91124b6d3180cb6c88212"

if (-not (Test-Path $VenvDir)) {
  Write-Host "[STRATA] Creating virtual environment at $VenvDir..."
  python -m venv $VenvDir
}

$PipExe = Join-Path $VenvDir "Scripts\pip.exe"
$PyExe = Join-Path $VenvDir "Scripts\python.exe"

Write-Host "[STRATA] Installing pinned pypdfium2 and Pillow from $ReqFile..."
& $PipExe install --disable-pip-version-check --no-input -r $ReqFile

$FontFile = Join-Path $FontDir "wqy-microhei.ttc"
if (-not (Test-Path $FontFile)) {
  Write-Host "[STRATA] Fetching WenQuanYi Micro Hei CJK font (elected under Apache-2.0)..."
  New-Item -ItemType Directory -Force -Path $FontDir | Out-Null
  $TarTmp = Join-Path $FontDir "wqy.tar.gz"
  Invoke-WebRequest -Uri $WqyUrl -OutFile $TarTmp
  tar -xzf $TarTmp -C $FontDir --strip-components=1 `
    fonts-wqy-microhei-master/wqy-microhei.ttc `
    fonts-wqy-microhei-master/LICENSE_Apache2.txt `
    fonts-wqy-microhei-master/AUTHORS.txt `
    fonts-wqy-microhei-master/README.txt
  Remove-Item $TarTmp -Force
}

$ActualSha = (Get-FileHash -Algorithm SHA256 $FontFile).Hash.ToLower()
if ($ActualSha -ne $ExpectedSha) {
  throw "[STRATA] Font SHA-256 mismatch ($ActualSha != $ExpectedSha)"
}

Write-Host "[STRATA] Verifying pypdfium2 watermark engine..."
& $PyExe (Join-Path $RepoRoot "scripts\synthetic\verify_watermark_visual.py")
Write-Host "[STRATA] Python dependency setup complete."
