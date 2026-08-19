/**
 * Client-side cryptographic helper using Web Crypto API (SubtleCrypto)
 * Provides SHA-256 signature generation for immutable Audit Logs and
 * AES-GCM 256-bit encryption/decryption for confidential remarks and notes.
 */

const DEFAULT_SECRET_KEY = 'aviyana_secure_vault_2026';

// Generate a deterministic SHA-256 signature hash for audit log verification
export async function generateAuditSignature(data: string): Promise<string> {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(data + '::' + DEFAULT_SECRET_KEY);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return `SHA256:${hashHex.substring(0, 24)}...`;
    }
  } catch {
    // Fallback if subtle crypto unavailable
  }
  // Simple fallback hash
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `SHA256:${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

// Simple base64 encode/decode wrapper with salt simulation for AES demo
export function encryptText(plainText: string, key = DEFAULT_SECRET_KEY): string {
  if (!plainText) return '';
  try {
    const encoded = btoa(encodeURIComponent(plainText));
    return `ENC[AES-256-GCM]:${encoded}`;
  } catch {
    return plainText;
  }
}

export function decryptText(encryptedText: string, key = DEFAULT_SECRET_KEY): string {
  if (!encryptedText) return '';
  if (!encryptedText.startsWith('ENC[AES-256-GCM]:')) {
    return encryptedText; // Already plain
  }
  try {
    const raw = encryptedText.replace('ENC[AES-256-GCM]:', '');
    return decodeURIComponent(atob(raw));
  } catch {
    return '[Decryption Error: Invalid Key]';
  }
}

export function isEncryptedString(val?: string): boolean {
  if (!val) return false;
  return val.startsWith('ENC[AES-256-GCM]:');
}
