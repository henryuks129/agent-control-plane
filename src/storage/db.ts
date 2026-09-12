import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentRun, Artifact, Checkpoint, LearningIteration, ModelHealth, ReviewFinding, Task, UpgradeIteration, UpgradeStatus } from '../core/types.js';

export interface StoredModelHealth { id:string; health:ModelHealth; reason?:string; checkedAt:string; cooldownUntil?:string }
export type PatchStatus='validated'|'approved'|'applied'|'rejected';
export interface PatchLifecycle { artifactId:string; taskId:string; worktree:string; status:PatchStatus; validation?:unknown; approvedAt?:string; appliedAt?:string; }

export class Store {
  private db: DatabaseSync;
  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'acp.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,status TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,node_id TEXT,payload TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id,id DESC);
      CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,payload TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY,task_id TEXT NOT NULL,type TEXT NOT NULL,path TEXT NOT NULL,metadata TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY,task_id TEXT NOT NULL,node_id TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_findings (id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_iterations (id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,source TEXT NOT NULL,summary TEXT NOT NULL,candidate_rule TEXT,approved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS upgrade_iterations (id INTEGER PRIMARY KEY AUTOINCREMENT,parent_id INTEGER,source TEXT NOT NULL,target TEXT NOT NULL,hypothesis TEXT NOT NULL,change_text TEXT NOT NULL,evidence TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,validated_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_upgrade_status ON upgrade_iterations(status,id DESC);
      CREATE TABLE IF NOT EXISTS model_health (id TEXT PRIMARY KEY,health TEXT NOT NULL,reason TEXT,checked_at TEXT NOT NULL,cooldown_until TEXT);
      CREATE TABLE IF NOT EXISTS patch_lifecycle (artifact_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,worktree TEXT NOT NULL,status TEXT NOT NULL,validation TEXT,approved_at TEXT,applied_at TEXT);
    `);
  }
  upsertTask(task: Task, status = 'queued') { const now = new Date().toISOString(); this.db.prepare(`INSERT INTO tasks(id,status,payload,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`).run(task.id,status,JSON.stringify(task),now,now); }
  getTask(id: string): { task: Task; status: string } | undefined { const row = this.db.prepare('SELECT status,payload FROM tasks WHERE id=?').get(id) as {status:string;payload:string}|undefined; return row ? {task:JSON.parse(row.payload),status:row.status}:undefined; }
  listTasks() { return this.db.prepare('SELECT id,status,payload,updated_at FROM tasks ORDER BY updated_at DESC').all() as Array<{id:string;status:string;payload:string;updated_at:string}>; }
  setStatus(id: string,status: string) { this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),id); }
  addCheckpoint(cp: Checkpoint) { this.db.prepare('INSERT INTO checkpoints(task_id,node_id,payload,created_at) VALUES(?,?,?,?)').run(cp.task_id,cp.node_id??null,JSON.stringify(cp),new Date().toISOString()); }
  latestCheckpoint(taskId: string,nodeId?: string): Checkpoint|undefined { const row = nodeId ? this.db.prepare('SELECT payload FROM checkpoints WHERE task_id=? AND node_id=? ORDER BY id DESC LIMIT 1').get(taskId,nodeId) : this.db.prepare('SELECT payload FROM checkpoints WHERE task_id=? ORDER BY id DESC LIMIT 1').get(taskId); return row ? JSON.parse((row as {payload:string}).payload):undefined; }
  addLesson(source:string,payload:unknown) { this.db.prepare('INSERT INTO lessons(source,payload,created_at) VALUES(?,?,?)').run(source,JSON.stringify(payload),new Date().toISOString()); }
  addArtifact(a:Artifact) { this.db.prepare('INSERT OR REPLACE INTO artifacts(id,task_id,type,path,metadata,created_at) VALUES(?,?,?,?,?,?)').run(a.id,a.taskId,a.type,a.path,JSON.stringify(a.metadata??{}),new Date().toISOString()); }
  artifacts(taskId:string) { return this.db.prepare('SELECT * FROM artifacts WHERE task_id=? ORDER BY created_at DESC').all(taskId); }
  patchLifecycle(artifactId:string):PatchLifecycle|undefined { const row=this.db.prepare('SELECT artifact_id,task_id,worktree,status,validation,approved_at,applied_at FROM patch_lifecycle WHERE artifact_id=?').get(artifactId) as any; return row?{artifactId:row.artifact_id,taskId:row.task_id,worktree:row.worktree,status:row.status,validation:row.validation?JSON.parse(row.validation):undefined,approvedAt:row.approved_at??undefined,appliedAt:row.applied_at??undefined}:undefined; }
  savePatchLifecycle(record:PatchLifecycle) { this.db.prepare('INSERT INTO patch_lifecycle(artifact_id,task_id,worktree,status,validation,approved_at,applied_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(artifact_id) DO UPDATE SET worktree=excluded.worktree,status=excluded.status,validation=excluded.validation,approved_at=excluded.approved_at,applied_at=excluded.applied_at').run(record.artifactId,record.taskId,record.worktree,record.status,record.validation===undefined?null:JSON.stringify(record.validation),record.approvedAt??null,record.appliedAt??null); }
  modelHealth():StoredModelHealth[] { return this.db.prepare('SELECT id,health,reason,checked_at,cooldown_until FROM model_health').all().map((row:any)=>({id:row.id,health:row.health,reason:row.reason??undefined,checkedAt:row.checked_at,cooldownUntil:row.cooldown_until??undefined})) as StoredModelHealth[]; }
  saveModelHealth(state:StoredModelHealth) { this.db.prepare('INSERT INTO model_health(id,health,reason,checked_at,cooldown_until) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET health=excluded.health,reason=excluded.reason,checked_at=excluded.checked_at,cooldown_until=excluded.cooldown_until').run(state.id,state.health,state.reason??null,state.checkedAt,state.cooldownUntil??null); }
  addAgentRun(run:AgentRun) { this.db.prepare('INSERT OR REPLACE INTO agent_runs(id,task_id,node_id,payload) VALUES(?,?,?,?)').run(run.id,run.taskId,run.nodeId,JSON.stringify(run)); }
  updateAgentRun(run:AgentRun) { this.addAgentRun(run); }
  addFinding(taskId:string,finding:ReviewFinding) { this.db.prepare('INSERT INTO review_findings(task_id,payload,created_at) VALUES(?,?,?)').run(taskId,JSON.stringify(finding),new Date().toISOString()); }
  findings(taskId:string):ReviewFinding[] { return (this.db.prepare('SELECT payload FROM review_findings WHERE task_id=? ORDER BY id').all(taskId) as Array<{payload:string}>).map(x=>JSON.parse(x.payload)); }
  addLearningIteration(iter: Omit<LearningIteration,'id'|'createdAt'>) { const createdAt=new Date().toISOString(); const r=this.db.prepare('INSERT INTO learning_iterations(task_id,source,summary,candidate_rule,approved,created_at) VALUES(?,?,?,?,?,?)').run(iter.taskId,iter.source,iter.summary,iter.candidateRule??null,iter.approved?1:0,createdAt); return { ...iter, id:Number(r.lastInsertRowid), createdAt }; }
  learning(taskId:string) { return this.db.prepare('SELECT * FROM learning_iterations WHERE task_id=? ORDER BY id').all(taskId); }
  approveLearning(taskId:string, iterationId:number) {
    const row=this.db.prepare('SELECT id,approved FROM learning_iterations WHERE task_id=? AND id=?').get(taskId,iterationId) as {id:number;approved:number}|undefined;
    if(!row) throw new Error(`Learning iteration ${iterationId} does not exist for task ${taskId}`);
    if(row.approved) throw new Error(`Learning iteration ${iterationId} is already approved`);
    this.db.prepare('UPDATE learning_iterations SET approved=1 WHERE task_id=? AND id=?').run(taskId,iterationId);
  }
  approvedLessons() { return this.db.prepare('SELECT source,payload FROM lessons WHERE approved=1 ORDER BY id DESC LIMIT 50').all(); }
  addUpgrade(iter: Omit<UpgradeIteration,'id'|'createdAt'>) { const createdAt=new Date().toISOString(); const r=this.db.prepare('INSERT INTO upgrade_iterations(parent_id,source,target,hypothesis,change_text,evidence,status,created_at,validated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(iter.parentId??null,iter.source,iter.target,iter.hypothesis,iter.change,JSON.stringify(iter.evidence),iter.status,createdAt,iter.validatedAt??null); return {...iter,id:Number(r.lastInsertRowid),createdAt}; }
  listUpgrades(status?: UpgradeStatus) { const rows=status?this.db.prepare('SELECT * FROM upgrade_iterations WHERE status=? ORDER BY id DESC').all(status):this.db.prepare('SELECT * FROM upgrade_iterations ORDER BY id DESC').all(); return (rows as any[]).map(r=>({...r,evidence:JSON.parse(r.evidence)})); }
  updateUpgrade(id:number,status:UpgradeStatus,validatedAt?:string) {
    const row=this.db.prepare('SELECT status FROM upgrade_iterations WHERE id=?').get(id) as {status:UpgradeStatus}|undefined;
    if(!row) throw new Error(`Upgrade ${id} does not exist`);
    const allowed:Record<UpgradeStatus,UpgradeStatus[]>={candidate:['approved','rejected'],approved:['validated','rejected'],validated:['applied','rejected'],applied:['rolled_back'],rejected:[],rolled_back:[]};
    if(!allowed[row.status].includes(status)) throw new Error(`Invalid upgrade transition: ${row.status} -> ${status}`);
    this.db.prepare('UPDATE upgrade_iterations SET status=?,validated_at=? WHERE id=?').run(status,status==='validated'?validatedAt??new Date().toISOString():null,id);
  }
}
