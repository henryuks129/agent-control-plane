import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(value:string) { const decoded=Buffer.from(value,'base64'); if(decoded.length!==32) throw new Error('ACP_SECRET_ENCRYPTION_KEY must be a 32-byte base64 value'); return decoded; }

export function encryptSecret(plaintext:string, encryptionKey:string) {
  const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key(encryptionKey),iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(payload:string, encryptionKey:string) {
  const [iv,tag,ciphertext]=payload.split('.'); if(!iv||!tag||!ciphertext) throw new Error('Invalid encrypted secret');
  const decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),Buffer.from(iv,'base64url')); decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8');
}
