import type { ReviewFinding, UpgradeIteration } from './types.js';
import { Store } from '../storage/db.js';

/**
 * Bounded recursive improvement coordinator.
 *
 * It turns repeated evidence into a candidate upgrade, but never promotes
 * a candidate automatically. The safety boundary is intentional: ACP may
 * learn from failures, while humans retain control over canonical policy.
 */
export class UpgradeEngine {
  constructor(private readonly store: Store) {}

  proposeFromFindings(taskId: string, parentId?: number): UpgradeIteration | undefined {
    const findings = this.store.findings(taskId);
    if (!findings.length) return undefined;

    const clusters = new Map<string, ReviewFinding[]>();
    for (const finding of findings) {
      const key = `${finding.category}:${finding.severity}`;
      const bucket = clusters.get(key) ?? [];
      bucket.push(finding);
      clusters.set(key, bucket);
    }

    const ranked = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
    if (!ranked.length) return undefined;

    const [key, cluster] = ranked[0];
    const category = key.split(':')[0] as ReviewFinding['category'];
    const mapping: Record<ReviewFinding['category'], UpgradeIteration['target']> = {
      bug: 'review', duplicate: 'review', 'dead-code': 'review', architecture: 'context',
      design: 'design', security: 'safety', performance: 'budget', testing: 'review', other: 'other'
    };

    return this.store.addUpgrade({
      parentId,
      source: `task:${taskId}`,
      target: mapping[category],
      hypothesis: `${cluster.length} ${category} finding(s) indicate a repeatable improvement opportunity.`,
      change: cluster[0].recommendation,
      evidence: cluster.slice(0, 8).map(f => `${f.id}: ${f.evidence.slice(0, 500)}`),
      status: 'candidate'
    });
  }

  /** One bounded cycle. Call repeatedly only within an explicit product budget. */
  cycle(taskId: string, maxIterations = 1): UpgradeIteration[] {
    const findings = this.store.findings(taskId);
    const clusters = new Map<string, ReviewFinding[]>();
    for (const finding of findings) {
      const key = `${finding.category}:${finding.severity}`;
      const bucket = clusters.get(key) ?? [];
      bucket.push(finding);
      clusters.set(key, bucket);
    }
    const ranked = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
    const created: UpgradeIteration[] = [];
    let parentId: number | undefined;
    const mapping: Record<ReviewFinding['category'], UpgradeIteration['target']> = {
      bug: 'review', duplicate: 'review', 'dead-code': 'review', architecture: 'context',
      design: 'design', security: 'safety', performance: 'budget', testing: 'review', other: 'other'
    };
    for (const [key, cluster] of ranked.slice(0, Math.max(0, maxIterations))) {
      const category = key.split(':')[0] as ReviewFinding['category'];
      const upgrade = this.store.addUpgrade({
        parentId, source: `task:${taskId}`, target: mapping[category],
        hypothesis: `${cluster.length} ${category} finding(s) indicate a repeatable improvement opportunity.`,
        change: cluster[0].recommendation,
        evidence: cluster.slice(0, 8).map(f => `${f.id}: ${f.evidence.slice(0, 500)}`),
        status: 'candidate'
      });
      created.push(upgrade);
      parentId = upgrade.id;
    }
    return created;
  }

  approve(id: number) { this.store.updateUpgrade(id, 'approved'); }
  markApplied(id: number) { this.store.updateUpgrade(id, 'applied'); }
  markValidated(id: number) { this.store.updateUpgrade(id, 'validated', new Date().toISOString()); }
  reject(id: number) { this.store.updateUpgrade(id, 'rejected'); }
  rollback(id: number) { this.store.updateUpgrade(id, 'rolled_back'); }
  list(status?: UpgradeIteration['status']) { return this.store.listUpgrades(status); }
}
