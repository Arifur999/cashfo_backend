// Colours and icons a skill can have. The frontend has the matching lists
// (components/modules/Customer/HabitTracker/Skills/skillPalette.ts) -- keep the keys in sync.
export const SKILL_COLORS = ['violet', 'indigo', 'lime', 'teal', 'rose', 'amber', 'sky', 'slate', 'red'] as const;

export const SKILL_ICONS = [
  'sparkles',
  'code',
  'palette',
  'music',
  'languages',
  'camera',
  'dumbbell',
  'pen',
  'calculator',
  'brain',
  'chef',
  'briefcase',
  'graduation',
] as const;

// The groups My skills sorts skills into (the SkillsList board); the
// frontend names them and draws their icons.
export const SKILL_CATEGORIES = ['tech', 'lang', 'design', 'biz', 'deen', 'life'] as const;

// Limits of the v16 Skills pages.
export const SKILL_LIMITS = {
  skills: 200,
  name: 120,
  source: 80,
  link: 300,
  why: 200,
  // A course of up to 5000 lessons or chapters, or 5000 hours (in minutes).
  count: 5000,
  minutes: 5000 * 60,
  minutesPerDay: 24 * 60,
  practiceNote: 500,
  steps: 100,
  stepTitle: 120,
  notes: 500,
  noteTitle: 80,
  noteText: 3000,
  resources: 100,
  resourceTitle: 120,
  // A deleted skill can be brought back for this long.
  undoMs: 24 * 60 * 60 * 1000,
} as const;
