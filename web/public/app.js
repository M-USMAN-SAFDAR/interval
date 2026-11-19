'use strict';
const $=s=>document.querySelector(s);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories={Education:'learn','IT Support':'tech',Consultancy:'advice',Technology:'tech',Other:'advice'};
let data={user:null,users:[],services:[],bookings:[],problems:[],adminReady:false};
let role=null,provider=null,filter='All services',query='',timer;
const main=$('#main'),modal=$('#modal'),panel=$('#panel');

function notice(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(timer);timer=setTimeout(()=>$('#toast').classList.remove('show'),2800)}
function openPanel(content){panel.innerHTML=content;if(!modal.open)modal.showModal()}
$('.close').onclick=()=>modal.close();modal.onclick=e=>{if(e.target===modal)modal.close()};
const fmt=(iso,opts)=>new Date(iso).toLocaleString(undefined,opts);
const dateLabel=iso=>fmt(iso,{weekday:'short',month:'short',day:'numeric'});
const timeLabel=iso=>fmt(iso,{hour:'numeric',minute:'2-digit'});
const future=iso=>new Date(iso)>new Date();
const eligible=s=>s.visible;
const free=s=>s.slots.filter(t=>!t.reserved && future(t.start));
function go(h){if(location.hash==='#'+h)render();else location.hash=h}
function card(s){return '<article class="directory-entry"><button class="card" data-service="'+s.id+'"><div class="thumb"><img src="art/'+(categories[s.cat]||'tech')+'.webp" alt=""><span class="category">'+esc(s.cat)+'</span></div><div class="card-body"><h3>'+esc(s.name)+'</h3><p class="by">with '+esc(s.provider)+'</p><div class="card-bottom"><span>◷ &nbsp;'+s.mins+' min session</span><span class="arrow" aria-hidden="true">↗</span></div></div></button><button class="profile-link" data-person="'+s.providerId+'">View '+esc(s.provider)+'’s profile</button></article>'}
function results(){const items=data.services.filter(s=>eligible(s)&&(filter==='All services'||s.cat===filter)&&[s.name,s.desc,s.provider].join(' ').toLowerCase().includes(query.toLowerCase()));$('#results').innerHTML=items.map(card).join('')||'<div class="empty">No services match this search. Try another name or category.</div>';$('#count').textContent=items.length+' SERVICE'+(items.length===1?'':'S');document.querySelectorAll('.chip').forEach(b=>{b.classList.toggle('active',b.textContent===filter);b.setAttribute('aria-pressed',b.textContent===filter)})}
function discover(){main.innerHTML='<section class="hero"><div class="copy"><span class="eyebrow">Appointment studio</span><h1>Make time<br><em>for expertise.</em></h1><p>Find a specialist, choose a time, and book a session that fits your day.</p><button class="primary" id="explore">Explore services <span>↘</span></button></div><div class="art"><img src="art/clock.webp" alt="Sculptural mint clock on a lilac plinth beside a polished chrome sphere"><span class="serial"><i></i>FIG. 01 &nbsp; / &nbsp; TIMEPIECE</span></div></section><section class="directory" id="directory"><div class="section-head"><h2>Service directory</h2><label class="search"><span aria-hidden="true">⌕</span><input id="search" aria-label="Search services" placeholder="Search services…" value="'+esc(query)+'"></label></div><div class="tools"><div class="chips">'+['All services',...Object.keys(categories)].map(c=>'<button class="chip">'+c+'</button>').join('')+'</div><span class="meta" id="count"></span></div><div id="results" class="cards"></div></section>';results();mountStudio();$('#search').oninput=e=>{query=e.target.value;results()};$('#explore').onclick=()=>$('#directory').scrollIntoView();$('.hero').onpointermove=e=>{if(!motionOff())$('.art').style.setProperty('--yaw',((e.clientX/innerWidth-.5)*6)+'deg')}}
function detail(id, message='', reason=''){
 const s=data.services.find(x=>x.id===id);
 if(!s||!eligible(s)){openPanel('<h2>Service unavailable</h2><p>Please choose another service.</p>');return}
 const slots=free(s);
 const options=slots.map(t=>'<option value="'+t.id+'">'+dateLabel(t.start)+' · '+timeLabel(t.start)+' – '+timeLabel(t.end)+'</option>').join('');
 openPanel('<h2>'+esc(s.name)+'</h2><p>'+esc(s.provider)+' · '+esc(s.cat)+'</p><p>'+esc(s.desc)+'</p><h3>About the provider</h3><p>'+esc(s.profile)+'</p><button class="ghost" data-person="'+s.providerId+'">View provider profile</button><p role="status">'+esc(message)+'</p>'+
 (slots.length?'<form id="reserve"><label>Available appointments (local time)<select name="slot">'+options+'</select></label><label>Reason for visit (optional)<textarea name="reason" maxlength="400"></textarea></label><p class="hint" role="alert"></p><button class="primary">'+(user()?'Request appointment':'Sign in to book')+'</button></form>':'<p class="empty">No available times.</p>'));
 if(!slots.length)return;
 $('#reserve').elements.reason.value=reason;
 $('#reserve').onsubmit=async event=>{
  event.preventDefault();
  if(!user()){sessionStorage.setItem('interval-intent',String(id));modal.close();go('login/customer');return}
  if(role!=='Customer'){notice('Use a customer account to book.');return}
  const form=event.currentTarget;
  await submitForm(form,async()=>{
   const note=form.elements.reason.value;
   try { await post('bookings',{slot:Number(form.elements.slot.value),reason:note}); }
   catch(error){
     if (![404,409].includes(error.status))throw error;
     await refresh();detail(id,error.message,note);return;
   }
   await refresh();modal.close();go('bookings');notice('Request received');
  });
 };
}
function providerProfile(id){
 const services=data.services.filter(s=>s.visible&&s.providerId===id);
 if(!services.length){openPanel('<h2>Provider unavailable</h2>');return}
 const first=services[0];
 openPanel('<h2>'+esc(first.provider)+'</h2><p>'+esc(first.profile)+'</p><h3>Services and availability</h3>'+services.map(s=>
  '<article class="record"><h3>'+esc(s.name)+'</h3><p>'+esc(s.desc)+'</p><button class="ghost" data-service="'+s.id+'">View times ('+free(s).length+')</button></article>').join(''));
}
function bookingDetails(id){
 const b=data.bookings.find(item=>item.id===id);
 if(!b){openPanel('<h2>Booking unavailable</h2>');return}
 openPanel('<h2>'+esc(b.name)+'</h2><p>'+esc(b.status)+'</p><p>Provider · '+esc(b.provider)+'</p><p>Customer · '+esc(b.customer)+'</p><p>Start · '+esc(new Date(b.time).toLocaleString())+'</p><p>End · '+esc(new Date(b.end).toLocaleString())+'</p><p>'+esc(b.reason||'No reason supplied.')+'</p>');
}
let bookingFilter='All';
function bookingCard(b){let actions=[];if(role==='Customer'&&customerOwns(b)&&future(b.time)&&['Pending','Confirmed'].includes(b.status))actions=['Cancelled'];if(role==='Provider'&&providerOwns(b)){if(b.status==='Pending')actions=['Confirmed','Rejected'];if(b.status==='Confirmed')actions=future(b.end)?['Cancelled']:['Completed','Cancelled']}
 return '<article class="record"><div class="row"><h3>'+esc(b.name)+'</h3><span class="state">'+esc(b.status)+'</span></div><p>'+esc(b.provider)+' · '+esc(b.customer)+' · '+dateLabel(b.time)+' · '+timeLabel(b.time)+'</p>'+(b.reason?'<p>Visit reason · '+esc(b.reason)+'</p>':'')+'<div class="actions"><button class="ghost" data-receipt="'+b.id+'">View details</button>'+actions.map(a=>'<button class="ghost" data-book="'+b.id+'" data-status="'+a+'">'+({Confirmed:'Confirm',Rejected:'Reject',Cancelled:'Cancel appointment',Completed:'Mark completed'})[a]+'</button>').join('')+(role!=='Administrator'?'<button class="ghost" data-report="'+b.id+'">Report a problem</button>':'')+'</div></article>'}
