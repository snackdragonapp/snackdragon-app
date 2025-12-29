'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safeNext';

export async function createDogAction(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Must be signed in');
  }

  const next = safeNextPath(formData.get('next')) ?? '/day/today';

  // If the user already has an active dog, this setup action is no longer needed.
  const { data: existingDogs, error: existingDogsError } = await supabase
    .from('dogs')
    .select('id')
    .is('archived_at', null)
    .limit(1);

  if (!existingDogsError && (existingDogs ?? []).length > 0) {
    redirect(next);
  }

  const name = String(formData.get('name') ?? '').trim();

  if (!name) {
    const qs = new URLSearchParams();
    qs.set('error', 'Dog name is required.');
    qs.set('next', next);
    redirect(`/setup/dog?${qs.toString()}`);
  }

  const { error } = await supabase.from('dogs').insert({
    user_id: user.id,
    name,
  });

  if (error) {
    const qs = new URLSearchParams();
    qs.set(
      'error',
      (error as any)?.code === '23505'
        ? 'You already have a dog with that name.'
        : error.message
    );
    qs.set('next', next);
    redirect(`/setup/dog?${qs.toString()}`);
  }

  redirect(next);
}
