// components/ProfileMenu.tsx (SERVER component)
import ProfileMenuClient from '@/components/ProfileMenuClient';
import { logoutAction } from '@/app/auth-actions';

async function logoutFromProfileMenu(formData: FormData) {
  'use server';
  await logoutAction(formData);
}

export default function ProfileMenu({ email }: { email: string }) {
  return (
    <ProfileMenuClient
      email={email}
      logoutFromProfileMenu={logoutFromProfileMenu}
    />
  );
}
