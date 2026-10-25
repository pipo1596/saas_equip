// APITPCNTC's JSON parser caps each key at 10,000 characters, so a notice
// body (up to 65,000 chars) must be split across body, body2, body3 ...
// body7. Each chunk must stay well-formed HTML, so the cut can only land
// between a closing '>' and the next opening '<' — never mid-tag or
// mid-text. An empty string yields no keys at all, which matches the
// backend's "blank body on *UPDATE keeps the stored value" rule.
export function chunkNoticeBody(html: string, max = 10000): Record<string, string> {
  const out: Record<string, string> = {};
  let rest = html.trim();
  let n = 1;
  while (rest.length) {
    let cut = rest.length;
    if (cut > max) {
      cut = 0;
      for (let i = max; i > 0; i--) {
        if (rest[i] === '<' && rest[i - 1] === '>') { cut = i; break; }
      }
      if (!cut) throw new Error('Body has no safe split point; add paragraph breaks.');
    }
    out[n === 1 ? 'body' : `body${n}`] = rest.slice(0, cut);
    rest = rest.slice(cut);
    n++;
  }
  return out;
}
