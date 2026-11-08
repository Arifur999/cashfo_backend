import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BackupEvery, DataBackupKind, Prisma, Role, type Business } from '@prisma/client';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { AccountBalanceService } from '../accounts/account-balance.service.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ownedWhere, planBackup, quoteIdent, type ForeignKey, type PlannedTable } from './backup-plan.js';
import { autoBackupDue, inBackupWindow } from './backup-rules.js';

// What a backup holds: the workspaces it covers and, per table, its rows
// as Postgres wrote them (JSON text, never parsed into numbers here, so a
// restore writes back exactly what was read).
interface Payload {
  format: number;
  takenAt: string;
  workspaces: { id: string; name: string }[];
  tables: Record<string, string>;
}
interface Catalog {
  plan: PlannedTable[];
  fks: ForeignKey[];
  columns: Map<string, Set<string>>;
}
type Client = Prisma.TransactionClient | PrismaService;

const FORMAT = 1;
export const KEEP_CHOICES = [3, 5, 10] as const;
// Copies taken just before a restore, kept so it can be undone.
const UNDO_COPIES = 2;
// People given an automatic backup in one housekeeping tick.
const AUTO_BATCH = 100;
// A restore rewrites every record in the person's workspaces.
const RESTORE_TIMEOUT_MS = 120_000;

