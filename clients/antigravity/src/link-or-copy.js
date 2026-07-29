// link-or-copy.js — 2026-07-26 audit finding 18. Extracted from index.js so
// the fallback logic itself can be tested directly, independent of the
// rest of the initialization script.
//
// A plain symlink needs Developer Mode (or admin) on Windows, which most
// Windows users have neither enabled nor even heard of. A JUNCTION does the
// same job (a directory alias the filesystem itself resolves) but needs no
// special privilege there — the correct first attempt on that platform, not
// a plain symlink. If linking still fails for any reason on any platform,
// fall back to an actual recursive copy, so the target content is genuinely
// present either way, rather than a caught-and-ignored error leaving an
// empty directory while the caller reports success anyway.
const fs = require('fs');

function linkOrCopy(sourceDir, targetPath, platform = process.platform) {
    try {
        if (platform === 'win32') {
            fs.symlinkSync(sourceDir, targetPath, 'junction');
        } else {
            fs.symlinkSync(sourceDir, targetPath);
        }
        return { ok: true, method: 'linked' };
    } catch {
        try {
            fs.cpSync(sourceDir, targetPath, { recursive: true });
            return { ok: true, method: 'copied (linking was not possible here)' };
        } catch (copyErr) {
            return { ok: false, error: copyErr };
        }
    }
}

module.exports = { linkOrCopy };
