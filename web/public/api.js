'use strict';

async function readResponse(response) {
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'The request failed.'), {status:response.status});
  return body;
}

async function post(path, fields) {
  const response = await fetch('/api/' + path, {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'X-Interval-Action':'1'},
    body: JSON.stringify(fields)
  });
  return readResponse(response);
}

let refreshVersion = 0;
async function refresh() {
  const version = ++refreshVersion;
  const snapshot = await readResponse(await fetch('/api/state', {cache:'no-store'}));
  if (version === refreshVersion) data = snapshot;
}
async function refreshView(){
  try { await refresh(); render(); }
  catch(error){ notice(error.message); }
}

async function submitForm(form, action) {
  const submit = form.querySelector('button[type=submit], button.primary');
  submit.disabled = true;
  try {
    await action();
  } catch (error) {
    const message = form.querySelector('[role=alert]');
    if (message) message.textContent = error.message;
    else notice(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function mutate(path, fields, message) {
  await post(path, fields);
  await refresh();
  if (modal.open) modal.close();
  render();
  notice(message);
}

function editor(title, fields, save) {
  openPanel('<h2>'+esc(title)+'</h2><form id="edit-form">'+fields+
    '<p class="hint" role="alert"></p><button type="submit" class="primary">Save</button></form>');
  const form = $('#edit-form');
  form.onsubmit = event => {
    event.preventDefault();
    submitForm(form, () => save(Object.fromEntries(new FormData(form))));
  };
}

function confirmChange(title, path, fields) {
  openPanel('<h2>'+esc(title)+'</h2><form id="confirm-change"><p class="hint" role="alert"></p>'+
    '<button class="primary" type="submit">Confirm change</button></form>');
  const form = $('#confirm-change');
  form.onsubmit = event => {
    event.preventDefault();
    submitForm(form, () => mutate(path, fields, 'Change saved'));
  };
}

function input(name, label, type, initial, extra='') {
  return '<label>'+label+'<input class="field" name="'+name+'" type="'+type+'" value="'+
    esc(initial ?? '')+'" '+extra+' required></label>';
}

function categoryField(selected) {
  return '<label>Category<select name="category">'+Object.keys(categories).map(item =>
    '<option '+(selected===item?'selected':'')+'>'+item+'</option>').join('')+'</select></label>';
}

function textArea(name, label, initial) {
  return '<label>'+label+'<textarea name="'+name+'" maxlength="500" required>'+esc(initial||'')+'</textarea></label>';
}

function serviceEditor(s) {
  editor(s?'Edit listing':'Add service',
    input('name','Service name','text',s?.name,'maxlength="90"')+
    categoryField(s?.cat)+textArea('description','Description',s?.desc)+
    input('minutes','Default length in minutes','number',s?.mins||30,'min="1" max="1440"'),
    v=>mutate(s?'services/'+s.id:'services',{...v,minutes:Number(v.minutes)},'Service saved'));
}

function managementTools() {
  if (role==='Provider') return '<div class="actions"><button class="primary" data-tool="service">Add service</button>'+
    '<button class="ghost" data-tool="profile">Edit profile</button></div>';
  if (role!=='Administrator') return '';
  const users=data.users.filter(u=>u.role!=='Administrator').map(u=>
    '<article class="record"><h3>'+esc(u.name)+'</h3><p>'+esc(u.email)+' · '+esc(u.role)+' · '+
    (u.active?'Active':'Deactivated')+'</p><button class="ghost" data-account="'+u.id+'">'+
    (u.active?'Deactivate':'Reactivate')+'</button></article>').join('');
  const reports=data.problems.map(p=>'<article class="record"><h3>Booking #'+p.booking_id+
    '</h3><p>'+esc(p.message)+'</p>'+(p.resolved?'Resolved':'<button class="ghost" data-resolve="'+p.id+'">Resolve</button>')+'</article>').join('');
  return '<details><summary>Registered accounts</summary><div class="records">'+(users||'No accounts yet.')+
    '</div></details><details><summary>Reported problems</summary><div class="records">'+(reports||'No reports.')+'</div></details>';
}

function localInput(iso) {
  if (!iso) return '';
  const d=new Date(iso);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

function slotEditor(s,t) {
  editor(t?'Edit availability':'Add availability',
    input('start','Local start time','datetime-local',localInput(t?.start))+
    input('end','Local end time','datetime-local',localInput(t?.end)),
    v=>mutate('services/'+s.id+'/slots'+(t?'/'+t.id:''),
      {start:new Date(v.start).toISOString(),end:new Date(v.end).toISOString()},'Availability saved'));
  const form=$('#edit-form');
  form.elements.start.onchange=()=>{
    if (!form.elements.end.value && form.elements.start.value)
      form.elements.end.value=localInput(new Date(+new Date(form.elements.start.value)+60000*s.mins).toISOString());
  };
}

function viewTimes(s) {
  openPanel('<h2>'+esc(s.name)+'</h2><div class="records">'+(s.slots.map(t=>
    '<div class="record"><p>'+dateLabel(t.start)+' · '+timeLabel(t.start)+' – '+timeLabel(t.end)+'</p>'+
    (t.reserved?'Reserved':'<div class="actions"><button class="ghost" data-edit-time="'+t.id+'">Edit</button>'+
     '<button class="ghost" data-delete-time="'+t.id+'">Remove</button></div>')+'</div>').join('')||'No upcoming slots.')+'</div>');
  panel.querySelectorAll('[data-edit-time]').forEach(b=>b.onclick=()=>slotEditor(s,s.slots.find(t=>t.id===Number(b.dataset.editTime))));
  panel.querySelectorAll('[data-delete-time]').forEach(b=>b.onclick=()=>confirmChange('Remove this slot?',
    'services/'+s.id+'/slots/'+b.dataset.deleteTime,{remove:true}));
}

async function handleAction(event) {
  const b=event.target.closest('button');
  if (!b) return;
  const d=b.dataset;
  if (b.matches('.chip')) {filter=b.textContent;results();return}
  if (d.service) {await refresh(); detail(Number(d.service));return}
  if (d.person) {await refresh(); providerProfile(Number(d.person));return}
  if (d.receipt) {await refresh(); bookingDetails(Number(d.receipt));return}
  if (d.refresh) {await refreshView();return}
  if (d.tool==='profile') {
    const u=user();
    editor('Professional profile',input('name','Name','text',u.name,'maxlength="90"')+
      categoryField(u.category)+textArea('bio','Experience and expertise',u.bio),
      v=>mutate('profile',v,'Profile saved'));
  }
  if (d.tool==='service') serviceEditor();
  if (d.decision) await mutate('users/'+d.app,{status:d.decision},'Provider application updated');
  if (d.account) {
    const u=data.users.find(u=>u.id===Number(d.account));
    confirmChange((u.active?'Deactivate ':'Reactivate ')+u.name+'?', 'users/'+u.id,{active:!u.active});
  }
  if (d.resolve) await mutate('problems/'+d.resolve+'/resolve',{},'Report resolved');
  if (d.report) editor('Report a booking problem',textArea('message','Problem',''),
    v=>mutate('bookings/'+d.report+'/problems',v,'Report sent to administrator'));
  if (d.book) confirmChange(b.textContent+'?', 'bookings/'+d.book,{status:d.status});
  const sid=d.slot||d.times||d.pause||d.review||d.editService||d.removeService;
  if (!sid) return;
  const s=data.services.find(item=>item.id===Number(sid));
  if (d.slot) slotEditor(s);
  if (d.times) viewTimes(s);
  if (d.editService) serviceEditor(s);
  if (d.removeService) confirmChange('Remove '+s.name+'?', 'services/'+s.id,{remove:true});
  if (d.pause) await mutate('services/'+s.id,{active:!s.active},'Listing updated');
  if (d.review) await mutate('services/'+s.id,{approved:!s.approved},'Listing updated');
}

async function startPortal() {
  document.addEventListener('click',event=>handleAction(event).catch(e=>notice(e.message)));
  try {
    await refresh();
    render();
  } catch {
    main.innerHTML='<section class="dashboard"><h1>Cannot reach the booking server</h1><p>Refresh the page to try again. If the problem continues, contact the studio administrator.</p></section>';
  }
}
