// components/EntriesList.tsx
'use client';

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useSyncExternalStore,
} from 'react';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
  reorderEntriesAction,
  updateEntryQtyAction,
  updateEntryQtyAndStatusAction,
  deleteEntryAction,
} from '@/app/actions';
import DataList from '@/components/primitives/DataList';
import ListRow from '@/components/primitives/ListRow';
import Grip from '@/components/icons/Grip';
import Trash from '@/components/icons/Trash';
import {
  registerPendingOp,
  hasSavingOpForEntry,
  subscribeToPendingOps,
  ackOp,
  completeOp,
} from '@/components/realtime/opRegistry';
import useStickyBoolean from '@/hooks/useStickyBoolean';

export type Entry = {
  id: string;
  name: string;
  qty: string;
  unit: string;
  kcal_snapshot: number;
  status: 'planned' | 'eaten';
  created_at: string;
  kcal_per_unit_snapshot?: number | null;
  /** Server-side position within the day (0-based). */
  ordering?: number;
};

type EntryAddedListener = (entry: Entry) => void;
const entryAddedListeners = new Set<EntryAddedListener>();

export function subscribeToEntryAdds(listener: EntryAddedListener): () => void {
  entryAddedListeners.add(listener);
  return () => {
    entryAddedListeners.delete(listener);
  };
}

export function emitEntryAdded(entry: Entry): void {
  for (const listener of entryAddedListeners) {
    listener(entry);
  }
}

/* ---------- Realtime change bus (for DayEntriesRealtime) ---------- */

export type EntryRealtimeChange =
  | { type: 'insert'; entry: Entry }
  | { type: 'update'; entry: Entry }
  | { type: 'delete'; id: string };

type EntryRealtimeListener = (change: EntryRealtimeChange) => void;
const entryRealtimeListeners = new Set<EntryRealtimeListener>();

export function subscribeToEntryRealtimeChanges(
  listener: EntryRealtimeListener
): () => void {
  entryRealtimeListeners.add(listener);
  return () => {
    entryRealtimeListeners.delete(listener);
  };
}

export function emitEntryRealtimeChange(change: EntryRealtimeChange): void {
  for (const listener of entryRealtimeListeners) {
    listener(change);
  }
}

/* Mounted guard to avoid SSR/CSR attribute mismatches on the drag handle */
function useIsMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// Debounce an arbitrary callback
function useDebouncedCallback(delay = 600) {
  const t = useRef<number | null>(null);

  const schedule = useCallback(
    (fn: () => void) => {
      if (t.current) window.clearTimeout(t.current);
      t.current = window.setTimeout(() => {
        fn();
        t.current = null;
      }, delay);
    },
    [delay]
  );

  const cancel = useCallback(() => {
    if (t.current) {
      window.clearTimeout(t.current);
      t.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (t.current) window.clearTimeout(t.current);
    };
  }, []);

  return { schedule, cancel };
}

/**
 * Derived "Saving…" flag for a given entry id based on the global
 * pending-op registry, with a little stickiness to avoid flicker.
 */
function useEntrySaving(entryId: string, minOnMs = 250): boolean {
  const rawSaving = useSyncExternalStore(
    subscribeToPendingOps,
    () => hasSavingOpForEntry(entryId),
    () => false
  );
  return useStickyBoolean(rawSaving, minOnMs);
}

/** Helper: consistently sort entries by ordering (if present). */
function sortByOrdering(entries: Entry[]): Entry[] {
  if (!entries.length) return entries;
  const anyOrdering = entries.some(
    (e) => typeof e.ordering === 'number' && Number.isFinite(e.ordering)
  );
  if (!anyOrdering) return entries;
  const copy = [...entries];
  copy.sort((a, b) => {
    const ao =
      typeof a.ordering === 'number' && Number.isFinite(a.ordering)
        ? (a.ordering as number)
        : Number.MAX_SAFE_INTEGER;
    const bo =
      typeof b.ordering === 'number' && Number.isFinite(b.ordering)
        ? (b.ordering as number)
        : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    // stable-ish fallback: created_at
    return a.created_at.localeCompare(b.created_at);
  });
  return copy;
}

