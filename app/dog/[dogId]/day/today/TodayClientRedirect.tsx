// app/dog/[dogId]/day/today/TodayClientRedirect.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { dogHref } from '@/lib/dogHref';

function localTodayYMD(): string {
  const d = new Date(); // local device time (reflects travel automatically)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function TodayClientRedirect({ dogId }: { dogId: string }) {
  const router = useRouter();

  useEffect(() => {
    try {
      const ro = Intl.DateTimeFormat().resolvedOptions();
      if (!ro || !ro.timeZone) throw new Error('timezone-unavailable');

      const ymd = localTodayYMD();
      router.replace(dogHref(dogId, `/day/${ymd}`));
    } catch (e) {
      // Match the server-injected script behavior: show explicit error (no fallback)
      const sk = document.getElementById('today-skeleton');
      if (sk) sk.style.display = 'none';
      const err = document.getElementById('tz-required');
      if (err) err.style.display = 'block';
      console.error('[day/today] timezone required', e);
    }
  }, [router, dogId]);

  return null;
}
