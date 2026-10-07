// components/ChartsTouchDebug.tsx
'use client';

import { useEffect, useState } from 'react';

/**
 * Diagnostic overlay for the charts page, shown only with ?debug=touch.
 * Logs touch and pointer events at the document level (capture phase) plus
 * whatever the charts' gesture handler reports through window.__chartsTouchLog,
 * and offers a Copy button so the log can be pasted elsewhere.
 */

type LogFn = (s: string) => void;
declare global {
  interface Window {
    __chartsTouchLog?: LogFn;
  }
}

const MAX_LINES = 600;

function describeTouch(t: Touch): string {
  const el = t.target as Element | null;
  const tag = el?.tagName ? el.tagName.toLowerCase() : '?';
  const cls = el?.getAttribute?.('class');
  const first = cls ? String(cls).split(' ')[0] : '';
  return `${Math.round(t.clientX)},${Math.round(t.clientY)}:${tag}${first ? '.' + first : ''}`;
}

export default function ChartsTouchDebug() {
  const [lines, setLines] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    const buf: string[] = [];
    let raf = 0;
    const push: LogFn = (s) => {
      buf.push(`${(performance.now() - t0).toFixed(0).padStart(6)} ${s}`);
      if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setLines([...buf]);
        });
      }
    };
    window.__chartsTouchLog = push;

    let oneFingerMoves = 0;
    const onTouch = (e: TouchEvent) => {
      // One-finger moves are frequent and uninteresting; keep every 5th.
      if (e.type === 'touchmove' && e.touches.length === 1 && oneFingerMoves++ % 5 !== 0) return;
      const target = e.target as Element | null;
      const ta =
        e.type === 'touchstart' && target instanceof Element
          ? ` ta=${getComputedStyle(target).touchAction}`
          : '';
      push(
        `${e.type} n=${e.touches.length} ch=${e.changedTouches.length} canc=${e.cancelable ? 1 : 0}` +
          `${ta} [${Array.from(e.touches).map(describeTouch).join(' | ')}]`
      );
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      push(
        `${e.type} id=${e.pointerId} primary=${e.isPrimary ? 1 : 0} ${Math.round(e.clientX)},${Math.round(e.clientY)}`
      );
    };

    const touchTypes = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
    const pointerTypes = ['pointerdown', 'pointerup', 'pointercancel'] as const;
    for (const t of touchTypes) document.addEventListener(t, onTouch, { capture: true, passive: true });
    for (const t of pointerTypes) document.addEventListener(t, onPointer, { capture: true, passive: true });

    push(`ua ${navigator.userAgent}`);
    push(
      `viewport ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio} maxTouchPoints=${navigator.maxTouchPoints}`
    );

    return () => {
      for (const t of touchTypes) document.removeEventListener(t, onTouch, { capture: true });
      for (const t of pointerTypes) document.removeEventListener(t, onPointer, { capture: true });
      if (raf) cancelAnimationFrame(raf);
      delete window.__chartsTouchLog;
    };
  }, []);

  const copy = async () => {
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      setCopied('copy failed; select the text instead');
    }
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 border-t bg-card text-[10px] sm:bottom-0">
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <span className="font-semibold">touch debug</span>
        <span className="text-muted-foreground">{lines.length} lines</span>
        <button type="button" className="ml-auto rounded border px-2 py-0.5" onClick={copy}>
          Copy
        </button>
        <button type="button" className="rounded border px-2 py-0.5" onClick={() => setLines([])}>
          Clear view
        </button>
        {copied && <span className="text-muted-foreground">{copied}</span>}
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre px-2 py-1 font-mono leading-tight select-text">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
