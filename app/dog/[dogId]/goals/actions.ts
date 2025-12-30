// app/dog/[dogId]/goals/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { isValidYMD } from '@/lib/dates';
import { safeNextPath } from '@/lib/safeNext';

function okInt(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
    throw new Error('Target must be a positive integer');
  }
  return v;
}

export async function createGoalAction(formData: FormData) {
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

  const startDate = String(formData.get('start_date') ?? '');
  if (!isValidYMD(startDate)) throw new Error('Missing or invalid date');

  const kcalTarget = okInt(formData.get('kcal_target'));
  if (kcalTarget < 200 || kcalTarget > 5000) {
    throw new Error('Target must be between 200 and 5000 kcal/day');
  }

  const note = String(formData.get('note') ?? '').trim() || null;

  // Upsert by (dog_id, start_date): replaces any existing goal for that day
  const { error } = await supabase
    .from('goals')
    .upsert(
      {
        user_id: user.id,
        dog_id: resolvedDogId,
        start_date: startDate,
        kcal_target: kcalTarget,
        note,
      },
      { onConflict: 'dog_id,start_date' }
    );

  if (error) throw new Error(error.message);

  // Goals affect day summaries and charts.
  revalidatePath('/dog/[dogId]/day/[ymd]');
  revalidatePath('/dog/[dogId]/charts');

  if (intent === 'create_return' && next) {
    revalidatePath(next);
    redirect(next);
  }

  revalidatePath('/dog/[dogId]/goals');
}

export async function deleteGoalAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing id');

  const { error } = await supabase.from('goals').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/dog/[dogId]/day/[ymd]');
  revalidatePath('/dog/[dogId]/charts');
  revalidatePath('/dog/[dogId]/goals');
}
