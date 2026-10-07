// components/ChartsTouchDebug.tsx
'use client';

import { useEffect, useState } from 'react';

/**
 * Diagnostic overlay for the charts page, shown only with ?debug=touch.
 *
 * Its mere presence was found to change two-finger gesture behaviour on a
 * phone, so each side effect is switchable from the URL to bisect which one:
 *   listen=both|touch|pointer|none  document-level listeners it adds (default both)
 *   style=1                         read the touched element's touch-action on touchstart
 *   panel=open                      keep the log panel open over the page (default: a button)
 *
 * Whatever the charts' gesture handler reports through window.__chartsTouchLog
 * is logged regardless of these options.
 */

type LogFn = (s: string) => void;
declare global {
  interface Window {
    __chartsTouchLog?: LogFn;
  }
}

export type TouchDebugOptions = {
  listen: 'both' | 'touch' | 'pointer' | 'none';
  style: boolean;
  panelOpen: boolean;
};

export function parseTouchDebugOptions(get: (key: string) => string | null): TouchDebugOptions {
  const listen = get('listen');
  return {
    listen:
      listen === 'touch' || listen === 'pointer' || listen === 'none' ? listen : 'both',
    style: get('style') === '1',
    panelOpen: get('panel') === 'open',
  };
}

const MAX_LINES = 600;

function describeTouch(t: Touch): string {
  const el = t.target as Element | null;
  const tag = el?.tagName ? el.tagName.toLowerCase() : '?';
  const cls = el?.getAttribute?.('class');
  const first = cls ? String(cls).split(' ')[0] : '';
  return `${Math.round(t.clientX)},${Math.round(t.clientY)}:${tag}${first ? '.' + first : ''}`;
}

export default function ChartsTouchDebug({ options }: { options: TouchDebugOptions }) {
  const [open, setOpen] = useState(options.panelOpen);
  const [lines, setLines] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    const buf: string[] = [];
    let raf = 0;
    const push: LogFn = (s) => {
      buf.push(`${(performance.now() - t0).toFixed(0).padStart(6)} ${s}`);
      if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
      // Only the line counter updates while collecting; the panel reads the
      // buffer when opened, so collecting causes no layout work of its own.
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setCount(buf.length);
        });
      }
    };
    window.__chartsTouchLog = push;
    (window as Window & { __chartsTouchBuf?: string[] }).__chartsTouchBuf = buf;

    let oneFingerMoves = 0;
    const onTouch = (e: TouchEvent) => {
      // One-finger moves are frequent and uninteresting; keep every 5th.
      if (e.type === 'touchmove' && e.touches.length === 1 && oneFingerMoves++ % 5 !== 0) return;
      const target = e.target as Element | null;
      const ta =
        options.style && e.type === 'touchstart' && target instanceof Element
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
    const useTouch = options.listen === 'both' || options.listen === 'touch';
    const usePointer = options.listen === 'both' || options.listen === 'pointer';
    if (useTouch) {
      for (const t of touchTypes) document.addEventListener(t, onTouch, { capture: true, passive: true });
    }
    if (usePointer) {
      for (const t of pointerTypes) document.addEventListener(t, onPointer, { capture: true, passive: true });
    }

    push(`build ${process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown'}`);
    push(`options listen=${options.listen} style=${options.style ? 1 : 0} panel=${options.panelOpen ? 'open' : 'button'}`);
    push(`ua ${navigator.userAgent}`);
    push(
      `viewport ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio} maxTouchPoints=${navigator.maxTouchPoints}`
    );

    return () => {
      if (useTouch) for (const t of touchTypes) document.removeEventListener(t, onTouch, { capture: true });
      if (usePointer) for (const t of pointerTypes) document.removeEventListener(t, onPointer, { capture: true });
      if (raf) cancelAnimationFrame(raf);
      delete window.__chartsTouchLog;
    };
  }, [options.listen, options.style, options.panelOpen]);

  const readBuf = () => (window as Window & { __chartsTouchBuf?: string[] }).__chartsTouchBuf ?? [];

  const openPanel = () => {
    setLines([...readBuf()]);
    setOpen(true);
  };
  const refresh = () => setLines([...readBuf()]);
  const copy = async () => {
    const text = readBuf().join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      setCopied('copy failed; select the text instead');
    }
    setTimeout(() => setCopied(null), 1500);
  };
  const clear = () => {
    readBuf().length = 0;
    setLines([]);
    setCount(0);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="fixed right-2 top-2 z-50 rounded border bg-card px-2 py-1 text-[11px] text-muted-foreground"
      >
        touch log ({count})
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 border-t bg-card text-[10px] sm:bottom-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1">
        <span className="font-semibold">touch log</span>
        <span className="text-muted-foreground">{lines.length} lines</span>
        <button type="button" className="ml-auto rounded border px-2 py-0.5" onClick={refresh}>
          Refresh
        </button>
        <button type="button" className="rounded border px-2 py-0.5" onClick={copy}>
          Copy
        </button>
        <button type="button" className="rounded border px-2 py-0.5" onClick={clear}>
          Clear
        </button>
        <button type="button" className="rounded border px-2 py-0.5" onClick={() => setOpen(false)}>
          Close
        </button>
        {copied && <span className="text-muted-foreground">{copied}</span>}
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre px-2 py-1 font-mono leading-tight select-text">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
