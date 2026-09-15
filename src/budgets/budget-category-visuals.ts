// Canonical icon/color key lists -- the DTO validates against these so a
// bad value can't reach the database; user-frontend's budgetCategoryVisuals.ts
// maps the same keys to actual lucide icons/Tailwind classes. Keep both
// lists in sync by hand.
//
// The first 18 keys (shopping..service) are the ORIGINAL set and must never
// be renamed or removed -- real BudgetCategory rows already have these
// stored in their `icon` column. Everything after that is an intentionally
// large addition (previously this list was capped at exactly 18 for a fixed
// 3-row-of-6 picker grid; the picker is now a scrollable, searchable grid
// instead, so there's no size constraint anymore) so a category name is far
// more likely to have a well-matched icon -- e.g. "Bonuses and Incentives"
// can now pick `trophy`/`medal`/`crown` alongside the original `bonus`
// (Award). New keys are the plain kebab-case lucide-react icon name itself
// (verified against the installed lucide-react version's icon exports)
// rather than an invented synonym, except where that name would collide
// with one of the original 18 (`home`/`car`/`gift` already exist under
// those exact strings, so the equivalent lucide icons aren't re-added under
// a second key).
export const BUDGET_CATEGORY_ICONS = [
  'shopping',
  'home',
  'car',
  'food',
  'entertainment',
  'health',
  'travel',
  'education',
  'clothing',
  'salary',
  'commission',
  'bonus',
  'rental',
  'interest',
  'investment',
  'dividend',
  'gift',
  'service',
  // Shopping / lifestyle
  'shopping-bag',
  'shopping-cart',
  'gem',
  'sparkles',
  'watch',
  'glasses',
  'shirt',
  // Home / utilities
  'house',
  'bed',
  'sofa',
  'lamp',
  'refrigerator',
  'washing-machine',
  'plug',
  'lightbulb',
  'thermometer',
  'wifi',
  'droplet',
  'flame',
  // Transport
  'bus',
  'train-front',
  'bike',
  'fuel',
  'truck',
  'ship',
  'anchor',
  // Travel
  'plane',
  'plane-takeoff',
  'luggage',
  'map-pin',
  'compass',
  'tent',
  'mountain',
  'waves',
  'globe',
  'map',
  // Food & dining
  'utensils',
  'coffee',
  'pizza',
  'cake',
  'cookie',
  'beer',
  'wine',
  'soup',
  'ice-cream-cone',
  'cake-slice',
  // Entertainment
  'drama',
  'clapperboard',
  'music',
  'gamepad-2',
  'tv',
  'film',
  'ticket',
  'puzzle',
  'dice-5',
  // Health & fitness
  'dumbbell',
  'heart-pulse',
  'stethoscope',
  'pill',
  'activity',
  'syringe',
  'bandage',
  // Education
  'graduation-cap',
  'book-open',
  'backpack',
  'pencil',
  // Family / relationships
  'heart',
  'baby',
  'dog',
  'cat',
  'paw-print',
  'users',
  'user',
  'user-round',
  'handshake',
  // Nature
  'flower',
  'flower-2',
  'leaf',
  'tree-pine',
  'sprout',
  'sun',
  'cloud',
  'snowflake',
  // Tools / maintenance
  'wrench',
  'paintbrush',
  'palette',
  'scissors',
  'key',
  'lock',
  'shield',
  // Money / finance (expense + income both draw from these)
  'wallet',
  'banknote',
  'banknote-arrow-up',
  'coins',
  'piggy-bank',
  'hand-coins',
  'credit-card',
  'receipt',
  'calculator',
  'percent',
  'trending-up',
  'trending-down',
  'landmark',
  // Business / work
  'building',
  'building-2',
  'factory',
  'store',
  'briefcase',
  // Achievement / reward -- directly covers the "Bonuses and Incentives"
  // gap this expansion was made for
  'trophy',
  'medal',
  'crown',
  'target',
  'rocket',
  // Celebrations / gifts
  'party-popper',
  // Tech / electronics
  'smartphone',
  'laptop',
  'monitor',
  'headphones',
  'camera',
  'printer',
  // Misc
  'package',
  'recycle',
  'battery',
  'spade',
  'club',
  'diamond',
  'star',
  'zap',
  'phone',
  'mail',
  'message-circle',
  'bell',
  'calendar',
  'clock',
  'timer',
  'flag',
] as const;

// Original 8 plus a few more distinct Tailwind hues -- still small enough
// that the color grid doesn't need its own search box.
export const BUDGET_CATEGORY_COLORS = [
  'blue',
  'green',
  'purple',
  'orange',
  'pink',
  'yellow',
  'red',
  'indigo',
  'teal',
  'cyan',
  'violet',
  'lime',
] as const;
