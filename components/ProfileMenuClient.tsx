'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import ConfirmSubmit from '@/components/primitives/ConfirmSubmit';

export default function ProfileMenuClient({
  email,
  logoutFromProfileMenu,
}: {
  email: string;
  logoutFromProfileMenu: (formData: FormData) => Promise<void>;
}) {
  const displayEmail = email?.trim() ? email.trim() : 'Unknown email';

  const detailsRef = useRef<HTMLDetailsElement>(null);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const closeMenu = useCallback(() => {
    const el = detailsRef.current;
    if (el?.open) el.open = false; // closes <details>
  }, []);

  // Close whenever navigation happens (Link clicks, back/forward, etc.)
  useEffect(() => {
    closeMenu();
  }, [pathname, searchKey, closeMenu]);

  const summaryBtn =
    'list-none cursor-pointer inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-control-hover ' +
    'focus:outline-none focus:ring-2 focus:ring-control-ring [&::-webkit-details-marker]:hidden';

  const menu =
    'absolute right-0 mt-2 w-56 rounded border bg-card p-2 shadow-md z-20';

  const menuItem =
    'block w-full rounded px-2 py-1 text-left text-sm hover:bg-control-hover ' +
    'focus:outline-none focus:ring-2 focus:ring-control-ring';

  return (
    <details ref={detailsRef} className="relative">
      <summary className={summaryBtn} aria-label="Open profile menu">
        <span aria-hidden="true">👤</span>
        <span>Profile</span>
      </summary>

      <div
        className={menu}
        role="menu"
        aria-label="Profile menu"
        // Close on successful form submit (and NOT if submit was prevented).
        onSubmit={(e) => {
          if (!e.defaultPrevented) closeMenu();
        }}
      >
        <Link
          href="/dogs"
          className={menuItem}
          role="menuitem"
          onClick={closeMenu}
        >
          Dogs
        </Link>

        <div className="my-1 border-t" />

        <div className="px-2 py-1">
          <div className="text-[11px] text-muted-foreground">Account</div>
          <div className="text-sm truncate" title={displayEmail}>
            {displayEmail}
          </div>
        </div>

        <div className="my-1 border-t" />

        <ConfirmSubmit
          formAction={logoutFromProfileMenu}
          confirmMessage="Log out?"
          className={menuItem}
          aria-label="Log out"
        >
          Logout
        </ConfirmSubmit>
      </div>
    </details>
  );
}
