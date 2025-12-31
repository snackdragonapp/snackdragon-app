// app/dogs/actions.ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safeNext';

function dogsUrl(
  next: string | null,
  showArchived: boolean,
  errorMessage?: string | null
) {
  const qs = new URLSearchParams();
  if (next) qs.set('next', next);
  if (showArchived) qs.set('show_archived', '1');
  if (errorMessage) qs.set('error', errorMessage);
  const s = qs.toString();
  return s ? `/dogs?${s}` : '/dogs';
}

function withErrorParam(path: string, errorMessage: string) {
  const u = new URL(path, 'http://local');
  u.searchParams.set('error', errorMessage);
  const s = u.searchParams.toString();
  return s ? `${u.pathname}?${s}` : u.pathname;
}

export async function createDogAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const rawName = String(formData.get('name') ?? '');
  const name = rawName.trim();

  const rawNext = String(formData.get('next') ?? '');
  const next = safeNextPath(rawNext) || '/';

  // Optional: when provided (e.g. from /dogs), errors should redirect back there
  // instead of the setup page.
  const rawErrorTo = String(formData.get('error_to') ?? '');
  const errorTo = safeNextPath(rawErrorTo);

  const redirectWithError = (message: string) => {
    if (errorTo) {
      redirect(withErrorParam(errorTo, message));
    }
    const qs = new URLSearchParams();
    qs.set('error', message);
    qs.set('next', next);
    redirect(`/setup/dog?${qs.toString()}`);
  };

  if (!name) {
    redirectWithError('Name is required.');
  }

  const { error } = await supabase
    .from('dogs')
    .insert({ user_id: user.id, name });

  if (error) {
    if (error.code === '23505') {
      redirectWithError('You already have a dog with that name.');
    } else {
      redirectWithError(error.message);
    }
  }

  redirect(next);
}

export async function renameDogAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const rawNext = String(formData.get('next') ?? '');
  const next = safeNextPath(rawNext);

  const showArchived = String(formData.get('show_archived') ?? '') === '1';

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (!id) {
    redirect(dogsUrl(next, showArchived, 'Missing dog id.'));
  }
  if (!name) {
    redirect(dogsUrl(next, showArchived, 'Name is required.'));
  }

  const { error } = await supabase.from('dogs').update({ name }).eq('id', id);

  if (error) {
    if (error.code === '23505') {
      redirect(dogsUrl(next, showArchived, 'You already have a dog with that name.'));
    }
    redirect(dogsUrl(next, showArchived, error.message));
  }

  revalidatePath('/dogs');
  redirect(dogsUrl(next, showArchived));
}

export async function archiveDogAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const rawNext = String(formData.get('next') ?? '');
  const next = safeNextPath(rawNext);

  const showArchived = String(formData.get('show_archived') ?? '') === '1';

  const id = String(formData.get('id') ?? '').trim();
  if (!id) {
    redirect(dogsUrl(next, showArchived, 'Missing dog id.'));
  }

  const { error } = await supabase
    .from('dogs')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    redirect(dogsUrl(next, showArchived, error.message));
  }

  revalidatePath('/dogs');
  redirect(dogsUrl(next, showArchived));
}

export async function restoreDogAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const rawNext = String(formData.get('next') ?? '');
  const next = safeNextPath(rawNext);

  const showArchived = String(formData.get('show_archived') ?? '') === '1';

  const id = String(formData.get('id') ?? '').trim();
  if (!id) {
    redirect(dogsUrl(next, showArchived, 'Missing dog id.'));
  }

  const { error } = await supabase
    .from('dogs')
    .update({ archived_at: null })
    .eq('id', id);

  if (error) {
    redirect(dogsUrl(next, showArchived, error.message));
  }

  revalidatePath('/dogs');
  redirect(dogsUrl(next, showArchived));
}
