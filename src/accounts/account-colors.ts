// The card colours a money account can wear (Balance > Accounts, Add or Edit
// account): ten, as the board offers them. Stored lowercase; null draws the
// account's type in its own colour.
import { GOAL_COLORS } from '../savings-goals/goal-colors.js';

export const ACCOUNT_COLORS = ['#1c7567', '#0f766e', '#0e7490', '#2563eb', '#4f46e5', '#7c3aed', '#be185d', '#b91c1c', '#c2410c', '#33413e'] as const;

// Any colour an account may be saved with: those, and the savings colours a
// savings account picks from (Savings accounts > Add or Edit, the same set
// as the goal cards).
export const CARD_COLORS: readonly string[] = [...ACCOUNT_COLORS, ...GOAL_COLORS];
