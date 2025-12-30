// components/AppNav.tsx
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { isValidYMD } from '@/lib/dates';
import { dogHref } from '@/lib/dogHref';

export default function AppNav({ dogId }: { dogId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();

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
  const dogsHref = `/dogs?next=${encodeURIComponent(dayHref)}`;

  const dogBase = `/dog/${encodeURIComponent(String(dogId ?? '').trim())}`;

  const isDay = pathname === `${dogBase}/day` || pathname.startsWith(`${dogBase}/day/`);
  const isCatalog =
    pathname === `${dogBase}/catalog` ||
    pathname.startsWith(`${dogBase}/catalog/`) ||
    pathname.startsWith('/catalog');
  const isWeights =
    pathname === `${dogBase}/weights` ||
    pathname.startsWith(`${dogBase}/weights/`) ||
    pathname.startsWith('/weights');
  const isGoals =
    pathname === `${dogBase}/goals` ||
    pathname.startsWith(`${dogBase}/goals/`) ||
    pathname.startsWith('/goals');
  const isCharts =
    pathname === `${dogBase}/charts` ||
    pathname.startsWith(`${dogBase}/charts/`) ||
    pathname.startsWith('/charts');
  const isDogs = pathname.startsWith('/dogs');

  const base =
    'rounded px-3 py-1 text-sm border hover:bg-nav-item-hover focus:outline-none focus:ring-2 focus:ring-control-ring';
  const active = 'bg-nav-item-active font-medium';

  // Hide the app nav during onboarding/setup flows.
  const inSetup = pathname === '/setup' || pathname.startsWith('/setup/');
  if (inSetup) return null;

  return (
    <nav className="border-t bg-header">
      <div className="mx-auto max-w-2xl p-2">
        <ul className="flex items-center gap-2">
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
              href={goalsHref}
              className={`${base} ${isGoals ? active : ''}`}
              aria-current={isGoals ? 'page' : undefined}
            >
              Goals
            </Link>
          </li>
          <li>
            <Link
              href={weightsHref}
              className={`${base} ${isWeights ? active : ''}`}
              aria-current={isWeights ? 'page' : undefined}
            >
              Weights
            </Link>
          </li>
          <li>
            <Link
              href={chartsHref}
              className={`${base} ${isCharts ? active : ''}`}
              aria-current={isCharts ? 'page' : undefined}
            >
              Charts
            </Link>
          </li>
          <li>
            <Link
              href={dogsHref}
              className={`${base} ${isDogs ? active : ''}`}
              aria-current={isDogs ? 'page' : undefined}
            >
              Dogs
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}
