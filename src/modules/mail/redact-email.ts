/**
 * Masks an address for logging: arko@gmail.com -> a***@gmail.com
 *
 * Log lines in this service must never carry a full address, a token or a
 * message body. Verbose debug logging is what filled this box's disk before.
 */
export function redactEmail(email: string): string {
  const [local, domain] = String(email ?? '').split('@');
  if (!domain || !local) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}
