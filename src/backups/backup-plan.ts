// Which tables hold a workspace's records, in what order they are written
// back, and how each row is tied to its workspace -- worked out from the
// database's own foreign keys, so a table added later is backed up without
// anyone remembering to list it.

// A single-column foreign key, as pg_constraint describes it.
export interface ForeignKey {
  table: string;
  column: string;
  references: string;
  refColumn: string;
  notNull: boolean;
}

export interface PlannedTable {
  table: string;
  // The required column that ties a row to its workspace: businessId itself,
  // or a column pointing at a row of an earlier table (`parent`).
  column: string;
  parent: string | null;
  refColumn: string;
}

export const ROOT = 'Business';
// Not part of a backup: who may open the workspace stays as it is, and the
// bell is not money. A group's access links are keys, not records: a restore
// must never bring back a link already used or replaced (an old RESET link
// would set the password of a login that has since moved on), so they are
// left out and the owner makes new ones.
export const NOT_BACKED_UP = ['BusinessMember', 'UserNotification', 'GroupAccessLink'] as const;

// Every table that belongs to a workspace, parents before children.
export function planBackup(fks: readonly ForeignKey[], skip: readonly string[] = NOT_BACKED_UP): PlannedTable[] {
  const owned = new Map<string, PlannedTable>();
  const counts = (fk: ForeignKey) => fk.notNull && fk.table !== ROOT && fk.table !== fk.references && !skip.includes(fk.table);
  // Straight under the workspace first, so a table that has both a
  // businessId and a parent row is filtered by its own businessId.
  for (const fk of fks) {
    if (counts(fk) && fk.references === ROOT && !owned.has(fk.table))
      owned.set(fk.table, { table: fk.table, column: fk.column, parent: null, refColumn: fk.refColumn });
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const fk of fks) {
      if (counts(fk) && !owned.has(fk.table) && owned.has(fk.references)) {
        owned.set(fk.table, { table: fk.table, column: fk.column, parent: fk.references, refColumn: fk.refColumn });
        grew = true;
      }
    }
  }

  // Parents first: a table waits for every other workspace table it points
  // at, nullable columns too (a row may point at one).
  const waitsFor = new Map<string, Set<string>>([...owned.keys()].map((table) => [table, new Set<string>()]));
  for (const fk of fks) {
    if (owned.has(fk.table) && owned.has(fk.references) && fk.table !== fk.references) waitsFor.get(fk.table)!.add(fk.references);
  }
  const ordered: PlannedTable[] = [];
  const placed = new Set<string>();
  while (placed.size < owned.size) {
    const ready = [...owned.keys()].filter((table) => !placed.has(table) && [...waitsFor.get(table)!].every((parent) => placed.has(parent))).sort();
    if (ready.length === 0) {
      const stuck = [...owned.keys()].filter((table) => !placed.has(table)).sort();
      throw new Error(`Workspace tables point at each other in a loop: ${stuck.join(', ')}`);
    }
    for (const table of ready) {
      placed.add(table);
      ordered.push(owned.get(table)!);
    }
  }
  return ordered;
}

const quoted = (name: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unexpected table or column name: ${name}`);
  return `"${name}"`;
};
export { quoted as quoteIdent };

// The SQL condition that keeps a table's rows to the workspaces in `param`
// (a text[] parameter such as $1), on `alias`'s columns.
export function ownedWhere(plan: readonly PlannedTable[], table: string, param: string, alias = ''): string {
  const step = plan.find((row) => row.table === table);
  if (!step) throw new Error(`${table} is not a workspace table`);
  quoted(table);
  const column = `${alias ? `${alias}.` : ''}${quoted(step.column)}`;
  if (!step.parent) return `${column} = ANY(${param}::text[])`;
  return `${column} IN (SELECT ${quoted(step.refColumn)} FROM ${quoted(step.parent)} WHERE ${ownedWhere(plan, step.parent, param)})`;
}
