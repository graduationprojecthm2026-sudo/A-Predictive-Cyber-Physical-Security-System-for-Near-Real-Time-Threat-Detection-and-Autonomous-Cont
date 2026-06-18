$ErrorActionPreference = "Continue"

Write-Host "--- Git Pull ---"
git pull origin main

Write-Host "--- Checking paths ---"
if (Test-Path "agents/hq") {
    Write-Host "Found agents/hq"
    if (Test-Path "agents/hq/docker/grafana") {
        Write-Host "Removing agents/hq/docker/grafana"
        Remove-Item -Recurse -Force "agents/hq/docker/grafana"
        git rm -rf "agents/hq/docker/grafana"
    }
    Write-Host "Moving agents/hq to hq"
    git mv "agents/hq" "hq"
} else {
    Write-Host "agents/hq not found"
}

if (Test-Path "hq/docker/grafana") {
    Write-Host "Removing hq/docker/grafana"
    Remove-Item -Recurse -Force "hq/docker/grafana"
    git rm -rf "hq/docker/grafana"
}

Write-Host "Creating local_manager_dashboard folder"
New-Item -ItemType Directory -Force -Path "dashboards/local_manager_dashboard"
New-Item -ItemType File -Force -Path "dashboards/local_manager_dashboard/.gitkeep"

git config user.email "hq-upload@graduation.local"
git config user.name "HQ Upload"

Write-Host "--- Git Status ---"
git status

Write-Host "--- Git Add and Commit ---"
git add -A
git commit -m "refactor: move hq to root, remove docker/grafana, add local_manager_dashboard"

Write-Host "--- Git Push ---"
git push origin main
