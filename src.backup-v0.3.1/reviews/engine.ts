import type { ReviewFinding } from '../core/types.js';
import { runCommand, type EvidenceResult } from './evidence.js';

export interface ReviewReport { passed:boolean; evidence:EvidenceResult[]; findings:ReviewFinding[]; }
export class ReviewEngine {
  constructor(private readonly fallowCommand:string) {}
  async deterministic(root:string):Promise<ReviewReport>{
    const evidence:EvidenceResult[]=[]; const findings:ReviewFinding[]=[];
    const typecheck=await runCommand('npm run typecheck',root); evidence.push(typecheck); if(!typecheck.ok) findings.push({id:'TYPECHECK',category:'testing',severity:'high',source:'tests',evidence:typecheck.stdout||typecheck.stderr,rationale:'Typecheck failed.',recommendation:'Fix TypeScript errors before merge.'});
    const tests=await runCommand('npm test',root); evidence.push(tests); if(!tests.ok) findings.push({id:'TESTS',category:'testing',severity:'high',source:'tests',evidence:tests.stdout||tests.stderr,rationale:'Automated tests failed.',recommendation:'Fix failing tests and rerun deterministic checks.'});
    if(this.fallowCommand){const fallow=await runCommand(`${this.fallowCommand} audit --format json --quiet`,root); evidence.push(fallow); if(!fallow.ok && fallow.exitCode!==2) findings.push({id:'FALLOW',category:'other',severity:'medium',source:'fallow',evidence:fallow.stderr||fallow.stdout,rationale:'Fallow reported findings.',recommendation:'Inspect and resolve the reported issues.'});}
    return {passed:findings.length===0,evidence,findings};
  }
}
