import type { ProjectSettings } from '../core/types.js';

const secret=/api.?key|secret|token|password|credential/i;
const allowedTop=new Set(['version','profiles','rolePreferences','budgets','timeouts']);

function object(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function safe(value:unknown):boolean { if(Array.isArray(value)) return value.every(safe); if(!object(value)) return true; return Object.entries(value).every(([key,item])=>!secret.test(key)&&safe(item)); }
export function validateProjectSettings(value:unknown,profileIds:string[]):ProjectSettings {
  if(!object(value)||value.version!==1) throw new Error('Project settings must be an object with version: 1.');
  if(!safe(value)) throw new Error('Project settings must not contain secrets or credential fields.');
  for(const key of Object.keys(value)) if(!allowedTop.has(key)) throw new Error(`Unknown project settings field: ${key}`);
  if(value.profiles!==undefined) { if(!object(value.profiles)) throw new Error('profiles must be an object.'); for(const [id,override] of Object.entries(value.profiles)){if(!profileIds.includes(id))throw new Error(`Unknown model profile: ${id}`);if(!object(override))throw new Error(`Invalid profile settings for ${id}`);for(const [key,item] of Object.entries(override)){if(!['enabled','priority','maxConcurrent'].includes(key)||((key==='enabled')?typeof item!=='boolean':typeof item!=='number'||item<0))throw new Error(`Invalid profile setting: ${id}.${key}`);}} }
  if(value.timeouts!==undefined) { if(!object(value.timeouts)) throw new Error('timeouts must be an object.'); for(const [key,item] of Object.entries(value.timeouts)) if(!['requestTimeoutMs','reviewerTimeoutMs','researcherTimeoutMs','builderTimeoutMs'].includes(key)||typeof item!=='number'||item<=0) throw new Error(`Invalid timeout setting: ${key}`); }
  return value as unknown as ProjectSettings;
}
