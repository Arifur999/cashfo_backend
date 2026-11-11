// A person's initials ("Arif Mahmud" → "A. M."), shown in a group in place
// of the name of someone who turned off "Show my name in groups".
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length
    ? words
        .slice(0, 2)
        .map((word) => `${[...word][0]?.toLocaleUpperCase() ?? ''}.`)
        .join(' ')
    : '?';
}
