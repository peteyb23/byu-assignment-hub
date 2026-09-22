(() => {
  // Standing/waving Wayne lives only at the top of the page. Once the user
  // scrolls down, hide him completely so he can never cover Today's Focus.
  const style = document.createElement('style');
  style.textContent = `
    @media (min-width:1101px) {
      .wayne-floating-helper:not(.wayne-sitting-mode) {
        position: fixed !important;
        width: 250px !important;
        z-index: 1200 !important;
        margin: 0 !important;
        transform: none !important;
      }
      .wayne-floating-helper:not(.wayne-sitting-mode) .wayne-row { display:flex !important; flex-direction:row !important; align-items:flex-start !important; gap:8px !important; width:100% !important; margin:0 !important; }
      .wayne-floating-helper:not(.wayne-sitting-mode) .wayne-bubble { display:block !important; flex:1 1 auto !important; max-width:166px !important; }
      .wayne-floating-helper:not(.wayne-sitting-mode) .wayne-mascot-wrap { display:flex !important; flex:0 0 76px !important; width:76px !important; height:126px !important; align-items:flex-end !important; justify-content:center !important; overflow:visible !important; }
      .wayne-floating-helper:not(.wayne-sitting-mode) #wayneMascot { display:block !important; height:118px !important; width:auto !important; max-width:none !important; }
      .wayne-floating-helper:not(.wayne-sitting-mode) #wayneDangleMascot,
      .wayne-floating-helper:not(.wayne-sitting-mode) #wayneDangleNextUp { display:none !important; }
    }
  `;
  document.head.appendChild(style);

  function placeStandingWayne() {
    const helper=document.querySelector('.wayne-floating-helper');
    const shell=document.querySelector('.app-shell');
    if(!helper||!shell)return;
    if(helper.classList.contains('wayne-sitting-mode')||window.innerWidth<=1100){
      helper.style.removeProperty('display');
      helper.style.removeProperty('left');
      helper.style.removeProperty('top');
      return;
    }
    // Standing Wayne is a top-of-page decoration, not a sticky widget.
    // As soon as the page moves down, he disappears and returns at the top.
    if(window.scrollY>40){helper.style.setProperty('display','none','important');return;}
    const shellRect=shell.getBoundingClientRect();
    const width=250,gap=18,left=shellRect.left-width-gap;
    if(left<8){helper.style.setProperty('display','none','important');return;}
    helper.style.removeProperty('display');
    helper.style.setProperty('left',`${Math.round(left)}px`,'important');
    helper.style.setProperty('top','18px','important');
  }

  const helper=document.querySelector('.wayne-floating-helper');
  if(helper)new MutationObserver(placeStandingWayne).observe(helper,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',placeStandingWayne);
  window.addEventListener('scroll',placeStandingWayne,{passive:true});
  window.addEventListener('pageshow',placeStandingWayne);
  window.addEventListener('focus',placeStandingWayne);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)placeStandingWayne();});
  setInterval(placeStandingWayne,1000);
  requestAnimationFrame(()=>requestAnimationFrame(placeStandingWayne));
})();

(() => {
  const FOCUS_KEY='assignmentHubTodayFocusV1', ACTIVE_DAY_KEY='assignmentHubFocusActiveDayV2', REAL_SESSION_DAY_KEY='assignmentHubFocusRealSessionDayV2';
  function dayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function freshState(date=dayKey()){return {date,goal:'',sessions:0,focusedMinutes:0,plannedIds:[],completedIds:[]};}
  function saveFreshDay(date=dayKey()){localStorage.setItem(FOCUS_KEY,JSON.stringify(freshState(date)));localStorage.setItem(ACTIVE_DAY_KEY,date);if(typeof renderTodayFocus==='function')renderTodayFocus();if(typeof updatePersonalGreeting==='function')updatePersonalGreeting();}
  function normalizeStartup(){const today=dayKey(),activeDay=localStorage.getItem(ACTIVE_DAY_KEY);let saved=null;try{saved=JSON.parse(localStorage.getItem(FOCUS_KEY)||'null');}catch(_){}if(activeDay&&activeDay!==today){saveFreshDay(today);return;}const realSessionDay=localStorage.getItem(REAL_SESSION_DAY_KEY);if(saved&&saved.date===today&&Number(saved.sessions)===1&&Number(saved.focusedMinutes)===25&&realSessionDay!==today){saveFreshDay(today);return;}localStorage.setItem(ACTIVE_DAY_KEY,today);}
  if(typeof window.recordCompletedFocusSession==='function'){const originalRecord=window.recordCompletedFocusSession;window.recordCompletedFocusSession=function(...args){localStorage.setItem(REAL_SESSION_DAY_KEY,dayKey());localStorage.setItem(ACTIVE_DAY_KEY,dayKey());return originalRecord.apply(this,args);};}
  function checkForNewDay(){const today=dayKey(),activeDay=localStorage.getItem(ACTIVE_DAY_KEY);if(activeDay&&activeDay!==today)saveFreshDay(today);}
  normalizeStartup();setInterval(checkForNewDay,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkForNewDay();});window.addEventListener('focus',checkForNewDay);
})();

