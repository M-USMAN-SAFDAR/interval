'use strict';
const adminAddress='admin@interval.demo';
const rolesInfo={
 customer:{name:'Customer',title:'Your appointments',copy:'Find a specialist, reserve a time, and keep your appointments together.',signup:'Create customer account',object:'ticket',label:'SESSION PASS',icon:'person'},
 provider:{name:'Provider',title:'Your practice',copy:'Publish your services, set availability, and manage incoming bookings.',signup:'Apply as a provider',object:'calendar',label:'SERVICE CALENDAR',icon:'calendar'},
 administrator:{name:'Administrator',title:'Studio operations',copy:'Review provider applications, oversee listings, and monitor studio activity.',signup:'Activate administrator',object:'vault',label:'ACCESS CONTROL',icon:'shield'}
};
function icon(name){
 const paths={person:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18m-13 4h3"/>',shield:'<path d="M12 2 4 5v6c0 5 4 9 8 11 4-2 8-6 8-11V5z"/><path d="m8 12 3 3 5-6"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',up:'<path d="M5 19 19 5M6 5h13v13"/>',back:'<path d="M19 12H5m6-6-6 6 6 6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',check:'<path d="m4 13 5 5L20 7"/>'};
 return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>';
}
function accounts(){return data.users}
function user(){return data.user}
function providerOwns(x){return !!user()&&x.providerId===user().id}
function customerOwns(x){return !!user()&&x.customerId===user().id}
function listingStatus(s){
 if(s.providerStatus==='pending')return 'Awaiting provider approval';
 if(s.providerStatus==='rejected')return 'Provider application rejected';
 return s.approved?(s.active?'Published':'Paused'):'Hidden by administrator';
}
function workspaceSummary(){const u=user();if(u.role==='Provider')return '<p class="account-status">Application status · '+esc(u.status)+'</p>';if(u.role!=='Administrator')return '';
 return '<h2 class="review-title">Provider applications</h2><div class="records">'+(accounts().filter(a=>a.role==='Provider'&&a.status==='pending').map(a=>'<article class="record"><h3>'+esc(a.name)+'</h3><p>'+esc(a.category)+' · '+esc(a.bio)+'</p><div class="actions"><button class="ghost" data-decision="approved" data-app="'+a.id+'">Approve</button><button class="ghost" data-decision="rejected" data-app="'+a.id+'">Reject</button></div></article>').join('')||'<p class="empty">No applications awaiting review.</p>')+'</div>'}
function sculpture(k){
 const object=k==='customer'?'<div class="ticket-back"></div><div class="ticket-front"><div class="ticket-glyph">'+icon('person')+'</div><b>Interval.</b><i></i><span></span><em></em></div>':k==='provider'?'<div class="desk-calendar"><div class="rings"><i></i><i></i></div><div class="cal-top"></div><div class="cal-grid">'+Array.from({length:12},(_,i)=>'<i class="'+(i===6?'picked':'')+'">'+(i===6?icon('check'):'')+'</i>').join('')+'</div></div>':'<div class="safe"><i class="bolt a"></i><i class="bolt b"></i><i class="bolt c"></i><i class="bolt d"></i><div class="dial"><div></div><i></i></div></div>';
 return '<div class="scene '+k+'" aria-hidden="true"><div class="matrix"></div><div class="halo"></div><i class="spark s1"></i><i class="spark s2"></i><div class="sculpt">'+object+'</div><span class="object-label">'+rolesInfo[k].label+'</span></div>';
}
function access(){main.innerHTML='<section class="portal"><div class="portal-intro"><div class="eyebrow">WORKSPACE ACCESS</div><h1>Choose your <em>workspace.</em></h1><p>One appointment studio, three ways to get started.</p></div><div class="portals">'+Object.entries(rolesInfo).map(([k,r])=>'<article class="role-card '+k+'">'+sculpture(k)+'<div class="role-copy"><h2>'+r.name+'</h2><p>'+r.copy+'</p><a class="signin" href="#login/'+k+'">Sign in '+icon('arrow')+'</a><a class="subaction" href="#register/'+k+'">'+r.signup+icon('up')+'</a></div></article>').join('')+'</div></section>';wireTilt()}
function wireTilt(){if(!matchMedia('(hover:hover)').matches)return;for(const card of main.querySelectorAll('.role-card,.visual-pane')){card.onpointermove=e=>{if(motionOff())return;const b=card.getBoundingClientRect();card.style.setProperty('--rx',((e.clientX-b.left)/b.width-.5)*14+'deg');card.style.setProperty('--ry',(.5-(e.clientY-b.top)/b.height)*10+'deg')};card.onpointerleave=()=>{card.style.removeProperty('--rx');card.style.removeProperty('--ry')}}}
function field(name,label,type,extra=''){return '<label>'+label+'<input class="field" name="'+name+'" type="'+type+'" required '+extra+'></label>'}
function authScreen(k,register){
 const r=rolesInfo[k],admin=k==='administrator';

 let fields=register?field('name','Full name','text','autocomplete="name" maxlength="90"'):'';
 fields+=field('email',admin?'Administrator email':'Email address','email','autocomplete="username" '+(admin?'value="'+adminAddress+'" readonly':'placeholder="you@example.com"'));
 if(register&&k==='provider')fields+='<label>Service category<select name="category" required><option value="">Choose a category</option>'+Object.keys(categories).map(c=>'<option>'+c+'</option>').join('')+'</select></label>'+field('service','Primary service','text','placeholder="e.g. Mathematics tutoring" maxlength="90"')+'<label>Service description<textarea name="serviceDescription" required rows="2" maxlength="500" placeholder="What will the customer receive during this appointment?"></textarea></label><label>Professional background<textarea name="bio" required rows="2" maxlength="500" placeholder="Describe your expertise and experience"></textarea></label>';
 fields+='<label>Password<div class="pwd"><input class="field" id="password" name="password" required type="password" autocomplete="'+(register?'new-password':'current-password')+'" '+(register?'minlength="8" placeholder="At least 8 characters"':'')+'><button type="button" id="reveal" aria-label="Show password">'+icon('eye')+'</button></div></label>';
 if(register)fields+=field('confirm','Confirm password','password','autocomplete="new-password"');
 const locked=admin&&register&&data.adminReady;
 const sameRole=main.querySelector('.auth-card')?.dataset.role===k;
 const priorMode=main.querySelector('.auth-card')?.classList.contains('signup');
 const switchText=register?'Login':admin&&!data.adminReady?'Activate account':'Sign up';
 const switchMode=register?'login':'register';
 const switchLink='<a class="switch-auth" href="#'+switchMode+'/'+k+'">'+switchText+'</a>';
 const remember=register?'':'<label class="remember"><input type="checkbox" name="remember"> Remember me</label>';
 main.innerHTML='<section class="auth-stage"><a class="return" href="#access">'+icon('back')+' All workspaces</a><div data-role="'+k+'" class="auth-card '+(register?'signup':'')+'"><div class="credentials"><small class="auth-role">'+r.name+' workspace</small><h1>'+(register?(admin?'Activate account':'Create account'):'Welcome back')+'</h1><p>'+(register&&k==='provider'?'Tell customers about your practice.':register?'Create your account to get started.':'Sign in to continue to your account.')+'</p>'+(locked?'<p>Administrator setup is complete. Use Login to continue.</p>':'<form id="account-form">'+fields+remember+'<p id="form-error" role="alert"></p><button class="auth-submit" type="submit">'+(register?r.signup:'Sign in')+'</button></form>')+'</div><div class="welcome"><div class="city" aria-hidden="true"></div><div><h2>'+(register?'Welcome back':'Hello there')+'</h2><p>'+(register?'Login to review your account and continue your journey.':'Begin your journey with us and discover something new.')+'</p>'+switchLink+'</div></div></div></section>';
 if(sameRole && priorMode!==register && !motionOff() && innerWidth>640){
   const panel=main.querySelector('.welcome'), distance=panel.offsetWidth*(register?1:-1);
   panel.animate([{transform:'translateX('+distance+'px)'},{transform:'translateX(0)'}],{duration:620,easing:'cubic-bezier(.65,0,.25,1)'});
   main.querySelector('.credentials').animate([{opacity:0},{opacity:1}],{duration:540});
 }
 if(locked)return;
 $('#reveal').onclick=e=>{const pw=$('#password'),show=pw.type==='password';pw.type=show?'text':'password';e.currentTarget.setAttribute('aria-label',show?'Hide password':'Show password')};
 $('#account-form').onsubmit=e=>{e.preventDefault();submitAccount(e.currentTarget,k,register)};
}
async function submitAccount(form,k,register){
 const values=Object.fromEntries(new FormData(form));
 const submit=form.querySelector('[type=submit]');
 submit.disabled=true;
 const error=form.querySelector('#form-error');
 error.textContent='';
 try {
   if(register && values.password!==values.confirm)throw Error('The passwords must match.');
   delete values.confirm;
   await post(register?'register':'login',{...values,role:rolesInfo[k].name});
   await refresh();
   const intended=Number(sessionStorage.getItem('interval-intent'));
   sessionStorage.removeItem('interval-intent');
   go(k==='customer'?(intended?'discover':'appointments'):'workspace');
   if(k==='customer'&&intended)setTimeout(()=>detail(intended),0);
 } catch(err){error.textContent=err.message}
 finally{submit.disabled=false}
}
function profileScreen(){
 const u=user();
 if(!u){go('access');return}
 const isCust=u.role==='Customer',isProv=u.role==='Provider';
 const myAppts=data.bookings.filter(b=>customerOwns(b)).length;
 const myServices=data.services.filter(s=>providerOwns(s)).length;
 main.innerHTML='<section class="dashboard"><span class="eyebrow">ACCOUNT SETTINGS</span><h1>My Profile</h1><p class="intro">View and manage your account details, professional information, and password.</p><div class="profile-card"><div class="profile-header"><div class="profile-avatar">'+icon(isProv?'calendar':u.role==='Administrator'?'shield':'person')+'</div><div class="profile-info"><h2>'+esc(u.name)+'</h2><p>'+esc(u.email)+' · <span class="state">'+esc(u.role)+'</span></p></div></div><div class="profile-meta-grid"><div class="profile-meta-item"><small>Account Role</small><strong>'+esc(u.role)+'</strong></div><div class="profile-meta-item"><small>Account Status</small><strong>'+esc(u.status||(u.active?'Active':'Suspended'))+'</strong></div>'+(isCust?'<div class="profile-meta-item"><small>Total Appointments</small><strong>'+myAppts+' booked</strong></div>':'')+(isProv?'<div class="profile-meta-item"><small>Primary Category</small><strong>'+esc(u.category||'General')+'</strong></div><div class="profile-meta-item"><small>Active Services</small><strong>'+myServices+' listings</strong></div>':'')+'</div>'+(isProv&&u.bio?'<div style="background:#0e151a;border:1px solid #283238;border-radius:10px;padding:14px"><small style="color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:0.1em;display:block;margin-bottom:6px">Professional Bio</small><p style="margin:0;color:var(--ink);font-size:14px;white-space:pre-wrap">'+esc(u.bio)+'</p></div>':'')+'<div class="actions" style="margin-top:10px"><button class="primary" id="btn-edit-profile">Edit Profile Details</button><button class="ghost" id="btn-change-password">Change Password</button><button class="ghost danger" id="btn-profile-signout">Sign Out</button></div></div></section>';
 $('#btn-edit-profile').onclick=()=>{
  if(isProv){
   editor('Edit Professional Profile',input('name','Full Name','text',u.name,'maxlength="90"')+categoryField(u.category)+textArea('bio','Experience and expertise',u.bio),v=>mutate('profile',v,'Profile details saved'));
  } else {
   editor('Edit Profile Details',input('name','Full Name','text',u.name,'maxlength="90"'),v=>mutate('profile',v,'Profile details saved'));
  }
 };
 $('#btn-change-password').onclick=()=>{
  openPanel('<h2>Change Password</h2><form id="password-form"><label>New Password<input class="field" type="password" name="password" minlength="8" maxlength="256" placeholder="At least 8 characters" required autocomplete="new-password"></label><label>Confirm New Password<input class="field" type="password" name="confirm" minlength="8" maxlength="256" placeholder="Repeat your new password" required autocomplete="new-password"></label><p class="hint" role="alert" id="password-error"></p><div class="actions"><button class="primary" type="submit">Update Password</button></div></form>');
  const form=$('#password-form');
  form.onsubmit=async e=>{
   e.preventDefault();
   const fd=new FormData(form),pw=fd.get('password'),conf=fd.get('confirm'),errEl=$('#password-error');
   errEl.textContent='';
   if(pw!==conf){errEl.textContent='Passwords do not match.';return}
   try{await post('password',{password:pw});modal.close();notice('Password updated successfully')}
   catch(err){errEl.textContent=err.message}
  };
 };
 $('#btn-profile-signout').onclick=async()=>{
  try{await post('logout',{});await refresh();notice('Signed out');go('access')}
  catch(e){notice(e.message)}
 };
}
function render(){
 document.querySelector("#workspace-links").replaceChildren();
 const u=user();role=u?.role||null;provider=u?.name||null;
 const [view='discover',which]=location.hash.slice(1).split('/');const route=view||'discover';
 const nav=document.querySelector('nav');
 if(u){
  const apptLink=role==='Customer'?'<a href="#appointments">My Appointments</a>':'<a href="#workspace">Appointments & Services</a>';
  nav.innerHTML='<a href="#discover">Discover</a>'+apptLink+'<a href="#profile">My Profile</a>';
 } else {
  nav.innerHTML='<a href="#discover">Discover</a><a href="#access">Workspaces</a>';
 }
 nav.querySelectorAll('a').forEach(a=>{
  const href=a.getAttribute('href');
  a.classList.toggle('active',href==='#'+route||(href==='#appointments'&&route==='bookings'));
 });
 const top=$('#roles');top.textContent=u?'Sign out ('+esc(u.name.split(' ')[0])+')':'Sign in';
 top.onclick=async()=>{try{if(u){await post('logout',{});await refresh();sessionStorage.removeItem('interval-intent');notice('Signed out')}go('access')}catch(e){notice(e.message)}};
 if(route==='login'||route==='register'){if(!Object.hasOwn(rolesInfo,which))return access();return authScreen(which,route==='register')}
 if(route==='discover')return discover();
 if(route==='profile')return profileScreen();
 if(route==='workspace'||route==='bookings'||route==='appointments'){
  if(!u)return authScreen('customer',false);
  return board((role==='Customer'||route==='appointments')?'bookings':'workspace');
 }
 access();
}
