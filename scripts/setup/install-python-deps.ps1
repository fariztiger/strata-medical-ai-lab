# Reproducible Python environment setup for STRATA ContentVault (Windows PowerShell)
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$VenvDir = Join-Path $RepoRoot ".venv"
$ReqFile = Join-Path $RepoRoot "packages\watermark-engine\requirements.txt"

Write-Host "[STRATA] Creating virtual environment at $VenvDir..."
python -m venv $VenvDir

$PipBin = Join-Path $VenvDir "Scripts\pip.exe"
$PyBin = Join-Path $VenvDir "Scripts\python.exe"

Write-Host "[STRATA] Installing pinned PyMuPDF and Pillow from $ReqFile..."
& $PipBin install --no-deps -r $ReqFile

Write-Host "[STRATA] Verifying watermark engine..."
& $PyBin (Join-Path $RepoRoot "scripts\synthetic\verify_watermark_visual.py")
Write-Host "[STRATA] Python dependency setup complete."