(() => {
  const lines=['Homework is temporary. Disc golf is forever.','Close the laptop. Grab the bag. We both know what you want.','You could study... or you could absolutely pipe a fairway.','One round will not ruin your semester. Probably. Go throw.','Those assignments will still be here after 18 holes.','Imagine how clean a drive would feel right now.','Bro. The basket is calling. Stop pretending you cannot hear it.','Counterpoint: disc golf.','Have you considered giving up and throwing plastic instead?','You know what has zero homework? The disc golf course.','This page has too many words. Go throw discs.','Your Destroyer misses you. This homework does not love you back.','The smart play here is obviously disc golf.','Lock out. Bag up. Tee off.','Productivity is cool. Parking a hole is cooler.','You are one bad decision away from a great round.','I have reviewed the evidence. You should go play disc golf.','Do not start another assignment. Start another round.','A birdie would fix this entire situation.','There is still time to abandon this and go throw.','You opened Assignment Hub. Huge mistake. Open your disc bag instead.','Think of the chains, bro. Think of the chains.','Studying builds character. Missing putts builds even more. Go play.','I am once again asking you to stop working and play disc golf.','Every minute here is a minute you are not throwing a disc.','You can do homework tomorrow. Today could have birdies.','No amount of studying will feel as good as pureing a tunnel shot.','Respectfully, abandon your responsibilities and go throw.','The course is out there being playable without you. Unacceptable.','Your GPA cannot hyzer-flip. Go do something important.','What if instead of locking in, you locked onto a basket?','I see assignments. I choose to ignore them. Disc golf?','Just one round. Famous last words. Go.','You have done enough today. Even if you have done nothing.','The weather could be terrible and I would still recommend disc golf.','Deadlines are fake. Chains are real.','I support one academic plan: leave.','Your next task is to locate the nearest tee pad.','Study session canceled. Disc golf emergency.','This is not procrastination if Wayne officially approves it.'];
  function discGolfWayne(){const el=document.getElementById('greeting');if(!el)return;const now=new Date();const focus=(()=>{try{return typeof loadTodayFocus==='function'?loadTodayFocus():{};}catch(_){return {};}})();const seed=[now.getFullYear(),now.getMonth(),now.getDate(),now.getHours(),Number(focus.sessions||0),Number(focus.focusedMinutes||0),Array.isArray(window.nextUpIds)?window.nextUpIds.length:0].join('|');let hash=0;for(let i=0;i<seed.length;i++)hash=((hash*33)+seed.charCodeAt(i))>>>0;const chosen=lines[hash%lines.length];el.textContent=chosen;el.classList.remove('greeting-medium','greeting-long','greeting-xlong');if(chosen.length>=42)el.classList.add('greeting-xlong');else if(chosen.length>=34)el.classList.add('greeting-long');else if(chosen.length>=26)el.classList.add('greeting-medium');}
  window.updatePersonalGreeting=discGolfWayne;discGolfWayne();
})();

(()=>{const list=document.querySelector('.quick-links-list');if(!list||list.querySelector('a[href="https://www.gradescope.com/"]'))return;const link=document.createElement('a');link.href='https://www.gradescope.com/';link.target='_blank';link.rel='noopener';link.innerHTML='<b>GRADESCOPE</b><span>Website ↗</span>';list.appendChild(link);})();

(()=>{const style=document.createElement('style');style.textContent=`@keyframes timerFinishedPulse{0%,100%{transform:scale(1);box-shadow:var(--shadow)}50%{transform:scale(1.035);box-shadow:0 0 0 7px rgba(49,88,212,.16),0 18px 46px rgba(31,36,48,.18)}}.study-timer.is-finished{animation:timerFinishedPulse .85s ease-in-out infinite!important;border:3px solid var(--accent)!important}.study-timer.is-finished #studyTimerDisplay{font-size:3rem!important;color:var(--accent)!important}.study-timer.is-finished #studyTimerDisplay::after{content:'  TIME UP';display:block;margin-top:4px;font-size:.82rem;font-weight:900;letter-spacing:.12em}`;document.head.appendChild(style);const display=document.getElementById('studyTimerDisplay'),card=display?.closest('.study-timer');if(!display||!card)return;let announced=false;const sync=()=>{const finished=card.classList.contains('is-finished')&&display.textContent.trim()==='0:00';if(finished&&!announced){announced=true;try{if('vibrate'in navigator)navigator.vibrate([250,120,250,120,450]);}catch(_){}document.title='⏰ TIME UP — Assignment Hub';}else if(!finished&&announced){announced=false;document.title='Assignment Hub';}};new MutationObserver(sync).observe(card,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});sync();})();



(()=>{const list=document.querySelector('.quick-links-list');if(!list)return;const links=[...list.querySelectorAll('a')],order=['MATH 213','MATH 215','MATH 290','ECON 110','GRADESCOPE'];order.forEach(label=>{const link=links.find(a=>a.querySelector('b')?.textContent.trim().toUpperCase()===label);if(link)list.appendChild(link);});})();

(()=>{const minutesEl=document.getElementById('focusMinutes');if(!minutesEl)return;const labelEl=minutesEl.nextElementSibling;function formatFocusTime(){const raw=Number(minutesEl.textContent.trim());if(!Number.isFinite(raw))return;const total=Math.max(0,Math.round(raw)),hours=Math.floor(total/60),minutes=total%60;minutesEl.textContent=hours?`${hours}h${minutes?` ${minutes}m`:''}`:`${minutes}m`;if(labelEl)labelEl.textContent='focused';}const observer=new MutationObserver(()=>{if(/^\d+$/.test(minutesEl.textContent.trim()))formatFocusTime();});observer.observe(minutesEl,{childList:true,characterData:true,subtree:true});formatFocusTime();})();
