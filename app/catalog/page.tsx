import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { createCatalogItemAction, updateCatalogItemAction } from './actions';
import CatalogAddForm from '@/components/CatalogAddForm';
import CatalogRow from '@/components/CatalogRow';
import RealtimeBridge from '@/components/realtime/RealtimeBridge';
import { safeNextPath } from '@/lib/safeNext';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams;
  // Safety: only allow relative paths
  const next = safeNextPath(sp.next);

  const supabase = await createClient();

  // Auth gate: anonymous → /login?next=/catalog
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const requested = next ? `/catalog?next=${encodeURIComponent(next)}` : '/catalog';
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  const dogId = await resolveDogId(supabase);

  const { data: items } = await supabase
    .from('catalog_items')
    .select('id,name,unit,kcal_per_unit,default_qty,created_at')
    .eq('dog_id', dogId)
    .order('name', { ascending: true });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 font-sans bg-canvas">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Catalog</h1>
        {next && (
          <Link href={next} className="rounded border px-2 py-1 text-sm hover:bg-control-hover">‹ Back to day</Link>
        )}
      </div>

      {/* Add item */}
      <section className="space-y-2">
        <h2 className="font-semibold">Add item</h2>
        <CatalogAddForm next={next} createAction={createCatalogItemAction} />
      </section>

      {/* Your items */}
      <section className="space-y-2">
        <h2 className="font-semibold">Your items</h2>
        <div className="rounded-lg border bg-card p-4">
          {(items ?? []).length === 0 ? (
            <ul className="divide-y">
              <li className="py-2 text-sm text-muted-foreground">No items yet. Create your first above.</li>
            </ul>
          ) : (
            <ul className="divide-y">
              {(items ?? []).map((it) => (
                <CatalogRow key={it.id} item={it} updateAction={updateCatalogItemAction} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Realtime sync for catalog items */}
      <RealtimeBridge
        channel="rt-catalog-items"
        table="catalog_items"
        filter={`dog_id=eq.${dogId}`}
        devLabel="Catalog"
      />
    </main>
  );
}