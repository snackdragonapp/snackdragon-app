// app/dogs/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PrimaryNav from '@/components/PrimaryNav';
import Alert from '@/components/primitives/Alert';
import DataList from '@/components/primitives/DataList';
import DogListRow from '@/components/DogListRow';
import { createDogAction } from '@/app/dogs/actions';
import { safeNextPath } from '@/lib/safeNext';
import { resolveDogId } from '@/lib/dogs';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type DogRow = {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
};

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
  const { data: { claims } } = await supabase.auth.getClaims();
  const userId = claims?.sub ?? null;

  if (!userId) {
    const qs = new URLSearchParams();
    if (next) qs.set('next', next);
    if (showArchived) qs.set('show_archived', '1');
    const requested = qs.toString() ? `/dogs?${qs.toString()}` : '/dogs';
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // Pick a dogId for AppNav on this non-dog-scoped page:
  // 1) Prefer the dogId from `next` so we preserve context.
  // 2) Fallback to the user's default dog (oldest active).
  const candidateDogId = extractDogIdFromPath(next);
  let navDogId: string | null = null;
  try {
    navDogId = await resolveDogId(supabase, candidateDogId);
  } catch {
    try {
      navDogId = await resolveDogId(supabase, null);
    } catch {
      navDogId = null;
    }
  }

  const { data: activeDogs } = await supabase
    .from('dogs')
    .select('id,name,created_at,archived_at')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .returns<DogRow[]>();

  let archivedDogs: DogRow[] | null = null;
  if (showArchived) {
    const { data } = await supabase
      .from('dogs')
      .select('id,name,created_at,archived_at')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .returns<DogRow[]>();
    archivedDogs = data;
  }

  const toggleQs = new URLSearchParams();
  if (next) toggleQs.set('next', next);
  if (!showArchived) toggleQs.set('show_archived', '1');
  const toggleHref = toggleQs.toString() ? `/dogs?${toggleQs.toString()}` : '/dogs';

  // Canonical "return to this /dogs view" URL (no `error=`).
  const selfQs = new URLSearchParams();
  if (next) selfQs.set('next', next);
  if (showArchived) selfQs.set('show_archived', '1');
  const selfHref = selfQs.toString() ? `/dogs?${selfQs.toString()}` : '/dogs';

  // Prepare nav data if we have a resolved dog context
  const navDogName =
    navDogId && activeDogs ? activeDogs.find((d) => d.id === navDogId)?.name : null;
  const navDogs = activeDogs ? activeDogs.map((d) => ({ id: d.id, name: d.name })) : null;

  return (
    <>
      {navDogId ? (
        <PrimaryNav dogId={navDogId} dogName={navDogName ?? null} dogs={navDogs} />
      ) : null}

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
          <h2 className="font-semibold">Add dog</h2>
          <div className="rounded-lg border bg-card p-4">
            <form action={createDogAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="next" value={selfHref} />

              <div className="flex flex-col flex-1">
                <label htmlFor="new-dog-name" className="text-xs text-muted-foreground">
                  Dog name
                </label>
                <input
                  id="new-dog-name"
                  name="name"
                  required
                  className="w-full border rounded px-2 py-1 text-sm"
                  autoComplete="off"
                />
              </div>

              <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-control-hover">
                Create
              </button>
            </form>
          </div>
        </section>

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
    </>
  );
}

function extractDogIdFromPath(path: string | null): string | null {
  if (!path) return null;
  try {
    // Handles cases where callers accidentally pass a full URL-ish string.
    const u = new URL(path, 'http://local');
    const m = /^\/dog\/([^/]+)\//.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    const m = /^\/dog\/([^/]+)\//.exec(path);
    return m ? decodeURIComponent(m[1]) : null;
  }
}