function board(view){const own=view==='bookings'||view==='appointments',isP=role==='Provider'&&!own;
 const allBooks=data.bookings.filter(b=>own?customerOwns(b):!isP||providerOwns(b));
 const books=allBooks.filter(b=>bookingFilter==='All'||b.status===bookingFilter);
 const controls='<div class="actions"><label>Status <select id="booking-filter">'+['All','Pending','Confirmed','Cancelled','Rejected','Completed'].map(v=>'<option '+(v===bookingFilter?'selected':'')+'>'+v+'</option>').join('')+'</select></label><button class="ghost" data-refresh="true">Refresh</button></div>';
 const pServices=data.services.filter(s=>!isP||providerOwns(s));
 const servicesSection=!own?('<div class="row" style="margin-top:28px"><h2>Service listings ('+pServices.length+')</h2>'+(isP?'<button class="primary" data-tool="service">+ Add New Service</button>':'')+'</div><div class="records">'+(pServices.map(s=>'<article class="record"><div class="row"><div><h3>'+esc(s.name)+'</h3><span class="category" style="position:static;display:inline-block;margin-top:4px">'+esc(s.cat)+'</span></div><span class="state">'+listingStatus(s)+'</span></div><p>'+esc(s.desc)+'</p><p>'+s.mins+' min duration · '+free(s).length+' open times</p><div class="actions">'+(isP?'<button class="primary" data-slot="'+s.id+'">+ Add time</button><button class="ghost" data-times="'+s.id+'">Manage times ('+free(s).length+')</button>':'')+'<button class="ghost" data-edit-service="'+s.id+'">Edit service</button>'+(isP?'<button class="ghost" data-pause="'+s.id+'">'+(s.active?'Pause listing':'Resume listing')+'</button>':'<button class="ghost" data-review="'+s.id+'">'+(s.approved?'Hide listing':'Approve listing')+'</button>')+'<button class="ghost danger" data-remove-service="'+s.id+'">Delete service</button></div></article>').join('')||('<div class="empty">You have no services listed yet.'+(isP?' Start by adding your first service offering.<div class="actions" style="margin-top:12px"><button class="primary" data-tool="service">+ Add New Service</button></div>':'')+'</div>'))+'</div><h2>Appointments</h2>'):'';
 main.innerHTML='<section class="dashboard"><span class="eyebrow">'+(own?'Customer':role)+' studio</span><h1>'+(own?'My Appointments':isP?'Provider workspace':'Administration')+'</h1><p class="intro">'+(own?'Track your booked sessions, decisions, and previous appointments.':isP?'Set availability, add and manage your services, and review client appointments.':'Review service visibility and booking activity.')+'</p>'+workspaceSummary()+managementTools()+servicesSection+controls+'<div class="records">'+(books.map(bookingCard).join('')||'<div class="empty">No matching appointments.'+(own?' Choose a service to make your first appointment.<div class="actions" style="margin-top:12px"><a class="primary" href="#discover">Discover services ↗</a></div>':' New requests will appear here.')+'</div>')+'</div></section>';
 mountWorkspace(allBooks);
 $('#booking-filter').onchange=e=>{bookingFilter=e.target.value;board(view)};}
function motionOff(){return document.body.classList.contains('paused')||matchMedia('(prefers-reduced-motion:reduce)').matches}
function motionLabel(){$('#motion').textContent=motionOff()?'Motion paused':'Pause motion';$('#motion').setAttribute('aria-pressed',motionOff());if(document.body.classList.contains('paused')&&!matchMedia('(prefers-reduced-motion:reduce)').matches)$('#motion').textContent='Resume motion'}
document.body.classList.toggle('paused',localStorage.getItem('interval-motion')==='paused');motionLabel();$('#motion').onclick=()=>{document.body.classList.toggle('paused');localStorage.setItem('interval-motion',document.body.classList.contains('paused')?'paused':'enabled');motionLabel()};
window.addEventListener('hashchange',()=>{bookingFilter='All';refreshView();window.scrollTo(0,0)});
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'&&!modal.open&&['#bookings','#appointments','#workspace','#profile'].includes(location.hash))refreshView();
});
startPortal();
