// Lightweight access gate, matching the pattern already used for other
// UKLASH internal GitHub Pages tools. This is NOT real security — anyone
// who opens dev tools can read this value in the bundled source. It only
// exists to stop the tool being casually found/used, not to protect data
// (no sell-through data ever leaves the browser; everything is processed
// client-side).
//
// Change this before deploying, and again any time you want to rotate it.
export const ACCESS_PASSPHRASE = 'UKLASH2026'

export const SESSION_STORAGE_KEY = 'sell-through-normalizer:unlocked'
