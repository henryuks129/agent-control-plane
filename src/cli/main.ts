#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import type { Checkpoint, Task } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { runMemoryCommand } from '../memory/cli.js';
import { runDesignCommand } from '../design/cli.js';
import { serve } from '../mcp/server.js';
import { runRunsCommand } from '../providers/runs-cli.js';
import { runAgentsCommand } from '../providers/cli.js';
import { runCommand } from '../providers/detect.js';
import { resolveCommand, usage as commandList } from './command.js';

const VERSION='0.3.1';
function usage(){console.log(commandList(VERSION))}
// The typed form (`/memory show`) becomes ACP's own name for the command here,
// once, so everything below reads one name per command.
const {command,args}=resolveCommand(process.argv.slice(2));
// Memory commands only read and write files in this project, so they run before the
// orchestrator starts and need no database and no model key.
if(command.startsWith('memory:')){const result=runMemoryCommand(command,args,{root:process.cwd(),dataDir:loadConfig().dataDir});console.log(result.output);process.exit(result.exitCode)}
// Agent commands start the user's own tools; they also need no database and no model key.
// Skill commands only read the shipped skills and this project's settings.
if(command.startsWith('skills:')||command==='design:check'){const result=runDesignCommand(command,args,{root:process.cwd()});console.log(result.output);process.exit(result.exitCode)}
if(command.startsWith('agents:')){const config=loadConfig();const result=await runAgentsCommand(command,args,{root:process.cwd(),worktreeDir:config.worktreeDir,dataDir:config.dataDir},{run:runCommand});console.log(result.output);process.exit(result.exitCode)}
if(command.startsWith('runs:')){const result=await runRunsCommand(command,args,{root:process.cwd()});console.log(result.output);process.exit(result.exitCode)}
// The MCP server owns standard output: every line on it is a protocol message.
if(command==='mcp'){await serve(process.stdin,process.stdout,{root:process.cwd(),dataDir:loadConfig().dataDir});process.exit(0)}
// The commands above only read and write files, so they finish before the
// database is loaded. That keeps them fast, and keeps Node's "SQLite is
// experimental" warning out of their output.
const [{ Orchestrator }, { startUi }, { checkOciDeployment }] = await Promise.all([import('../agents/orchestrator.js'), import('./ui.js'), import('../deployment/oci.js')]);
const acp=new Orchestrator();
try{
 if(command==='help'){usage();process.exit(0)}
 if(command==='doctor'){console.log(JSON.stringify({version:'0.3.1',node:process.version,dataDir:acp.config.dataDir,artifactsDir:acp.config.artifactsDir,uiHost:acp.config.uiHost,nvidiaConfigured:Boolean(acp.config.nvidia.apiKey),nvidiaBaseUrl:acp.config.nvidia.baseUrl,maxConcurrency:acp.config.maxConcurrency,requestTimeoutMs:acp.config.requestTimeoutMs,modelCooldownMs:acp.config.modelCooldownMs,reviewerTimeoutMs:acp.config.reviewerTimeoutMs,researcherTimeoutMs:acp.config.researcherTimeoutMs,builderTimeoutMs:acp.config.builderTimeoutMs,models:acp.router.all(),budgets:acp.config.budgets,fallow:acp.config.fallowCommand,coderabbitEnabled:acp.config.coderabbitEnabled},null,2));process.exit(0)}
 if(command==='ui'){startUi(acp,acp.config.uiPort,acp.config.uiHost);}
 else if(command==='deployment:oci:check'){console.log(JSON.stringify(checkOciDeployment(),null,2));}
 else if(command==='project:onboard'){console.log(JSON.stringify(await acp.onboardProject(args[0]),null,2));}
 else if(command==='project:list'){console.log(JSON.stringify(acp.projects(),null,2));}
 else if(command==='project:show'){console.log(JSON.stringify(acp.project(args[0]),null,2));}
 else if(command==='project:settings'){console.log(JSON.stringify(acp.projectSettings(args[0]),null,2));}
 else if(command==='project:settings:set'){console.log(JSON.stringify(acp.saveProjectSettings(args[0],JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8'))),null,2));}
 else if(command==='task:create'){const file=path.resolve(args[0]);const task=JSON.parse(fs.readFileSync(file,'utf8')) as Task;console.log(acp.createTask(task));}
 else if(command==='task:show'){console.log(JSON.stringify(acp.showTask(args[0]),null,2));}
 else if(command==='task:plan'){console.log(JSON.stringify(acp.buildPlan(args[0]),null,2));}
 else if(command==='task:run'){console.error(`ACP: running ${args[0]} (workers ${acp.config.requestTimeoutMs}ms; research ${acp.config.researcherTimeoutMs}ms; build ${acp.config.builderTimeoutMs}ms; review ${acp.config.reviewerTimeoutMs}ms).`);console.log(JSON.stringify(await acp.run(args[0]),null,2));}
 else if(command==='task:progress'){console.log(JSON.stringify(acp.taskProgress(args[0]),null,2));}
 else if(command==='task:graph'){console.log(JSON.stringify(acp.taskGraph(args[0]),null,2));}
 else if(command==='task:resume'){console.error(`ACP: resuming ${args[0]} (workers ${acp.config.requestTimeoutMs}ms; research ${acp.config.researcherTimeoutMs}ms; build ${acp.config.builderTimeoutMs}ms; review ${acp.config.reviewerTimeoutMs}ms).`);console.log(JSON.stringify(await acp.resume(args[0]),null,2));}
 else if(command==='checkpoint:create'){const cp=JSON.parse(fs.readFileSync(path.resolve(args[1]),'utf8')) as Checkpoint;await acp.checkpoint(args[0],cp);console.log('checkpoint saved');}
 else if(command==='context:build'){const record=acp.showTask(args[0]);if(!record)throw new Error('Task not found');console.log(JSON.stringify(acp.context.build(record.task,acp.store.latestCheckpoint(args[0])),null,2));}
 else if(command==='model:list'){console.log(JSON.stringify(acp.router.all(),null,2));}
 else if(command==='model:smoke'){console.log(JSON.stringify(await acp.smoke((args[0]??'builder') as any),null,2));}
 else if(command==='media:models'){console.log(JSON.stringify(acp.mediaModels(),null,2));}
 else if(command==='media:image'){if(!args[0])throw new Error('Provide an image prompt');console.log(JSON.stringify(await acp.generateImage(args[0],args[1]),null,2));}
 else if(command==='media:show'){console.log(JSON.stringify(acp.artifacts(args[0]),null,2));}
 else if(command==='patch:list'){console.log(JSON.stringify(acp.patches(args[0]),null,2));}
 else if(command==='patch:show'){console.log(JSON.stringify(acp.showPatch(args[0],args[1]),null,2));}
 else if(command==='patch:validate'){console.log(JSON.stringify(await acp.validatePatch(args[0],args[1]),null,2));}
 else if(command==='patch:approve'){console.log(JSON.stringify(acp.approvePatch(args[0],args[1]),null,2));}
 else if(command==='patch:apply'){console.log(JSON.stringify(await acp.applyPatch(args[0],args[1]),null,2));}
 else if(command==='worktree:create'){console.log(await acp.ensureWorktree(args[0]));}
 else if(command==='worktree:prepare'){console.log(JSON.stringify(await acp.prepareWorktree(args[0]),null,2));}
 else if(command==='review:deterministic'){console.log(JSON.stringify(await acp.deterministicReview(args[0]),null,2));}
 else if(command==='review:llm'){console.log(JSON.stringify(await acp.llmReview(args[0]),null,2));}
 else if(command==='review:external'){console.log(JSON.stringify(await acp.externalReview(args[0]),null,2));}
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
 else if(command==='history:show'){console.log(JSON.stringify(acp.taskHistory(args[0]),null,2));}
 else if(command==='artifact:preview'){console.log(JSON.stringify(acp.artifactPreview(args[0],args[1]),null,2));}
 else if(command==='design:candidate'){const file=path.resolve(args[1]);console.log(acp.writeDesignCandidate(args[0],fs.readFileSync(file,'utf8')));}
 else {usage();process.exit(1)}
}catch(error){console.error(error instanceof Error?error.stack??error.message:error);process.exit(1)}
