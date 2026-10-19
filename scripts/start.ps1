$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed to start the app."
    }
    $port = if ($env:APP_PORT) { $env:APP_PORT } else { "8000" }
    Write-Output "Kanban app is running at http://localhost:$port"
}
finally {
    Pop-Location
}