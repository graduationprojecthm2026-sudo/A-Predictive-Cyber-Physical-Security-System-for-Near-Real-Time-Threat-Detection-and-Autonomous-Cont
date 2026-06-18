$ErrorActionPreference = "Continue"

Write-Host "--- Git Pull ---"
git pull origin main

$gitkeeps = @(
    ".github/workflows/.gitkeep",
    "agents/advanced/forensic_agent/.gitkeep",
    "agents/advanced/ti_agent/.gitkeep",
    "agents/data_network/ndr_agent/.gitkeep",
    "agents/iot/behavioral_agent/.gitkeep",
    "agents/iot/gateway_agent/.gitkeep",
    "agents/physical_access/credential_anomaly_agent/.gitkeep",
    "agents/physical_access/pac_eda_agent/.gitkeep",
    "collectors/.gitkeep",
    "dashboards/local_manager_dashboard/.gitkeep",
    "docs/diagrams/.gitkeep",
    "hardware/enclosures/.gitkeep",
    "hardware/wiring/.gitkeep",
    "local-managers/data_local_manager/.gitkeep",
    "local-managers/images/.gitkeep",
    "local-managers/iot_local_manager/.gitkeep",
    "local-managers/pac_local_manager/.gitkeep",
    "pi/iot/.gitkeep",
    "pi/pac/.gitkeep",
    "serverroom/vm3/pihole/.gitkeep"
)

Write-Host "--- Recreating .gitkeep files ---"
foreach ($file in $gitkeeps) {
    $dir = Split-Path $file -Parent
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir
    }
    New-Item -ItemType File -Force -Path $file
}

Write-Host "--- Git Status ---"
git status

Write-Host "--- Committing and Pushing ---"
git add -A
git commit -m "refactor: restore placeholder .gitkeep files for empty directories"
git push origin main
