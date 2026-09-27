// Interpreting browser window titles (read with GetWindowText). This is the only thing we
// "read" from the pages, and it is what Windows shows in the taskbar anyway.

const SIGN_IN_PATTERNS = [/\bsign in\b/i, /\bsign-in\b/i, /google accounts/i, /choose an account/i, /verify it'?s you/i, /2-step verification/i];

export function looksLikeSignIn(title: string): boolean {
  return SIGN_IN_PATTERNS.some((p) => p.test(title));
}

/** Strip the browser/service suffixes so labels show the programme name. */
export function cleanTitle(title: string): string {
  let t = title.trim();
  t = t.replace(/\s+[-–—|]\s+(Google Chrome|Microsoft Edge|Personal - Microsoft​? Edge)$/i, '');
  t = t.replace(/\s+[-–—|]\s+YouTube( TV)?$/i, '').replace(/^YouTube TV\s+[-–—|]\s+/i, '');
  t = t.replace(/^\(\d+\)\s+/, ''); // YouTube's "(3) " notification-count prefix
  return t === 'YouTube TV' || t === 'YouTube' ? '' : t;
}
