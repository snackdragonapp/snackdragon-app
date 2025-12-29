// app/dogs/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Alert from '@/components/primitives/Alert';
import DataList from '@/components/primitives/DataList';
import DogListRow from '@/components/DogListRow';
import { safeNextPath } from '@/lib/safeNext';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function DogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const next = safeNextPath(sp.next);
  const error = typeof sp.error === 'string' ? sp.error : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const requested = next ? `/dogs?next=${encodeURIComponent(next)}` : '/dogs';
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  const { data: dogs } = await supabase
    .from('dogs')
    .select('id,name,created_at,archived_at')
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dogs</h1>
        {next ? (
          <Link
            href={next}
            className="rounded border px-2 py-1 text-sm hover:bg-control-hover"
            title="Back to day"
          >
            ‹ Back to day
          </Link>
        ) : null}
      </div>

      {error ? (
        <Alert tone="error">
          <span className="font-medium">Error:</span> {error}
        </Alert>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Your dogs</h2>
        <div className="rounded-lg border bg-card p-4">
          <DataList>
            {(dogs ?? []).length === 0 ? (
              <li className="py-2 text-sm text-muted-foreground">No dogs found.</li>
            ) : (
              (dogs ?? []).map((d) => <DogListRow key={d.id} dog={d} next={next} />)
            )}
          </DataList>
        </div>
      </section>
    </main>
  );
}
