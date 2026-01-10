// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from 'next/link';
import Image from "next/image";
import icon from "./icon.png";
import "./globals.css";
import { createClient } from '@/lib/supabase/server';
import ClientAuthSync from '@/components/auth/ClientAuthSync';
import ToastViewport from '@/components/primitives/Toast';
import ProfileMenu from '@/components/ProfileMenu';
export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Snack Dragon',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // ✅ Trusted identity for server-side gating
  const { data: { claims } } = await supabase.auth.getClaims();
  const userId = claims?.sub ?? null;

  // ⚠️ Only for tokens (and display info), not for authorization decisions
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email ?? '';

  const year = new Date().getFullYear();

  const BLOG_BASE = 'https://blog.snackdragon.app';
  const BLOG_LINK = BLOG_BASE;
  const ABOUT_LINK = `${BLOG_BASE}/about`;
  const PRIVACY_LINK = `${BLOG_BASE}/privacy`;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        {/* Sync server auth state to the browser (and clear on logout) */}
        <ClientAuthSync
          serverUserId={userId}
          accessToken={session?.access_token ?? null}
          refreshToken={session?.refresh_token ?? null}
        />

        <header className="border-b bg-header">
          <div className="mx-auto max-w-2xl p-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src={icon}
                alt="Snack Dragon Logo"
                width={64}
                height={64}
                className="h-12 w-12 shrink-0 rounded-sm object-contain"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-xl leading-tight sm:leading-none">
                  Snack Dragon
                </span>
                <span className="hidden sm:block text-xs leading-tight">
                  Calorie counting for dogs
                </span>
              </div>
            </Link>
            <div className="text-sm">
              {userId ? (
                <ProfileMenu email={email} />
              ) : (
                <div className="flex items-center gap-3">
                  <Link className="underline" href="/login">Login</Link>
                  <Link className="underline" href="/signup">Sign up</Link>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t bg-header">
          <div className="mx-auto max-w-2xl px-3 py-4 text-xs text-muted-foreground">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>© {year} Michael Cooper</span>
                <span aria-hidden="true">·</span>
                <a className="underline hover:no-underline" href={BLOG_LINK} target="_blank" rel="noreferrer">
                  Blog
                </a>
                <span aria-hidden="true">·</span>
                <a className="underline hover:no-underline" href={ABOUT_LINK} target="_blank" rel="noreferrer">
                  About
                </a>
                <span aria-hidden="true">·</span>
                <a className="underline hover:no-underline" href={PRIVACY_LINK} target="_blank" rel="noreferrer">
                  Privacy
                </a>
              </div>

              <div className="text-[11px] leading-snug">
                For tracking only. Not veterinary advice.
              </div>
            </div>
          </div>
        </footer>

        <ToastViewport />
      </body>
    </html>
  );
}
