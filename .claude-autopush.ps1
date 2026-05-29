# Claude Code PostToolUse hook — auto commit + push edits in D:\Rattana Pic to GitHub
# Reads tool-call JSON from stdin, only acts if edited file is under D:\Rattana Pic

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $data = $raw | ConvertFrom-Json
    $file = $data.tool_input.file_path
    if (-not $file) { exit 0 }

    # Normalize path & match project root
    $root = 'D:\Rattana Pic'
    $normalized = $file -replace '/', '\'
    if (-not $normalized.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        exit 0  # not our project — silently skip
    }

    Set-Location $root

    # Stage and commit only if there are changes
    git add -A 2>$null | Out-Null
    $diff = git diff --cached --quiet 2>$null
    if ($LASTEXITCODE -eq 0) {
        # No staged changes
        exit 0
    }

    $leaf = Split-Path $file -Leaf
    $msg  = "auto: claude edit $leaf"
    git commit -m $msg --no-verify 2>$null | Out-Null
    git push origin main --quiet 2>$null | Out-Null

    Write-Host "[autopush] pushed: $leaf"
} catch {
    Write-Host "[autopush] error: $_"
    exit 0  # never block tool calls
}
