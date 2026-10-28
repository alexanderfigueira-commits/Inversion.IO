/** Issue content is plain text. Blank lines separate paragraphs, single line breaks stay inside one. */
export const paragraphs = (content) =>
  String(content ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/** A short plain text teaser for archive listings. */
export function excerpt(content, max = 200) {
  const first = paragraphs(content)[0] ?? '';
  if (first.length <= max) return first;
  return `${first.slice(0, max).replace(/\s+\S*$/, '')}...`;
}
