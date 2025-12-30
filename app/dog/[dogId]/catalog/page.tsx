import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { dogHref } from '@/lib/dogHref';
import { createCatalogItemAction, updateCatalogItemAction } from './actions';
import CatalogAddForm from '@/components/CatalogAddForm';
import CatalogRow from '@/components/CatalogRow';
import RealtimeBridge from '@/components/realtime/RealtimeBridge';
import { safeNextPath } from '@/lib/safeNext';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ dogId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { dogId: dogIdParam } = await params;

  const sp = await searchParams;
  // Safety: only allow relative paths
  const next = safeNextPath(sp.next);

  const supabase = await createClient();

  // Auth gate: anonymous → /login?next=/dog/<dogId>/catalog
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const requested = next
      ? `${dogHref(dogIdParam, '/catalog')}?next=${encodeURIComponent(next)}`
      : dogHref(dogIdParam, '/catalog');
    redirect(`/login?next=${encodeURIComponent(requested)}`);
  }

  // Validate dog context from URL
  let dogId: string;
  try {
    dogId = await resolveDogId(supabase, dogIdParam);
  } catch {
    notFound();
  }

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
        <CatalogAddForm dogId={dogId} next={next} createAction={createCatalogItemAction} />
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
                <CatalogRow key={it.id} dogId={dogId} item={it} updateAction={updateCatalogItemAction} />
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
