// Escapes text interpolated into an email's HTML body. A user's own name is
// free text (registration accepts anything up to its length limit), so without
// this a name like `<a href="https://evil.example">Click here</a>` would render
// as real markup inside an email that genuinely comes from us.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
