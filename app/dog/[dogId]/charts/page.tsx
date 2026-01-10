import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { dogHref } from '@/lib/dogHref';
import ChartsClient from '@/components/ChartsClient';
import RealtimeBridge from '@/components/realtime/RealtimeBridge';
import { safeNextPath } from '@/lib/safeNext';

export const dynamic = 'force-dynamic';

function toUTCms(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12, 0, 0); // ✅ UTC noon
}

// NOTE: numeric columns come back as string; accept string | number and cast later.
type WeightRow = { measured_at: string; weight_kg: string | number };
type GoalRow   = { start_date: string; kcal_target: number };
type DailyRow  = {
  date: string;
  planned_kcal: string | number;
  eaten_kcal: string | number;
  total_kcal: string | number;
};

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
  const { data: { claims } } = await supabase.auth.getClaims();
  const userId = claims?.sub ?? null;

  if (!userId) {
    const requested = next
      ? `${dogHref(dogIdParam, '/charts')}?next=${encodeURIComponent(next)}`
      : dogHref(dogIdParam, '/charts');
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // Validate dog context from URL (404 if not owned / does not exist)
  let dogId: string;
  try {
    dogId = await resolveDogId(supabase, dogIdParam);
  } catch {
    notFound();
  }

  // Build queries with proper result typing
  const weightsQ = supabase
    .from('weights')
    .select('measured_at,weight_kg')
    .eq('dog_id', dogId)
    .order('measured_at', { ascending: true })
    .returns<WeightRow[]>();

  const goalsQ = supabase
    .from('goals')
    .select('start_date,kcal_target')
    .eq('dog_id', dogId)
    .order('start_date', { ascending: true })
    .returns<GoalRow[]>();

  const dailyQ = supabase
    .rpc('get_daily_kcal_totals', { p_dog_id: dogId })
    .returns<DailyRow[]>();

  // Promise.all wants real Promises in some TS setups; .then(r => r) makes it explicit
  const [{ data: weights }, { data: goals }, { data: daily }] = await Promise.all([
    weightsQ.then(r => r),
    goalsQ.then(r => r),
    dailyQ.then(r => r),
  ]);

  const goalsAsc = (goals ?? []).map(g => ({
    start: g.start_date,
    target: Number(g.kcal_target),
    t: toUTCms(g.start_date),
  }));

  function activeGoal(ymd: string): number | null {
    if (!goalsAsc.length) return null;
    let lo = 0, hi = goalsAsc.length - 1, ans: number | null = null;
    const t = toUTCms(ymd);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (goalsAsc[mid].t <= t) {
        ans = goalsAsc[mid].target;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  const weightsWithGoal = (weights ?? []).map(w => ({
    t: toUTCms(w.measured_at),
    y: Number(w.weight_kg), // handles string|number
    goal: activeGoal(w.measured_at),
    ymd: w.measured_at,
  }));

  // after you’ve loaded the data:
  const dailyArray: DailyRow[] = Array.isArray(daily) ? daily : [];

  const dailyWithGoal = dailyArray
    .map(d => ({
      t: toUTCms(d.date),
      total: Number(d.total_kcal),
      goal: activeGoal(d.date),
      ymd: d.date,
    }))
    // Ignore days that have a day row but no calories logged.
    .filter(d => d.total > 0);

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Charts</h1>
        {next && (
          <Link href={next} className="rounded border px-2 py-1 text-sm hover:bg-control-hover">
            ‹ Back to day
          </Link>
        )}
      </div>
      <ChartsClient weights={weightsWithGoal} daily={dailyWithGoal} />

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
