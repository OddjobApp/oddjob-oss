# normalize_utility_imports.ps1
# Bulk normalization of utility imports for Oddjob domain refactor

$targetDirs = @("server/domain", "server/services")
$mappings = @{
    'import\s+\{\s*AIClientFactory\s*\}\s+from\s+"(\.*?\/)+ai/ai-client\.js"' = 'import { AIClientFactory } from "@server/ai/ai-client.js"'
    'import\s+\{\s*aiHealingService\s*\}\s+from\s+"(\.*?\/)+ai-healing-service\.js"' = 'import { aiHealingService } from "@server/domain/ai/core/ai-healing-service.js"'
    'import\s+datasetService\s+from\s+"(\.*?\/)+dataset-service\.js"' = 'import datasetService from "@server/domain/knowledge/core/dataset-service.js"'
    'import\s+\{\s*db\s*\}\s+from\s+"(\.*?\/)+database_service\.js"' = 'import { db } from "@server/db/index.js"'
}

Write-Host "Starting Utility Import Normalization in $targetDirs..." -ForegroundColor Cyan

foreach ($dir in $targetDirs) {
    Get-ChildItem -Path $dir -Recurse -Filter "*.ts" | ForEach-Object {
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
}

Write-Host "Normalization Complete." -ForegroundColor Cyan
