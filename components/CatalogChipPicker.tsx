// components/CatalogChipPicker.tsx
'use client';

import { useMemo, useState } from 'react';
import { registerPendingOp, completeOp, ackOp } from '@/components/realtime/opRegistry';
import {
  emitEntryAdded,
  emitEntryRealtimeChange,
  type Entry as DayEntry,
} from '@/components/EntriesList';
import { toast } from '@/components/primitives/Toast';

type Item = {
  id: string;
  name: string;
  unit: string;
  kcal_per_unit: number | string;
  default_qty: number | string;
  created_at: string;
  // From RPC (not required by the UI, but harmless to keep around):
  last_used_date?: string | null;
  first_order_on_last_day?: number | null;
};

export default function CatalogChipPicker({
  items,
  selectedYMD,
  dayId,
  dogId,
  addFromCatalogAction,
  visibleLimit = 20,
}: {
  items: Item[];
  selectedYMD: string;
  /** Preferred: day row id for the selected date (Phase 2.1) */
  dayId: string;
  dogId: string;
  addFromCatalogAction: (formData: FormData) => Promise<void>;
  /** How many to show when the search box is empty */
  visibleLimit?: number;
}) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) =>
      it.name.toLowerCase().includes(s) || it.unit.toLowerCase().includes(s)
    );
  }, [q, items]);

  // Show only the top N (by the server’s ordering) when q is empty.
  const display = q.trim() ? filtered : filtered.slice(0, visibleLimit);
  const truncated = !q.trim() && filtered.length > visibleLimit;

  return (
    <div>
      {/* Live search input */}
      <div className="mb-2 flex items-center gap-2">
        <label htmlFor="catalog-q" className="sr-only">Search catalog</label>
        <input
          id="catalog-q"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search catalog…"
          className="border rounded px-2 py-1 text-sm flex-1 min-w-0"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="rounded border px-2 py-1 text-sm hover:bg-control-hover"
          >
            Clear
          </button>
        )}
      </div>

      {/* Chips list (filtered live, keeps original ordering from server) */}
      <div className="flex flex-wrap gap-2">
        {display.map((it) => (
          <CatalogChipButton
            key={it.id}
            item={it}
            selectedYMD={selectedYMD}
            dayId={dayId}
            dogId={dogId}
            addFromCatalogAction={addFromCatalogAction}
          />
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-muted-foreground">No matches.</div>
        )}
        {truncated && (
          <div className="text-xs text-subtle-foreground">
            Showing top {visibleLimit}. Type to search all.
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogChipButton({
  item,
  selectedYMD,
  dayId,
  dogId,
  addFromCatalogAction,
}: {
  item: Item;
  selectedYMD: string;
  dayId: string;
  dogId: string;
  addFromCatalogAction: (formData: FormData) => Promise<void>;
}) {
  const onClick = () => {
    // Generate ids for THIS gesture
    const opId = crypto.randomUUID();
    const entryId = crypto.randomUUID();

    // Build an optimistic Entry shape for the Day list
    const baseQty = Number(item.default_qty ?? 0);
    const mult = 1; // current UI always uses mult=1
    const qty = baseQty * mult;

    if (!Number.isFinite(qty) || qty < 0) {
      toast({
        tone: 'error',
        message: 'This catalog item has an invalid default serving. Edit it in Catalog first.',
        durationMs: 3500,
      });
      return;
    }

    const perUnitRaw = Number(item.kcal_per_unit ?? 0);
    const perUnit = Number(perUnitRaw.toFixed(4));
    const kcal = Number((qty * perUnit).toFixed(2));

    const optimisticEntry: DayEntry = {
      id: entryId,
      name: item.name,
      qty: qty.toString(),
      unit: item.unit,
      kcal_snapshot: kcal,
      status: 'planned',
      created_at: new Date().toISOString(),
      kcal_per_unit_snapshot: perUnit,
    };

    // Push into EntriesList's local state immediately
    emitEntryAdded(optimisticEntry);

    toast({
      tone: 'success',
      message: `Added: ${item.name}`,
      durationMs: 1400,
    });

    // Register this op locally so Realtime can recognize its echo
    registerPendingOp({
      id: opId,
      kind: 'add_from_catalog',
      entryIds: [entryId],
      startedAt: Date.now(),
    });

    // Now perform the server action (awaited) without a form submit.
    void (async () => {
      try {
        const fd = new FormData();
        fd.set('date', selectedYMD);
        fd.set('day_id', dayId); // ✅ Phase 2.1: preferred path (1 RPC)
        fd.set('mult', '1');
        fd.set('catalog_item_id', item.id);
        fd.set('client_op_id', opId);
        fd.set('entry_id', entryId);

        // Keep dog_id for backward-compat fallback paths
        fd.set('dog_id', dogId);

        await addFromCatalogAction(fd);

        // Clear "Saving…" immediately on server completion
        completeOp(opId);
      } catch (err) {
        console.error(err);

        // Remove op + rollback optimistic row
        ackOp(opId);
        emitEntryRealtimeChange({ type: 'delete', id: entryId });

        toast({
          tone: 'error',
          message: 'Add failed. Please try again.',
          durationMs: 3500,
        });
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="border rounded px-2 py-1 text-left text-xs bg-chip-face hover:bg-chip-hover active:bg-chip-pressed focus:outline-none focus:ring-2 focus:ring-control-ring"
      aria-label={`Add ${item.name}`}
    >
      <div className="font-medium">{item.name}</div>
      <div className="text-[11px] text-muted-foreground">
        {Number(item.default_qty).toString()} {item.unit}
      </div>
    </button>
  );
}
