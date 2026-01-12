// app/dog/[dogId]/weights/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { dogHref } from '@/lib/dogHref';
import WeightAddForm from '@/components/WeightAddForm';
import DataList from '@/components/primitives/DataList';
import WeightListRow from '@/components/WeightListRow';
import { createWeightAction, updateWeightAction } from './actions';
import RealtimeBridge from '@/components/realtime/RealtimeBridge';
import { safeNextPath } from '@/lib/safeNext';

export const dynamic = 'force-dynamic';

export default async function WeightsPage({
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

  // Auth gate: anonymous → /login?next=/dog/<dogId>/weights
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;

  if (!userId) {
    const requested = next
      ? `${dogHref(dogIdParam, '/weights')}?next=${encodeURIComponent(next)}`
      : dogHref(dogIdParam, '/weights');
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // DogLayout validates dogId when signed in
  const dogId = dogIdParam;

  // Fetch weights for the dog (newest first)
  const { data: weights } = await supabase
    .from('weights')
    .select('id, measured_at, method, weight_kg, me_kg, me_and_dog_kg, note, created_at')
    .eq('dog_id', dogId)
    .order('measured_at', { ascending: false })
    .order('created_at', { ascending: false });

  // Default date is computed client-side from the browser's current timezone.

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Weights</h1>
        {next && (
          <Link href={next} className="rounded border px-2 py-1 text-sm hover:bg-control-hover">
            ‹ Back to day
          </Link>
        )}
      </div>

      {/* Add weight */}
      <section className="space-y-2">
        <h2 className="font-semibold">Add weight</h2>
        <WeightAddForm dogId={dogId} next={next} createAction={createWeightAction} />
      </section>

      {/* History */}
      <section className="space-y-2">
        <h2 className="font-semibold">Your measurements</h2>
        <div className="rounded-lg border bg-card p-4">
          {!weights || weights.length === 0 ? (
            <DataList>
              <li className="py-2 text-sm text-muted-foreground">No weights yet. Add one above.</li>
            </DataList>
          ) : (
            <DataList>
              {weights.map((w) => (
                <WeightListRow key={w.id} w={w} updateAction={updateWeightAction} />
              ))}
            </DataList>
          )}
        </div>
      </section>

      {/* Realtime sync for weights */}
      <RealtimeBridge
        channel="rt-weights"
        table="weights"
        filter={`dog_id=eq.${dogId}`}
        devLabel="Weights"
      />
    </main>
  );
}
