# fix_test_imports_v2.ps1
# Refined bulk normalization of test imports for Oddjob domain refactor

$testDir = "tests"
$mappings = @{
    # Fix incorrect v1 mappings
    '@server/domain/auth/user.service.js' = '@server/domain/org/core/user.service.js'
    '@server/domain/org/organization.service.js' = '@server/domain/org/core/organization.service.js'
    
    # New legacy-to-domain mappings
    '(\.?\.?/)+server/services/user-service(\.js)?' = '@server/domain/org/core/user.service.js'
    '(\.?\.?/)+server/services/organization-service(\.js)?' = '@server/domain/org/core/organization.service.js'
    '(\.?\.?/)+server/services/auth-service(\.js)?' = '@server/domain/auth/core/auth.service.js'
    '(\.?\.?/)+server/services/mission-service(\.js)?' = '@server/domain/mission/core/mission.service.js'
    '(\.?\.?/)+server/services/mission-run-service(\.js)?' = '@server/domain/mission/core/mission-run.service.js'
    '(\.?\.?/)+server/services/job-service(\.js)?' = '@server/domain/jobs/job.service.js'
    '(\.?\.?/)+server/services/pipeline-service(\.js)?' = '@server/domain/pipeline/core/pipeline.service.js'
    '(\.?\.?/)+server/services/intent-pipeline-mapper(\.js)?' = '@server/domain/mission/core/intent-pipeline-mapper.js'
    '(\.?\.?/)+server/services/governor/decision-router(\.js)?' = '@server/domain/org/governor/decision-router.js'
    
    # Standardize aliases if relative paths remain
    '(\.?\.?/)+server/db\.js' = '@server/db/index.js'
    '(\.?\.?/)+server/ai/ai-client\.js' = '@server/ai/ai-client.js'
}

Write-Host "Starting Refined Bulk Import Normalization (v2) in $testDir..." -ForegroundColor Cyan

Get-ChildItem -Path $testDir -Recurse -Filter "*.test.ts" | ForEach-Object {
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

Write-Host "Refined Normalization Complete." -ForegroundColor Cyan
