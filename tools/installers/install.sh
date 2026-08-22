#!/bin/sh
# GRU953-Studio installer for macOS and Linux.
#
# What this does, in order:
#   1. Checks Node.js is present and new enough. It does NOT install Node for
#      you — installing system software without being asked is not something
#      this project does. If Node is missing it tells you exactly where to get
#      it and stops.
#   2. Installs the GRU953-Studio command from npm.
#   3. Runs "gru953-studio install", which finds the supported apps on this
#      machine and sets GRU953-Studio up in the ones it can.
#
#      IT DOES NOT ASK YOU ANYTHING (corrected 2026-08-22, finding X243: this
#      header used to claim it did). There is no prompt anywhere in
#      "gru953-studio install" - no readline, no stdin read, nothing. Running
#      this installer IS the consent; nothing further is requested. It writes
#      configuration files into the editors it finds, and re-running it
#      overwrites files you may have edited by hand.
#
#      It also used to say it sets the studio up "in each one", which overstated
#      what happens: one supported host is skipped by design, and some cannot be
#      reached from a shell installer at all. It configures what it can and
#      reports the rest.
#
# ON PIPING THIS INTO A SHELL, honestly: running
#   curl ... | sh
# means executing a script from the internet without reading it. That is a real
# risk, whoever publishes it. If you would rather not, do this instead — same
# result, and you get to read it first:
#   curl -fsSLO https://raw.githubusercontent.com/GRU-953/GRU953-Studio/main/tools/installers/install.sh
#   less install.sh
#   sh install.sh
#
# POSIX sh on purpose (no bashisms): the default shell is not bash everywhere,
# and an installer is the worst place to discover that.

set -eu

MIN_NODE_MAJOR=22
PACKAGE="@gru953/studio-cli"

say() { printf '%s\n' "$1"; }
die() {
    printf '\n%s\n' "GRU953-Studio: $1" >&2
    exit 1
}

say ""
say "GRU953-Studio installer"
say "======================="
say ""

# --- 1. Node.js -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    die "Node.js is not installed on this computer.

Node.js is a free tool GRU953-Studio needs in order to run its safety checks.

To install it:
  1. Open https://nodejs.org in your web browser.
  2. Download the version marked 'LTS'.
  3. Open the downloaded file and follow its instructions.
  4. Close and reopen your terminal.
  5. Run this installer again.

Nothing has been changed on your computer."
fi

NODE_VERSION="$(node --version 2>/dev/null | sed 's/^v//')"
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | cut -d. -f1)"
case "$NODE_MAJOR" in
    '' | *[!0-9]*) die "Could not work out which version of Node.js is installed (it reported '$NODE_VERSION'). Please check with: node --version" ;;
esac
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
    die "Your Node.js is version $NODE_VERSION, and GRU953-Studio needs $MIN_NODE_MAJOR or newer.

To update it:
  1. Open https://nodejs.org in your web browser.
  2. Download the version marked 'LTS'.
  3. Open the downloaded file and follow its instructions.
  4. Close and reopen your terminal, then run this installer again.

Nothing has been changed on your computer."
fi
say "Found Node.js $NODE_VERSION. Good."

if ! command -v npm >/dev/null 2>&1; then
    die "Node.js is installed but npm is not, which is unusual — they normally arrive together. Reinstalling Node.js from https://nodejs.org should fix it."
fi

# --- 2. The GRU953-Studio command ------------------------------------------
say "Installing the GRU953-Studio command from npm..."
if npm install -g "$PACKAGE@latest" >/dev/null 2>&1; then
    say "Installed."
else
    # A global npm install failing on permissions is the single most common
    # stumble here, and "EACCES" on its own tells a non-technical reader
    # nothing. Retry visibly so they can see the real error, then explain.
    say "That did not work on the first attempt. Trying again and showing the full output:"
    say ""
    if ! npm install -g "$PACKAGE@latest"; then
        die "Could not install the GRU953-Studio command.

If the message above mentions 'EACCES' or 'permission denied', npm is trying to
write to a folder your user account cannot change. The safest fix is to tell npm
to use a folder in your home directory instead:

  1. Run:  mkdir -p \"\$HOME/.npm-global\"
  2. Run:  npm config set prefix \"\$HOME/.npm-global\"
  3. Add this line to the end of your shell profile
     (~/.zshrc on macOS, ~/.bashrc on most Linux systems):
         export PATH=\"\$HOME/.npm-global/bin:\$PATH\"
  4. Close and reopen your terminal.
  5. Run this installer again.

