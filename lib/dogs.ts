// lib/dogs.ts
import type { SupabaseClient } from '@supabase/supabase-js';

type DogIdRow = { id: string };

export async function resolveDogId(
  supabase: SupabaseClient,
  dogId?: string | null,
): Promise<string> {
  const candidate =
    typeof dogId === 'string' && dogId.trim() ? dogId.trim() : null;

  // If a dog id was provided, validate it belongs to the current user (via RLS).
  if (candidate) {
    const { data, error } = await supabase
      .from('dogs')
      .select('id')
      .eq('id', candidate)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error('Dog not found');
    return (data as DogIdRow).id;
  }

  // Default behavior (pre-Phase 6 routing): choose the user's oldest ACTIVE dog,
  // falling back to any dog if none are active (matches the old get_or_create_day behavior).
  const { data: activeDogs, error: activeErr } = await supabase
    .from('dogs')
    .select('id')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1);

  if (activeErr) throw new Error(activeErr.message);
  const activeId = (activeDogs as DogIdRow[] | null)?.[0]?.id;
  if (activeId) return activeId;

  const { data: anyDogs, error: anyErr } = await supabase
    .from('dogs')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1);

  if (anyErr) throw new Error(anyErr.message);
  const anyId = (anyDogs as DogIdRow[] | null)?.[0]?.id;
  if (!anyId) throw new Error('No dog found for user');
  return anyId;
}
