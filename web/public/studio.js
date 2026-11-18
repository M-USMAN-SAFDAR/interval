/* The photographic clock is the first paint and WebGL fallback. */
function mountStudio() {
  const hero = document.querySelector('.hero');
  const stage = hero.querySelector('.art');
  let context;
  if (window.gsap && window.ScrollTrigger && !motionOff()) {
    gsap.registerPlugin(ScrollTrigger);
    context = gsap.context(() => {
      gsap.from('.copy > *', {y:24, opacity:0, stagger:.08, duration:.62});
      gsap.from('.directory .section-head', {y:28, opacity:0, duration:.55,
        scrollTrigger:{trigger:'.directory', start:'top 95%', once:true}});
      const button = hero.querySelector('.primary');
      button.onpointerenter = () => { if (!motionOff()) gsap.to(button,{y:-3,duration:.18}); };
      button.onpointerleave = () => gsap.to(button,{y:0,duration:.18});
    });
  }
  let cleanup = () => {};
  if (window.THREE) {
    try { cleanup = mountTimepiece(stage); }
    catch (error) { console.info('Using static timepiece.',error.message); }
  }
  const observer = new MutationObserver(() => {
    if (hero.isConnected) return;
    observer.disconnect();
    cleanup();
    context?.revert();
  });
  observer.observe(document.querySelector('main'), {childList:true});
}

function mountTimepiece(stage) {
  const T = window.THREE;
  const renderer = new T.WebGLRenderer({antialias:true, alpha:true, powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(35,1,.1,50);
  camera.position.set(0,.18,6.5);
  const clock = new T.Group();
  scene.add(clock);
  const material = (color,metalness=.2) => new T.MeshStandardMaterial({color,metalness,roughness:.32});
  const face = material(0xbbefdc), edge = material(0x6aaf99), ink = material(0x192e32);
  function part(geometry,surface,x,y,z) {
    const mesh = new T.Mesh(geometry,surface);
    clock.add(mesh);
    mesh.position.set(x,y,z);
    return mesh;
  }
  const dial = part(new T.CylinderGeometry(1.43,1.43,.32,80),face,0,0,0);
  dial.rotation.x=Math.PI/2;
  part(new T.TorusGeometry(1.41,.055,12,96),edge,0,0,.16);
  for (let i=0;i<60;i++) {
    const angle=i*Math.PI/30, major=i%5===0;
    part(new T.BoxGeometry(major?.045:.018,major?.17:.065,.025),ink,
      Math.sin(angle)*1.23,Math.cos(angle)*1.23,.18).rotation.z=-angle;
  }
  function hand(length,angle,width,z) {
    part(new T.BoxGeometry(width,length,.045),ink,Math.sin(angle)*length/2,
      Math.cos(angle)*length/2,z).rotation.z=-angle;
  }
  const now=new Date(), minutes=now.getMinutes();
  hand(.72,((now.getHours()%12)+minutes/60)*Math.PI/6,.09,.23);
  hand(1.04,minutes*Math.PI/30,.055,.27);
  part(new T.SphereGeometry(.09,16,12),edge,0,0,.30);
  scene.add(new T.HemisphereLight(0xffffff,0x686686,2.9));
  const light=new T.DirectionalLight(0xffffff,3.1);
  light.position.set(-3,5,4);scene.add(light);
  stage.append(renderer.domElement);
  clock.rotation.set(.14,-.32,-.13);
  function draw(){ renderer.render(scene,camera); }
  const resize=new ResizeObserver(()=>{
    if (!stage.clientWidth || !stage.clientHeight) return;
    camera.aspect=stage.clientWidth/stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth,stage.clientHeight,false);
    draw();
    stage.classList.add('model-ready');
  });
  resize.observe(stage);
  const parent=stage.closest('.hero');
  const tilt=event=>{
    if(motionOff())return;
    const rect=parent.getBoundingClientRect();
    clock.rotation.y=-.32+((event.clientX-rect.left)/rect.width-.5)*.6;
    clock.rotation.x=.14+((event.clientY-rect.top)/rect.height-.5)*.35;
    draw();
  };
  parent.addEventListener('pointermove',tilt);
  return ()=>{
    resize.disconnect();parent.removeEventListener('pointermove',tilt);
    clock.children.forEach(mesh=>mesh.geometry.dispose());
    [face,edge,ink].forEach(m=>m.dispose());
    renderer.dispose();renderer.forceContextLoss();
  };
}

function mountWorkspace(bookings) {
  const main=document.querySelector('main'), board=main.querySelector('.dashboard');
  const sidebar=document.querySelector('#workspace-links');
  sidebar.replaceChildren();
  const title=document.createElement('strong');title.textContent=role+' studio';sidebar.append(title);
  const sections=[board.querySelector('h1'),...board.querySelectorAll('h2,details>summary')];
  for(const section of sections){
    const button=document.createElement('button');
    button.textContent=section.textContent;
    button.onclick=()=>{
      if(section.parentElement.tagName==='DETAILS')section.parentElement.open=true;
      section.scrollIntoView({block:'start',behavior:motionOff()?'instant':'smooth'});
      section.tabIndex=-1;section.focus({preventScroll:true});
    };
    sidebar.append(button);
  }
  if(role==='Customer'){
    const browse=document.createElement('a');browse.href='#discover';browse.textContent='Find a service ↗';sidebar.append(browse);
  }
  const metrics=document.createElement('div');metrics.className='metrics';
  for(const status of ['Pending','Confirmed','Completed']){
    const card=document.createElement('div');card.className='metric';
    const count=document.createElement('b'), label=document.createElement('span');
    count.textContent=bookings.filter(b=>b.status===status).length;
    label.textContent=status;card.append(count,label);metrics.append(card);
  }
  board.querySelector('.intro').after(metrics);
  if(window.gsap && !motionOff())gsap.from(metrics.children,{y:10,duration:.3,stagger:.04});
}

const menuToggle = document.querySelector('#menu-toggle');
const siteSidebar = document.querySelector('#site-sidebar');
function setMenu(open) {
  menuToggle.setAttribute('aria-expanded', String(open));
  siteSidebar.classList.toggle('is-open', open);
}
menuToggle.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
siteSidebar.addEventListener('click', event => {
  if (event.target.closest('a,button')) {
    setMenu(false);
    if (menuToggle.offsetWidth && siteSidebar.contains(document.activeElement)) menuToggle.focus();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && siteSidebar.classList.contains('is-open')) {
    setMenu(false);
    menuToggle.focus();
  }
});
