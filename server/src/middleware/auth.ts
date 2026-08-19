import { NextFunction, Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';

export interface AppUser {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: 'dept_head' | 'manager' | 'employee';
  department: string;
  permissions: Record<string, boolean>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      appUser?: AppUser;
    }
  }
}

/**
 * Verifies the Supabase-issued JWT sent as `Authorization: Bearer <token>`,
 * then loads the matching row from public.users (with role + permissions)
 * and attaches it to req.appUser.
 *
 * This backend uses the Supabase SERVICE ROLE key, which bypasses RLS —
 * so this middleware is the actual authorization boundary. Every route
 * that touches sensitive data must go through requireAuth (and usually
 * requirePermission too).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });
    }
    const token = header.slice('Bearer '.length);

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileErr } = await supabase
      .from('users')
      .select('id, auth_user_id, name, email, role, department, permissions')
      .eq('auth_user_id', data.user.id)
      .single();

    if (profileErr || !profile) {
      return res.status(403).json({ error: 'No matching user profile found' });
    }

    req.appUser = profile as AppUser;
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

/** Requires a specific boolean flag on the caller's permissions object. */
export function requirePermission(permission: keyof AppUser['permissions']) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.appUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (req.appUser.permissions?.[permission] !== true) {
      return res.status(403).json({ error: `Missing permission: ${String(permission)}` });
    }
    next();
  };
}

/** Requires the caller's role to be one of the given roles. */
export function requireRole(...roles: AppUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.appUser || !roles.includes(req.appUser.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}
