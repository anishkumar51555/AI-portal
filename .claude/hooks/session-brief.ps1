<#
.SYNOPSIS
  SessionStart briefing — the token-saving entry point.

.DESCRIPTION
  Emits a compact, factual status so a new session knows where the project stands
  without reading docs/. Combines:
    - the frontmatter of PROJECT-STATE.md (phase, last task, next task, blockers)
    - live repo facts (scaffolded? migrations? containers up? fixtures built?)
    - a pointer to docs/CONTEXT-MAP.md so only relevant specs get loaded

  Costs ~250 tokens. Replaces ~48,000 tokens of reading docs/ from scratch.
  Advisory only: always exits 0.
#>

$ErrorActionPreference = 'SilentlyContinue'

$projectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { $PWD.Path }
$lines = New-Object System.Collections.Generic.List[string]

$lines.Add('=== AI COMPONENT ECOSYSTEM PORTAL ===')

# ── PROJECT-STATE.md frontmatter is the source of truth for "where are we" ──
$statePath = Join-Path $projectDir 'PROJECT-STATE.md'
if (Test-Path -LiteralPath $statePath) {
    # -Encoding UTF8 is required: Windows PowerShell 5.1 reads as the system
    # ANSI codepage by default, which mangles em-dashes and other non-ASCII.
    $raw = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8

    # Grab the leading --- ... --- block without needing a YAML parser.
    if ($raw -match '(?s)^\s*---\s*\r?\n(.*?)\r?\n---') {
        foreach ($line in ($Matches[1] -split "`r?`n")) {
            if ($line -match '^\s*([a-z_]+)\s*:\s*(.+?)\s*$') {
                $key = $Matches[1]; $val = $Matches[2].Trim('"')
                switch ($key) {
                    'phase'      { $lines.Add("Phase:      $val") }
                    'phase_name' { $lines[-1] = "$($lines[-1]) - $val" }
                    'last_task'  { $lines.Add("Last done:  $val") }
                    'next_task'  { $lines.Add("NEXT TASK:  $val") }
                    'blocked_by' { if ($val -ne 'none') { $lines.Add("BLOCKED BY: $val") } }
                    'updated'    { $lines.Add("State as of: $val") }
                }
            }
        }
    }
} else {
    $lines.Add('PROJECT-STATE.md missing - start at docs/09-implementation-plan.md task 0.1.')
}

# ── live repo facts, so the brief cannot go stale ──
$facts = New-Object System.Collections.Generic.List[string]

if (-not (Test-Path -LiteralPath (Join-Path $projectDir 'node_modules'))) {
    $facts.Add('node_modules MISSING - run npm install')
}
if (Test-Path -LiteralPath (Join-Path $projectDir 'prisma/migrations')) {
    $n = (Get-ChildItem -LiteralPath (Join-Path $projectDir 'prisma/migrations') -Directory).Count
    $facts.Add("migrations: $n")
} elseif (Test-Path -LiteralPath (Join-Path $projectDir 'prisma/schema.prisma')) {
    $facts.Add('prisma schema exists, no migrations yet')
} else {
    $facts.Add('prisma not initialised (task 0.8)')
}

$fixtureDir = Join-Path $projectDir 'tests/fixtures/archives'
if (Test-Path -LiteralPath $fixtureDir) {
    $fx = (Get-ChildItem -LiteralPath $fixtureDir -Filter *.zip).Count
    $facts.Add("test fixtures: $fx")
} else {
    $facts.Add('fixtures missing - npm run fixtures:build')
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    $running = (& docker ps --filter 'name=ai-portal' --format '{{.Names}}' 2>$null) -join ','
    if ($running) { $facts.Add("containers up: $running") }
    else          { $facts.Add('containers DOWN - npm run docker:up before db/storage work') }
} else {
    $facts.Add('docker NOT INSTALLED - integration tests unavailable')
}

$lines.Add("Repo: $($facts -join ' | ')")

# ── the instruction that actually saves the tokens ──
$lines.Add('')
$lines.Add('CONTEXT RULE: do NOT read docs/ end to end (~36k words).')
$lines.Add('Read PROJECT-STATE.md, then ONE row of docs/CONTEXT-MAP.md for this task.')
$lines.Add('Boundaries/types/format/secrets are enforced by eslint+tsc+hooks, not by reading rules.')
$lines.Add('Run /next-task to pick up work, /verify to check it, /resume for a fuller status.')

$lines -join "`n" | Write-Output
exit 0
