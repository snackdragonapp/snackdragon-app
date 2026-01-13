// components/realtime/RealtimeBridge.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/client';
import { shouldIgnoreRealtime } from '@/components/realtime/localWritePulse';
import { hasPendingOp, ackOp, ackOpByEntryId } from '@/components/realtime/opRegistry';

type RtState = 'idle' | 'connecting' | 'live' | 'error';
type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export type RealtimeBridgeProps = {
  /** Unique channel name within this tab, e.g. "rt-catalog-items" */
  channel: string;
  /** Table to subscribe to (in the given schema) */
  table: string;
  schema?: string;
  /**
   * Optional Postgres filter, e.g. "user_id=eq.<uuid>".
   * If omitted, we default to "user_id=eq.<current-user>" for tables that have user_id.
   * Pass "" to explicitly disable any filter (and rely solely on RLS), e.g. for `entries`.
   */
  filter?: string;
  /** Which events to listen for; defaults to INSERT/UPDATE/DELETE. */
  events?: PostgresEvent[];
  /** Debounce for router.refresh after an event. */
  debounceMs?: number;
  /**
   * How long after a local write to ignore realtime echoes in THIS tab.
   * Matches your Day bridge default.
   */
  ignoreLocalWritesTTL?: number;
  /**
   * Label shown in the little dev indicator, e.g. "Catalog" or "Goals".
   * Defaults to the table name.
   */
  devLabel?: string;
  /** Disable the dev indicator while still keeping the subscription. */
  showIndicator?: boolean;
};

export default function RealtimeBridge({
  channel,
  table,
  schema = 'public',
  filter,
  events,
  debounceMs = 250,
  ignoreLocalWritesTTL = 400,
  devLabel,
  showIndicator = true,
}: RealtimeBridgeProps) {
  const router = useRouter();
  const debounceRef = useRef<number | null>(null);
  const [rtState, setRtState] = useState<RtState>('idle');

  useEffect(() => {
    const supabase = getBrowserClient();
    let mounted = true;
    setRtState('idle');

    // Real channel instance for cleanup
    let chan: ReturnType<typeof supabase.channel> | null = null;

    const scheduleRefresh = () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(
        () => {
          if (mounted) {
            router.refresh();
          }
          debounceRef.current = null;
        },
        debounceMs
      );
    };

    type RowWithClientOpId = {
      client_op_id?: string | null;
      // keep it open so other columns don't cause type issues
      [key: string]: unknown;
    };

    type RtChangePayload = {
      new: RowWithClientOpId | null;
      old: RowWithClientOpId | null;
    };

    const handleChange = (payload: unknown) => {
      const p = payload as RtChangePayload & { eventType?: PostgresEvent };
      const eventType = p.eventType;
      const newRow: RowWithClientOpId = p?.new ?? {};
      const oldRow: RowWithClientOpId = p?.old ?? {};

      const rawOp =
        newRow.client_op_id ??
        oldRow.client_op_id ??
        null;

      const clientOpId =
        typeof rawOp === 'string' && rawOp.trim()
          ? rawOp.trim()
          : null;

      let ignore = false;

      // 1) Prefer op-id based matching (INSERT / UPDATE cases)
      if (clientOpId && hasPendingOp(clientOpId)) {
        ignore = true;
        ackOp(clientOpId);
      } else if (!clientOpId && eventType === 'DELETE') {
        // 2) DELETE + RLS: we only get the PK → match by entryId
        const entryId =
          typeof (oldRow as { id?: unknown }).id === 'string'
            ? (oldRow as { id?: string }).id
            : null;

        if (entryId && ackOpByEntryId(entryId)) {
          ignore = true; // local delete; we already removed it optimistically
        } else {
          // no pending op -> treat as remote delete
          ignore =
            ignoreLocalWritesTTL > 0
              ? shouldIgnoreRealtime(ignoreLocalWritesTTL)
              : false;
        }
      } else {
        // 3) Everything else: fall back to TTL ignore window
        ignore =
          ignoreLocalWritesTTL > 0
            ? shouldIgnoreRealtime(ignoreLocalWritesTTL)
            : false;
      }

      if (!ignore) scheduleRefresh();
    };

    const run = async () => {
      // Use getSession() to avoid a network auth call.
      // If there is no session, we don't subscribe.
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

      const evs: PostgresEvent[] =
        events && events.length ? events : ['INSERT', 'UPDATE', 'DELETE'];

      // Default to user_id filter for all your user-scoped tables.
      // If `filter` is provided (including ""), we use it as-is.
      const defaultFilter = `user_id=eq.${session.user.id}`;
      const effectiveFilter =
        filter === undefined ? defaultFilter : filter; // allow "" to mean "no filter"

      setRtState('connecting');

      type ChannelStatus = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT';

      // Minimal view of the RealtimeChannel API that we care about
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

      const rawChannel = supabase.channel(channel);
      let c = rawChannel as unknown as PgChannel;

      for (const ev of evs) {
        c = c.on(
          'postgres_changes',
          {
            event: ev,
            schema,
            table,
            ...(effectiveFilter ? { filter: effectiveFilter } : {}),
          },
          handleChange
        );
      }

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
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (chan) supabase.removeChannel(chan);
    };
  }, [channel, table, schema, filter, events, debounceMs, ignoreLocalWritesTTL, router]);

  // Dev-only indicator
  if (process.env.NODE_ENV === 'production' || !showIndicator) {
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

  const name = devLabel ?? table;

  return (
    <div className="fixed bottom-2 left-2 z-40 pointer-events-none">
      <div className="flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[10px] text-subtle-foreground shadow-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span>
          {name}: {label}
        </span>
      </div>
    </div>
  );
}
