// app/dog/[dogId]/day/today/page.tsx
import Script from 'next/script';
import Alert from '@/components/primitives/Alert';
import TodayClientRedirect from './TodayClientRedirect';
import { dogHref } from '@/lib/dogHref';
import { createClient } from '@/lib/supabase/server';
import { resolveDogId } from '@/lib/dogs';
import { notFound } from 'next/navigation';

function SkeletonChip({ w = 'sd-sk-w-20' }: { w?: string }) {
  return <div className={`sd-sk-chip ${w}`} />;
}

function SkeletonRow() {
  return (
    <li className="sd-sk-row">
      <div className="sd-sk-row-grid">
        <div className="sd-sk-check" />
        <div className="sd-sk-row-text">
          <div className="sd-sk-line sd-sk-w-56" />
          <div className="sd-sk-line sd-sk-w-40 sd-sk-subline" />
        </div>
        <div className="sd-sk-line sd-sk-w-16 sd-sk-right" />
      </div>
    </li>
  );
}

export default async function TodayPage({
  params,
}: {
  params: Promise<{ dogId: string }>;
}) {
  const { dogId } = await params;

  // Validate dog context when signed in (404 if not owned / does not exist).
  // If not signed in, we allow the client to resolve ymd and then the day page will auth-gate.
  const supabase = await createClient();
  const { data: { claims } } = await supabase.auth.getClaims();
  const userId = claims?.sub ?? null;

  if (userId) {
    try {
      await resolveDogId(supabase, dogId);
    } catch {
      notFound();
    }
  }

  // Prefix used by both the beforeInteractive script and the client redirect.
  const dayPrefix = dogHref(dogId, '/day/');

  return (
    <main className="sd-today">
      {/* Client-side navigations don't rerun beforeInteractive scripts. */}
      <TodayClientRedirect dogId={dogId} />

      {/* Tiny critical CSS so the skeleton respects light/dark even before Tailwind loads. */}
      <style>{`
        .sd-today{
          max-width:42rem;margin:0 auto;padding:1.5rem;
          font-family:Arial,Helvetica,sans-serif;
          background:var(--my-color-canvas,#f8fafc);
          color:var(--foreground,#171717);
        }
        .sd-sk{animation:sdPulse 1.2s ease-in-out infinite;opacity:.9}
        @keyframes sdPulse{0%,100%{opacity:.65}50%{opacity:1}}
        .sd-sk-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}

        /* “Ink” blocks */
        .sd-sk-title{height:2rem;border-radius:.375rem;background:var(--my-color-control-pressed,#f3f4f6);width:16rem}
        .sd-sk-h2{height:1.25rem;width:10rem;border-radius:.375rem;background:var(--my-color-control-pressed,#f3f4f6);margin-bottom:.5rem}
        .sd-sk-line{height:1rem;border-radius:.375rem;background:var(--my-color-control-pressed,#f3f4f6)}
        .sd-sk-subline{height:.75rem;background:var(--my-color-control-hover,#f9fafb)}

        /* Surfaces */
        .sd-sk-card{border:1px solid var(--my-color-border,#e5e7eb);border-radius:.75rem;background:var(--my-color-card,#ffffff);padding:1rem}
        .sd-sk-row{padding:.75rem 0;border-top:1px solid var(--my-color-divider,#e5e7eb)}
        .sd-sk-row:first-child{border-top:none}

        /* Controls/chips */
        .sd-sk-nav{display:flex;gap:.5rem;flex-wrap:wrap}
        .sd-sk-btn{height:2rem;width:5rem;border:1px solid var(--my-color-border,#e5e7eb);border-radius:.5rem;background:var(--my-color-chip-face,#f8fafc)}
        .sd-sk-chiprow{display:flex;flex-wrap:wrap;gap:.5rem}
        .sd-sk-chip{height:2rem;border-radius:.5rem;border:1px solid var(--my-color-border,#e5e7eb);background:var(--my-color-chip-face,#f8fafc)}

        /* Row layout */
        .sd-sk-row-grid{display:grid;grid-template-columns:44px 1fr auto;gap:.5rem;align-items:center}
        .sd-sk-check{height:2.75rem;width:2.75rem;border-radius:.5rem;border:1px solid var(--my-color-border,#e5e7eb);background:var(--my-color-chip-face,#f8fafc)}
        .sd-sk-row-text{display:flex;flex-direction:column;gap:.5rem}
        .sd-sk-right{justify-self:end;margin-top:.25rem}

        /* Totals */
        .sd-sk-totals{display:flex;justify-content:space-between;gap:.75rem;border-top:1px solid var(--my-color-divider,#e5e7eb);margin-top:1rem;padding-top:1rem;flex-wrap:wrap}

        @media (max-width: 640px){
          .sd-sk-title{width:12rem}
          .sd-sk-nav{width:100%;justify-content:flex-start}
        }
      `}</style>

      {/* Resolve "today" on first-load before React hydration (fastest redirect). */}
      <Script id="snackdragon-resolve-today" strategy="beforeInteractive">
        {`
(function () {
  try {
    var ro = Intl.DateTimeFormat().resolvedOptions();
    if (!ro || !ro.timeZone) throw new Error('timezone-unavailable');

    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var ymd = y + '-' + m + '-' + day;

    var base = ${JSON.stringify(dayPrefix)};
    window.location.replace(base + ymd);
  } catch (e) {
    var sk = document.getElementById('today-skeleton');
    if (sk) sk.style.display = 'none';
    var err = document.getElementById('tz-required');
    if (err) err.style.display = 'block';
    if (console && console.error) console.error('[day/today] timezone required', e);
  }
})();
        `}
      </Script>

      {/* Error state (hidden unless timezone detection fails) */}
      <div id="tz-required" style={{ display: 'none' }} className="sd-tz-error">
        <h1 className="sd-tz-title">Timezone required</h1>
        <Alert tone="error">
          We couldn’t determine your timezone in this browser. Please ensure JavaScript
          and Intl time zone support are available, then reload.
        </Alert>
      </div>

      {/* Skeleton placeholder */}
      <div id="today-skeleton" className="sd-sk" aria-busy="true">
        <div className="sd-sk-header">
          <div className="sd-sk-title" />
          <div className="sd-sk-nav">
            <div className="sd-sk-btn" />
            <div className="sd-sk-btn" />
            <div className="sd-sk-btn" />
          </div>
        </div>

        <section className="sd-sk-section">
          <div className="sd-sk-h2" />
          <div className="sd-sk-card">
            <div className="sd-sk-chiprow">
              <SkeletonChip w="sd-sk-w-24" />
              <SkeletonChip w="sd-sk-w-28" />
              <SkeletonChip w="sd-sk-w-20" />
              <SkeletonChip w="sd-sk-w-32" />
              <SkeletonChip w="sd-sk-w-24" />
              <SkeletonChip w="sd-sk-w-16" />
              <SkeletonChip w="sd-sk-w-28" />
            </div>
            <div
              className="sd-sk-line sd-sk-w-32 sd-sk-subline"
              style={{ marginTop: '.75rem' }}
            />
          </div>
        </section>

        <section className="sd-sk-section">
          <div className="sd-sk-h2" style={{ width: '5rem' }} />
          <div className="sd-sk-card">
            <ul className="sd-sk-list">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </ul>

            <div className="sd-sk-totals">
              <div className="sd-sk-line sd-sk-w-28 sd-sk-subline" />
              <div className="sd-sk-line sd-sk-w-28 sd-sk-subline" />
              <div className="sd-sk-line sd-sk-w-28 sd-sk-subline" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
