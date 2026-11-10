export interface OciDeploymentProfile {
  provider: 'oci';
  region: string;
  compartmentId: string;
  publicBaseUrl: string;
  artifactNamespace: string;
  artifactBucket: string;
  databaseSecretRef: string;
  apiImage: string;
}

export interface DeploymentCheck {
  ready: boolean;
  missing: string[];
  errors: string[];
  profile?: OciDeploymentProfile;
}

const required = [
  ['OCI_REGION', 'region'],
  ['OCI_COMPARTMENT_ID', 'compartmentId'],
  ['ACP_PUBLIC_BASE_URL', 'publicBaseUrl'],
  ['OCI_OBJECT_STORAGE_NAMESPACE', 'artifactNamespace'],
  ['ACP_ARTIFACT_BUCKET', 'artifactBucket'],
  ['ACP_DATABASE_SECRET_REF', 'databaseSecretRef'],
  ['ACP_API_IMAGE', 'apiImage']
] as const;

/** Validates OCI deployment inputs without reading credentials or contacting OCI. */
export function checkOciDeployment(env: NodeJS.ProcessEnv = process.env): DeploymentCheck {
  const missing = required.filter(([name]) => !env[name]?.trim()).map(([name]) => name);
  const errors: string[] = [];
  const publicBaseUrl = env.ACP_PUBLIC_BASE_URL?.trim() ?? '';
  const secretRef = env.ACP_DATABASE_SECRET_REF?.trim() ?? '';
  if (publicBaseUrl && !/^https:\/\//i.test(publicBaseUrl)) errors.push('ACP_PUBLIC_BASE_URL must use https.');
  if (secretRef && !/^oci-vault:\/\//.test(secretRef)) errors.push('ACP_DATABASE_SECRET_REF must be an oci-vault:// reference, not a database URL or password.');
  if (env.ACP_UI_HOST && env.ACP_UI_HOST !== '0.0.0.0') errors.push('ACP_UI_HOST must be 0.0.0.0 for the OCI container profile.');
  if (missing.length || errors.length) return { ready: false, missing, errors };
  return {
    ready: true,
    missing: [],
    errors: [],
    profile: {
      provider: 'oci',
      region: env.OCI_REGION!.trim(),
      compartmentId: env.OCI_COMPARTMENT_ID!.trim(),
      publicBaseUrl,
      artifactNamespace: env.OCI_OBJECT_STORAGE_NAMESPACE!.trim(),
      artifactBucket: env.ACP_ARTIFACT_BUCKET!.trim(),
      databaseSecretRef: secretRef,
      apiImage: env.ACP_API_IMAGE!.trim()
    }
  };
}