Using 'sudo npm install -g' also works, but it installs as the system
administrator, which is a bigger permission than this needs.

Nothing else has been changed on your computer."
    fi
fi

# --- 3. Set up every app found on this machine ------------------------------
say ""
say "Now setting GRU953-Studio up in the apps on this computer..."
say ""
# CORRECTED 2026-08-22, three defects in this block, all caused by `set -e` (line 26) doing
# exactly what it is asked to do:
#
#   a. `gru953-studio install` returning non-zero aborted the whole script HERE, so the closing
#      instructions below - the only place the user is told what to type next - were never printed.
#      A partial setup therefore ended in silence. Its status is now captured, the failure is
#      stated plainly, and the guidance is still printed.
#
#   b. `NPM_BIN="$(npm bin -g ... || npm prefix -g ...)/bin"` is an assignment whose exit status is
#      the substitution's, so if BOTH npm calls failed the script aborted before reaching the
#      carefully written "installed but cannot be found afterwards" message a few lines below.
#      Verified in /bin/sh and in dash: both abort.
#
#   c. That expression was one branch pretending to be two. `npm bin -g` was removed in npm 9 and
#      on npm 11.19.0 prints `Unknown command: "bin"` to STDOUT while exiting non-zero - so
#      `2>/dev/null` did not suppress it, the `||` ran the second command, and the substitution
#      captured BOTH outputs. NPM_BIN became a four-line string ending `/opt/homebrew/bin`, so
#      `[ -x "$NPM_BIN/gru953-studio" ]` could never be true and only the `elif` ever worked. The
#      dead call is gone rather than kept as decoration.
# CORRECTED 2026-08-22, X258: this resolved the command by PATH only, so it ran whatever
# `gru953-studio` happened to be first there — never the build `npm install -g` had just written.
# On the machine where this was found, PATH resolves to /opt/homebrew/bin/gru953-studio, a Homebrew
# symlink into Cellar/gru953-studio/6.0.3, while the copy just installed was 6.1.0. So the installer
# could report success having configured the machine with an older build, and it printed no version
# at all, leaving nothing to notice it by. The just-installed shim is now preferred, and whichever
# one is about to run is named out loud.
INSTALL_STATUS=0
NPM_PREFIX_FOR_RUN="$(npm prefix -g 2>/dev/null || true)"
CLI=""
if [ -n "$NPM_PREFIX_FOR_RUN" ] && [ -x "$NPM_PREFIX_FOR_RUN/bin/gru953-studio" ]; then
    CLI="$NPM_PREFIX_FOR_RUN/bin/gru953-studio"
elif command -v gru953-studio >/dev/null 2>&1; then
    CLI="$(command -v gru953-studio)"
fi
if [ -n "$CLI" ]; then
    say "Using $CLI (version $("$CLI" --version 2>/dev/null || echo 'unknown'))"
    "$CLI" install || INSTALL_STATUS=$?
else
    # Installed, but its folder is not on PATH yet — common with a fresh npm
    # prefix. Run it by its real path so the setup still completes, and let the
    # CLI's own PATH step deal with the cause.
    NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
    if [ -n "$NPM_PREFIX" ] && [ -x "$NPM_PREFIX/bin/gru953-studio" ]; then
        "$NPM_PREFIX/bin/gru953-studio" install || INSTALL_STATUS=$?
    else
        die "The GRU953-Studio command was installed but cannot be found afterwards.

Try closing and reopening your terminal, then run:  gru953-studio install

If that still does not find it, run this to see where npm put it:
  npm prefix -g"
    fi
fi

say ""
if [ "$INSTALL_STATUS" -ne 0 ]; then
    say "Setup did not finish cleanly (the setup step exited with status $INSTALL_STATUS)."
    say "Some apps may not be configured. What to do next is below either way."
    say ""
fi
say "Done. Type 'gru953-studio doctor' at any time to check everything is set up."
# CORRECTED 2026-08-22: this said /studio, a command renamed to /studio-start on 2026-08-17. A
# brand-new user's very first instruction was a command that no longer exists. The same line in
# install.ps1 was wrong in the same way and is corrected with it - fixing one instance of a shape
# and leaving its twin is the mistake this project calls L14.
say "In Claude Code, type /studio-start to begin."
exit "$INSTALL_STATUS"
