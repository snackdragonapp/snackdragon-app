// components/ProfileMenu.tsx (SERVER component)
import ProfileMenuClient from '@/components/ProfileMenuClient';
import { logoutAction } from '@/app/auth-actions';

async function logoutFromProfileMenu() {
  'use server';
  await logoutAction();
}

export default function ProfileMenu({ email }: { email: string }) {
  return (
    <ProfileMenuClient
      email={email}
      logoutFromProfileMenu={logoutFromProfileMenu}
    />
  );
}
