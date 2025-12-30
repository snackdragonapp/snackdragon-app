// app/dog/[dogId]/catalog/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { parsePositiveNumber, parsePositiveDecimal } from '@/lib/quantity';
import { safeNextPath } from '@/lib/safeNext';

function okQty(n: unknown) {
  const v = parsePositiveNumber(n);
  if (v == null) throw new Error('Value must be a positive number');
  return v;
}

function okDecimal(n: unknown) {
  const v = parsePositiveDecimal(n);
  if (v == null) throw new Error('Value must be a positive number');
  return v;
}

function deriveKcalPerUnit(formData: FormData): number {
  // IMPORTANT: do NOT trust client-computed hidden fields.
  // Always derive from the package fields the user typed.
  const rawLabelKcal = formData.get('label_kcal');

  // Your UI uses `label_amount` (text, may contain "3/4").
  // Keep a fallback to `label_qty` only for any legacy forms.
  const rawLabelAmt = formData.get('label_amount') ?? formData.get('label_qty');

  if (rawLabelKcal == null || rawLabelAmt == null) {
    throw new Error('Calories and serving size are required');
  }

  // Calories must be decimal only; servings may be fractional.
  const labelKcal = okDecimal(rawLabelKcal);
  const labelAmt = okQty(rawLabelAmt);

  const perUnit = labelKcal / labelAmt;
  if (!Number.isFinite(perUnit) || perUnit <= 0) {
    throw new Error('Could not compute kcal per unit');
  }

  // Match numeric(10,4) on the DB side
  return Number(perUnit.toFixed(4));
}

export async function createCatalogItemAction(formData: FormData) {
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

  const name = String(formData.get('name') ?? '').trim();
  const unit = String(formData.get('unit') ?? '').trim();

  // `default_qty` is a text input and may be "3/4"
  const defaultQty = okQty(formData.get('default_qty'));

  if (!name || !unit) throw new Error('Name and unit required');

  const kcalPerUnit = deriveKcalPerUnit(formData);

  const { error } = await supabase.from('catalog_items').insert({
    user_id: user.id,
    dog_id: resolvedDogId,
    name,
    unit,
    kcal_per_unit: kcalPerUnit,
    default_qty: defaultQty,
  });
  if (error) throw new Error(error.message);

  // Catalog changes affect day chips; invalidate day pages too.
  revalidatePath('/dog/[dogId]/day/[ymd]');

  // If user chose "Create & return" and provided a safe relative path, go back.
  if (intent === 'create_return' && next) {
    // Revalidate the destination so chips pick up the new item immediately.
    revalidatePath(next);
    redirect(next);
  }

  // Default behavior: stay on catalog
  revalidatePath('/dog/[dogId]/catalog');
  revalidatePath('/'); // optional; ok to keep
}

export async function updateCatalogItemAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing id');

  const name = String(formData.get('name') ?? '').trim();
  const unit = String(formData.get('unit') ?? '').trim();

  // `default_qty` is a text input and may be "1 1/2"
  const defaultQty = okQty(formData.get('default_qty'));

  if (!name || !unit) throw new Error('Name and unit required');

  const kcalPerUnit = deriveKcalPerUnit(formData);

  const { error } = await supabase
    .from('catalog_items')
    .update({
      name,
      unit,
      kcal_per_unit: kcalPerUnit,
      default_qty: defaultQty,
    })
    .eq('id', id);

  if (error) throw new Error(error.message);
  revalidatePath('/dog/[dogId]/catalog');
  revalidatePath('/dog/[dogId]/day/[ymd]');
  revalidatePath('/');
}

export async function deleteCatalogItemAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing id');

  const { error } = await supabase.from('catalog_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dog/[dogId]/catalog');
  revalidatePath('/dog/[dogId]/day/[ymd]');
  revalidatePath('/');
}
