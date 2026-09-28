// Shared class-transformer / class-validator helpers for the Habit Tracker DTOs.

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Optional fields use ValidateIf(whenSent), not IsOptional: IsOptional also
// skips an explicit null, which would then reach the service as a value (a
// null title would crash it, a null status would count as "moved to a shelf").
export const whenSent = (_: unknown, value: unknown) => value !== undefined;
