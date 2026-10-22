import { withOwnerStorage } from './browserCoordination';
import { getSessionRequestConfig, isSessionCurrent } from './queueSession';

interface LocalCard { _id: string; nextReviewDate: string }

// Local guest cards are durable local work, rather than a backend queue overlay.
// All is authoritative; due is derived so a crash cannot split the two snapshots.
export async function mutateLocalGuestCards<T extends LocalCard>(
  language: string, update: (latest: T[]) => T[], isContextCurrent: () => boolean = () => true,
): Promise<{ all: T[]; due: T[] }> {
  const { sessionSnapshot: session } = getSessionRequestConfig();
  if (session.ownerNamespace !== 'local_guest' || session.userId !== 'guest' || session.token)
    throw new Error('Local guest session required');
  return withOwnerStorage('local_guest', () => {
    if (!isSessionCurrent(session) || !isContextCurrent()) throw new Error('Local guest context changed');
    const key = `flashcards_all_guest_${language}`;
    const raw = localStorage.getItem(key) ?? localStorage.getItem(`flashcards_due_guest_${language}`);
    const latest = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(latest)) throw new Error('Invalid local flashcards');
    const all = update(latest);
    localStorage.setItem(key, JSON.stringify(all));
    return { all, due: all.filter(card => Date.parse(card.nextReviewDate) <= Date.now()) };
  });
}
