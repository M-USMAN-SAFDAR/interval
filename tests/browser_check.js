// Exercises the rendered forms in a disposable local database.
const password=document.currentScript.dataset.password;
const frame=document.querySelector('iframe'), output=document.querySelector('#result');
const doc=()=>frame.contentDocument;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,description){
 for(let i=0;i<160;i++){const result=fn();if(result)return result;await sleep(35)}
 throw Error('Timeout: '+description);
}
const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
const find=(sel)=>until(()=>[...doc().querySelectorAll(sel)].find(visible),sel);
async function click(sel){(await find(sel)).click()}
async function route(hash){frame.contentWindow.location.hash=hash;await sleep(180)}
async function fields(values){for(const [k,v] of Object.entries(values)){const e=await find('[name="'+k+'"]');e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))}}
async function textExists(text){return until(()=>doc().body.innerText.includes(text),text)}
async function auth(role,mode,values,target){
 await route(mode+'/'+role);
 await until(()=>doc().querySelector('.auth-role')?.innerText.toLowerCase().includes(role),role+' form');
 await fields(values);await click('#account-form button[type=submit]');await textExists(target);
}
async function logout(){if (!visible(doc().querySelector('#roles'))) await click('#menu-toggle');await click('#roles');await textExists('Choose your');}
async function login(role,email,target){await auth(role,'login',{email,password},target)}
function localDate(days,hour){
 const t=new Date();t.setDate(t.getDate()+days);t.setHours(hour,0,0,0);
 return new Date(t-t.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
async function run(width){
 frame.width=width;
 const tag=width+'-'+Date.now(), provider='p'+tag+'@example.test', customer='c'+tag+'@example.test';
 const providerName='Tutor '+tag, title='Lesson '+tag;
 await auth('provider','register',{name:providerName,email:provider,category:'Education',service:title,serviceDescription:'A guided algebra lesson',bio:'Tutor for algebra',password,confirm:password},'Provider workspace');
 await click('[data-slot]');await fields({start:localDate(2,10),end:localDate(2,11)});await click('#edit-form button.primary');await textExists('1 open times');
 await click('[data-slot]');await fields({start:localDate(2,12),end:localDate(2,13)});await click('#edit-form button.primary');await textExists('2 open times');
 await logout();await login('administrator','admin@interval.demo','Administration');
 await click('[data-decision="approved"]');await textExists('No applications awaiting review');await logout();
 await auth('customer','register',{name:'Learner '+tag,email:customer,password,confirm:password},'My bookings');
 await route('discover');await find('#search');const search=doc().querySelector('#search');search.value=title;search.dispatchEvent(new Event('input'));
 await click('[data-person]');await textExists('Services and availability');await click('dialog [data-service]');
 await textExists('Available appointments');
 const firstSlot=(await find('#reserve select')).value;
 await fields({reason:'Keep my visit note'});
 const competing=await fetch('/__compete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot:Number(firstSlot)})});
 if(!competing.ok)throw Error('Competing customer could not reserve the first slot');
 await click('#reserve button.primary');await textExists('That time was just reserved');
 if(doc().querySelector('#reserve select').value===firstSlot || doc().querySelector('#reserve textarea').value!=='Keep my visit note')throw Error('Conflict recovery failed');
 await click('#reserve button.primary');await textExists('Pending');
 await click('[data-receipt]');await textExists('End ·');await click('.close');
 if(doc().documentElement.scrollWidth>width+2)throw Error('Horizontal overflow at '+width);
 await logout();await login('provider',provider,'Provider workspace');
 await click('[data-status="Confirmed"]');await click('#confirm-change button.primary');await until(()=>doc().querySelector('.state') && [...doc().querySelectorAll('.state')].some(e=>e.textContent==='Confirmed'),'confirmed status');
 const filter=await find('#booking-filter');filter.value='Confirmed';filter.dispatchEvent(new Event('change'));await textExists('View details');
 await logout();await login('customer',customer,'My bookings');await textExists('Confirmed');
 await click('[data-status="Cancelled"]');await click('#confirm-change button.primary');await textExists('Cancelled');
 await route('discover');await until(()=>[...doc().querySelectorAll('[data-service]')].some(e=>e.innerText.includes(title)),title);
 [...doc().querySelectorAll('[data-service]')].find(e=>e.innerText.includes(title)).click();
 await textExists('Available appointments');await click('.close');await logout();
 output.textContent+='\nPASS '+width+'px · provider application, slot, approval, search, profile, request, details, confirmation, cancellation and reopening';
}
(async()=>{try{await find('#search');await route('access');await textExists('Choose your');await run(360);await run(1280);output.textContent+='\nAll browser checks passed.'}catch(e){output.textContent+='\nFAILED '+e.message}})();
