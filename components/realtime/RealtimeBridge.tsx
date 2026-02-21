// components/realtime/RealtimeBridge.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/client';
import { shouldIgnoreRealtime } from '@/components/realtime/localWritePulse';
import { hasPendingOp, ackOp, ackOpByEntryId } from '@/components/realtime/opRegistry';
import { validateRealtimePayload } from '@/components/realtime/validatePayload';
import { reportRealtimeStatus } from '@/components/realtime/RealtimeStatusToast';

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

  // Report status changes to the global toast system
  useEffect(() => {
    reportRealtimeStatus(rtState);
  }, [rtState]);

  useEffect(() => {
    const supabase = getBrowserClient();
    let mounted = true;
    let userId: string | null = null;
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

    const handleChange = (payload: unknown) => {
      const validated = validateRealtimePayload(payload);
      if (!validated) {
        // Malformed payload; ignore to prevent crashes
        return;
      }

      const { eventType, new: newRow, old: oldRow } = validated;

      const rawOp =
        newRow?.client_op_id ??
        oldRow?.client_op_id ??
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

    let retryTimer: number | null = null;
    let channelSeq = 0;

    const scheduleRetry = () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (mounted && userId) subscribe(userId);
      }, 3000);
    };

    const subscribe = (uid: string) => {
      if (!mounted) return;
      if (retryTimer) { window.clearTimeout(retryTimer); retryTimer = null; }
      if (chan) { supabase.removeChannel(chan); chan = null; }

      channelSeq++;
      setRtState('connecting');

      const evs: PostgresEvent[] =
        events && events.length ? events : ['INSERT', 'UPDATE', 'DELETE'];

      const defaultFilter = `user_id=eq.${uid}`;
      const effectiveFilter =
        filter === undefined ? defaultFilter : filter;

      const rawChannel = supabase.channel(`${channel}-${channelSeq}`);
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
          scheduleRetry();
        } else if (status === 'CLOSED') {
          setRtState('idle');
        }
      }) as ReturnType<typeof supabase.channel>;
    };

    // Use getUser() to get authoritative user data.
    // This avoids race conditions with getSession() when the session cache
    // hasn't been updated yet (e.g., after ClientAuthSync calls setSession()).
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted || !data.user) {
        return;
      }
      userId = data.user.id;
      subscribe(userId);
    };

    // Reconnect when app becomes visible (e.g., after mobile sleep)
    const handleVisibilityChange = () => {
      if (!mounted || !userId) return;
      if (document.visibilityState !== 'visible') return;

      subscribe(userId);
      // Re-fetch server data to catch up on changes missed while backgrounded
      scheduleRefresh();
    };

    void run();

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (retryTimer) window.clearTimeout(retryTimer);
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
