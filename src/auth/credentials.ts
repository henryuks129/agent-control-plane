import type { Store } from '../storage/db.js';
import { encryptSecret } from '../security/secrets.js';

export class UserCredentials {
  constructor(private readonly store:Store,private readonly encryptionKey:string|undefined=process.env.ACP_SECRET_ENCRYPTION_KEY) {}
  nvidiaConfigured(sessionId:string|undefined) { return Boolean(sessionId && this.store.userCredential(sessionId,'nvidia-nim')); }
  saveNvidiaKey(sessionId:string|undefined,apiKey:string) { if(!sessionId||!this.store.userSession(sessionId)) throw new Error('Sign in with GitHub first'); if(!this.encryptionKey) throw new Error('Secure credential storage is not configured'); if(!apiKey.trim()) throw new Error('Enter a NVIDIA NIM API key'); this.store.saveUserCredential(sessionId,'nvidia-nim',encryptSecret(apiKey.trim(),this.encryptionKey)); }
}
