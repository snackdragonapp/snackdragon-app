import { redirect } from 'next/navigation';
import Alert from '@/components/primitives/Alert';
import { safeNextPath } from '@/lib/safeNext';
import { createClient } from '@/lib/supabase/server';
import { createDogAction } from '@/app/dogs/actions';

export const dynamic = 'force-dynamic';

export default async function SetupDogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const next = safeNextPath(sp.next) ?? '/';
  const error = typeof sp.error === 'string' ? sp.error : null;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const requested = `/setup/dog?next=${encodeURIComponent(next)}`;
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // If the user already has an active dog, this setup page is no longer needed.
  const { data: existingDogs, error: existingDogsError } = await supabase
    .from('dogs')
    .select('id')
    .is('archived_at', null)
    .limit(1);

  if (!existingDogsError && (existingDogs ?? []).length > 0) {
    redirect(next);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <header className="space-y-4">
        <h1 className="text-2xl font-bold">Welcome to Snack Dragon</h1>
        <p className="text-sm text-muted-foreground">
          Tell us your dog’s name to get started.
        </p>
      </header>

      {error ? (
        <Alert tone="error">
          <span className="font-medium">Error:</span> {error}
        </Alert>
      ) : null}

      <form action={createDogAction} className="space-y-4">
        <input type="hidden" name="next" value={next} hidden />

        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-col">
            <label htmlFor="dog-name" className="text-xs text-muted-foreground">
              Dog's name
            </label>
            <input
              id="dog-name"
              name="name"
              required
              className="border rounded px-2 py-1"
              placeholder="e.g., Snapdragon"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click Continue below to finish setup and go to the app.
          </p>

          <button
            type="submit"
            className="rounded border px-3 py-1 text-sm hover:bg-control-hover"
          >
            Continue
          </button>
        </div>
      </form>
    </main>
  );
}