// Settings › Data & privacy › Backup and restore: a copy of the money
// records in every workspace the person owns (not Password Manager, not
// the Habit Tracker), kept in Smartly; automatic at 2:00 at night or made
// by hand, and put back on request.
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private catalog?: Promise<Catalog>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: AccountBalanceService,
  ) {}

  async page(userId: string) {
    const [user, backups] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { backupAuto: true, backupEvery: true, backupKeep: true } }),
      this.prisma.dataBackup.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, createdAt: true, size: true, rawSize: true, workspaces: true },
      }),
    ]);
    return {
      settings: { auto: user.backupAuto, every: user.backupEvery === BackupEvery.DAILY ? 'daily' : 'weekly', keep: user.backupKeep },
      backups: backups.map(({ rawSize: _raw, ...backup }) => backup),
      storage: {
        backups: backups.reduce((sum, backup) => sum + backup.size, 0),
        records: backups.find((backup) => backup.kind !== DataBackupKind.BEFORE_RESTORE)?.rawSize ?? null,
      },
    };
  }

  // A keep lowered takes effect at the next backup, so no copy is lost to a
  // slip of the menu.
  async updateSettings(userId: string, dto: { auto?: boolean; every?: 'daily' | 'weekly'; keep?: number }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.auto !== undefined && { backupAuto: dto.auto }),
        ...(dto.every !== undefined && { backupEvery: dto.every === 'daily' ? BackupEvery.DAILY : BackupEvery.WEEKLY }),
        ...(dto.keep !== undefined && { backupKeep: dto.keep }),
      },
    });
    return this.page(userId);
  }

  // "Back up now".
  async backUpNow(userId: string) {
    const made = await this.capture(userId, DataBackupKind.MANUAL);
    if (!made) throw new BadRequestException('You have no workspace to back up yet.');
    return this.page(userId);
  }

  // A copy of the person's workspaces as they are, read in one snapshot so
  // a posting halfway through never splits. An automatic one identical to
  // the newest copy is not kept twice. Null when there is nothing to copy.
  async capture(userId: string, kind: DataBackupKind): Promise<{ id: string } | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const payload = await this.snapshot(tx, userId);
        if (payload.workspaces.length === 0) return null;
        const hash = hashOf(payload);
        if (kind === DataBackupKind.AUTO) {
          const newest = await tx.dataBackup.findFirst({
            where: { userId, kind: { not: DataBackupKind.BEFORE_RESTORE } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, hash: true },
          });
          if (newest?.hash === hash) return newest;
        }
        return this.store(tx, userId, kind, payload, hash);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: RESTORE_TIMEOUT_MS },
    );
  }

  // Puts a backup back: every record in each workspace it covers is
  // replaced by the copy's. Workspaces made since, or deleted since, are
  // left alone, and so is one locked with a PIN this request carries no
  // unlock for. A copy of how things are right now is taken first (the
  // undo). Referral withdrawals already paid into a wallet stay, with
  // the wallets and categories they need.
  async restore(userId: string, backupId: string, isShut: (workspace: Business) => boolean) {
    const backup = await this.prisma.dataBackup.findFirst({ where: { id: backupId, userId } });
    if (!backup) throw new NotFoundException('Backup not found');
    const payload = JSON.parse(gunzipSync(backup.data).toString('utf8')) as Payload;
    if (payload.format !== FORMAT) throw new BadRequestException('This backup can not be read by this version of Smartly.');
    const covered = new Set(payload.workspaces.map((workspace) => workspace.id));
    const owned = await this.prisma.business.findMany({ where: { ownerId: userId, deletedAt: null, id: { in: [...covered] } } });
    const locked = owned.filter((workspace) => isShut(workspace));
    const open = owned.filter((workspace) => !isShut(workspace)).map((workspace) => workspace.id);
    if (open.length === 0) {
      throw new BadRequestException(
        locked.length > 0 ? 'Open your workspaces with their PIN first, then restore.' : 'None of the workspaces in this backup is yours any more.',
      );
    }
    const { plan, fks, columns } = await this.loadCatalog();
    const keep = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { backupKeep: true } });

    const undo = await this.prisma
      .$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Business" WHERE id = ANY(${open}::text[]) AND "ownerId" = ${userId} AND "deletedAt" IS NULL FOR UPDATE`;
          const ids = rows.map((row) => row.id);
          if (ids.length === 0) throw new BadRequestException('None of the workspaces in this backup is yours any more.');
          const before = await this.snapshot(tx, userId);
          const undo = await this.store(tx, userId, DataBackupKind.BEFORE_RESTORE, before, hashOf(before), keep.backupKeep);

          for (const step of [...plan].reverse()) {
            await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdent(step.table)} WHERE ${ownedWhere(plan, step.table, '$1')}`, ids);
          }
          for (const step of plan) {
            await this.writeRows(tx, columns, step.table, payload.tables[step.table], ownedWhere(plan, step.table, '$2', 'r'), ids);
          }
          await this.keepPayouts(tx, { plan, fks, columns }, before, ids);
          return undo;
        },
        { timeout: RESTORE_TIMEOUT_MS, maxWait: 10_000 },
      )
      .catch((error: unknown) => {
        // A row the database no longer takes (a value removed since the
        // backup was made): nothing was changed, the whole restore rolled back.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
          this.logger.warn(`Restore of backup ${backupId} failed: ${error.message}`);
          throw new BadRequestException('This backup can no longer be put back. Nothing was changed.');
        }
        throw error;
      });
    return {
      restored: open.length,
      locked: locked.map((workspace) => workspace.name),
      undoId: undo.id,
      takenAt: backup.createdAt,
    };
  }

  // Automatic backups, between 2:00 and 8:00 at night on the Dhaka
  // calendar: daily, or a week after the last. Each person is claimed first (autoBackupOn), so
  // two servers or an overlapping tick never take it twice.
  async runAuto(now = new Date()): Promise<number> {
    const today = dhakaDateKey(now);
    if (!inBackupWindow(now)) return 0;
    const weekAgo = dhakaDateKey(new Date(now.getTime() - 7 * 86_400_000));
    const people = await this.prisma.user.findMany({
      where: {
        role: Role.USER,
        status: 'ACTIVE',
        backupAuto: true,
        ownedBusinesses: { some: { deletedAt: null } },
        OR: [
          { autoBackupOn: null },
          { backupEvery: BackupEvery.DAILY, autoBackupOn: { lt: today } },
          { backupEvery: BackupEvery.WEEKLY, autoBackupOn: { lte: weekAgo } },
        ],
      },
      select: { id: true, backupEvery: true, autoBackupOn: true },
      orderBy: { id: 'asc' },
      take: AUTO_BATCH,
    });
    let made = 0;
    for (const person of people) {
      if (!autoBackupDue(person.backupEvery, person.autoBackupOn, today)) continue;
      const { count } = await this.prisma.user.updateMany({ where: { id: person.id, autoBackupOn: person.autoBackupOn }, data: { autoBackupOn: today } });
      if (count !== 1) continue;
      try {
        if (await this.capture(person.id, DataBackupKind.AUTO)) made++;
      } catch (error) {
        this.logger.warn(`Automatic backup for ${person.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return made;
  }

  private async snapshot(client: Client, userId: string): Promise<Payload> {
    const { plan, columns } = await this.loadCatalog();
    const workspaces = await client.business.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    const ids = workspaces.map((workspace) => workspace.id);
    const tables: Record<string, string> = {};
    if (ids.length > 0) {
      for (const step of plan) {
        // In a steady order, so an unchanged workspace hashes the same.
        const order = columns.get(step.table)?.has('id') ? 't."id"' : 't::text';
        const [row] = await client.$queryRawUnsafe<{ rows: string }[]>(
          `SELECT coalesce(json_agg(t ORDER BY ${order}), '[]')::text AS rows FROM ${quoteIdent(step.table)} t WHERE ${ownedWhere(plan, step.table, '$1', 't')}`,
          ids,
        );
        tables[step.table] = row.rows;
      }
    }
    return { format: FORMAT, takenAt: new Date().toISOString(), workspaces, tables };
  }

  private async store(client: Client, userId: string, kind: DataBackupKind, payload: Payload, hash: string, keep?: number) {
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const data = gzipSync(raw);
    const made = await client.dataBackup.create({
      data: { userId, kind, size: data.length, rawSize: raw.length, hash, workspaces: payload.workspaces.length, data },
      select: { id: true },
    });
    const limit = keep ?? (await client.user.findUniqueOrThrow({ where: { id: userId }, select: { backupKeep: true } })).backupKeep;
    const [older, olderUndo] = await Promise.all([
      client.dataBackup.findMany({
        where: { userId, kind: { not: DataBackupKind.BEFORE_RESTORE } },
        orderBy: { createdAt: 'desc' },
        skip: limit,
        select: { id: true },
      }),
      client.dataBackup.findMany({
        where: { userId, kind: DataBackupKind.BEFORE_RESTORE },
        orderBy: { createdAt: 'desc' },
        skip: UNDO_COPIES,
        select: { id: true },
      }),
    ]);
    const gone = [...older, ...olderUndo].map((row) => row.id);
    if (gone.length > 0) await client.dataBackup.deleteMany({ where: { id: { in: gone } } });
    return made;
  }

  // Writes a table's rows from a backup, the columns the table still has
  // (one added since takes its default), only those `where` keeps.
  private async writeRows(client: Client, columns: Map<string, Set<string>>, table: string, rows: string | undefined, where: string, ...params: unknown[]) {
    if (!rows || rows === '[]') return;
    const [first] = await client.$queryRawUnsafe<{ keys: string[] }[]>(`SELECT array(SELECT json_object_keys($1::json -> 0)) AS keys`, rows);
    const now = columns.get(table) ?? new Set<string>();
    const cols = first.keys.filter((key) => now.has(key)).map(quoteIdent);
    if (cols.length === 0) return;
    await client.$executeRawUnsafe(
      `INSERT INTO ${quoteIdent(table)} (${cols.join(', ')}) SELECT ${cols.map((col) => `r.${col}`).join(', ')} FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json) r WHERE ${where}`,
      rows,
      ...params,
    );
  }

  // A referral withdrawal paid into a wallet after the backup was taken
  // stays: its posting, the posting's lines and anything they point at
  // that the backup lacks come back from the copy taken just before.
  private async keepPayouts(tx: Prisma.TransactionClient, { plan, fks, columns }: Catalog, before: Payload, ids: string[]) {
    const payouts = await tx.payoutRequest.findMany({
      where: { incomeBusinessId: { in: ids }, incomeTransactionId: { not: null } },
      select: { incomeTransactionId: true },
    });
    const wanted = payouts.map((payout) => payout.incomeTransactionId!);
    if (wanted.length === 0) return;

    const owned = new Set(plan.map((step) => step.table));
    const parsed = new Map<string, Record<string, unknown>[]>();
    const rowsOf = (table: string) => {
      if (!parsed.has(table)) parsed.set(table, JSON.parse(before.tables[table] ?? '[]') as Record<string, unknown>[]);
      return parsed.get(table)!;
    };
    const present = async (table: string, column: string, values: string[]) => {
      if (values.length === 0) return new Set<string>();
      const found = await tx.$queryRawUnsafe<{ v: string }[]>(
        `SELECT ${quoteIdent(column)}::text AS v FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)}::text = ANY($1::text[])`,
        values,
      );
      return new Set(found.map((row) => row.v));
    };
    const carry = new Map<string, Set<string>>();
    const add = (table: string, row: Record<string, unknown>) => {
      const id = String(row.id);
      const set = carry.get(table) ?? new Set<string>();
      if (set.has(id)) return false;
      set.add(id);
      carry.set(table, set);
      return true;
    };

    const there = await present('Transaction', 'id', wanted);
    const lost = new Set(wanted.filter((id) => !there.has(id)));
    if (lost.size === 0) return;
    for (const row of rowsOf('Transaction')) if (lost.has(String(row.id))) add('Transaction', row);
    // The rows that can't stand without them (their lines).
    for (const fk of fks) {
      if (fk.references !== 'Transaction' || !fk.notNull || !owned.has(fk.table) || !columns.get(fk.table)?.has('id')) continue;
      for (const row of rowsOf(fk.table)) if (lost.has(String(row[fk.column]))) add(fk.table, row);
    }
    // And whatever they point at that the restored records lack.
    for (let grew = true; grew;) {
      grew = false;
      for (const fk of fks) {
        const ids = carry.get(fk.table);
        if (!ids || !owned.has(fk.references) || !columns.get(fk.references)?.has('id')) continue;
        const values = [
          ...new Set(
            rowsOf(fk.table)
              .filter((row) => ids.has(String(row.id)) && row[fk.column] != null)
              .map((row) => String(row[fk.column])),
          ),
        ];
        const found = await present(fk.references, fk.refColumn, values);
        for (const value of values) {
          if (found.has(value)) continue;
          const parent = rowsOf(fk.references).find((row) => String(row[fk.refColumn]) === value);
          if (parent && add(fk.references, parent)) grew = true;
        }
      }
    }
    for (const step of plan) {
      const carried = carry.get(step.table);
      if (carried)
        await this.writeRows(
          tx,
          columns,
          step.table,
          before.tables[step.table],
          `r."id" = ANY($2::text[]) AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(step.table)} x WHERE x."id" = r."id")`,
          [...carried],
        );
    }
    // The wallets those lines touch, summed again.
    const lines = carry.get('TransactionEntry');
    const accounts = new Set(
      rowsOf('TransactionEntry')
        .filter((row) => lines?.has(String(row.id)))
        .map((row) => String(row.accountId)),
    );
    for (const accountId of accounts) await this.balances.recalculateBalance(accountId, tx);
  }

  private loadCatalog(): Promise<Catalog> {
    this.catalog ??= (async () => {
      const unquote = (name: string) => name.replace(/^"|"$/g, '');
      const fks = await this.prisma.$queryRaw<ForeignKey[]>`
        SELECT c.conrelid::regclass::text AS "table", a.attname AS "column", c.confrelid::regclass::text AS "references", r.attname AS "refColumn", a.attnotnull AS "notNull"
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute r ON r.attrelid = c.confrelid AND r.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND cardinality(c.conkey) = 1 AND c.connamespace = current_schema()::regnamespace`;
      const cols = await this.prisma.$queryRaw<{ table: string; column: string }[]>`
        SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns WHERE table_schema = current_schema() AND is_generated = 'NEVER'`;
      const columns = new Map<string, Set<string>>();
      for (const { table, column } of cols) columns.set(table, (columns.get(table) ?? new Set<string>()).add(column));
      const clean = fks.map((fk) => ({ ...fk, table: unquote(fk.table), references: unquote(fk.references) }));
      return { plan: planBackup(clean), fks: clean, columns };
    })().catch((error: unknown) => {
      this.catalog = undefined;
      throw error;
    });
    return this.catalog;
  }
}

// The records and the workspaces they belong to, not when they were read.
const hashOf = (payload: Payload) =>
  createHash('sha256')
    .update(JSON.stringify({ workspaces: payload.workspaces, tables: payload.tables }))
    .digest('hex');
