/**
 * Puts user-provided text inside clearly delimited data blocks and escapes
 * the delimiter if it appears inside to guard against prompt injection.
 */
export function wrapUntrusted(text) {
  if (text == null) return '<<<USER_DATA\n\n>>>';
  const str = String(text);
  // Escapes the delimiters if they appear inside
  const escaped = str
    .replace(/<<<USER_DATA/g, '<\\<<USER_DATA')
    .replace(/>>>/g, '>\\>>');
  return `<<<USER_DATA\n${escaped}\n>>>`;
}
