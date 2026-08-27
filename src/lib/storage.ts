import { supabase } from './supabaseClient';

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

// Buckets are private (see 25_private_storage_buckets.sql) — a URL alone
// no longer grants access the way a public bucket's URL would. Every
// upload gets a signed URL instead of a permanent public one: still just
// a plain URL string stored and rendered exactly as before (no app-wide
// refresh logic needed), but one that requires a cryptographically
// signed token baked into it rather than being guessable/enumerable, and
// that a private bucket can have revoked entirely if ever needed.
//
// Expiry is intentionally very long (10 years) rather than short-lived,
// since these URLs are stored directly in the database and rendered via
// plain <img src>/<a href> throughout the app — a short expiry would
// require re-signing on every read, which isn't how this app is
// structured today. This is a deliberate middle ground: meaningfully
// closes off "anyone on the internet with a leaked/logged URL, forever"
// (the actual risk with a public bucket) without a full re-architecture
// of how these URLs are stored and displayed.
const SIGNED_URL_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60;

/** Uploads an avatar image under the given user's folder and returns its (long-lived, signed) URL. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/${randomId()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage
    .from('avatars')
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (signError || !data) throw signError ?? new Error('Failed to sign avatar URL');
  return data.signedUrl;
}

/** Uploads a task attachment file under that task's folder and returns its (long-lived, signed) URL. */
export async function uploadTaskFile(taskId: string, file: File): Promise<{ url: string; path: string }> {
  const path = `${taskId}/${randomId()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage
    .from('task-attachments')
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (signError || !data) throw signError ?? new Error('Failed to sign attachment URL');
  return { url: data.signedUrl, path };
}

/** Uploads a chat attachment under that conversation's folder and returns its (long-lived, signed) URL. */
export async function uploadChatFile(conversationId: string, file: File): Promise<{ url: string; path: string; kind: 'image' | 'file' }> {
  const path = `${conversationId}/${randomId()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from('chat-attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (signError || !data) throw signError ?? new Error('Failed to sign chat attachment URL');
  const kind: 'image' | 'file' = file.type.startsWith('image/') ? 'image' : 'file';
  return { url: data.signedUrl, path, kind };
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB — a sane default; raise if Supabase plan allows more
