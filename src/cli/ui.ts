import http from 'node:http';
import { Orchestrator } from '../agents/orchestrator.js';

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function page() {
  return `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:15px system-ui;background:#0b0d10;color:#eee;max-width:1000px;margin:36px auto;padding:0 18px}
  .card{border:1px solid #27313d;border-radius:14px;background:#10151b;padding:20px;margin:16px 0}
  button{border:1px solid #52647b;border-radius:9px;background:#141d27;color:#eee;padding:9px 12px;margin:4px;cursor:pointer}
  button:hover{background:#1d2a38}.muted{color:#a9b5c4}.flow{display:grid;gap:8px;max-width:620px}
  .node{border:1px solid #435166;border-radius:10px;background:#111820;padding:12px}.completed{border-color:#3c9b6f}
  .ready,.running{border-color:#5d91d6}.pending{border-color:#b58b38}.failed{border-color:#bc5960}
  .arrow{text-align:center;color:#8fa5c0;font-size:20px}pre{white-space:pre-wrap;max-height:240px;overflow:auto}
</style>
<h1>Agent Control Plane</h1><p class="muted">Local patch review and human approval.</p>
<div class="card"><h2>Tasks</h2><div id="tasks">Loading…</div></div>
<div class="card"><h2>Task graph</h2><div id="graph" class="muted">Select a task.</div></div>
<div class="card"><h2>Selected task</h2><pre id="detail">Select a task.</pre><div id="actions"></div></div>
<div class="card"><h2>History</h2><pre id="history">Select a task.</pre></div>
<script>
  const get=(url)=>fetch(url).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||response.statusText);return body});
  const escape=(text)=>String(text).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  async function act(taskId,patchId,action){
    if(action==='apply'&&!confirm('Apply this approved patch to the task worktree?'))return;
    try{await fetch('/api/tasks/'+encodeURIComponent(taskId)+'/patches/'+encodeURIComponent(patchId)+'/'+action,{method:'POST'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||response.statusText)});await choose(taskId)}catch(error){alert(error.message)}
  }
  function renderGraph(graph){
    const target=document.querySelector('#graph');
    if(!graph.nodes.length){target.textContent='No graph nodes are available.';return}
    target.innerHTML='<div class="flow">'+graph.nodes.map((node,index)=>
      '<div class="node '+escape(node.status)+'"><b>'+escape(node.role)+'</b> · '+escape(node.title)+
      '<br><small class="muted">'+escape(node.status)+(node.dependsOn.length?' · depends on '+escape(node.dependsOn.join(', ')): '')+'</small></div>'+
      (index<graph.nodes.length-1?'<div class="arrow" aria-hidden="true">↓</div>':'')
    ).join('')+'</div>';
  }
  async function choose(taskId){
    try{
      const [progress,patches,graph,history]=await Promise.all([
        get('/api/tasks/'+encodeURIComponent(taskId)+'/progress'), get('/api/tasks/'+encodeURIComponent(taskId)+'/patches'),
        get('/api/tasks/'+encodeURIComponent(taskId)+'/graph'), get('/api/tasks/'+encodeURIComponent(taskId)+'/history')
      ]);
      renderGraph(graph);
      document.querySelector('#detail').textContent=JSON.stringify(progress,null,2);
      document.querySelector('#history').textContent=JSON.stringify(history,null,2);
      const actions=document.querySelector('#actions');actions.textContent='';
      patches.forEach(patch=>{
        const label=document.createElement('p');label.textContent='Patch: '+patch.id;actions.append(label);
        ['validate','approve','apply'].forEach(action=>{const button=document.createElement('button');button.textContent=action[0].toUpperCase()+action.slice(1);button.onclick=()=>act(taskId,patch.id,action);actions.append(button)});
      });
      if(!patches.length)actions.textContent='No patch artifacts for this task.';
    }catch(error){document.querySelector('#detail').textContent=error.message}
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
