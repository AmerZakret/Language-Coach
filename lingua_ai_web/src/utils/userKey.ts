import type { User } from '../types/auth';

export function getUserProgressKey(
  user?: Pick<User, 'id' | 'email'> | null,
  isGuest = false,
  token?: string | null,
): string {
  if (isGuest) {
    return token?.trim() && user?.id && /^[a-f\d]{24}$/i.test(user.id)
      ? `guest_${user.id}`
      : 'local_guest';
  }
  if (user?.id) return `registered_${user.id}`;
  if (user?.email) return `registered_email_${encodeURIComponent(user.email.toLowerCase())}`;
  return 'local_guest';
}

export function getLegacyRegisteredProgressKey(userEmail?: string, isGuest = false): string | undefined {
  if (isGuest || !userEmail) return undefined;
  return userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');
}
