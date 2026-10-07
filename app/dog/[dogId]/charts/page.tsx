import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { dogHref } from '@/lib/dogHref';
import ChartsClient from '@/components/ChartsClient';
import RealtimeBridge from '@/components/realtime/RealtimeBridge';
import { safeNextPath } from '@/lib/safeNext';
import { buildChartData, type EntryInput } from '@/lib/chartData';

export const dynamic = 'force-dynamic';

// NOTE: numeric columns come back as string; accept string | number and cast later.
type WeightRow = { measured_at: string; weight_kg: string | number };
type GoalRow = { start_date: string; kcal_target: number };
type EntryRow = {
  name: string;
  catalog_item_id: string | null;
  kcal_snapshot: string | number;
  // Embedded to-one relation; defensively allow the array shape too.
  days: { date: string } | { date: string }[] | null;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

// PostgREST caps a single response at 1000 rows, so page through the entries.
const PAGE = 1000;

async function fetchAllEntries(supabase: Supabase, dogId: string): Promise<EntryInput[]> {
  const out: EntryInput[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('entries')
      .select('name,catalog_item_id,kcal_snapshot,days!inner(date)')
      .eq('days.dog_id', dogId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
      .returns<EntryRow[]>();
    if (error) throw new Error(error.message);

    const page = data ?? [];
    for (const e of page) {
      const day = Array.isArray(e.days) ? e.days[0] : e.days;
      if (!day?.date) continue;
      out.push({
        date: day.date,
        name: e.name,
        catalog_item_id: e.catalog_item_id,
        kcal: Number(e.kcal_snapshot),
      });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

export default async function ChartsPage({
  params,
  searchParams,
}: {
  params: Promise<{ dogId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dogId: dogIdParam } = await params;

  const sp = await searchParams;
  const next = safeNextPath(sp.next);

  const supabase = await createClient();

  // Auth gate: anonymous → /login?next=/dog/<dogId>/charts
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;

  if (!userId) {
    const requested = next
      ? `${dogHref(dogIdParam, '/charts')}?next=${encodeURIComponent(next)}`
      : dogHref(dogIdParam, '/charts');
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // DogLayout validates dogId when signed in
  const dogId = dogIdParam;

  const weightsQ = supabase
    .from('weights')
    .select('measured_at,weight_kg')
    .eq('dog_id', dogId)
    .order('measured_at', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<WeightRow[]>();

  const goalsQ = supabase
    .from('goals')
    .select('start_date,kcal_target')
    .eq('dog_id', dogId)
    .order('start_date', { ascending: true })
    .returns<GoalRow[]>();

  const [weightsRes, goalsRes, entries] = await Promise.all([
    weightsQ.then((r) => r),
    goalsQ.then((r) => r),
    fetchAllEntries(supabase, dogId),
  ]);
  if (weightsRes.error) throw new Error(weightsRes.error.message);
  if (goalsRes.error) throw new Error(goalsRes.error.message);

  const { rows, series } = buildChartData({
    weights: (weightsRes.data ?? []).map((w) => ({
      measured_at: w.measured_at,
      weight_kg: Number(w.weight_kg),
    })),
    goals: (goalsRes.data ?? []).map((g) => ({
      start_date: g.start_date,
      kcal_target: Number(g.kcal_target),
    })),
    entries,
  });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      {/* Title row (with the range control) is rendered by the client. */}
      <ChartsClient dogId={dogId} rows={rows} series={series} backHref={next} />

      {/* Realtime sync for data feeding Charts */}
      <RealtimeBridge
        channel="rt-charts-entries"
        table="entries"
        filter=""              // rely on RLS via days.user_id; no direct user_id column
        devLabel="Charts: entries"
      />
      <RealtimeBridge
        channel="rt-charts-goals"
        table="goals"
        filter={`dog_id=eq.${dogId}`}
        devLabel="Charts: goals"
        showIndicator={false}  // avoid 3 overlapping pills; entries one is enough
      />
      <RealtimeBridge
        channel="rt-charts-weights"
        table="weights"
        filter={`dog_id=eq.${dogId}`}
        devLabel="Charts: weights"
        showIndicator={false}
      />
    </main>
  );
}
