// Settings › Profile's rules for the details a person tells about
// themselves; null when they are fine. Pure, so they are tested alone.

const MIN_AGE = 13;
const EARLIEST = '1920-01-01';

export function profileDetailsProblem(
  input: { dateOfBirth?: string; phone2Typed?: string; phone2?: string | null; mainPhone: string | null },
  today: string,
): string | null {
  if (input.dateOfBirth) {
    const [year, month, day] = today.split('-').map(Number);
    const youngest = `${year - MIN_AGE}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (input.dateOfBirth > today) return 'That date is in the future.';
    if (input.dateOfBirth > youngest) return 'You need to be at least 13 to use Smartly.';
    if (input.dateOfBirth < EARLIEST) return 'Check the year.';
  }
  if (input.phone2Typed) {
    if (!input.phone2) return 'Use a Bangladesh mobile number that starts with 13 to 19.';
    if (input.phone2 === input.mainPhone) return 'This is the same as your main number.';
  }
  return null;
}
