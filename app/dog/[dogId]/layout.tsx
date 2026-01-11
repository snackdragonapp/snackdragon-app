// app/dog/[dogId]/layout.tsx
import PrimaryNav from '@/components/PrimaryNav';
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

type DogRow = {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
};

export default async function DogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dogId: string }>;
}) {
  // Note: params is a Promise in this codebase’s Next.js setup (see other pages).
  const { dogId } = await params;

  const supabase = await createClient();
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;

  // These are used only for the dog switcher in the primary nav.
  let activeDogs: { id: string; name: string }[] | null = null;
  let activeDogName: string | null = null;

  if (userId) {
    // Fetch active dogs list once; validate dogId by membership.
    const { data } = await supabase
      .from('dogs')
      .select('id,name,created_at,archived_at')
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .returns<DogRow[]>();

    const rows = data ?? [];

    const match = rows.find((d) => d.id === dogId);
    if (!match) {
      notFound();
    }

    activeDogName = match.name;
    activeDogs = rows.map((d) => ({ id: d.id, name: d.name }));
  }

  return (
    <>
      <PrimaryNav dogId={dogId} dogName={activeDogName} dogs={activeDogs} />
      {children}
    </>
  );
}
