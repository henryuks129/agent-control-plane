import type { ReviewFinding, UpgradeIteration } from './types.js';
import { Store } from '../storage/db.js';
import { UpgradeEngine } from './upgrades.js';

export class LearningLoop {
  private readonly upgradesEngine: UpgradeEngine;
  constructor(private readonly store: Store) { this.upgradesEngine = new UpgradeEngine(store); }

  ingest(taskId: string, source: string, findings: ReviewFinding[]) {
    for (const finding of findings) {
      this.store.addLesson(source, finding);
      const candidateRule = finding.category === 'duplicate'
        ? 'Before creating a new abstraction, search the codebase and reuse or extend an existing implementation.'
        : finding.category === 'design'
          ? 'Before UI changes, retrieve the relevant canonical design rules and anti-patterns and validate against them.'
          : finding.category === 'dead-code'
            ? 'Every completed change must remove unused code introduced or exposed by the task.'
            : undefined;
      this.store.addLearningIteration({ taskId, source, summary: `${finding.id}: ${finding.rationale}`, candidateRule, approved: false });
    }
  }

  proposeUpgrade(taskId: string, maxIterations = 1) { return this.upgradesEngine.cycle(taskId, maxIterations); }
  approveUpgrade(id: number) { this.upgradesEngine.approve(id); }
  markUpgradeApplied(id: number) { this.upgradesEngine.markApplied(id); }
  markUpgradeValidated(id: number) { this.upgradesEngine.markValidated(id); }
  rejectUpgrade(id: number) { this.upgradesEngine.reject(id); }
  rollbackUpgrade(id: number) { this.upgradesEngine.rollback(id); }
  upgrades(status?: UpgradeIteration['status']) { return this.upgradesEngine.list(status); }

  humanApprove(taskId: string, iterationId: number) {
    this.store.approveLearning(taskId, iterationId);
    this.store.addLesson('human', { taskId, iterationId, action: 'approve-candidate' });
  }
}
