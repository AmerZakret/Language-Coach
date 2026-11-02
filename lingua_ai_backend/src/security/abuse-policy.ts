import { SetMetadata } from '@nestjs/common';

export type RoutePolicy =
  | 'login'
  | 'register'
  | 'guest'
  | 'provider'
  | 'flashcard-write'
  | 'community-write'
  | 'reaction';
export const ABUSE_POLICY = 'abuse-policy';
export const AbusePolicy = (policy: RoutePolicy) =>
  SetMetadata(ABUSE_POLICY, policy);
export type Rule = {
  name: string;
  identity: string;
  limit: number;
  windowMs: number;
};
export const minute = 60000;
export const hour = 60 * minute;
export const day = 24 * hour;
export function rule(
  name: string,
  identity: string,
  limit: number,
  windowMs = minute,
): Rule {
  return { name, identity, limit, windowMs };
}
export function isHealth(path: string): boolean {
  return ['/health', '/health/live', '/health/ready'].includes(
    path.toLowerCase().replace(/\/+$/, ''),
  );
}
export const OUTPUT_TOKENS = {
  chat: 2048,
  writing: 4096,
  flashcard: 1024,
  feedback: 256,
} as const;
