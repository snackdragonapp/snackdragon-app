// app/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { dogHref } from '@/lib/dogHref';

export const dynamic = 'force-dynamic';

export default async function Root() {
  const supabase = await createClient();

  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;
  if (!userId) {
    redirect('/login');
  }

  // Default dog = oldest active dog (archived_at is null, created_at asc)
  const { data: dog, error } = await supabase
    .from('dogs')
    .select('id')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!dog) {
    redirect('/setup?next=/');
  }

  redirect(dogHref(dog.id, '/day/today'));
}
