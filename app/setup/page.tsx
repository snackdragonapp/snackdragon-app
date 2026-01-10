// app/setup/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safeNext';

export const dynamic = 'force-dynamic';

export default async function SetupIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next) ?? '/';

  const supabase = await createClient();
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;

  if (!userId) {
    const qs = new URLSearchParams();
    qs.set('next', next);
    const requested = `/setup?${qs.toString()}`;
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // Step 1: Dogs (complete when user has at least one active dog)
  const { data: dogs, error: dogsError } = await supabase
    .from('dogs')
    .select('id')
    .is('archived_at', null)
    .limit(1);

  const hasActiveDog = !dogsError && (dogs ?? []).length > 0;

  if (!hasActiveDog) {
    const qs = new URLSearchParams();
    qs.set('next', next);
    redirect(`/setup/dog?${qs.toString()}`);
  }

  /**
   * Future steps go here, e.g.:
   * if (!hasCatalogItems) redirect(`/setup/catalog?next=${encodeURIComponent(next)}`);
   */

  // Setup complete
  redirect(next);
}
