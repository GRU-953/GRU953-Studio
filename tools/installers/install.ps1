# GRU953-Studio installer for Windows.
#
# What this does, in order:
#   1. Checks Node.js is present and new enough. It does NOT install Node for
#      you — installing system software without being asked is not something
#      this project does. If Node is missing it tells you exactly where to get
#      it and stops.
#   2. Installs the GRU953-Studio command from npm.
#   3. Runs "gru953-studio install", which finds every supported app on this
#      computer and sets GRU953-Studio up in each one, asking before it changes
#      anything.
#
# ON PIPING THIS INTO POWERSHELL, honestly: running
#   irm <url> | iex
# means executing a script from the internet without reading it. That is a real
# risk, whoever publishes it. If you would rather not, do this instead — same
# result, and you get to read it first:
#   irm https://raw.githubusercontent.com/GRU-953/GRU953-Studio/main/tools/installers/install.ps1 -OutFile install.ps1
#   notepad install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$MinNodeMajor = 22
$Package = '@gru953/studio-cli'

function Say([string]$Text) { Write-Host $Text }
function Die([string]$Text) {
    Write-Host ''
    Write-Host "GRU953-Studio: $Text" -ForegroundColor Red
    exit 1
}

Say ''
Say 'GRU953-Studio installer'
Say '======================='
Say ''

# --- 1. Node.js -------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Die @'
Node.js is not installed on this computer.

Node.js is a free tool GRU953-Studio needs in order to run its safety checks.

To install it:
  1. Open https://nodejs.org in your web browser.
  2. Download the version marked "LTS".
  3. Open the downloaded file and follow its instructions.
  4. Close this window and open a new PowerShell window.
  5. Run this installer again.

Nothing has been changed on your computer.
'@
}

$nodeVersion = (& node --version) -replace '^v', ''
$nodeMajor = 0
if (-not [int]::TryParse(($nodeVersion -split '\.')[0], [ref]$nodeMajor)) {
    Die "Could not work out which version of Node.js is installed (it reported '$nodeVersion'). Please check with: node --version"
}
if ($nodeMajor -lt $MinNodeMajor) {
    Die @"
Your Node.js is version $nodeVersion, and GRU953-Studio needs $MinNodeMajor or newer.

To update it:
  1. Open https://nodejs.org in your web browser.
  2. Download the version marked "LTS".
  3. Open the downloaded file and follow its instructions.
  4. Close this window, open a new PowerShell window, and run this installer again.

Nothing has been changed on your computer.
"@
}
Say "Found Node.js $nodeVersion. Good."

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die 'Node.js is installed but npm is not, which is unusual - they normally arrive together. Reinstalling Node.js from https://nodejs.org should fix it.'
}

# --- 2. The GRU953-Studio command ------------------------------------------
Say 'Installing the GRU953-Studio command from npm...'
# npm on Windows is a shell shim, so it is invoked through cmd rather than
# directly; calling it as a bare command can fail depending on how PowerShell
# resolves it.
& npm install -g "$Package@latest" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Say 'That did not work on the first attempt. Trying again and showing the full output:'
    Say ''
    & npm install -g "$Package@latest"
    if ($LASTEXITCODE -ne 0) {
        Die @'
Could not install the GRU953-Studio command.

If the message above mentions a permission problem, try opening PowerShell as an
administrator (right-click PowerShell, choose "Run as administrator") and running
this installer again.

If it mentions a network or proxy problem, and you are on a work computer, your
organisation may block npm - your IT team can confirm.

Nothing else has been changed on your computer.
'@
    }
}
Say 'Installed.'

# --- 3. Set up every app found on this computer -----------------------------
Say ''
Say 'Now setting GRU953-Studio up in the apps on this computer...'
Say ''
$cli = Get-Command gru953-studio -ErrorAction SilentlyContinue
if ($cli) {
    & gru953-studio install
} else {
    # Installed, but its folder is not on PATH in THIS window yet. A new
    # PowerShell window would pick it up, but making the user open one before
    # anything works is a poor first experience, so find it directly.
    $prefix = (& npm prefix -g) 2>$null
    $candidate = Join-Path $prefix 'gru953-studio.cmd'
    if (Test-Path $candidate) {
        & $candidate install
    } else {
        Die @"
The GRU953-Studio command was installed but cannot be found afterwards.

Close this window, open a new PowerShell window, and run:
  gru953-studio install

If that still does not find it, run this to see where npm put it:
  npm prefix -g
"@
    }
}

Say ''
Say "Done. Type 'gru953-studio doctor' at any time to check everything is set up."
Say 'In Claude Code, type /studio to begin.'
