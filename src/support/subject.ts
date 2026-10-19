const MAX_SUBJECT = 80;

// A message's subject for the support inbox: its first line, spaces
// squeezed, cut at a word near 80 characters.
export function subjectOf(message: string): string {
  const firstLine = message.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim();
  if (firstLine.length <= MAX_SUBJECT) return firstLine;
  const cut = firstLine.slice(0, MAX_SUBJECT - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_SUBJECT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
