// components/realtime/DayEntriesRealtime.tsx
'use client';

import { useEffect, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase/client';
import {
  hasPendingOp,
  hasPendingOpForEntry,
  ackOp,
  ackOpByEntryId,
} from '@/components/realtime/opRegistry';
import type { Entry } from '@/components/EntriesList';
import { emitEntryRealtimeChange } from '@/components/EntriesList';

type RtState = 'idle' | 'connecting' | 'live' | 'error';
type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE';

type RowWithClientOpId = {
  id?: unknown;
  client_op_id?: string | null;
  [key: string]: unknown;
};

type RtChangePayload = {
  eventType?: PostgresEvent;
  new: RowWithClientOpId | null;
  old: RowWithClientOpId | null;
};

function rowToEntry(row: RowWithClientOpId): Entry | null {
  const id = typeof row.id === 'string' ? row.id : null;
  if (!id) return null;

  const name =
    typeof (row as { name?: unknown }).name === 'string'
      ? ((row as { name?: unknown }).name as string)
      : '';
  const unit =
    typeof (row as { unit?: unknown }).unit === 'string'
      ? ((row as { unit?: unknown }).unit as string)
      : '';

  const qtyRaw = (row as { qty?: unknown }).qty;
  const kcalRaw = (row as { kcal_snapshot?: unknown }).kcal_snapshot;
  const statusRaw = (row as { status?: unknown }).status;
  const createdRaw = (row as { created_at?: unknown }).created_at;
  const kpuRaw = (row as { kcal_per_unit_snapshot?: unknown }).kcal_per_unit_snapshot;
  const orderingRaw = (row as { ordering?: unknown }).ordering;

  const qtyNum =
    typeof qtyRaw === 'number'
      ? qtyRaw
      : qtyRaw != null
      ? Number(qtyRaw)
      : NaN;
  const qtyStr = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum.toString() : '0';

  const kcalNum =
    typeof kcalRaw === 'number'
      ? kcalRaw
      : kcalRaw != null
      ? Number(kcalRaw)
      : 0;

  const status: 'planned' | 'eaten' =
    statusRaw === 'eaten' ? 'eaten' : 'planned';

  const createdAt =
    typeof createdRaw === 'string'
      ? createdRaw
      : new Date().toISOString();

  const kpuNum =
    kpuRaw == null
      ? null
      : typeof kpuRaw === 'number'
      ? kpuRaw
      : Number(kpuRaw);

  let ordering: number | undefined;
  if (typeof orderingRaw === 'number') {
    ordering = orderingRaw;
  } else if (orderingRaw != null) {
    const o = Number(orderingRaw);
    if (Number.isFinite(o)) ordering = o;
  }

  const base: Entry = {
    id,
    name,
    unit,
    qty: qtyStr,
    kcal_snapshot: Number.isFinite(kcalNum) ? Number(kcalNum) : 0,
    status,
    created_at: createdAt,
    kcal_per_unit_snapshot: kpuNum,
  };

  return ordering != null ? { ...base, ordering } : base;
}

export default function DayEntriesRealtime({ dayId }: { dayId: string }) {
  const [rtState, setRtState] = useState<RtState>('idle');

  useEffect(() => {
    const supabase = getBrowserClient();
    let mounted = true;
    setRtState('idle');

    let chan: ReturnType<typeof supabase.channel> | null = null;

    const handleChange = (payload: unknown) => {
      const p = payload as RtChangePayload;
      const eventType = p.eventType;
      const newRow = p.new;
      const oldRow = p.old;

      const rawOp =
        (newRow?.client_op_id ?? oldRow?.client_op_id) ?? null;

      const clientOpId =
        typeof rawOp === 'string' && rawOp.trim()
          ? rawOp.trim()
          : null;

      const idVal = newRow?.id ?? oldRow?.id;
      const entryId = typeof idVal === 'string' ? idVal : null;

      let matchedLocalOp = false;

      if (clientOpId && hasPendingOp(clientOpId)) {
        matchedLocalOp = true;
        ackOp(clientOpId);
      } else if (entryId && hasPendingOpForEntry(entryId)) {
        matchedLocalOp = true;
      }

      if (!clientOpId && eventType === 'DELETE') {
        const oldId = oldRow?.id;
        const entryId = typeof oldId === 'string' ? oldId : null;
        if (entryId && ackOpByEntryId(entryId)) {
          matchedLocalOp = true;
        }
      }

      if (matchedLocalOp) {
        // Local optimistic op just got its DB echo; UI is already up to date.
        return;
      }

      // Remote change: patch the EntriesList local state instead of refreshing.
      if (eventType === 'INSERT' || eventType === 'UPDATE') {
        if (!newRow) return;
        const entry = rowToEntry(newRow);
        if (!entry) return;

        emitEntryRealtimeChange({
          type: eventType === 'INSERT' ? 'insert' : 'update',
          entry,
        });
      } else if (eventType === 'DELETE') {
        const oldId = oldRow?.id;
        const entryId = typeof oldId === 'string' ? oldId : null;
        if (!entryId) return;

        emitEntryRealtimeChange({
          type: 'delete',
          id: entryId,
        });
      }
    };

    const run = async () => {
      // Use getSession() to avoid a network auth call.
      // Realtime will only subscribe when we have a valid local session.
      let { data: { session } } = await supabase.auth.getSession();
      if (!mounted || !session?.user) {
        return;
      }

      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!mounted) return;

      if (!refreshError && refreshed.session) {
        session = refreshed.session;
      }

      supabase.realtime.setAuth(session.access_token);

      setRtState('connecting');

      type ChannelStatus =
        | 'SUBSCRIBED'
        | 'CLOSED'
        | 'CHANNEL_ERROR'
        | 'TIMED_OUT';

      type PgChannel = {
        on(
          type: 'postgres_changes',
          params: {
            event: PostgresEvent | '*';
            schema: string;
            table?: string;
            filter?: string;
          },
          callback: (payload: unknown) => void
        ): PgChannel;
        subscribe(callback: (status: ChannelStatus) => void): unknown;
      };

      const rawChannel = supabase.channel(`rt-day-entries-${dayId}`);
      const c = rawChannel as unknown as PgChannel;

      (['INSERT', 'UPDATE', 'DELETE'] as PostgresEvent[]).forEach((ev) => {
        c.on(
          'postgres_changes',
          {
            event: ev,
            schema: 'public',
            table: 'entries',
            filter: `day_id=eq.${dayId}`,
          },
          handleChange
        );
      });

      chan = c.subscribe((status: ChannelStatus) => {
        if (!mounted) return;
        if (status === 'SUBSCRIBED') {
          setRtState('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRtState('error');
        } else if (status === 'CLOSED') {
          setRtState('idle');
        }
      }) as ReturnType<typeof supabase.channel>;
    };

    void run();

    return () => {
      mounted = false;
      if (chan) supabase.removeChannel(chan);
    };
  }, [dayId]);

  // Dev-only indicator; hide in production
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  let label: string = rtState;
  if (rtState === 'connecting') label = 'connecting…';
  if (rtState === 'live') label = 'live';
  if (rtState === 'error') label = 'error (retrying)';

  const dotClass =
    rtState === 'live'
      ? 'bg-emerald-500'
      : rtState === 'connecting'
      ? 'bg-amber-400'
      : rtState === 'error'
      ? 'bg-rose-500 animate-pulse'
      : 'bg-zinc-400';

  return (
    <div className="fixed bottom-2 left-2 z-40 pointer-events-none">
      <div className="flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[10px] text-subtle-foreground shadow-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span>Day entries: {label}</span>
      </div>
    </div>
  );
}
