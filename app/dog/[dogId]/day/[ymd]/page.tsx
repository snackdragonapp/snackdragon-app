// app/dog/[dogId]/day/[ymd]/page.tsx
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { dogHref } from '@/lib/dogHref';
import {
  isValidYMD,
  addDaysYMD,
  formatYMDLong, // timezone-invariant long label for a YYYY-MM-DD
} from '@/lib/dates';
import { addEntryFromCatalogAction } from '@/app/actions';
import EntriesList from '@/components/EntriesList';
import CatalogChipPicker from '@/components/CatalogChipPicker';
import DayEntriesRealtime from '@/components/realtime/DayEntriesRealtime';
import PendingOpsDebug from '@/components/realtime/PendingOpsDebug';
import { expectNoError } from '@/lib/supabase/expect';

export default async function DayPage({
  params,
}: {
  params: Promise<{ dogId: string; ymd: string }>;
}) {
  const { dogId: dogIdParam, ymd } = await params;

  const supabase = await createClient();

  // Resolve the literal date from the path. If invalid, go through /dog/<dogId>/day/today,
  // which determines "today" in the browser's current timezone.
  if (!isValidYMD(ymd)) {
    redirect(dogHref(dogIdParam, '/day/today'));
  }
  const selectedYMD = ymd;

  const friendly = formatYMDLong(selectedYMD);

  // Auth gate: anonymous → /login?next=/dog/<dogId>/day/<ymd>
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(
        dogHref(dogIdParam, `/day/${selectedYMD}`)
      )}`
    );
  }

  // Validate dog context from params (404 if not owned / does not exist)
  let dogId: string;
  try {
    dogId = await resolveDogId(supabase, dogIdParam);
  } catch {
    notFound();
  }

  // Nav dates (pure date math on literal YYYY-MM-DD)
  const prevYMD = addDaysYMD(selectedYMD, -1);
  const nextYMD = addDaysYMD(selectedYMD, +1);

  // Ensure a "day" row exists for this date and get its id (creates if needed).
  const { data: dayId, error: dayErr } = await supabase.rpc('get_or_create_day', {
    p_dog_id: dogId,
    p_date: selectedYMD,
  });
  if (dayErr) {
    throw new Error(dayErr.message);
  }
  const dayIdStr = String(dayId);

  // Fetch this day's entries
  const entriesResult = await supabase
    .from('entries')
    .select(
      'id, name, qty, unit, kcal_snapshot, status, created_at, ordering, kcal_per_unit_snapshot'
    )
    .eq('day_id', dayIdStr)
    .order('ordering', { ascending: true });

  const entriesData = expectNoError(entriesResult, `loading entries for day ${dayIdStr}`);

  const entries: Array<{
    id: string;
    name: string;
    qty: string;
    unit: string;
    kcal_snapshot: number;
    status: 'planned' | 'eaten';
    created_at: string;
    kcal_per_unit_snapshot: number | null;
    ordering?: number;
  }> = entriesData.map((e) => {
    const rawOrdering = (e as { ordering?: unknown }).ordering;
    const ordering =
      typeof rawOrdering === 'number'
        ? rawOrdering
        : rawOrdering != null
        ? Number(rawOrdering)
        : undefined;

    return {
      ...e,
      kcal_snapshot: Number(e.kcal_snapshot ?? 0),
      kcal_per_unit_snapshot:
        (e as { kcal_per_unit_snapshot?: unknown }).kcal_per_unit_snapshot != null
          ? Number((e as { kcal_per_unit_snapshot?: unknown }).kcal_per_unit_snapshot)
          : null,
      ordering: Number.isFinite(ordering as number) ? (ordering as number) : undefined,
    };
  });

  // Ordered by: last used date desc, then first appearance that day asc,
  // then name asc for never-used items.
  const { data: orderedItems } = await supabase.rpc('get_catalog_items_usage_order', {
    p_dog_id: dogId,
  });
  const chipItems = orderedItems ?? []; // let the picker limit what it shows

  // Active goal for this day (latest start_date <= selectedYMD)
  const { data: goalRows } = await supabase
    .from('goals')
    .select('start_date,kcal_target')
    .eq('dog_id', dogId)
    .lte('start_date', selectedYMD)
    .order('start_date', { ascending: false })
    .limit(1);
  const activeGoal = (goalRows ?? [])[0] ?? null;
  const activeGoalKcal = activeGoal ? Number(activeGoal.kcal_target) : null;

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      {/* Header + date nav */}
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold">{friendly}</h1>
        <nav className="flex items-start gap-2 text-sm">
          <Link
            href={dogHref(dogId, `/day/${prevYMD}`)}
            className="rounded border px-2 py-1 hover:bg-control-hover"
            title="Previous day"
          >
            ←
          </Link>
          <Link
            href={dogHref(dogId, '/day/today')}
            className="rounded border px-2 py-1 hover:bg-control-hover"
            title="Jump to today"
          >
            Today
          </Link>
          <Link
            href={dogHref(dogId, `/day/${nextYMD}`)}
            className="rounded border px-2 py-1 hover:bg-control-hover"
            title="Next day"
          >
            →
          </Link>
        </nav>
      </div>

      {/* Unified "Add to this day" section with labeled subsections */}
      <section className="space-y-2">
        <h2 className="font-semibold">Add to this day</h2>
        <div className="rounded-lg border bg-card p-4 space-y-4">
          {/* catalogpage subsection */}
          <div>
            <CatalogChipPicker
              items={chipItems ?? []}
              selectedYMD={selectedYMD}
              dogId={dogId}
              addFromCatalogAction={addEntryFromCatalogAction}
              visibleLimit={20}
            />
            <div className="mt-2 text-sm text-muted-foreground">
              <Link
                href={{
                  pathname: '/catalog',
                  query: { next: dogHref(dogId, `/day/${selectedYMD}`) },
                }}
                className="underline"
              >
                Manage catalog →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Entries with totals at the bottom (now inside EntriesList) */}
      <section className="space-y-2">
        <h2 className="font-semibold">Entries</h2>
        <div className="rounded-lg border bg-card p-4 space-y-3">
          {/* Drag-and-drop list with optimistic updates + totals */}
          <EntriesList
            entries={entries}
            selectedYMD={selectedYMD}
            activeGoalKcal={activeGoalKcal}
            dogId={dogId}
          />
        </div>
      </section>

      {/* Realtime: scoped to this day; drives fully optimistic updates */}
      <DayEntriesRealtime dayId={dayIdStr} />

      {/* Dev-only pending op-id overlay */}
      {process.env.NODE_ENV !== 'production' ? <PendingOpsDebug /> : null}
    </main>
  );
}
