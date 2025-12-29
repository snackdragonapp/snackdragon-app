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
  const showArchived = sp.show_archived === '1';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const qs = new URLSearchParams();
    if (next) qs.set('next', next);
    if (showArchived) qs.set('show_archived', '1');
    const requested = qs.toString() ? `/dogs?${qs.toString()}` : '/dogs';
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  const { data: activeDogs } = await supabase
    .from('dogs')
    .select('id,name,created_at,archived_at')
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  const { data: archivedDogs } = showArchived
    ? await supabase
        .from('dogs')
        .select('id,name,created_at,archived_at')
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false })
    : { data: null as any };

  const toggleQs = new URLSearchParams();
  if (next) toggleQs.set('next', next);
  if (!showArchived) toggleQs.set('show_archived', '1');
  const toggleHref = toggleQs.toString() ? `/dogs?${toggleQs.toString()}` : '/dogs';

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dogs</h1>

        <div className="flex items-center gap-2">
          <Link
            href={toggleHref}
            className="rounded border px-2 py-1 text-sm hover:bg-control-hover"
            title={showArchived ? 'Hide archived dogs' : 'Show archived dogs'}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Link>

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
      </div>

      {error ? (
        <Alert tone="error">
          <span className="font-medium">Error:</span> {error}
        </Alert>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Active dogs</h2>
        <div className="rounded-lg border bg-card p-4">
          <DataList>
            {(activeDogs ?? []).length === 0 ? (
              <li className="py-2 text-sm text-muted-foreground">No active dogs found.</li>
            ) : (
              (activeDogs ?? []).map((d) => (
                <DogListRow
                  key={d.id}
                  dog={d}
                  next={next}
                  showArchived={showArchived}
                />
              ))
            )}
          </DataList>
        </div>
      </section>

      {showArchived ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Archived dogs</h2>
          <div className="rounded-lg border bg-card p-4">
            <DataList>
              {(archivedDogs ?? []).length === 0 ? (
                <li className="py-2 text-sm text-muted-foreground">No archived dogs.</li>
              ) : (
                (archivedDogs ?? []).map((d) => (
                  <DogListRow
                    key={d.id}
                    dog={d}
                    next={next}
                    showArchived={showArchived}
                  />
                ))
              )}
            </DataList>
          </div>
        </section>
      ) : null}
    </main>
  );
}
