import http from 'node:http';
import { Orchestrator } from '../agents/orchestrator.js';

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function page() {
  return `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:15px system-ui;background:#0b0d10;color:#eee;max-width:1000px;margin:36px auto;padding:0 18px}
  .card{border:1px solid #27313d;border-radius:14px;background:#10151b;padding:20px;margin:16px 0}
  button{border:1px solid #52647b;border-radius:9px;background:#141d27;color:#eee;padding:9px 12px;margin:4px;cursor:pointer}
  button:hover{background:#1d2a38}.muted{color:#a9b5c4}.flow,.list{display:grid;gap:8px;max-width:720px}
  .node,.row{border:1px solid #435166;border-radius:10px;background:#111820;padding:12px}.completed{border-color:#3c9b6f}
  .ready,.running{border-color:#5d91d6}.pending,.checkpointed{border-color:#b58b38}.failed,.blocked{border-color:#bc5960}
  .arrow{text-align:center;color:#8fa5c0;font-size:20px}.summary{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
  .metric{border:1px solid #435166;border-radius:10px;padding:10px;min-width:105px}.badge{display:inline-block;border-radius:99px;padding:2px 8px;background:#26364a;font-size:12px}
  .section{margin-top:18px}.section h3{margin:0 0 8px}.preview{white-space:pre-wrap;max-height:280px;overflow:auto;background:#090c10;padding:12px;border-radius:8px}
</style>
<h1>Agent Control Plane</h1><p class="muted">Local patch review and human approval.</p>
<div class="card"><h2>Tasks</h2><div id="tasks">Loading…</div></div>
<div class="card"><h2>Task graph</h2><div id="graph" class="muted">Select a task.</div></div>
<div class="card"><h2>Task summary</h2><div id="summary" class="muted">Select a task.</div><div id="actions"></div></div>
<div class="card"><h2>Task history</h2><div id="history" class="muted">Select a task.</div><pre id="preview" class="preview" hidden></pre></div>
<script>
  const get=(url)=>fetch(url).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||response.statusText);return body});
  const escape=(text)=>String(text??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const label=(value)=>String(value??'').replace(/[_-]/g,' ');
  function row(title,detail,kind='') { return '<div class="row '+escape(kind)+'"><b>'+escape(title)+'</b>'+(detail?'<br><small class="muted">'+escape(detail)+'</small>':'')+'</div>'; }
  async function act(taskId,patchId,action){
    if(action==='apply'&&!confirm('Apply this approved patch to the task worktree?'))return;
    try{await fetch('/api/tasks/'+encodeURIComponent(taskId)+'/patches/'+encodeURIComponent(patchId)+'/'+action,{method:'POST'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||response.statusText)});await choose(taskId)}catch(error){alert(error.message)}
  }
  async function preview(taskId,artifactId){
    const target=document.querySelector('#preview');target.hidden=false;target.textContent='Loading preview…';
    try{const artifact=await get('/api/tasks/'+encodeURIComponent(taskId)+'/artifacts/'+encodeURIComponent(artifactId));target.textContent=artifact.missing?'This artifact is no longer available locally.':artifact.previewType==='media'?'Media is stored locally at: '+artifact.path:artifact.text}catch(error){target.textContent=error.message}
  }
  function renderGraph(graph){
    const target=document.querySelector('#graph');
    if(!graph.nodes.length){target.textContent='No graph nodes are available.';return}
    target.innerHTML='<div class="flow">'+graph.nodes.map((node,index)=>
      '<div class="node '+escape(node.status)+'"><b>'+escape(node.role)+'</b> · '+escape(node.title)+
      '<br><small class="muted">'+escape(label(node.status))+(node.dependsOn.length?' · depends on '+escape(node.dependsOn.join(', ')): '')+'</small></div>'+
      (index<graph.nodes.length-1?'<div class="arrow" aria-hidden="true">↓</div>':'')
    ).join('')+'</div>';
  }
  function renderSummary(progress){
    const nodes=progress.nodes||[];const complete=(progress.completed||[]).length;const ready=(progress.ready||[]);
    document.querySelector('#summary').innerHTML='<div class="summary">'+
      '<div class="metric"><small class="muted">Status</small><br><span class="badge">'+escape(label(progress.status))+'</span></div>'+
      '<div class="metric"><small class="muted">Completed</small><br><b>'+complete+' / '+nodes.length+'</b></div>'+
      '<div class="metric"><small class="muted">Ready now</small><br><b>'+ready.length+'</b></div></div>'+
      '<div class="list">'+nodes.map(node=>row(node.title,node.role+' · '+label(node.status),node.status)).join('')+'</div>';
  }
  function renderHistory(history,taskId){
    const target=document.querySelector('#history');const section=(name,content)=>'<div class="section"><h3>'+name+'</h3>'+content+'</div>';
    const artifacts=history.artifacts?.length?'<div class="list">'+history.artifacts.map(artifact=>'<div class="row"><b>'+escape(artifact.type)+'</b> · '+escape(artifact.id)+'<br><small class="muted">'+escape(artifact.created_at||'local artifact')+'</small><br><button data-artifact="'+escape(artifact.id)+'">Preview</button></div>').join('')+'</div>':'<p class="muted">No artifacts recorded.</p>';
    const findings=history.findings?.length?'<div class="list">'+history.findings.map(finding=>row(finding.id,finding.severity+' · '+(finding.recommendation||finding.rationale||finding.evidence),finding.severity)).join('')+'</div>':'<p class="muted">No review findings recorded.</p>';
    const learning=history.learning?.length?'<div class="list">'+history.learning.map(item=>row(item.source,item.summary+(item.approved?' · approved':' · candidate'))).join('')+'</div>':'<p class="muted">No learning entries recorded.</p>';
    const upgrades=history.upgrades?.length?'<div class="list">'+history.upgrades.map(item=>row(item.target,item.change_text+' · '+item.status,item.status)).join('')+'</div>':'<p class="muted">No upgrades proposed.</p>';
    target.innerHTML=section('Artifacts',artifacts)+section('Review findings',findings)+section('Learning',learning)+section('Upgrades',upgrades);
    target.querySelectorAll('[data-artifact]').forEach(button=>button.onclick=()=>preview(taskId,button.dataset.artifact));
  }
  async function choose(taskId){
    try{
      const [progress,patches,graph,history]=await Promise.all([
        get('/api/tasks/'+encodeURIComponent(taskId)+'/progress'), get('/api/tasks/'+encodeURIComponent(taskId)+'/patches'),
        get('/api/tasks/'+encodeURIComponent(taskId)+'/graph'), get('/api/tasks/'+encodeURIComponent(taskId)+'/history')
      ]);
      renderGraph(graph);renderSummary(progress);renderHistory(history,taskId);document.querySelector('#preview').hidden=true;
      const actions=document.querySelector('#actions');actions.textContent='';
      patches.forEach(patch=>{
        const label=document.createElement('p');label.textContent='Patch: '+patch.id;actions.append(label);
        ['validate','approve','apply'].forEach(action=>{const button=document.createElement('button');button.textContent=action[0].toUpperCase()+action.slice(1);button.onclick=()=>act(taskId,patch.id,action);actions.append(button)});
      });
      if(!patches.length)actions.textContent='No patch artifacts for this task.';
    }catch(error){document.querySelector('#summary').textContent=error.message}
  }
  get('/api/dashboard').then(data=>{const tasks=document.querySelector('#tasks');tasks.textContent='';data.tasks.forEach(task=>{const button=document.createElement('button');button.textContent=task.id+' — '+task.status;button.onclick=()=>choose(task.id);tasks.append(button)})}).catch(error=>document.querySelector('#tasks').textContent=error.message);
</script>`;
}

