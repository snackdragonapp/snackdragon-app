// app/dog/[dogId]/goals/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { dogHref } from '@/lib/dogHref';
import { addDaysYMD } from '@/lib/dates';
import { createGoalAction, updateGoalAction } from './actions';
import GoalAddForm from '@/components/GoalAddForm';
import DataList from '@/components/primitives/DataList';
import GoalListRow from '@/components/GoalListRow';
import RealtimeBridge from '@/components/realtime/RealtimeBridge';
import { safeNextPath } from '@/lib/safeNext';

export const dynamic = 'force-dynamic';

export default async function GoalsPage({
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

  // Auth gate
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;

  if (!userId) {
    const requested = next
      ? `${dogHref(dogIdParam, '/goals')}?next=${encodeURIComponent(next)}`
      : dogHref(dogIdParam, '/goals');
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // DogLayout validates dogId when signed in
  const dogId = dogIdParam;

  // Load goals, newest start_date first
  const { data: goals } = await supabase
    .from('goals')
    .select('id,start_date,kcal_target,note,created_at')
    .eq('dog_id', dogId)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false });

  // Default date is computed client-side from the browser's current timezone.

  // Compute effective end_date for display:
  // for a row at index i (desc order), end = (previous row's start_date) - 1 day
  const rows = (goals ?? []).map((g, i, arr) => {
    const prev = i === 0 ? null : arr[i - 1];
    const end = prev ? addDaysYMD(String(prev.start_date), -1) : null;
    return { ...g, end_date: end };
  });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Goals</h1>
        {next && (
          <Link href={next} className="rounded border px-2 py-1 text-sm hover:bg-control-hover">
            ‹ Back to day
          </Link>
        )}
      </div>

      {/* Add goal */}
      <section className="space-y-2">
        <h2 className="font-semibold">Add goal</h2>
        <GoalAddForm dogId={dogId} next={next} createAction={createGoalAction} />
      </section>

      {/* List goals */}
      <section className="space-y-2">
        <h2 className="font-semibold">Your goals</h2>
        <div className="rounded-lg border bg-card p-4">
          {(rows ?? []).length === 0 ? (
            <DataList>
              <li className="py-2 text-sm text-muted-foreground">No goals yet. Add one above.</li>
            </DataList>
          ) : (
            <DataList>
              {rows.map((g, idx) => (
                <GoalListRow
                  key={g.id}
                  goal={g}
                  current={idx === 0 && !g.end_date}
                  updateAction={updateGoalAction}
                />
              ))}
            </DataList>
          )}
        </div>
      </section>

      {/* Realtime sync for goals */}
      <RealtimeBridge
        channel="rt-goals"
        table="goals"
        filter={`dog_id=eq.${dogId}`}
        devLabel="Goals"
      />
    </main>
  );
}
