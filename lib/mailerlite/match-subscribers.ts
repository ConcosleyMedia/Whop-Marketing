// Pure matcher that pairs MailerLite subscribers with our users by email.
//
// Email match is case-insensitive and whitespace-trimmed on both sides.
// If multiple subscribers share an email, the FIRST one wins (deterministic
// w.r.t. input order). Users with null/empty email are skipped.

export type SubscriberRef = { id: string; email: string };
export type UserRef = { id: string; email: string | null };
export type SubscriberMatch = {
  user_id: string;
  mailerlite_subscriber_id: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function matchSubscribersToUsers(
  subscribers: SubscriberRef[],
  users: UserRef[],
): SubscriberMatch[] {
  const subscriberByEmail = new Map<string, string>();
  for (const sub of subscribers) {
    if (!sub.email) continue;
    const norm = normalizeEmail(sub.email);
    if (!norm) continue;
    if (!subscriberByEmail.has(norm)) {
      subscriberByEmail.set(norm, sub.id);
    }
  }

  const matches: SubscriberMatch[] = [];
  for (const user of users) {
    if (!user.email) continue;
    const norm = normalizeEmail(user.email);
    if (!norm) continue;
    const subId = subscriberByEmail.get(norm);
    if (subId) {
      matches.push({ user_id: user.id, mailerlite_subscriber_id: subId });
    }
  }
  return matches;
}
