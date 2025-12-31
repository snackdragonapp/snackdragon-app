// components/AppNav.tsx
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isValidYMD } from '@/lib/dates';
import { dogHref } from '@/lib/dogHref';

export default function AppNav({
  dogId,
  dogName,
  dogs,
}: {
  dogId: string;
  dogName?: string | null;
  dogs?: { id: string; name: string }[] | null;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const searchKey = search.toString();

  const statsDetailsRef = useRef<HTMLDetailsElement>(null);
  const dogDetailsRef = useRef<HTMLDetailsElement>(null);

  const closeMenus = useCallback(() => {
    const stats = statsDetailsRef.current;
    if (stats?.open) stats.open = false; // closes <details>

    const dog = dogDetailsRef.current;
    if (dog?.open) dog.open = false; // closes <details>
  }, []);

  // Close whenever navigation happens (Link clicks, back/forward, etc.)
  useEffect(() => {
    closeMenus();
  }, [pathname, searchKey, closeMenus]);

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
  const isGoals = pathname === `${dogBase}/goals` || pathname.startsWith(`${dogBase}/goals/`);
  const isCharts =
    pathname === `${dogBase}/charts` || pathname.startsWith(`${dogBase}/charts/`);

  const isStats = isWeights || isGoals || isCharts;

  const base =
    'inline-flex items-center rounded px-3 py-1 text-sm border hover:bg-nav-item-hover focus:outline-none focus:ring-2 focus:ring-control-ring';
  const active = 'bg-nav-item-active font-medium';

  const statsSummary =
    `${base} ${isStats ? active : ''} ` +
    'list-none cursor-pointer gap-1 ' +
    '[&::-webkit-details-marker]:hidden';

  const statsMenu = 'absolute left-0 mt-2 w-44 rounded border bg-card p-2 shadow-md z-20';

  const statsItem =
    'block w-full rounded px-2 py-1 text-left text-sm hover:bg-control-hover ' +
    'focus:outline-none focus:ring-2 focus:ring-control-ring';

  const dogList = Array.isArray(dogs) ? dogs : null;

  const activeDogName = useMemo(() => {
    if (typeof dogName === 'string' && dogName.trim()) return dogName.trim();
    const match = dogList?.find((d) => d.id === dogId)?.name;
    return match ?? 'Dog';
  }, [dogName, dogList, dogId]);

  const dogSwitchHref = useCallback(
    (nextDogId: string) => {
      if (!pathname.startsWith('/dog/')) {
        return dogHref(nextDogId, '/day/today');
      }

      const encoded = encodeURIComponent(nextDogId);
      const replaced = pathname.replace(/^\/dog\/[^/]+/, `/dog/${encoded}`);
      return searchKey ? `${replaced}?${searchKey}` : replaced;
    },
    [pathname, searchKey],
  );

  const dogSummary =
    `${base} ` +
    'list-none cursor-pointer gap-1 ' +
    '[&::-webkit-details-marker]:hidden';

  // Hide the app nav during onboarding/setup flows.
  const inSetup = pathname === '/setup' || pathname.startsWith('/setup/');
  if (inSetup) return null;

  return (
    <nav className="border-t bg-header">
      <div className="mx-auto max-w-2xl p-2">
        <ul className="flex items-center gap-2">
          <li>
            <Link
              href={dayHref}
              className={`${base} ${isDay ? active : ''}`}
              aria-current={isDay ? 'page' : undefined}
            >
              Day
            </Link>
          </li>

          <li>
            <Link
              href={catalogHref}
              className={`${base} ${isCatalog ? active : ''}`}
              aria-current={isCatalog ? 'page' : undefined}
            >
              Catalog
            </Link>
          </li>

          <li>
            <details ref={statsDetailsRef} className="relative">
              <summary className={statsSummary} aria-label="Open stats menu">
                <span>Stats</span>
                <span aria-hidden="true">▾</span>
              </summary>

              <div className={statsMenu} role="menu" aria-label="Stats menu">
                <Link
                  href={chartsHref}
                  className={`${statsItem} ${isCharts ? active : ''}`}
                  role="menuitem"
                  onClick={closeMenus}
                >
                  Charts
                </Link>
                <Link
                  href={goalsHref}
                  className={`${statsItem} ${isGoals ? active : ''}`}
                  role="menuitem"
                  onClick={closeMenus}
                >
                  Goals
                </Link>
                <Link
                  href={weightsHref}
                  className={`${statsItem} ${isWeights ? active : ''}`}
                  role="menuitem"
                  onClick={closeMenus}
                >
                  Weights
                </Link>
              </div>
            </details>
          </li>

          {pathname.startsWith('/dog/') && dogList && dogList.length > 0 ? (
            <li>
              <details ref={dogDetailsRef} className="relative">
                <summary className={dogSummary} aria-label="Open dog switcher">
                  <span className="max-w-[10rem] truncate" title={activeDogName}>
                    {activeDogName}
                  </span>
                  <span aria-hidden="true">▾</span>
                </summary>

                <div className={statsMenu} role="menu" aria-label="Dog switcher">
                  {dogList.map((d) => (
                    <Link
                      key={d.id}
                      href={dogSwitchHref(d.id)}
                      className={`${statsItem} ${d.id === dogId ? active : ''}`}
                      role="menuitem"
                      onClick={closeMenus}
                    >
                      {d.name}
                    </Link>
                  ))}
                </div>
              </details>
            </li>
          ) : null}
        </ul>
      </div>
    </nav>
  );
}
