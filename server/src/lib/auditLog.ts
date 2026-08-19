import crypto from 'crypto';
import { supabase } from './supabase.js';
import { AppUser } from '../middleware/auth.js';

const SIGNING_SECRET = process.env.SUPABASE_JWT_SECRET || 'aviyana-audit-signing';

type AuditCategory = 'task' | 'user' | 'security' | 'slack' | 'approval' | 'report';
type AuditStatus = 'success' | 'warning' | 'critical';

/** Real HMAC-SHA256 signature (replaces the fake base64 "encryption" in the old frontend prototype). */
function signAuditEntry(payload: string): string {
  const hmac = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
  return `SHA256:${hmac}`;
}

export async function writeAuditLog(opts: {
  actor: AppUser;
  action: string;
  category: AuditCategory;
  target: string;
  details?: string;
  status?: AuditStatus;
  ipHash?: string;
}) {
  const payload = `${opts.actor.id}::${opts.action}::${opts.target}::${Date.now()}`;
  const encrypted_signature = signAuditEntry(payload);

  const { error } = await supabase.from('audit_logs').insert({
    actor_id: opts.actor.id,
    action: opts.action,
    category: opts.category,
    target: opts.target,
    details: opts.details ?? '',
    ip_hash: opts.ipHash ?? null,
    encrypted_signature,
    status: opts.status ?? 'success',
  });

  if (error) {
    console.error('Failed to write audit log:', error.message);
  }
}
