// app/setup/dog/actions.ts
'use server';

import { createClient } from '@/lib/supabase/server';

export type AddSetupDogResult =
  | { ok: true; dog: { id: string; name: string } }
  | { ok: false; error: string };

const UNIQUE_VIOLATION = '23505';

function getErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const maybe = err as unknown as { code?: unknown };
  return typeof maybe.code === 'string' ? maybe.code : null;
}

export async function addSetupDogAction(input: {
  name: string;
}): Promise<AddSetupDogResult> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims();
  if (claimsErr) throw new Error(claimsErr.message);
  const userId = claimsData?.claims?.sub ?? null;

  if (!userId) return { ok: false, error: 'You must be signed in.' };

  const name = String(input?.name ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const { data, error } = await supabase
    .from('dogs')
    .insert({ user_id: userId, name })
    .select('id,name')
    .single();

  if (error) {
    const code = getErrorCode(error);
    if (code === UNIQUE_VIOLATION) {
      return { ok: false, error: 'You already have a dog with that name.' };
    }
    return { ok: false, error: error.message };
  }

  // data.name should exist, but fall back to the submitted name for safety
  return { ok: true, dog: { id: data.id, name: data.name ?? name } };
}
