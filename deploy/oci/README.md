# ACP OCI non-production deployment profile

This profile packages the ACP dashboard/API for OCI. It deliberately does not
provision resources, connect to OCI, accept credentials, or make the dashboard
public. Authentication arrives in v0.6-4, so place the service behind a private
network boundary or an operator-only access gateway.

## Inputs

Copy `oci.env.example` outside the repository, fill in the non-secret resource
identifiers, then validate the profile:

```bash
set -a
source /secure/path/to/acp-oci.env
set +a
acp /deployment oci check
```

The validation output reports only missing field names and configuration errors.
It does not print secret values or contact OCI. `ACP_DATABASE_SECRET_REF` must
be an `oci-vault://` reference; OCI injects the actual database credential only
at runtime through its managed secret mechanism.

## Container

Build the image locally or in an approved CI environment:

```bash
docker build -t acp:0.6.2 .
```

The image runs with a non-root user, writes its local fallback state only under
`/var/lib/acp`, and listens on port 4317. Persistent volumes are suitable for a
non-production local fallback only. They are not a substitute for the production
metadata and object-store adapters that follow this profile.

## Provisioning gate

Before any OCI resources are created, choose the tenancy/compartment, region,
container registry, managed PostgreSQL-compatible service, Object Storage bucket,
queue service, private ingress mechanism, OIDC provider and retention policy.
Provisioning is a separate, authorized action because it creates billable cloud
resources and requires account credentials.
