// app/dog/[dogId]/layout.tsx
import PrimaryNav from '@/components/PrimaryNav';
import { createClient } from '@/lib/supabase/server';

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
  const { data: { claims } } = await supabase.auth.getClaims();
  const userId = claims?.sub ?? null;

  // These are used only for the dog switcher in the primary nav.
  let activeDogs: { id: string; name: string }[] | null = null;
  let activeDogName: string | null = null;

  if (userId) {
    const { data: dog } = await supabase
      .from('dogs')
      .select('id,name')
      .eq('id', dogId)
      .maybeSingle();

    activeDogName = dog?.name ?? null;

    const { data } = await supabase
      .from('dogs')
      .select('id,name,created_at,archived_at')
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .returns<DogRow[]>();

    activeDogs = (data ?? []).map((d) => ({ id: d.id, name: d.name }));

    if (!activeDogName) {
      const match = activeDogs.find((d) => d.id === dogId);
      activeDogName = match?.name ?? null;
    }
  }

  return (
    <>
      <PrimaryNav dogId={dogId} dogName={activeDogName} dogs={activeDogs} />
      {children}
    </>
  );
}
