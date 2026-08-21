import { supabase } from './supabaseClient';

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

/** Uploads an avatar image under the given user's folder and returns its public URL. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/${randomId()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

/** Uploads a task attachment file under that task's folder and returns its public URL. */
export async function uploadTaskFile(taskId: string, file: File): Promise<{ url: string; path: string }> {
  const path = `${taskId}/${randomId()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('task-attachments').getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB — a sane default; raise if Supabase plan allows more
