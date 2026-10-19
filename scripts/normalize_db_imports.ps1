# normalize_db_imports.ps1
# Bulk normalization of database imports for Oddjob domain refactor

$domainDir = "server/domain"
$mappings = @{
    'import\s+\{\s*db\s*\}\s+from\s+"(\.*?\/)+database_service\.js"' = 'import { db } from "@server/db/index.js"'
    'import\s+\{\s*pool\s*\}\s+from\s+"(\.*?\/)+database_service\.js"' = 'import { pool } from "@server/db/index.js"'
    'import\s+\{\s*db,\s*pool\s*\}\s+from\s+"(\.*?\/)+database_service\.js"' = 'import { db, pool } from "@server/db/index.js"'
    'import\s+\{\s*pool,\s*db\s*\}\s+from\s+"(\.*?\/)+database_service\.js"' = 'import { pool, db } from "@server/db/index.js"'
}

Write-Host "Starting Database Import Normalization in $domainDir..." -ForegroundColor Cyan

Get-ChildItem -Path $domainDir -Recurse -Filter "*.ts" | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content $file -Raw
    $originalContent = $content
    
    foreach ($pattern in $mappings.Keys) {
        $replacement = $mappings[$pattern]
        $content = [regex]::Replace($content, $pattern, $replacement)
    }
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file -Value $content -NoNewline
        Write-Host "Updated: $($_.FullName)" -ForegroundColor Green
    }
}

Write-Host "Normalization Complete." -ForegroundColor Cyan