export function startUi(acp: Orchestrator, port: number) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const taskId = parts[2];
      const patchId = parts[4];
      const action = parts[5];

      if (url.pathname === '/api/dashboard') {
        const tasks = acp.listTasks().map(task => ({ id: task.id, status: task.status, updatedAt: task.updated_at }));
        return json(response, 200, { tasks });
      }
      if (parts[0] === 'api' && parts[1] === 'tasks' && request.method === 'GET') {
        if (parts[3] === 'progress') return json(response, 200, acp.taskProgress(taskId));
        if (parts[3] === 'graph') return json(response, 200, acp.taskGraph(taskId));
        if (parts[3] === 'patches') return json(response, 200, acp.patches(taskId));
        if (parts[3] === 'history') return json(response, 200, acp.taskHistory(taskId));
        if (parts[3] === 'artifacts' && parts[4]) return json(response, 200, acp.artifactPreview(taskId, parts[4]));
      }
      if (parts[0] === 'api' && parts[1] === 'tasks' && parts[3] === 'patches' && request.method === 'POST') {
        if (action === 'validate') return json(response, 200, acp.validatePatch(taskId, patchId));
        if (action === 'approve') return json(response, 200, acp.approvePatch(taskId, patchId));
        if (action === 'apply') return json(response, 200, acp.applyPatch(taskId, patchId));
      }
      if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return response.end(page());
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`ACP UI: http://127.0.0.1:${port}`));
  return server;
}
