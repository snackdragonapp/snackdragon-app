// components/realtime/opRegistry.ts
'use client';

export type OpKind =
  | 'add_from_catalog'
  | 'update_qty'
  | 'update_qty_and_status'
  | 'delete'
  | 'reorder';

export type PendingOp = {
  id: string;
  kind: OpKind;
  // Entries this op actually touches in the DB (used by Realtime ignore logic)
  entryIds?: string[];
  // Optional subset of entries that should show a "Saving…" indicator.
  // If omitted, we fall back to entryIds.
  savingEntryIds?: string[];
  startedAt: number;
};

const pending = new Map<string, PendingOp>();

// Simple subscription mechanism so React hooks can listen for changes.
const subscribers = new Set<() => void>();

function emitChange() {
  for (const fn of subscribers) {
    try {
      fn();
    } catch (err) {
      console.error('[opRegistry] subscriber error', err);
    }
  }
}

/**
 * When we "complete" an op (server action resolved), we clear Saving… immediately,
 * but keep the op around briefly so Realtime echoes can still be matched/ignored.
 *
 * If the echo never arrives (disconnect), we GC completed ops after this TTL so
 * they don't block future remote updates (hasPendingOpForEntry).
 */
const COMPLETE_GC_MS = 5_000;
const cleanupTimers = new Map<string, number>();

function clearCleanupTimer(id: string) {
  const t = cleanupTimers.get(id);
  if (t != null) {
    window.clearTimeout(t);
    cleanupTimers.delete(id);
  }
}

function scheduleCleanup(id: string) {
  clearCleanupTimer(id);
  const t = window.setTimeout(() => {
    // If still present, drop it.
    if (pending.has(id)) {
      pending.delete(id);
      emitChange();
    }
    cleanupTimers.delete(id);
  }, COMPLETE_GC_MS);

  cleanupTimers.set(id, t);
}

/**
 * Subscribe to any change in the pending-op registry.
 * Returns an unsubscribe function.
 */
export function subscribeToPendingOps(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function registerPendingOp(op: PendingOp) {
  // If we re-register an id (should be rare), ensure no stale GC timer remains.
  clearCleanupTimer(op.id);

  pending.set(op.id, op);
  emitChange();
}

/**
 * Mark an op as "completed" (server action resolved), which immediately clears
 * "Saving…" indicators, but keeps the op for a short time so Realtime echoes can
 * still match and remove it.
 */
export function completeOp(id: string) {
  const op = pending.get(id);
  if (!op) return;

  pending.set(id, {
    ...op,
    // IMPORTANT: empty array means "show Saving… for no entries"
    savingEntryIds: [],
  });

  emitChange();
  scheduleCleanup(id);
}

export function ackOp(id: string) {
  const op = pending.get(id);
  if (!op) return;

  clearCleanupTimer(id);
  pending.delete(id);

  emitChange();
}

export function hasPendingOp(id: string): boolean {
  return pending.has(id);
}

/**
 * True if ANY pending op currently references this entry id.
 */
export function hasPendingOpForEntry(entryId: string): boolean {
  for (const op of pending.values()) {
    if (op.entryIds?.includes(entryId)) return true;
  }
  return false;
}

export function hasSavingOpForEntry(entryId: string): boolean {
  for (const op of pending.values()) {
    const ids = op.savingEntryIds ?? op.entryIds;
    if (ids?.includes(entryId)) return true;
  }
  return false;
}

// Handy for debugging
export function listPendingOps(): PendingOp[] {
  return Array.from(pending.values());
}

/**
 * Acknowledge and clear all ops that mention the given entry id.
 * Returns true if we matched at least one op.
 */
export function ackOpByEntryId(entryId: string): boolean {
  let matched = false;
  for (const [id, op] of pending.entries()) {
    if (op.entryIds?.includes(entryId)) {
      clearCleanupTimer(id);
      pending.delete(id);
      matched = true;
    }
  }
  if (matched) {
    emitChange();
  }
  return matched;
}
