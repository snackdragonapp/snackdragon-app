// app/setup/dog/page.tsx
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/safeNext';
import { createClient } from '@/lib/supabase/server';
import DogSetupBuilder from './DogSetupBuilder';

export const dynamic = 'force-dynamic';

type DogRow = { id: string; name: string | null };

export default async function SetupDogPage({
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
    const requested = `/setup/dog?${qs.toString()}`;
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  const { data: activeDogs } = await supabase
    .from('dogs')
    .select('id,name')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .returns<DogRow[]>();

  const continueQs = new URLSearchParams();
  continueQs.set('next', next);
  const continueHref = `/setup?${continueQs.toString()}`;

  return <DogSetupBuilder initialDogs={activeDogs ?? []} continueHref={continueHref} />;
}
