// components/MobileBottomNav.tsx
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { isValidYMD } from '@/lib/dates';
import { dogHref } from '@/lib/dogHref';

export default function MobileBottomNav({ dogId }: { dogId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const searchKey = search.toString();

  const [statsOpen, setStatsOpen] = useState(false);
  const sheetId = useId();

  const closeSheet = useCallback(() => {
    setStatsOpen(false);
  }, []);

  // Close the sheet whenever navigation happens (Link clicks, back/forward, etc.)
  useEffect(() => {
    closeSheet();
  }, [pathname, searchKey, closeSheet]);

  const pathYMD = useMemo(() => {
    const m = /^\/dog\/[^/]+\/day\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
    return m && isValidYMD(m[1]) ? m[1] : null;
  }, [pathname]);

  const nextYMD = useMemo(() => {
    const next = search.get('next');
    if (!next) return null;
    try {
      const u = new URL(next, 'http://local');
      const m = /^\/dog\/[^/]+\/day\/(\d{4}-\d{2}-\d{2})$/.exec(u.pathname);
      return m && isValidYMD(m[1]) ? m[1] : null;
    } catch {
      const m = /^\/dog\/[^/]+\/day\/(\d{4}-\d{2}-\d{2})$/.exec(next);
      return m && isValidYMD(m[1]) ? m[1] : null;
    }
  }, [search]);

  const dayHref = pathYMD
    ? dogHref(dogId, `/day/${pathYMD}`)
    : nextYMD
    ? dogHref(dogId, `/day/${nextYMD}`)
    : dogHref(dogId, '/day/today');

  const catalogHref = dogHref(dogId, `/catalog?next=${encodeURIComponent(dayHref)}`);
  const weightsHref = dogHref(dogId, `/weights?next=${encodeURIComponent(dayHref)}`);
  const goalsHref = dogHref(dogId, `/goals?next=${encodeURIComponent(dayHref)}`);
  const chartsHref = dogHref(dogId, `/charts?next=${encodeURIComponent(dayHref)}`);

  const dogBase = dogHref(dogId, '/').slice(0, -1);

  const isDay = pathname === `${dogBase}/day` || pathname.startsWith(`${dogBase}/day/`);
  const isCatalog =
    pathname === `${dogBase}/catalog` || pathname.startsWith(`${dogBase}/catalog/`);
  const isWeights =
    pathname === `${dogBase}/weights` || pathname.startsWith(`${dogBase}/weights/`);
  const isGoals =
    pathname === `${dogBase}/goals` || pathname.startsWith(`${dogBase}/goals/`);
  const isCharts =
    pathname === `${dogBase}/charts` || pathname.startsWith(`${dogBase}/charts/`);

  const isStats = isWeights || isGoals || isCharts;

  const base =
    'inline-flex w-full items-center justify-center rounded px-3 py-2 text-sm border ' +
    'hover:bg-nav-item-hover focus:outline-none focus:ring-2 focus:ring-control-ring';

  const active = 'bg-nav-item-active font-medium';

  const sheetCloseBtn =
    'rounded border px-2 py-1 text-sm hover:bg-control-hover ' +
    'focus:outline-none focus:ring-2 focus:ring-control-ring';

  const sheetItem =
    'block w-full rounded px-3 py-3 text-left text-base hover:bg-control-hover ' +
    'focus:outline-none focus:ring-2 focus:ring-control-ring';

  return (
    <>
      {/* 
        Inject padding into the global footer so it scrolls ABOVE this fixed nav.
        - Targets 'body > footer' (standard Next.js root layout structure).
        - Only applies on small screens matching the nav visibility.
      */}
      <style>{`
        @media (max-width: 640px) {
          body > footer {
            padding-bottom: calc(3.5rem + env(safe-area-inset-bottom)) !important;
          }
        }
      `}</style>

      {/* Mobile bottom primary nav (pinned) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 border-t bg-header z-30">
        <div className="mx-auto max-w-2xl px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <ul className="flex items-center gap-2">
            <li className="flex-1">
              <Link
                href={dayHref}
                className={`${base} ${isDay ? active : ''}`}
                aria-current={isDay ? 'page' : undefined}
              >
                Day
              </Link>
            </li>

            <li className="flex-1">
              <Link
                href={catalogHref}
                className={`${base} ${isCatalog ? active : ''}`}
                aria-current={isCatalog ? 'page' : undefined}
              >
                Catalog
              </Link>
            </li>

            <li className="flex-1">
              <button
                type="button"
                className={`${base} ${isStats ? active : ''}`}
                aria-haspopup="dialog"
                aria-expanded={statsOpen}
                aria-controls={sheetId}
                onClick={() => setStatsOpen(true)}
              >
                Stats
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {/* Mobile Stats bottom sheet */}
      {statsOpen ? (
        <div className="sm:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close stats menu"
            onClick={closeSheet}
          />

          <div
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="Stats menu"
            className="absolute bottom-0 left-0 right-0 rounded-t-lg border-t bg-card shadow-lg"
          >
            <div className="mx-auto max-w-2xl p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <div className="flex items-center justify-between">
                <div className="font-medium">Stats</div>
                <button type="button" className={sheetCloseBtn} onClick={closeSheet}>
                  Close
                </button>
              </div>

              <div className="mt-3" role="menu" aria-label="Stats menu items">
                <Link
                  href={chartsHref}
                  className={`${sheetItem} ${isCharts ? active : ''}`}
                  role="menuitem"
                  onClick={closeSheet}
                >
                  Charts
                </Link>
                <Link
                  href={goalsHref}
                  className={`${sheetItem} ${isGoals ? active : ''}`}
                  role="menuitem"
                  onClick={closeSheet}
                >
                  Goals
                </Link>
                <Link
                  href={weightsHref}
                  className={`${sheetItem} ${isWeights ? active : ''}`}
                  role="menuitem"
                  onClick={closeSheet}
                >
                  Weights
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
