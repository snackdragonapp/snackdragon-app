// app/actions.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { isValidYMD, addDaysYMD } from '@/lib/dates';

// Simple helper: generate a client op-id for this server action call.
function newOpId(): string {
  return crypto.randomUUID();
}

export async function toggleEntryStatusAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const entryId = String(formData.get('entry_id') ?? '');
  const nextStatus = String(formData.get('next_status') ?? 'planned');
  if (!entryId) throw new Error('Missing entry_id');
  if (nextStatus !== 'planned' && nextStatus !== 'eaten') throw new Error('Invalid status');

  // RLS ensures you can only update entries whose day belongs to you
  const opId = newOpId();

  const { error } = await supabase
    .from('entries')
    .update({
      status: nextStatus,
      client_op_id: opId,
    })
    .eq('id', entryId);

  if (error) throw new Error(error.message);
}

export async function deleteEntryAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const entryId = String(formData.get('entry_id') ?? '');
  if (!entryId) throw new Error('Missing entry_id');

  const clientOpIdRaw = formData.get('client_op_id');
  const clientOpId =
    typeof clientOpIdRaw === 'string' && clientOpIdRaw.trim()
      ? clientOpIdRaw.trim()
      : null;
  const opId = clientOpId ?? newOpId();

  const { error } = await supabase.rpc('delete_entry_with_op', {
    p_entry_id: entryId,
    p_client_op_id: opId,
  });
  if (error) throw new Error(error.message);
}

export async function updateEntryQtyAndStatusAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const entryId = String(formData.get('entry_id') ?? '');
  const nextStatus = String(formData.get('next_status') ?? 'planned');
  const qty = Number(formData.get('qty') ?? '0');
  if (!entryId) throw new Error('Missing entry_id');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Qty must be > 0');
  if (nextStatus !== 'planned' && nextStatus !== 'eaten') throw new Error('Invalid status');

  const clientOpIdRaw = formData.get('client_op_id');
  const clientOpId =
    typeof clientOpIdRaw === 'string' && clientOpIdRaw.trim()
      ? clientOpIdRaw.trim()
      : null;
  const opId = clientOpId ?? newOpId();

  const { error } = await supabase.rpc('update_entry_qty_and_status', {
    p_entry_id: entryId,
    p_qty: qty,
    p_next_status: nextStatus,
    p_client_op_id: opId,
  });
  if (error) throw new Error(error.message);
}

export async function addEntryFromCatalogAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  // Selected day from the form (chips live on whatever day you’re viewing)
  const dayDate = String(formData.get('date') ?? '');
  if (!isValidYMD(dayDate)) throw new Error('Missing or invalid date');

  const itemId = String(formData.get('catalog_item_id') ?? '');
  const mult = Number(formData.get('mult') ?? '1');
  const status = (String(formData.get('status') ?? 'planned') === 'eaten') ? 'eaten' : 'planned';
  if (!itemId) throw new Error('Missing catalog_item_id');
  if (!Number.isFinite(mult) || mult <= 0) throw new Error('Invalid multiplier');

  const dogIdRaw = formData.get('dog_id');
  const dogId =
    typeof dogIdRaw === 'string' && dogIdRaw.trim() ? dogIdRaw.trim() : null;
  const resolvedDogId = await resolveDogId(supabase, dogId);

  // Ensure selected day exists → get day_id
  const { data: dayId, error: dayErr } = await supabase.rpc('get_or_create_day', {
    p_dog_id: resolvedDogId,
    p_date: dayDate,
  });
  if (dayErr) throw new Error(dayErr.message);

  // Load item (RLS: only your item is visible)
  const { data: item, error: itemErr } = await supabase
    .from('catalog_items')
    .select('id,name,unit,kcal_per_unit,default_qty')
    .eq('id', itemId)
    .eq('dog_id', resolvedDogId)
    .single();

  if (itemErr) throw new Error(itemErr.message);

  const baseQty = Number(item.default_qty);
  const perUnit = Number(item.kcal_per_unit);
  const qty = baseQty * mult;
  const kcal = Number((qty * perUnit).toFixed(2));

  // Prefer client-provided op-id, fall back to server-generated
  const clientOpIdRaw = formData.get('client_op_id');
  const opId =
    typeof clientOpIdRaw === 'string' && clientOpIdRaw.trim()
      ? clientOpIdRaw.trim()
      : newOpId();

  // Optional client-chosen entry id (for optimistic UI)
  const entryIdRaw = formData.get('entry_id');
  const entryId =
    typeof entryIdRaw === 'string' && entryIdRaw.trim()
      ? entryIdRaw.trim()
      : crypto.randomUUID();

  // Append at bottom atomically (RPC), then tag with catalog_item_id
  const { error: insErr } = await supabase.rpc('add_entry_with_order', {
    p_day_id: dayId,
    p_name: item.name,
    p_qty: qty,
    p_unit: item.unit,
    p_kcal: kcal,
    p_status: status,
    p_catalog_item_id: item.id,
    p_client_op_id: opId,
    p_id: entryId,
  });
  if (insErr) throw new Error(insErr.message);
}

