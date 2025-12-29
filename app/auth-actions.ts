// app/auth-actions.ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safeNext';
import { headers } from 'next/headers';

export async function signupAction(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm_password') ?? '');

  if (!email) throw new Error('Email required');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');

  // ✅ Server-side confirm check
  if (!confirm || confirm !== password) {
    const qs = new URLSearchParams({ error: 'Passwords do not match.' });
    redirect(`/signup?${qs.toString()}`);
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    const qs = new URLSearchParams({ error: error.message });
    redirect(`/signup?${qs.toString()}`);
  }

  redirect('/login?check-email=1');
}

export async function loginAction(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  // Read raw `next` from the form, sanitize it, then fall back to "/"
  const nextSafe = safeNextPath(formData.get('next'));
  const next = nextSafe ?? '/';

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Redirect back to /login so the page can show the red <Alert>
    const qs = new URLSearchParams({ error: error.message, next });
    redirect(`/login?${qs.toString()}`);
  }

  // 👇 ensures cookies are attached to THIS response before redirect
  await supabase.auth.getUser();

  // Phase 2 setup gate: if signed in and no active dogs, force /setup/dog
  const { data: dogs, error: dogsErr } = await supabase
    .from('dogs')
    .select('id')
    .is('archived_at', null)
    .limit(1);

  if (!dogsErr && (dogs ?? []).length === 0) {
    redirect(`/setup/dog?next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);

  // 👇 ensures cookies are attached to THIS response before redirect
  await supabase.auth.getUser();

  redirect('/login');
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/forgot-password?error=Email%20required');

  const supabase = await createClient();

  const headersList = await headers();
  const origin =
    headersList.get('origin') ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://localhost:3000';

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) redirect(`/forgot-password?error=${encodeURIComponent(error.message)}`);
  redirect('/forgot-password?sent=1');
}
