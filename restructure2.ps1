$ErrorActionPreference = "Continue"

Write-Host "--- Git Pull ---"
git pull origin main

Write-Host "--- Renaming routers to Routers ---"
if (Test-Path "network/routers") {
    # On Windows, we need to rename via a temp folder because NTFS is case-insensitive
    git mv network/routers network/routers_temp
    git mv network/routers_temp network/Routers
} else {
    Write-Host "network/routers not found (might already be renamed)"
}

Write-Host "--- Removing compliance agent ---"
if (Test-Path "agents/advanced/compliance_agent") {
    git rm -rf agents/advanced/compliance_agent
    Remove-Item -Recurse -Force "agents/advanced/compliance_agent" -ErrorAction SilentlyContinue
} else {
    Write-Host "agents/advanced/compliance_agent not found"
}

Write-Host "--- Removing all .gitkeep files ---"
Get-ChildItem -Path . -Filter ".gitkeep" -Recurse | ForEach-Object {
    $fullName = $_.FullName
    $relPath = $fullName.Substring((Get-Location).Path.Length + 1).Replace('\', '/')
    Write-Host "Removing gitkeep: $relPath"
    git rm -f $relPath
    if (Test-Path $fullName) {
        Remove-Item $fullName -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "--- Git Status ---"
git status

Write-Host "--- Committing and Pushing ---"
git add -A
git commit -m "refactor: rename routers to Routers, remove compliance agent, and remove all .gitkeep files"
git push origin main