export async function updateEntryQtyAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const entryId = String(formData.get('entry_id') ?? '');
  const qty = Number(formData.get('qty') ?? '0');
  if (!entryId) throw new Error('Missing entry_id');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Qty must be > 0');

  // Fetch per-unit snapshot (and fall back if missing)
  const { data: entry, error: selErr } = await supabase
    .from('entries')
    .select('id, qty, kcal_snapshot, kcal_per_unit_snapshot')
    .eq('id', entryId)
    .maybeSingle();

  if (selErr) throw new Error(selErr.message);
  if (!entry) throw new Error('Entry not found');

  let perUnit = entry.kcal_per_unit_snapshot as unknown as number | null;

  if (perUnit == null || perUnit === 0) { // Check for 0 too
    const baseQty = Number(entry.qty) || qty;
    const baseKcal = Number(entry.kcal_snapshot) || 0;
    // Only lock it in if we have actual data
    if (baseKcal > 0 && baseQty > 0) {
      perUnit = Number((baseKcal / baseQty).toFixed(4));
    }
  }

  const newKcal = Number((qty * Number(perUnit)).toFixed(2));

  const clientOpIdRaw = formData.get('client_op_id');
  const clientOpId =
    typeof clientOpIdRaw === 'string' && clientOpIdRaw.trim()
      ? clientOpIdRaw.trim()
      : null;
  const opId = clientOpId ?? newOpId();

  const { error: updErr } = await supabase
    .from('entries')
    .update({
      qty,
      kcal_snapshot: newKcal,
      kcal_per_unit_snapshot: perUnit,
      client_op_id: opId,
    })
    .eq('id', entryId);

  if (updErr) throw new Error(updErr.message);
}

export async function reorderEntriesAction(input: {
  date: string;
  ids: string[];
  dog_id: string;
  client_op_id?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  if (!isValidYMD(input.date)) throw new Error('Missing or invalid date');

  const dogId =
    typeof input.dog_id === 'string' && input.dog_id.trim() ? input.dog_id.trim() : null;
  const resolvedDogId = await resolveDogId(supabase, dogId);

  // Get existing day id (don’t silently create a new day if not there)
  const { data: day } = await supabase
    .from('days')
    .select('id')
    .eq('date', input.date)
    .eq('dog_id', resolvedDogId)
    .maybeSingle();

  if (!day) {
    // nothing to reorder (or stale client); just return
    return;
  }

  const clientOpId =
    typeof input.client_op_id === 'string' && input.client_op_id.trim()
      ? input.client_op_id.trim()
      : null;
  const opId = clientOpId ?? newOpId();

  const { error } = await supabase.rpc('reorder_entries', {
    p_day_id: day.id,
    p_ids: input.ids,
    p_client_op_id: opId,
  });

  if (error) throw new Error(error.message);
}

export async function copyPreviousDayEntriesAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const dayDate = String(formData.get('date') ?? '');
  if (!isValidYMD(dayDate)) throw new Error('Missing or invalid date');

  const dogIdRaw = formData.get('dog_id');
  const dogId =
    typeof dogIdRaw === 'string' && dogIdRaw.trim() ? dogIdRaw.trim() : null;
  const resolvedDogId = await resolveDogId(supabase, dogId);

  const prevYMD = addDaysYMD(dayDate, -1);

  // Ensure target day exists → get day_id
  const { data: targetDayId, error: dayErr } = await supabase.rpc('get_or_create_day', {
    p_dog_id: resolvedDogId,
    p_date: dayDate,
  });
  if (dayErr) throw new Error(dayErr.message);
  const targetDayIdStr = String(targetDayId);

  // Only copy into an empty day
  const { data: existing, error: existingErr } = await supabase
    .from('entries')
    .select('id')
    .eq('day_id', targetDayIdStr)
    .limit(1);

  if (existingErr) throw new Error(existingErr.message);
  if ((existing ?? []).length > 0) return;

  // Find the previous day row (do NOT create it)
  const { data: prevDay, error: prevDayErr } = await supabase
    .from('days')
    .select('id')
    .eq('dog_id', resolvedDogId)
    .eq('date', prevYMD)
    .maybeSingle();

  if (prevDayErr) throw new Error(prevDayErr.message);
  if (!prevDay?.id) return;

  // Load previous day's entries in display order
  const { data: prevEntries, error: prevEntriesErr } = await supabase
    .from('entries')
    .select('name, qty, unit, kcal_snapshot, catalog_item_id, ordering')
    .eq('day_id', prevDay.id)
    .order('ordering', { ascending: true });

  if (prevEntriesErr) throw new Error(prevEntriesErr.message);
  if (!prevEntries || prevEntries.length === 0) return;

  const opId = newOpId();

  for (const row of prevEntries) {
    const name = String((row as { name?: unknown }).name ?? '').trim();
    const unit = String((row as { unit?: unknown }).unit ?? '').trim();
    const qty = Number((row as { qty?: unknown }).qty);
    const kcal = Number((row as { kcal_snapshot?: unknown }).kcal_snapshot);

    if (!name) throw new Error('Invalid entry name');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid entry qty');
    if (!Number.isFinite(kcal)) throw new Error('Invalid entry kcal');

    const catalogItemIdRaw = (row as { catalog_item_id?: unknown }).catalog_item_id;
    const catalogItemId =
      typeof catalogItemIdRaw === 'string' && catalogItemIdRaw.trim()
        ? catalogItemIdRaw.trim()
        : null;

    // IMPORTANT: pass p_id to disambiguate the overloaded add_entry_with_order RPC
    const entryId = crypto.randomUUID();

    const { error: insErr } = await supabase.rpc('add_entry_with_order', {
      p_day_id: targetDayIdStr,
      p_name: name,
      p_qty: qty,
      p_unit: unit,
      p_kcal: kcal,
      p_status: 'planned', // eaten checkbox unchecked
      p_catalog_item_id: catalogItemId,
      p_client_op_id: opId,
      p_id: entryId,
    });

    if (insErr) throw new Error(insErr.message);
  }
}
