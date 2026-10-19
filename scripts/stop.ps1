$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    docker compose down
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed to stop the app."
    }
    Write-Output "Kanban app stopped."
}
finally {
    Pop-Location
}