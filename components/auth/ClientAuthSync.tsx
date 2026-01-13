// components/auth/ClientAuthSync.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/client';

export default function ClientAuthSync({
  serverUserId,
  accessToken,
  refreshToken,
}: {
  serverUserId: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
}) {
  const router = useRouter();

  // Avoid an extra refresh on the initial mount; only refresh on transitions.
  const lastServerUserId = useRef<string | null>(serverUserId);

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;

    const sync = async () => {
      // Use getUser() to get authoritative user data.
      // getSession() can return null/stale data during navigation transitions,
      // causing false mismatches that trigger unnecessary router.refresh() calls.
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;

      const clientUserId = data.user?.id ?? null;

      const serverChanged = lastServerUserId.current !== serverUserId;
      lastServerUserId.current = serverUserId;

      // Server says logged out → ensure browser is logged out too
      if (!serverUserId) {
        if (clientUserId) {
          await supabase.auth.signOut();
        }

        // Auth boundary changed; drop any cached authed trees.
        if (serverChanged) {
          router.refresh();
        }
        return;
      }

      // Server says logged in → ensure browser has same user
      if (clientUserId !== serverUserId) {
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        }

        // After reconciling session, force the app to refetch server components.
        router.refresh();
        return;
      }

      // Same user, but server auth boundary just transitioned (e.g. after login redirect):
      // refresh to ensure we don't reuse a stale cached tree that bypasses middleware/guards.
      if (serverChanged) {
        router.refresh();
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [serverUserId, accessToken, refreshToken, router]);

  return null;
}
