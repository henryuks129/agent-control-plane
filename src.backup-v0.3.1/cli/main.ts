import fs from 'node:fs';
import path from 'node:path';
import { Orchestrator } from '../agents/orchestrator.js';
import { startUi } from './ui.js';
import type { Checkpoint, Task } from '../core/types.js';

function usage(){console.log(`ACP v0.3.1

Commands:
  doctor
  ui
  task:create <file.json>
  task:show <TASK-ID>
  task:plan <TASK-ID>
  task:run <TASK-ID>
  checkpoint:create <TASK-ID> <checkpoint.json>
  context:build <TASK-ID>
  model:list
  model:smoke
  worktree:create <TASK-ID>
  review:deterministic <TASK-ID>
  review:llm <TASK-ID>
  design:candidate <name> <file.md>
  learning:show <TASK-ID>
  learning:approve <TASK-ID> <iteration>
  learning:propose-upgrade <TASK-ID> <max-iterations>
  upgrade:list [status]
  upgrade:approve <upgrade-id>
  upgrade:validate <upgrade-id>
  upgrade:apply <upgrade-id>
  upgrade:reject <upgrade-id>
  upgrade:rollback <upgrade-id>
`)}

const command=process.argv[2];const args=process.argv.slice(3);const acp=new Orchestrator();
try{
 if(!command||command==='help'){usage();process.exit(0)}
 if(command==='doctor'){console.log(JSON.stringify({version:'0.3.1',node:process.version,dataDir:acp.config.dataDir,artifactsDir:acp.config.artifactsDir,nvidiaConfigured:Boolean(acp.config.nvidia.apiKey),nvidiaBaseUrl:acp.config.nvidia.baseUrl,maxConcurrency:acp.config.maxConcurrency,models:acp.router.all(),budgets:acp.config.budgets,fallow:acp.config.fallowCommand,coderabbitEnabled:acp.config.coderabbitEnabled},null,2));process.exit(0)}
 if(command==='ui'){startUi(acp,acp.config.uiPort);}
 else if(command==='task:create'){const file=path.resolve(args[0]);const task=JSON.parse(fs.readFileSync(file,'utf8')) as Task;console.log(acp.createTask(task));}
 else if(command==='task:show'){console.log(JSON.stringify(acp.showTask(args[0]),null,2));}
 else if(command==='task:plan'){console.log(JSON.stringify(acp.buildPlan(args[0]),null,2));}
 else if(command==='task:run'){console.log(JSON.stringify(await acp.run(args[0]),null,2));}
 else if(command==='checkpoint:create'){const cp=JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8')) as Checkpoint;await acp.checkpoint(args[0],cp);console.log('checkpoint saved');}
 else if(command==='context:build'){const record=acp.showTask(args[0]);if(!record)throw new Error('Task not found');console.log(JSON.stringify(acp.context.build(record.task,acp.store.latestCheckpoint(args[0])),null,2));}
 else if(command==='model:list'){console.log(JSON.stringify(acp.router.all(),null,2));}
 else if(command==='model:smoke'){console.log(JSON.stringify(await acp.smoke(),null,2));}
 else if(command==='worktree:create'){console.log(await acp.ensureWorktree(args[0]));}
 else if(command==='review:deterministic'){console.log(JSON.stringify(await acp.deterministicReview(args[0]),null,2));}
 else if(command==='review:llm'){console.log(JSON.stringify(await acp.llmReview(args[0]),null,2));}
 else if(command==='learning:show'){console.log(JSON.stringify(acp.learning(args[0]),null,2));}
 else if(command==='learning:approve'){acp.approveLearning(args[0],Number(args[1]));console.log('learning iteration approved');}
 else if(command==='learning:propose-upgrade'){console.log(JSON.stringify(acp.proposeUpgrade(args[0],Number(args[1]??1)),null,2));}
 else if(command==='upgrade:list'){console.log(JSON.stringify(acp.upgrades(args[0] as any),null,2));}
 else if(command==='upgrade:approve'){acp.approveUpgrade(Number(args[0]));console.log('upgrade approved');}
 else if(command==='upgrade:validate'){acp.validateUpgrade(Number(args[0]));console.log('upgrade validated');}
 else if(command==='upgrade:apply'){acp.applyUpgrade(Number(args[0]));console.log('upgrade marked applied');}
 else if(command==='upgrade:reject'){acp.rejectUpgrade(Number(args[0]));console.log('upgrade rejected');}
 else if(command==='upgrade:rollback'){acp.rollbackUpgrade(Number(args[0]));console.log('upgrade rolled back');}
 else if(command==='artifacts:show'){console.log(JSON.stringify(acp.artifacts(args[0]),null,2));}
 else if(command==='design:candidate'){const file=path.resolve(args[1]);console.log(acp.writeDesignCandidate(args[0],fs.readFileSync(file,'utf8')));}
 else {usage();process.exit(1)}
}catch(error){console.error(error instanceof Error?error.stack??error.message:error);process.exit(1)}
