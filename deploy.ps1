# Elroy deploy: commit + push from this PC, then pull + rebuild on the VPS.
# Usage (PowerShell, in D:\elroy):   .\deploy.ps1 "what changed"
param([string]$Message = "Update Elroy")

$Server = "root@107.172.25.72"
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "`n== Committing and pushing ==" -ForegroundColor Magenta
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m $Message } else { Write-Host "Nothing new to commit." }
git push
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host "`n== Updating the server (enter the VPS password if asked) ==" -ForegroundColor Magenta
ssh $Server "cd ~/elroy && git pull && ELROY_BUILD_ID=`$(git rev-parse --short HEAD) docker compose up -d --build && docker compose ps"
if ($LASTEXITCODE -ne 0) { throw "server update failed" }

Write-Host "`n== Done. Refresh the Elroy source in OBS (right-click > Refresh). ==" -ForegroundColor Green
