import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Shared by Books (pages) and Skills (lessons / minutes): an item sits on one
// of three shelves -- not started, in progress, done -- and moves between them
// either because the user explicitly moved it (a status) or because of how far
// along it is (progress out of a total).

export interface Shelves<S> {
  todo: S; // WANT_TO_READ / WANT_TO_LEARN
  doing: S; // READING / LEARNING
  done: S; // FINISHED / COMPLETED
}

export interface ShelfMessages {
  // Progress larger than the total, e.g. "Pages read can't be more than the total pages".
  overTotal: string;
  // Progress sent together with a move to the "not started" shelf.
  notStarted: string;
}

export interface ShelfItem<S> {
  status: S;
  progress: number;
  startedAt: Date | null;
  doneAt: Date | null;
}

export interface ShelfChange<S> {
  status?: S; // undefined: not sent
  progress?: number; // undefined: not sent
  total: number; // the (possibly edited) total, always known
}

export interface SettledShelf<S> extends ShelfItem<S> {
  // Whether the progress that was sent is what the item ended up with. A move
  // to done or to not-started decides the progress itself, so a progress sent
  // alongside it (say, the stale value of a full edit form) is not something
  // the user reported.
  progressReported: boolean;
}

// The shelf, progress and dates an item ends up with. `current` is null when
// the item is being created. An explicit status always wins, whatever the
// item's current shelf -- the same request gives the same result either way:
//  - status done            -> everything done (progress = total); a progress
//                              sent with it is not used
//  - status not started     -> back to zero; progress above zero is a 400
//  - status in progress     -> the progress sent (all of it -> done); none
//                              sent: a done item starts over at zero, any
//                              other keeps its progress
//  - no status              -> from the progress: all -> done, some -> in
//                              progress, none -> stays (done dropped to 0 is
//                              in progress). A done item whose details are
//                              edited without a progress (a page-count fix)
//                              stays done.
// A total lowered below the progress already recorded is rejected, not
// clamped: silently marking the item done would lose the real progress the
// moment the typo is fixed.
export function settleShelf<S>(shelves: Shelves<S>, current: ShelfItem<S> | null, change: ShelfChange<S>, now: Date, messages: ShelfMessages): SettledShelf<S> {
  const { total } = change;
  const from: ShelfItem<S> = current ?? { status: shelves.todo, progress: 0, startedAt: null, doneAt: null };
  if (change.progress !== undefined && change.progress > total) throw new BadRequestException(messages.overTotal);

  let status: S;
  let progress: number;
  let progressReported = change.progress !== undefined;

  if (change.status === shelves.done) {
    status = shelves.done;
    progress = total;
    progressReported = false;
  } else if (change.status === shelves.todo) {
    if (change.progress !== undefined && change.progress > 0) throw new BadRequestException(messages.notStarted);
    status = shelves.todo;
    progress = 0;
    progressReported = false;
  } else if (change.status !== undefined) {
    if (change.progress !== undefined) progress = change.progress;
    else if (from.status === shelves.done) progress = 0;
    else progress = from.progress;
    if (progress > total) throw new BadRequestException(messages.overTotal);
    status = progress >= total ? shelves.done : shelves.doing;
  } else {
    if (change.progress !== undefined) progress = change.progress;
    else if (from.status === shelves.done) progress = total;
    else progress = from.progress;
    if (progress > total) throw new BadRequestException(messages.overTotal);
    if (progress >= total) status = shelves.done;
    else if (progress > 0) status = shelves.doing;
    else status = from.status === shelves.done ? shelves.doing : from.status;
  }

  // Only an explicit "start over" (in progress requested on a done item,
  // landing at zero) resets the start date. Leaving the done shelf any other
  // way (reporting the real progress after a misclicked Finish) is a
  // correction, and keeps the original start date.
  const restarted = change.status === shelves.doing && from.status === shelves.done && progress === 0;
  let startedAt = from.startedAt;
  if (status === shelves.todo) startedAt = null;
  else if (startedAt === null || restarted) startedAt = now;
  const doneAt = status === shelves.done ? (from.doneAt ?? now) : null;

  return { status, progress, startedAt, doneAt, progressReported };
}

// Runs `attempt` again while its compare-and-swap write loses a race.
// `attempt` reads the row, derives the new values from it and writes them
// only if the row still has the updatedAt it read -- so a concurrent change
// (two tabs, "+10" racing an edit) is re-derived from, not overwritten.
export async function compareAndSwap<T>(attempt: () => Promise<T>, conflictMessage: string): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (error) {
      // P2025: the guarded update matched no row -- someone else wrote first.
      // (A deleted row is re-read on the next attempt and becomes a 404.)
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) throw error;
    }
  }
  throw new ConflictException(conflictMessage);
}
