# Database Backup Script for Oddjob

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = join-path $PSScriptRoot "..\backups"
if (!(Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir
    Write-Host "Created backup directory: $backupDir"
}

# 1. Postgres Backup
Write-Host "Starting Postgres backup..."
$pgDump = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
$dbUrl = "postgresql://postgres:ShitMonger01!@127.0.0.1:5432/oddjob"
$postgresOutputFile = Join-Path $backupDir "postgres_backup_$timestamp.sql"

# Set password for pg_dump
$env:PGPASSWORD = "ShitMonger01!"
try {
    & $pgDump -U postgres -h 127.0.0.1 -p 5432 oddjob > $postgresOutputFile
    Write-Host "Postgres backup completed: $postgresOutputFile"
} catch {
    Write-Error "Postgres backup failed: $_"
} finally {
    Remove-Item Env:\PGPASSWORD
}

# 2. Qdrant Backup
Write-Host "Starting Qdrant backup..."
$qdrantUrl = "http://localhost:6333"
$collection = "oddjob_rag_assets"
$snapshotApi = "$qdrantUrl/collections/$collection/snapshots"

try {
    # Trigger snapshot
    $response = Invoke-RestMethod -Method Post -Uri $snapshotApi
    $snapshotName = $response.result.name
    Write-Host "Qdrant snapshot triggered: $snapshotName"

    # Download snapshot
    $downloadUrl = "$snapshotApi/$snapshotName"
    $qdrantOutputFile = Join-Path $backupDir "qdrant_snapshot_$timestamp.snapshot"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $qdrantOutputFile
    Write-Host "Qdrant backup completed: $qdrantOutputFile"
} catch {
    Write-Error "Qdrant backup failed: $_"
}
