// The card colours a savings goal, a saving plan and a savings account can
// wear (the Savings boards' colour row): muted, deep tones ordered so
// neighbours blend. Stored lowercase.
export const GOAL_COLORS = ['#235347', '#6b8f71', '#6b7334', '#1f5f66', '#2f5d8a', '#2b3a67', '#5b3a6e', '#a35d72', '#7a2e3a', '#b0593a', '#9c7a30', '#6e4f3a', '#3a4447'] as const;

// A colour as it is stored: trimmed and lowercase.
export const lowerColor = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
