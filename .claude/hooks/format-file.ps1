<#
.SYNOPSIS
  PostToolUse formatter for Write / Edit.

.DESCRIPTION
  Runs Prettier on the file that was just written, so formatting never shows up
  as diff noise or as a CI failure.

  Advisory only: this hook ALWAYS exits 0. A formatter problem must never block
  work, and before `npm install` has been run there is nothing to invoke.
#>

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $hook = $raw | ConvertFrom-Json
} catch { exit 0 }

$filePath = $hook.tool_input.file_path
if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }
if (-not (Test-Path -LiteralPath $filePath)) { exit 0 }

# Only formats that Prettier owns here.
$formattable = '\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css|md|mdx|ya?ml)$'
if ($filePath -notmatch $formattable) { exit 0 }

$projectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { $PWD.Path }

# Nothing to run before dependencies are installed — stay silent.
$prettierBin = Join-Path $projectDir 'node_modules/.bin/prettier.cmd'
if (-not (Test-Path -LiteralPath $prettierBin)) { exit 0 }

# --ignore-unknown so an unconfigured extension is a no-op, not an error.
& $prettierBin --write --ignore-unknown --log-level warn -- $filePath 2>&1 | Out-Null

exit 0
