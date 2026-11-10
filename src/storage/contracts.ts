import type { Artifact, AuditEvent, Membership, Organization, QueueJob, UsageRecord } from '../core/types.js';

/**
 * v0.6 provider boundaries. The local Store implements these contracts today;
 * OCI adapters will implement the same contracts without changing orchestration.
 */
export interface ArtifactStore {
  addArtifact(artifact: Artifact): void;
  artifacts(taskId: string): unknown[];
}

export interface TenancyStore {
  organization(id: string): Organization | undefined;
  saveOrganization(organization: Organization): void;
  saveMembership(membership: Membership): void;
  memberships(organizationId: string): Membership[];
  addAuditEvent(event: AuditEvent): void;
  auditEvents(organizationId: string, projectId?: string): AuditEvent[];
}

export interface UsageStore {
  addUsage(record: UsageRecord): void;
  usage(organizationId: string, projectId?: string): UsageRecord[];
}

export interface QueueStore {
  saveQueueJob(job: QueueJob): void;
  queueJob(id: string): QueueJob | undefined;
}
