import { tryTargetLanguage } from '../common/target-language';
import { User } from './schemas/user.schema';

/** Public identity shared by authentication and profile endpoints. */
export function serializeUser(user: User) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    isGuest: user.isGuest === true,
    level: user.level,
    totalXp: user.totalXp,
    streak: user.streak,
    targetLanguage: tryTargetLanguage(user.targetLanguage) ?? user.targetLanguage ?? 'en',
  };
}
