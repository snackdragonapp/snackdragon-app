// app/dog/[dogId]/weights/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { isValidYMD } from '@/lib/dates';
import { safeNextPath } from '@/lib/safeNext';

function okNum(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) throw new Error('Value must be a positive number');
  return v;
}

function toKg(n: number, unit: string) {
  const u = (unit || 'kg').toLowerCase();
  return u === 'lb' || u === 'lbs' ? n * 0.45359237 : n;
}

function round3(n: number) {
  return Number(n.toFixed(3));
}

export async function createWeightAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const dogIdRaw = formData.get('dog_id');
  const dogId =
    typeof dogIdRaw === 'string' && dogIdRaw.trim() ? dogIdRaw.trim() : null;
  const resolvedDogId = await resolveDogId(supabase, dogId);

  // Optional return target + intent
  const rawNext = String(formData.get('next') ?? '');
  const next = safeNextPath(rawNext);
  const intent = String(formData.get('intent') ?? 'create');

  const methodRaw = String(formData.get('method') ?? 'vet');
  const method: 'vet' | 'home_diff' = methodRaw === 'home_diff' ? 'home_diff' : 'vet';
  const unit = String(formData.get('unit') ?? 'kg');

  const measuredAt = String(formData.get('date') ?? '');
  if (!isValidYMD(measuredAt)) throw new Error('Missing or invalid date');

  let weightKg: number;
  let meKg: number | null = null;
  let meAndDogKg: number | null = null;

  if (method === 'vet') {
    const w = okNum(formData.get('weight'));
    weightKg = round3(toKg(w, unit));
  } else {
    const me = okNum(formData.get('me'));
    const both = okNum(formData.get('me_plus_dog'));
    if (both <= me) throw new Error('You + dog must be greater than You');
    meKg = round3(toKg(me, unit));
    meAndDogKg = round3(toKg(both, unit));
    weightKg = round3(meAndDogKg - meKg);
  }

  const note = String(formData.get('note') ?? '').trim() || null;

  const { error } = await supabase.from('weights').insert({
    user_id: user.id,
    dog_id: resolvedDogId,
    measured_at: measuredAt,
    method,
    weight_kg: weightKg,
    me_kg: meKg,
    me_and_dog_kg: meAndDogKg,
    note,
  });
  if (error) throw new Error(error.message);

  // Weights affect charts; day pages may show related context later too.
  revalidatePath('/dog/[dogId]/charts');
  revalidatePath('/dog/[dogId]/day/[ymd]');

  if (intent === 'create_return' && next) {
    revalidatePath(next);
    redirect(next);
  }

  revalidatePath('/dog/[dogId]/weights');
}

export async function deleteWeightAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing id');

  const { error } = await supabase.from('weights').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/dog/[dogId]/charts');
  revalidatePath('/dog/[dogId]/day/[ymd]');
  revalidatePath('/dog/[dogId]/weights');
}