export default function EntriesList({
  entries,
  selectedYMD,
  activeGoalKcal,
  dogId,
}: {
  entries: Entry[];
  selectedYMD: string;
  /** Optional kcal/day goal for this date (used for the summary line). */
  activeGoalKcal?: number | null;
  dogId: string;
}) {
  const [items, setItems] = useState<Entry[]>(sortByOrdering(entries));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(sortByOrdering(entries));
  }, [entries]);

  useEffect(() => {
    const unsubscribe = subscribeToEntryAdds((entry) => {
      setItems((prev) => [...prev, entry]);
    });
    return unsubscribe;
  }, []);

  // Apply remote Realtime changes (from DayEntriesRealtime) to local items state.
  useEffect(() => {
    const unsubscribe = subscribeToEntryRealtimeChanges((change) => {
      setItems((prev) => {
        switch (change.type) {
          case 'insert': {
            const exists = prev.some((e) => e.id === change.entry.id);
            if (exists) {
              const updated = prev.map((e) =>
                e.id === change.entry.id ? { ...e, ...change.entry } : e
              );
              return sortByOrdering(updated);
            }
            const appended = [...prev, change.entry];
            return sortByOrdering(appended);
          }
          case 'update': {
            const exists = prev.some((e) => e.id === change.entry.id);
            if (!exists) {
              const appended = [...prev, change.entry];
              return sortByOrdering(appended);
            }
            const updated = prev.map((e) =>
              e.id === change.entry.id ? { ...e, ...change.entry } : e
            );
            return sortByOrdering(updated);
          }
          case 'delete': {
            const filtered = prev.filter((e) => e.id !== change.id);
            return filtered;
          }
          default:
            return prev;
        }
      });
    });
    return unsubscribe;
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  async function persistOrder(next: Entry[], prev: Entry[], movedEntryId: string) {
    const opId = crypto.randomUUID();
    try {
      setSaving(true);

      registerPendingOp({
        id: opId,
        kind: 'reorder',
        entryIds: next.map((e) => e.id),   // all rows touched in the DB
        savingEntryIds: [movedEntryId],    // ONLY this row shows "Saving…"
        startedAt: Date.now(),
      });

      await reorderEntriesAction({
        date: selectedYMD,
        ids: next.map((e) => e.id),
        client_op_id: opId,
        dog_id: dogId,
      });

      // Clear Saving… immediately on server completion.
      // Keep the op briefly so Realtime echoes can still match & be ignored.
      completeOp(opId);

      // still no router.refresh; rely on optimistic + Realtime
    } catch (err) {
      console.error(err);
      ackOp(opId);     // clear op so nothing gets stuck
      setItems(prev);
      alert('Reorder failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((x) => x.id === active.id);
    const newIndex = items.findIndex((x) => x.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const prev = items;
    const reordered = arrayMove(items, oldIndex, newIndex);
    const next = reordered.map((e, idx) => ({ ...e, ordering: idx }));

    setItems(next);

    const movedEntryId = String(active.id); // dnd-kit id = your entry id
    void persistOrder(next, prev, movedEntryId);
  }

  function applyQtyOptimistic(id: string, newQty: number) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;

        // Prefer the canonical per-unit snapshot if we have it
        let perUnit =
          it.kcal_per_unit_snapshot != null
            ? Number(it.kcal_per_unit_snapshot)
            : undefined;

        // Fallback for very old rows that don't have a snapshot yet:
        if (perUnit == null) {
          const baseQty = parseFloat(String(it.qty)) || 0;
          const baseKcal = Number(it.kcal_snapshot) || 0;
          if (baseQty > 0 && Number.isFinite(baseKcal)) {
            perUnit = Number((baseKcal / baseQty).toFixed(4));
          }
        }

        if (perUnit == null || !Number.isFinite(perUnit) || perUnit <= 0) {
          // Give up on kcal optimism, but still update the qty text
          return {
            ...it,
            qty: String(newQty),
          };
        }

        const nextKcal = Number((perUnit * newQty).toFixed(2));

        return {
          ...it,
          qty: String(newQty),
          kcal_snapshot: nextKcal,
          // Freeze the per-unit so future edits don't re-derive it
          kcal_per_unit_snapshot: perUnit,
        };
      })
    );
  }

  function applyStatusOptimistic(id: string, next: 'planned' | 'eaten') {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: next } : it)));
  }

  function applyDeleteOptimistic(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function restoreEntry(entry: Entry) {
    setItems((prev) => {
      if (prev.some((e) => e.id === entry.id)) return prev;
      return sortByOrdering([...prev, entry]);
    });
  }

  if (items.length === 0) {
    return (
      <DataList>
        <li className="py-2 text-sm text-muted-foreground">No entries yet.</li>
      </DataList>
    );
  }

  const disableDnD = saving;

  // Derive totals from the optimistic local items
  const { totalPlanned, totalEaten } = items.reduce(
    (acc, it) => {
      if (it.status === 'planned') acc.totalPlanned += it.kcal_snapshot;
      else if (it.status === 'eaten') acc.totalEaten += it.kcal_snapshot;
      return acc;
    },
    { totalPlanned: 0, totalEaten: 0 }
  );

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <DataList>
            {items.map((e) => (
              <SortableEntry
                key={e.id}
                e={e}
                selectedYMD={selectedYMD}
                disabled={disableDnD}
                onQtyOptimistic={applyQtyOptimistic}
                onStatusOptimistic={applyStatusOptimistic}
                onDeleteOptimistic={applyDeleteOptimistic}
                onRestoreDeleted={restoreEntry}
              />
            ))}
          </DataList>
        </SortableContext>
      </DndContext>

      {/* Totals + optional goal, based on local optimistic state */}
      <div className="space-y-1">
        <div className="pt-3 mt-2 border-t text-sm grid grid-cols-2 gap-x-10 gap-y-1">
          <div>
            <span className="font-medium">Eaten:</span> {totalEaten.toFixed(0)} kcal
          </div>
          <div className="text-right">
            <span className="font-medium">Total:</span> {(totalPlanned + totalEaten).toFixed(0)} kcal
          </div>

          <div>
            <span className="font-medium">Planned:</span> {totalPlanned.toFixed(0)} kcal
          </div>
          {activeGoalKcal != null ? (
            <div className="text-right leading-tight">
              Goal:&nbsp;
              <span className="font-medium tabular-nums">{activeGoalKcal.toFixed(0)}</span>
              &nbsp;kcal
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ---- Single sortable row ---- */

type SortableEntryProps = {
  e: Entry;
  selectedYMD: string;
  disabled?: boolean;
  onQtyOptimistic: (id: string, qty: number) => void;
  onStatusOptimistic: (id: string, next: 'planned' | 'eaten') => void;
  onDeleteOptimistic: (id: string) => void;
  onRestoreDeleted: (entry: Entry) => void;
};

function SortableEntry({
  e,
  selectedYMD,
  disabled,
  onQtyOptimistic,
  onStatusOptimistic,
  onDeleteOptimistic,
  onRestoreDeleted,
}: SortableEntryProps) {
  const mounted = useIsMounted();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: e.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const showSaving = useEntrySaving(e.id, 250);
  const qtyRef = useRef<AutoSaveQtyFormHandle | null>(null);

  return (
    <ListRow
      ref={setNodeRef}
      style={style}
      handle={
        <button
          type="button"
          aria-label="Drag to reorder"
          className="
            relative
            h-full w-4 md:w-[18px]
            flex items-center justify-center
            cursor-grab active:cursor-grabbing
            select-none touch-none bg-control disabled:opacity-60
            rounded focus:outline-none focus:ring-2 focus:ring-control-ring

            /* Mobile hit-slope WITHOUT widening the column */
            before:content-['']
            before:absolute before:inset-y-0
            before:-left-5 before:-right-2
            md:before:inset-0
          "
          {...(mounted ? attributes : {})}
          {...(mounted ? listeners : {})}
          suppressHydrationWarning
          disabled={disabled}
        >
          <Grip className="text-handle text-lg md:text-base" />
        </button>
      }
      content={
        <div className="grid grid-cols-[44px_1fr_auto] md:grid-cols-[22px_1fr_auto] gap-x-2 gap-y-0">
          {/* Col 1: checkbox spans both rows */}
          <div className="col-[1/2] row-span-2 flex items-center justify-center">
            <CheckboxStatusForm
              entryId={e.id}
              currentStatus={e.status}
              selectedYMD={selectedYMD}
              initialQtyStr={e.qty}
              getLatestQty={() => qtyRef.current?.getLatestQty() ?? null}
              onSubmitOptimistic={(next) => onStatusOptimistic(e.id, next)}
              onPreSubmit={() => qtyRef.current?.cancelPending()}
            />
          </div>

          {/* Row 1 / Col 2: name */}
          <div className="col-[2/3] row-[1/2]">
            <div className="font-medium">{e.name}</div>
          </div>

          {/* Row 1 / Col 3: kcal */}
          <div className="col-[3/4] row-[1/2] flex items-center justify-end">
            <div className="text-sm">{Number(e.kcal_snapshot).toFixed(0)} kcal</div>
          </div>

          {/* Row 2 / Col 2: qty editor */}
          <div className="col-[2/3] row-[2/3] mt-0.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <AutoSaveQtyForm
                ref={qtyRef}
                entryId={e.id}
                unit={e.unit}
                initialQty={e.qty}
                selectedYMD={selectedYMD}
                onQtyOptimistic={(q) => onQtyOptimistic(e.id, q)}
                readOnly={e.status === 'eaten'}
              />
            </div>
          </div>

          {/* Row 2 / Col 3: Saving… indicator (space is reserved even when hidden) */}
          <div className="col-[3/4] row-[2/3] mt-0.5 flex items-center justify-end">
            <span
              className={`text-[11px] text-subtle-foreground whitespace-nowrap ${
                showSaving ? '' : 'invisible'
              }`}
              aria-live="polite"
              aria-atomic="true"
            >
              Saving…
            </span>
          </div>
        </div>
      }
      actions={
        <EntryDeleteButton
          entry={e}
          selectedYMD={selectedYMD}
          onDeleteOptimistic={onDeleteOptimistic}
          onRestoreDeleted={onRestoreDeleted}
        />
      }
    />
  );
}

function EntryDeleteButton({
  entry,
  // selectedYMD is not required by deleteEntryAction today, but keeping it here
  // makes it easy to add later if you choose (and keeps the call sites stable).
  selectedYMD,
  onDeleteOptimistic,
  onRestoreDeleted,
}: {
  entry: Entry;
  selectedYMD: string;
  onDeleteOptimistic: (id: string) => void;
  onRestoreDeleted: (entry: Entry) => void;
}) {
  const onClick = () => {
    const ok = window.confirm('Delete this entry?');
    if (!ok) return;

    // Optimistic UI first
    onDeleteOptimistic(entry.id);

    const opId = crypto.randomUUID();
    registerPendingOp({
      id: opId,
      kind: 'delete',
      entryIds: [entry.id],
      startedAt: Date.now(),
    });

    void (async () => {
      try {
        const fd = new FormData();
        fd.set('entry_id', entry.id);
        fd.set('date', selectedYMD);
        fd.set('client_op_id', opId);

        await deleteEntryAction(fd);

        // Clear Saving… immediately on server completion
        completeOp(opId);
      } catch (err) {
        console.error(err);
        ackOp(opId);

        // Rollback optimistic delete
        onRestoreDeleted(entry);

        alert('Delete failed. Please try again.');
      }
    })();
  };

  const klass =
    'inline-flex h-11 w-11 md:h-7 md:w-7 items-center justify-center rounded ' +
    'hover:bg-button-danger-hover focus:outline-none focus:ring-2 focus:ring-danger';

  const dims = 'h-5 w-5 md:h-4 md:w-4';

  return (
    <button
      type="button"
      onClick={onClick}
      className={klass}
      aria-label="Delete entry"
      title="Delete entry"
    >
      <Trash className={dims} aria-hidden="true" />
    </button>
  );
}

/* ----- Auto-save qty sub-component (awaited server action) ----- */

export type AutoSaveQtyFormHandle = {
  commitNow: () => void;
  getLatestQty: () => number | null;
  cancelPending: () => void;
};

const AutoSaveQtyForm = forwardRef<
  AutoSaveQtyFormHandle,
  {
    entryId: string;
    unit: string;
    initialQty: string;
    selectedYMD: string;
    onQtyOptimistic: (qty: number) => void;
    readOnly?: boolean;
  }
>(function AutoSaveQtyForm(
  { entryId, unit, initialQty, selectedYMD, onQtyOptimistic, readOnly = false },
  ref
) {
  const [val, setVal] = useState(initialQty);

  const { schedule: scheduleDebounced, cancel: cancelDebounce } = useDebouncedCallback(600);

  // Prevent a late error handler from “rolling back” a newer qty.
  const lastOpRef = useRef<string | null>(null);

  // Track the last qty we consider "committed" (best-effort).
  const lastGoodQtyRef = useRef<number | null>(null);

  const parseQty = useCallback((v: string): number | null => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, []);

  // Keep input in sync when server refresh/realtime replaces props
  useEffect(() => {
    setVal(initialQty);
    const n = parseQty(initialQty);
    if (n != null) lastGoodQtyRef.current = n;
  }, [initialQty, parseQty]);

  const sendQty = useCallback(
    async (opId: string, qty: number, prevGood: number | null) => {
      lastOpRef.current = opId;

      registerPendingOp({
        id: opId,
        kind: 'update_qty',
        entryIds: [entryId],
        startedAt: Date.now(),
      });

      try {
        const fd = new FormData();
        fd.set('date', selectedYMD);
        fd.set('entry_id', entryId);
        fd.set('qty', String(qty));
        fd.set('client_op_id', opId);

        await updateEntryQtyAction(fd);

        // Clear Saving… immediately on server completion
        completeOp(opId);

        // Only advance the "good" pointer if this is still the latest op.
        if (lastOpRef.current === opId) {
          lastGoodQtyRef.current = qty;
        }
      } catch (err) {
        console.error(err);
        ackOp(opId);

        // Only rollback if this is still the latest attempted qty write.
        if (lastOpRef.current === opId) {
          if (prevGood != null) {
            onQtyOptimistic(prevGood);
            setVal(String(prevGood));
          } else {
            // fallback: revert to the last prop
            setVal(initialQty);
          }
          alert('Update failed. Please try again.');
        }
      }
    },
    [entryId, selectedYMD, onQtyOptimistic, initialQty]
  );

  const commit = useCallback(
    (next: number, mode: 'debounced' | 'immediate') => {
      // Update optimistic UI immediately
      onQtyOptimistic(next);

      const prevGood = lastGoodQtyRef.current;

      if (mode === 'immediate') {
        cancelDebounce();
        const opId = crypto.randomUUID();
        void sendQty(opId, next, prevGood);
      } else {
        scheduleDebounced(() => {
          const opId = crypto.randomUUID();
          void sendQty(opId, next, prevGood);
        });
      }
    },
    [onQtyOptimistic, sendQty, scheduleDebounced, cancelDebounce]
  );

  useImperativeHandle(
    ref,
    () => ({
      commitNow: () => {
        const n = parseQty(val);
        if (n != null) commit(n, 'immediate');
      },
      getLatestQty: () => {
        const n = parseQty(val);
        return n;
      },
      cancelPending: () => {
        cancelDebounce();
      },
    }),
    [val, parseQty, commit, cancelDebounce]
  );

  return (
    <div className="flex items-center gap-1">
      {readOnly ? (
        <>
          {/* Text-only when eaten */}
          <span className="font-medium">{val}</span>
          <span>{unit}</span>
        </>
      ) : (
        <>
          <label htmlFor={`qty-${entryId}`} className="sr-only">
            Quantity
          </label>
          <input
            id={`qty-${entryId}`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={val}
            onInput={(e) => {
              const nextStr = e.currentTarget.value;
              setVal(nextStr);
              const n = parseQty(nextStr);
              if (n != null) commit(n, 'debounced');
            }}
            onBlur={(e) => {
              const n = parseQty(e.currentTarget.value);
              if (n != null) {
                commit(n, 'immediate');
              } else {
                // Invalid/blank -> revert to last known qty
                cancelDebounce();
                setVal(initialQty);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur(); // blur triggers immediate commit
              }
            }}
            className="w-20 border rounded px-2 py-1 text-xs"
          />
          <span>{unit}</span>
        </>
      )}
    </div>
  );
});

/* ----- Checkbox status form (awaited server action) ----- */
function CheckboxStatusForm({
  entryId,
  currentStatus,
  selectedYMD,
  initialQtyStr,
  getLatestQty,
  onSubmitOptimistic,
  onPreSubmit,
}: {
  entryId: string;
  currentStatus: 'planned' | 'eaten';
  selectedYMD: string;
  /** string form of qty from props, used as fallback initial hidden value */
  initialQtyStr: string;
  /** read the latest typed qty from the sibling qty editor */
  getLatestQty?: () => number | null;
  onSubmitOptimistic: (next: 'planned' | 'eaten') => void;
  onPreSubmit: () => void; // cancel qty debounce before toggling
}) {
  // Prevent a late error handler from “rolling back” a newer toggle.
  const lastOpRef = useRef<string | null>(null);

  return (
    <label
      className="flex items-center justify-center h-11 w-11 md:h-auto md:w-auto cursor-pointer"
      title={currentStatus === 'eaten' ? 'Mark as planned' : 'Mark as eaten'}
    >
      <input
        id={`eaten-${entryId}`}
        type="checkbox"
        className="
          h-5 w-5 md:h-4 md:w-4
          cursor-pointer
          border border-input rounded
          accent-control-accent
          outline-none focus:ring-2 focus:ring-control-ring
        "
        aria-label="Eaten"
        checked={currentStatus === 'eaten'}
        onChange={(e) => {
          // Cancel any pending qty debounce; we will send qty ourselves
          onPreSubmit();

          const prev = currentStatus;
          const next: 'planned' | 'eaten' = e.currentTarget.checked ? 'eaten' : 'planned';

          // Optimistic UI first (keeps checkbox controlled by React, no form-reset flicker)
          onSubmitOptimistic(next);

          // Read latest qty and fall back to initial
          const latest = getLatestQty ? getLatestQty() : null;
          const fallback = parseFloat(String(initialQtyStr)) || 0;
          const qtyToSend =
            latest != null && Number.isFinite(latest) && latest > 0
              ? latest
              : Number.isFinite(fallback) && fallback > 0
              ? fallback
              : 1; // last-resort safety; server requires > 0

          const opId = crypto.randomUUID();
          lastOpRef.current = opId;

          registerPendingOp({
            id: opId,
            kind: 'update_qty_and_status',
            entryIds: [entryId],
            startedAt: Date.now(),
          });

          const fd = new FormData();
          fd.set('date', selectedYMD);
          fd.set('entry_id', entryId);
          fd.set('next_status', next);
          fd.set('qty', String(qtyToSend));
          fd.set('client_op_id', opId);

          void (async () => {
            try {
              await updateEntryQtyAndStatusAction(fd);

              // Clear Saving… immediately on server completion
              completeOp(opId);
            } catch (err) {
              console.error(err);

              // Clear the pending-op, otherwise “Saving…” can get stuck
              ackOp(opId);

              // Only rollback if this is still the latest attempted toggle
              if (lastOpRef.current === opId) {
                onSubmitOptimistic(prev);
                alert('Update failed. Please try again.');
              }
            }
          })();
        }}
      />
    </label>
  );
}
