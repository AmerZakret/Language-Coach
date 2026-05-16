export function getUserProgressKey(userEmail?: string, isGuest?: boolean): string {
  if (isGuest || !userEmail) return 'guest';
  return userEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');
}
