# Reproducible Python environment setup for STRATA ContentVault (Windows PowerShell)
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$VenvDir = Join-Path $RepoRoot ".venv"

Write-Host "[STRATA] Creating virtual environment at $VenvDir..."
python -m venv $VenvDir

$PipExe = Join-Path $VenvDir "Scripts\pip.exe"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

Write-Host "[STRATA] Installing PyMuPDF and Pillow..."
& $PipExe install --no-deps pymupdf Pillow

Write-Host "[STRATA] Verifying watermark engine..."
& $PythonExe (Join-Path $RepoRoot "scripts\synthetic\verify_watermark_visual.py")
Write-Host "[STRATA] Python dependency setup complete."
