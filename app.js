let assignments = [];
let assignmentsLoaded = false;
const COMPLETED_KEY = 'assignmentHubManualCompleted';
const HIDDEN_KEY = 'assignmentHubHidden';
const MANUAL_KEY = 'assignmentHubManualAssignments';
const THEME_KEY = 'assignmentHubTheme';
const NEXT_UP_KEY = 'assignmentHubNextUp';
const NEXT_UP_ESTIMATES_KEY = 'assignmentHubNextUpEstimates';
let completed = new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]'));
let hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
let manualAssignments = JSON.parse(localStorage.getItem(MANUAL_KEY) || '[]');
let nextUpIds = JSON.parse(localStorage.getItem(NEXT_UP_KEY) || '[]');
let nextUpEstimates = JSON.parse(localStorage.getItem(NEXT_UP_ESTIMATES_KEY) || '{}');
let now = new Date();
let showLater = false;
let activeCourse = 'ALL';
let toastTimer = null;
let lastUndo = null;
let calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
let calendarSelectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let calendarShowReadings = true;
let editingManualId = null;

const COURSE_COLORS = [
  { match: /NDFS\s*100/i, color: '#43a85b' },
  { match: /MATH\s*290/i, color: '#a451d7' },
  { match: /MATH\s*215/i, color: '#a78662' },
  { match: /MATH\s*213/i, color: '#367ed8' },
  { match: /ECON\s*110/i, color: '#e64e4e' },
];
const fallbackPalette = ['#3d63dd','#ad4cce','#cf7d24','#218a62','#c94b69','#2379a9','#8a6d1d','#7b5bc7'];

function colorFor(value) {
  const text = String(value || 'course');
  const custom = COURSE_COLORS.find(x => x.match.test(text));
  if (custom) return custom.color;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return fallbackPalette[Math.abs(hash) % fallbackPalette.length];
}

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isComplete(a) { return a.submitted || completed.has(a.id); }
function isReading(a) { return a.kind === 'reading'; }
function isAssignment(a) { return !isReading(a); }
function isHidden(a) { return hidden.has(a.id); }
function visibleItem(a) { return !isComplete(a) && !isHidden(a); }

function groupFor(date) {
  if (date < startOfDay(now)) return 'Overdue';
  if (sameDay(date, now)) return 'Today';
  if (sameDay(date, addDays(now, 1))) return 'Tomorrow';
  if (date <= addDays(startOfDay(now), 7)) return 'This Week';
  return 'Later';
}

function formatTime(date) { return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function formatDate(date) { return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
function saveSet(key, value) { localStorage.setItem(key, JSON.stringify([...value])); }
function saveManual() { localStorage.setItem(MANUAL_KEY, JSON.stringify(manualAssignments)); }
function saveNextUp() { localStorage.setItem(NEXT_UP_KEY, JSON.stringify(nextUpIds)); }
function saveNextUpEstimates() { localStorage.setItem(NEXT_UP_ESTIMATES_KEY, JSON.stringify(nextUpEstimates)); }

const NEXT_UP_TIME_OPTIONS = [15, 30, 45, 60, 90, 120];
function normalizeEstimate(value) {
  const minutes = Number(value);
  return NEXT_UP_TIME_OPTIONS.includes(minutes) ? minutes : null;
}
function estimateLabel(minutes) {
  const m = normalizeEstimate(minutes);
  if (m === 15) return '15m';
  if (m === 30) return '30m';
  if (m === 45) return '45m';
  if (m === 60) return '1h';
  if (m === 90) return '1.5h';
  if (m === 120) return '2h+';
  return 'Set time';
}
function formatEstimatedTotal(minutes, hasPlus = false) {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const text = hours && mins ? `${hours}h ${mins}m` : hours ? `${hours}h` : `${mins}m`;
  return `~${text}${hasPlus ? '+' : ''}`;
}

function urgencyText(date) {
  const diff = date - now;
  if (diff < 0) {
    const hrs = Math.max(1, Math.round(Math.abs(diff) / 36e5));
    return hrs < 24 ? `${hrs}h overdue` : `${Math.round(hrs / 24)}d overdue`;
  }
  const hrs = diff / 36e5;
  if (hrs < 1) return 'due in under 1h';
  if (hrs < 24) return `due in ${Math.round(hrs)}h`;
  return `due in ${Math.ceil(hrs / 24)}d`;
}

function normalizeManual(a) { return { ...a, color: colorFor(a.course), source: 'Manual', kind: 'assignment', submitted: false, manual: true }; }
function mergedAssignments(remote) {
  const remoteIds = new Set(remote.map(a => a.id));
  const manual = manualAssignments.filter(a => !remoteIds.has(a.id)).map(normalizeManual);
  return [...remote, ...manual].sort((a,b) => new Date(a.due) - new Date(b.due));
}

async function loadAssignments() {
  const status = document.getElementById('syncStatus');
  const syncButton = document.getElementById('syncButton');
  syncButton.disabled = true;
  syncButton.textContent = '↻ Syncing…';
  status.textContent = 'Connecting to BYU Canvas…';
  try {
    const response = await fetch('/api/assignments', { cache: 'no-store' });
    const data = await response.json();
    if (response.status === 401 && data.authRequired) { showLogin(); throw new Error('Assignment Hub is locked.'); }
    if (!response.ok) throw new Error(data.error || 'Canvas sync failed.');
    const remote = (data.assignments || []).map(a => ({ ...a, color: colorFor(a.course || a.courseId) }));
    assignments = mergedAssignments(remote);
    assignmentsLoaded = true;
    now = new Date();
    render();
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const warnings = [];
    if (data.courseErrors?.length) warnings.push(`${data.courseErrors.length} Canvas warning${data.courseErrors.length === 1 ? '' : 's'}`);
    if (data.learningSuiteError) warnings.push('Learning Suite warning');
    status.textContent = `Synced ${time}${warnings.length ? ` · ${warnings.join(' · ')}` : ''}`;
  } catch (error) {
    assignments = manualAssignments.map(normalizeManual);
    assignmentsLoaded = true;
    render();
    status.textContent = error.message;
    document.getElementById('summaryText').textContent = 'Live sync needs attention';
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = '↻ Sync';
  }
}


// Personal dynamic greeting. Read-only: it never mutates assignment/study state.
let personalGreetingSignature = '';

function greetingPick(options, seed) {
  let hash = 0;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
  }
  return options[hash % options.length];
}

function updatePersonalGreeting() {
  const el = document.getElementById('greeting');
  if (!el) return;

  const current = new Date();
  const hour = current.getHours();

  const remaining = assignments.filter(a => isAssignment(a) && visibleItem(a));
  const overdueCount = remaining.filter(a => new Date(a.due) < startOfDay(current)).length;
  const todayCount = remaining.filter(a => sameDay(new Date(a.due), current)).length;
  const weekCount = remaining.filter(a => {
    const due = new Date(a.due);
    return due >= startOfDay(current) && due <= addDays(startOfDay(current), 7);
  }).length;

  let sessions = 0;
  let focusedMinutes = 0;
  try {
    const focus = loadTodayFocus();
    sessions = Number(focus.sessions || 0);
    focusedMinutes = Number(focus.focusedMinutes || 0);
  } catch (_) {}

  const queuedCount = Array.isArray(nextUpIds) ? nextUpIds.length : 0;
  const timerButton = document.getElementById('studyTimerStart');
  const timerRunning = !!timerButton && (timerButton.textContent === 'Pause' || timerButton.textContent === 'Resume');

  const signature = [
    hour,
    overdueCount,
    todayCount,
    weekCount,
    queuedCount,
    sessions,
    focusedMinutes,
    timerRunning ? 1 : 0
  ].join('|');

  if (signature === personalGreetingSignature) return;
  personalGreetingSignature = signature;

  const lockIn = [];
  const bail = [];

  // Wayne has two personalities: gym-bro lock-in coach, or terrible influence.
  if (overdueCount > 0) {
    lockIn.push(
      `Bro, ${overdueCount} overdue. Lock in.`,
      `Nahhh, overdue work? Get in the lab.`,
      `Red numbers? Absolutely not. Lock in.`
    );
  }

  if (todayCount > 0) {
    lockIn.push(
      `${todayCount} due today. Bro, lock all the way in.`,
      `Today's got hands. Lock in.`,
      `Queue it up and get active, my guy.`
    );
  }

  if (queuedCount >= 4) {
    lockIn.push(
      `That Next Up is stacked. Time to lock.`,
      `You made the queue. Now stand on business.`,
      `Bro built a whole quest log. Go clear it.`
    );
  }

  if (timerRunning) {
    lockIn.push(
      `Timer's running. Eyes front, bro.`,
      `Nah, don't touch another tab. Lock in.`,
      `You're on the clock. Get after it.`
    );
  }

  if (sessions < 3) {
    lockIn.push(
      `Campfire's hungry. Feed it 25.`,
      `One clean focus block. Lock in.`,
      `Bro, 25 minutes. That's light work.`,
      `Get in there and cook.`
    );
  } else {
    lockIn.push(
      `You're already cooking. Run another one.`,
      `Momentum is crazy right now. Stay locked.`,
      `Do not fumble the streak, bro.`
    );
  }

  if (sessions >= 2 || focusedMinutes >= 50) {
    bail.push(
      `${focusedMinutes} minutes? Bro, go see your wife.`,
      `You did enough. Go hang with Brinley.`,
      `Close the laptop. Brinley clears homework.`,
      `Respectfully, go bother your wife.`
    );
  }

  if (sessions >= 3 || focusedMinutes >= 75) {
    bail.push(
      `Bro, the discs are literally calling you.`,
      `You've studied enough. Go throw plastic.`,
      `Pack it up. Disc golf exists.`,
      `This is your sign to go play disc golf.`
    );
  }

  if (sessions >= 6 || focusedMinutes >= 150) {
    bail.push(
      `${focusedMinutes} focused minutes? Dude. Go home.`,
      `${sessions} sessions? Brinley wants her husband back.`,
      `Bro, you're done. Go touch grass. Preferably a fairway.`,
      `The books lost. Go play disc golf.`
    );
  }

  if (hour >= 21) {
    bail.push(
      `It's late, bro. Go hang out with your wife.`,
      `Lock OUT. Brinley time.`,
      `Homework will be here tomorrow. Your evening won't.`,
      `Bro, close this website. I'm serious.`
    );
  }

  if (overdueCount === 0 && todayCount === 0) {
    bail.push(
      `Nothing due today? Get outta here. Go play disc golf.`,
      `You're free, bro. Go hang with Brinley.`,
      `No emergency. Shut it down and go live.`,
      `Bro, why are you still here? Go throw.`
    );
  }

  const daySeed = current.getFullYear() + '-' + (current.getMonth() + 1) + '-' + current.getDate();
  const modeSeed = daySeed + '|' + signature;
  let modeHash = 0;
  for (let i = 0; i < modeSeed.length; i++) modeHash = ((modeHash * 33) + modeSeed.charCodeAt(i)) >>> 0;

  // The more you've studied, the more likely Wayne is to tell you to bail.
  const bailChance = Math.min(82, 15 + sessions * 9 + (hour >= 20 ? 15 : 0));
  const useBail = bail.length && (modeHash % 100) < bailChance;
  const options = useBail ? bail : lockIn;

  const chosen = greetingPick(options, daySeed + '|' + signature);
  el.textContent = chosen;

  // Keep personalized greetings on one line by shrinking only when needed.
  el.classList.remove('greeting-medium', 'greeting-long', 'greeting-xlong');
  if (chosen.length >= 42) el.classList.add('greeting-xlong');
  else if (chosen.length >= 34) el.classList.add('greeting-long');
  else if (chosen.length >= 26) el.classList.add('greeting-medium');
}

function render() {
  const remaining = assignments.filter(a => isAssignment(a) && visibleItem(a));
  const overdue = remaining.filter(a => new Date(a.due) < startOfDay(now));
  const today = remaining.filter(a => sameDay(new Date(a.due), now));
  const week = remaining.filter(a => {
    const due = new Date(a.due);
    return due >= startOfDay(now) && due <= addDays(startOfDay(now), 7);
  });

  document.getElementById('overdueCount').textContent = overdue.length;
  document.getElementById('todayCount').textContent = today.length;
  document.getElementById('weekCount').textContent = week.length;
  document.getElementById('remainingCount').textContent = remaining.length;

  const urgentBits = [];
  if (overdue.length) urgentBits.push(`${overdue.length} overdue`);
  if (today.length) urgentBits.push(`${today.length} due today`);
  urgentBits.push(`${week.length} in the next 7 days`);
  document.getElementById('summaryText').textContent = urgentBits.join(' · ');

  updatePersonalGreeting();
  renderCourseFilters();
  renderAssignments();
  renderNextUp();
  renderTodayFocus();
  renderReadings();
  renderCourses();
  renderCalendar();
  renderHidden();
  renderCompleted();
  populateManualCourses();
}

function filteredAssignments() { return assignments.filter(a => isAssignment(a) && (activeCourse === 'ALL' || a.course === activeCourse)); }
function filteredReadings() { return assignments.filter(a => isReading(a) && (activeCourse === 'ALL' || a.course === activeCourse)); }

function renderCourseFilters() {
  const container = document.getElementById('courseFilters');
  const courses = [...new Set(assignments.map(a => a.course))].sort();
  if (!courses.length) { container.innerHTML = ''; return; }
  container.innerHTML = '';
  const all = document.createElement('button');
  all.className = `filter-chip ${activeCourse === 'ALL' ? 'active' : ''}`;
  all.textContent = 'All classes';
  all.onclick = () => { activeCourse = 'ALL'; renderCourseFilters(); renderAssignments(); renderReadings(); renderCalendar(); };
  container.appendChild(all);
  courses.forEach(course => {
    const btn = document.createElement('button');
    btn.className = `filter-chip ${activeCourse === course ? 'active' : ''}`;
    btn.style.setProperty('--course-color', colorFor(course));
    btn.innerHTML = `<span class="filter-dot"></span>${escapeHtml(shortCourse(course))}`;
    btn.onclick = () => { activeCourse = course; renderCourseFilters(); renderAssignments(); renderReadings(); renderCalendar(); };
    container.appendChild(btn);
  });
}

function shortCourse(course) {
  const m = String(course).match(/([A-Z]{2,}\s*\d{3})/i);
  return m ? m[1].toUpperCase().replace(/\s+/, ' ') : course;
}

function completeLocally(a) {
  if (a.submitted) return;
  if (nextUpIds.includes(a.id)) recordFocusCompletedTask(a.id);
  const wasDueToday = isAssignment(a) && sameDay(new Date(a.due), now);
  completed.add(a.id);
  saveSet(COMPLETED_KEY, completed);
  removeFromNextUp(a.id, false);
  lastUndo = () => { completed.delete(a.id); saveSet(COMPLETED_KEY, completed); render(); };
  const stillDueToday = assignments.some(x => isAssignment(x) && visibleItem(x) && sameDay(new Date(x.due), now));
  showToast(wasDueToday && !stillDueToday ? 'All done for today' : 'Marked complete', true);
  render();
}

function hideLocally(a) {
  hidden.add(a.id);
  saveSet(HIDDEN_KEY, hidden);
  removeFromNextUp(a.id, false);
  lastUndo = () => { hidden.delete(a.id); saveSet(HIDDEN_KEY, hidden); render(); };
  showToast('Hidden from dashboard', true);
  render();
}

function bindCardActions(node, a) {
  const check = node.querySelector('.check-button');
  check.title = a.submitted ? 'Completed in Canvas' : 'Mark complete locally';
  if (a.submitted) check.classList.add('synced-complete');
  check.addEventListener('click', () => completeLocally(a));

  const menuButton = node.querySelector('.card-menu-button');
  const menu = node.querySelector('.card-menu');
  menuButton.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.card-menu').forEach(m => { if (m !== menu) m.hidden = true; });
    menu.hidden = !menu.hidden;
  });
  const quickNextUpButton = node.querySelector('.next-up-quick-button');
  const isQueued = nextUpIds.includes(a.id);
  quickNextUpButton.textContent = isQueued ? '✓' : '+';
  quickNextUpButton.classList.toggle('is-queued', isQueued);
  quickNextUpButton.setAttribute('aria-label', isQueued ? 'Remove from Next Up' : 'Add to Next Up');
  quickNextUpButton.title = isQueued ? 'Remove from Next Up' : 'Add to Next Up';
  quickNextUpButton.addEventListener('click', e => {
    e.stopPropagation();
    if (nextUpIds.includes(a.id)) removeFromNextUp(a.id, true);
    else addToNextUp(a);
  });
  menu.querySelector('[data-action="hide"]').addEventListener('click', () => hideLocally(a));
  const editButton = menu.querySelector('[data-action="edit"]');
  const deleteButton = menu.querySelector('[data-action="delete"]');
  if (a.manual) {
    editButton.hidden = false; deleteButton.hidden = false;
    editButton.addEventListener('click', () => openEditDialog(a));
    deleteButton.addEventListener('click', () => deleteManualAssignment(a));
  }
  const main = node.querySelector('.assignment-main');
  const title = node.querySelector('.assignment-title');
  title.addEventListener('click', e => { e.preventDefault(); openDetailDialog(a); });
  main.addEventListener('click', e => { if (!e.target.closest('button')) openDetailDialog(a); });
}

function addToNextUp(a) {
  if (nextUpIds.includes(a.id)) return;
  recordFocusPlannedTask(a.id);
  nextUpIds.push(a.id);
  saveNextUp();
  renderAssignments();
  renderNextUp();
  renderTodayFocus();
  updatePersonalGreeting();
  showToast('Added to Next Up', false);
}

function removeFromNextUp(id, announce = true) {
  const before = nextUpIds.length;
  nextUpIds = nextUpIds.filter(itemId => itemId !== id);
  if (nextUpIds.length === before) return;
  saveNextUp();
  renderNextUp();
  renderTodayFocus();
  updatePersonalGreeting();
  if (announce) {
    renderAssignments();
    showToast('Removed from Next Up', false);
  }
}

function moveNextUp(id, direction) {
  const index = nextUpIds.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= nextUpIds.length) return;
  [nextUpIds[index], nextUpIds[target]] = [nextUpIds[target], nextUpIds[index]];
  saveNextUp();
  renderNextUp();
  renderTodayFocus();
}

function saveNextUpOrderFromDom(container) {
  nextUpIds = [...container.querySelectorAll('.next-up-item')].map(row => row.dataset.nextUpId).filter(Boolean);
  saveNextUp();
  renderTodayFocus();
}

function bindNextUpDrag(row, handle, container) {
  let pointerId = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let holdTimer = null;

  const beginDrag = () => {
    if (dragging || pointerId === null) return;
    dragging = true;
    row.classList.add('is-dragging');
    document.body.classList.add('next-up-dragging');
    handle.setAttribute('aria-grabbed', 'true');
  };

  const reorderAt = clientY => {
    const siblings = [...container.querySelectorAll('.next-up-item:not(.is-dragging)')];
    const before = siblings.find(item => {
      const rect = item.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    if (before) {
      if (before.previousElementSibling !== row) container.insertBefore(row, before);
    } else if (container.lastElementChild !== row) {
      container.appendChild(row);
    }
  };

  const finishDrag = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    if (dragging) {
      dragging = false;
      row.classList.remove('is-dragging');
      document.body.classList.remove('next-up-dragging');
      handle.setAttribute('aria-grabbed', 'false');
      saveNextUpOrderFromDom(container);
      renderNextUp();
    }
    if (pointerId !== null && handle.hasPointerCapture?.(pointerId)) {
      try { handle.releasePointerCapture(pointerId); } catch (_) {}
    }
    pointerId = null;
  };

  handle.setAttribute('aria-grabbed', 'false');

  handle.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    handle.setPointerCapture?.(pointerId);
    // A short hold makes touch dragging intentional; mouse dragging starts as soon as it moves.
    holdTimer = setTimeout(beginDrag, e.pointerType === 'touch' ? 140 : 80);
  });

  handle.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId) return;
    const distance = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!dragging && distance >= (e.pointerType === 'touch' ? 7 : 3)) beginDrag();
    if (!dragging) return;
    e.preventDefault();
    reorderAt(e.clientY);
  });

  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  handle.addEventListener('lostpointercapture', () => {
    if (pointerId !== null) finishDrag();
  });

  handle.addEventListener('keydown', e => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    moveNextUp(row.dataset.nextUpId, e.key === 'ArrowUp' ? -1 : 1);
    requestAnimationFrame(() => {
      const updated = [...container.querySelectorAll('.next-up-item')].find(item => item.dataset.nextUpId === row.dataset.nextUpId);
      updated?.querySelector('.next-up-drag')?.focus();
    });
  });
}

function setNextUpEstimate(id, value) {
  const minutes = normalizeEstimate(value);
  if (minutes == null) delete nextUpEstimates[id];
  else nextUpEstimates[id] = minutes;
  saveNextUpEstimates();
  renderNextUp();
}

function renderNextUp() {
  const container = document.getElementById('nextUpList');
  const count = document.getElementById('nextUpCount');
  const summary = document.getElementById('nextUpSummary');
  if (!container || !count) return;

  const assignmentMap = new Map(assignments.map(a => [a.id, a]));

  // Do not validate/prune persisted Next Up IDs until Canvas/manual assignments
  // have actually loaded. The app renders once before the async sync finishes;
  // pruning during that render would erase the saved queue on every reload.
  if (assignmentsLoaded) {
    const validIds = nextUpIds.filter(id => {
      const a = assignmentMap.get(id);
      return a && isAssignment(a) && visibleItem(a);
    });
    if (validIds.length !== nextUpIds.length) {
      nextUpIds = validIds;
      saveNextUp();
    }
  }

  count.textContent = nextUpIds.length;
  container.innerHTML = '';

  const estimates = nextUpIds.map(id => normalizeEstimate(nextUpEstimates[id])).filter(Boolean);
  const totalMinutes = estimates.reduce((sum, minutes) => sum + minutes, 0);
  const hasPlus = nextUpIds.some(id => normalizeEstimate(nextUpEstimates[id]) === 120);
  const unestimated = nextUpIds.length - estimates.length;
  if (summary) {
    if (!nextUpIds.length) summary.textContent = 'Build your own short homework queue.';
    else if (!estimates.length) summary.textContent = `${nextUpIds.length} assignment${nextUpIds.length === 1 ? '' : 's'} · add time estimates below`;
    else {
      const total = formatEstimatedTotal(totalMinutes, hasPlus);
      summary.textContent = `${nextUpIds.length} assignment${nextUpIds.length === 1 ? '' : 's'} · ${total}${unestimated ? ` + ${unestimated} without time` : ''}`;
    }
  }

  if (!assignmentsLoaded && nextUpIds.length) {
    container.innerHTML = '<div class="next-up-empty"><strong>Restoring Next Up…</strong><span>Your saved queue will appear as soon as assignments finish syncing.</span></div>';
    return;
  }

  if (!assignmentsLoaded && nextUpIds.length) {
    container.innerHTML = '<div class="next-up-empty"><strong>Restoring Next Up…</strong><span>Your saved queue will appear as soon as assignments finish syncing.</span></div>';
    return;
  }

  if (!nextUpIds.length) {
    container.innerHTML = '<div class="next-up-empty"><strong>Nothing queued yet.</strong><span>Use the + button on any assignment to add it here.</span></div>';
    return;
  }

  nextUpIds.forEach(id => {
    const a = assignmentMap.get(id);
    if (!a) return;
    const due = new Date(a.due);
    const estimate = normalizeEstimate(nextUpEstimates[id]);
    const row = document.createElement('article');
    row.className = 'next-up-item';
    row.dataset.nextUpId = id;
    row.style.setProperty('--course-color', a.color);
    row.innerHTML = `
      <button class="next-up-drag" type="button" aria-label="Drag to reorder. Keyboard: Alt plus Up or Down." title="Hold and drag to reorder">⋮⋮</button>
      <div class="next-up-main">
        <div class="next-up-topline"><span class="course-pill">${escapeHtml(shortCourse(a.course))}</span><span>${escapeHtml(a.allDay ? formatDate(due) : `${formatDate(due)} · ${formatTime(due)}`)}</span></div>
        <button class="next-up-title" type="button">${escapeHtml(a.title)}</button>
        <label class="next-up-estimate-wrap"><span>Estimate</span><select class="next-up-estimate" aria-label="Estimated time for ${escapeHtml(a.title)}">
          <option value="">Set time</option>
          <option value="15">15m</option>
          <option value="30">30m</option>
          <option value="45">45m</option>
          <option value="60">1h</option>
          <option value="90">1.5h</option>
          <option value="120">2h+</option>
        </select></label>
      </div>
      <div class="next-up-actions">
        <button type="button" data-complete aria-label="Mark complete" title="Mark complete">✓</button>
        <button type="button" data-remove aria-label="Remove from Next Up" title="Remove from Next Up">×</button>
      </div>`;
    const select = row.querySelector('.next-up-estimate');
    select.value = estimate ? String(estimate) : '';
    select.classList.toggle('has-estimate', Boolean(estimate));
    row.querySelector('.next-up-title').addEventListener('click', () => openDetailDialog(a));
    row.querySelector('[data-complete]').addEventListener('click', () => completeLocally(a));
    row.querySelector('[data-remove]').addEventListener('click', () => removeFromNextUp(id, true));
    select.addEventListener('change', e => setNextUpEstimate(id, e.target.value));
    bindNextUpDrag(row, row.querySelector('.next-up-drag'), container);
    container.appendChild(row);
  });
}

function renderAssignments() {
  const container = document.getElementById('assignmentSections');
  container.innerHTML = '';
  const groups = ['Overdue', 'Today', 'Tomorrow', 'This Week'];
  const source = filteredAssignments();

  groups.forEach(group => {
    const groupAssignments = source.filter(visibleItem).filter(a => groupFor(new Date(a.due)) === group).sort((a,b) => new Date(a.due) - new Date(b.due));
    if (!groupAssignments.length) return;
    const section = document.createElement('section');
    section.className = `section section-${group.toLowerCase().replace(' ', '-')}`;
    section.innerHTML = `<div class="section-header"><h2 class="section-title">${group.toUpperCase()}</h2><span class="section-count">${groupAssignments.length}</span></div>`;
    const list = document.createElement('div');
    list.className = 'assignment-list';

    groupAssignments.forEach(a => {
      const node = document.getElementById('assignmentTemplate').content.cloneNode(true);
      const card = node.querySelector('.assignment-card');
      card.style.setProperty('--course-color', a.color);
      if (group === 'Overdue') card.classList.add('is-overdue');
      if (group === 'Today') card.classList.add('is-today');
      node.querySelector('.course-pill').textContent = shortCourse(a.course);
      const due = new Date(a.due);
      const dueLabel = a.allDay ? formatDate(due) : (['Overdue','Today','Tomorrow'].includes(group) ? `${formatDate(due)} · ${formatTime(due)}` : formatDate(due));
      node.querySelector('.due-time').textContent = a.allDay ? dueLabel : `${dueLabel} · ${urgencyText(due)}`;
      const title = node.querySelector('.assignment-title');
      title.textContent = a.title;
      if (a.url) title.href = a.url; else { title.removeAttribute('href'); title.classList.add('no-link'); }
      const points = a.points == null ? (a.source === 'Learning Suite' ? 'Live schedule feed' : a.source === 'Manual' ? 'Added manually' : 'Points not listed') : `${a.points} point${a.points === 1 ? '' : 's'}`;
      const notes = a.notes ? ` · ${a.notes}` : '';
      node.querySelector('.assignment-meta').textContent = `${points} · ${a.source || 'Canvas'}${notes}`;
      bindCardActions(node, a);
      list.appendChild(node);
    });
    section.appendChild(list);
    container.appendChild(section);
  });

  if (showLater) {
    const laterItems = source.filter(visibleItem).filter(a => groupFor(new Date(a.due)) === 'Later').sort((a,b) => new Date(a.due) - new Date(b.due));
    const months = new Map();
    laterItems.forEach(a => { const d=new Date(a.due), key=d.toLocaleDateString([],{month:'long',year:'numeric'}); if(!months.has(key)) months.set(key,[]); months.get(key).push(a); });
    months.forEach((items, month) => {
      const section=document.createElement('section'); section.className='section section-later';
      section.innerHTML=`<div class="section-header"><h2 class="section-title">${escapeHtml(month.toUpperCase())}</h2><span class="section-count">${items.length}</span></div>`;
      const list=document.createElement('div'); list.className='assignment-list';
      items.forEach(a=>{ const node=document.getElementById('assignmentTemplate').content.cloneNode(true); const card=node.querySelector('.assignment-card'); card.style.setProperty('--course-color',a.color); node.querySelector('.course-pill').textContent=shortCourse(a.course); const due=new Date(a.due); node.querySelector('.due-time').textContent=a.allDay?formatDate(due):`${formatDate(due)} · ${formatTime(due)}`; const title=node.querySelector('.assignment-title'); title.textContent=a.title; if(a.url)title.href=a.url; else{title.removeAttribute('href');title.classList.add('no-link')} const points=a.points==null?(a.source==='Learning Suite'?'Live schedule feed':a.source==='Manual'?'Added manually':'Points not listed'):`${a.points} point${a.points===1?'':'s'}`; node.querySelector('.assignment-meta').textContent=`${points} · ${a.source||'Canvas'}${a.notes?` · ${a.notes}`:''}`; bindCardActions(node,a); list.appendChild(node); });
      section.appendChild(list); container.appendChild(section);
    });
  }

  if (!container.children.length) {
    const suffix = activeCourse === 'ALL' ? '' : ` for ${shortCourse(activeCourse)}`;
    container.innerHTML = `<section class="empty-state"><strong>You're clear${suffix}.</strong><span>No incomplete assignments in the upcoming 7-day view.</span></section>`;
  }
}

function renderReadings() {
  const container = document.getElementById('readingSection');
  container.innerHTML = '';
  const visible = filteredReadings().filter(visibleItem).filter(a => showLater || new Date(a.due) <= addDays(startOfDay(now), 7)).sort((a,b) => new Date(a.due) - new Date(b.due));
  if (!visible.length) {
    container.innerHTML = `<section class="empty-state"><strong>No readings in view.</strong><span>Use Show later to include future ECON readings.</span></section>`;
    return;
  }
  const section = document.createElement('section');
  section.className = 'section reading-section standalone-reading';
  section.innerHTML = `<div class="section-header"><div><h2 class="section-title reading-title">ECON 110 READINGS</h2><p class="section-subtitle">Reading schedule · separate from graded assignments</p></div><span class="section-count">${visible.length}</span></div>`;
  const list = document.createElement('div');
  list.className = 'assignment-list reading-list';
  visible.forEach(a => {
    const node = document.getElementById('assignmentTemplate').content.cloneNode(true);
    const card = node.querySelector('.assignment-card');
    card.classList.add('reading-card');
    card.style.setProperty('--course-color', a.color);
    const due = new Date(a.due);
    if (due < startOfDay(now)) card.classList.add('is-overdue');
    node.querySelector('.course-pill').textContent = 'ECON 110 · READING';
    node.querySelector('.due-time').textContent = formatDate(due);
    const title = node.querySelector('.assignment-title');
    title.textContent = a.title;
    title.href = a.url;
    node.querySelector('.assignment-meta').textContent = 'Learning Suite reading schedule';
    bindCardActions(node, a);
    list.appendChild(node);
  });
  section.appendChild(list);
  container.appendChild(section);
}

function renderCourses() {
  const container = document.getElementById('courseGrid');
  container.innerHTML = '';
  const courseMap = new Map();
  assignments.forEach(a => {
    if (!courseMap.has(a.course)) courseMap.set(a.course, { color: a.color, remaining: 0, nextDue: null, week: 0, readingWeek: 0 });
    const c = courseMap.get(a.course); const due = new Date(a.due);
    if (isReading(a)) { if (visibleItem(a) && due >= startOfDay(now) && due <= addDays(startOfDay(now), 7)) c.readingWeek++; return; }
    if (visibleItem(a)) { c.remaining++; if (!c.nextDue || due < c.nextDue) c.nextDue = due; if (due >= startOfDay(now) && due <= addDays(startOfDay(now), 7)) c.week++; }
  });
  [...courseMap.entries()].sort((a,b) => (a[1].nextDue || Infinity) - (b[1].nextDue || Infinity)).forEach(([course, stats]) => {
    const card = document.createElement('article');
    card.className = 'course-card'; card.style.setProperty('--course-color', stats.color);
    const nextAssignment = assignments.find(a => !isReading(a) && a.course === course && visibleItem(a) && new Date(a.due).getTime() === stats.nextDue?.getTime());
    const next = stats.nextDue ? (nextAssignment?.allDay ? formatDate(stats.nextDue) : `${formatDate(stats.nextDue)} · ${formatTime(stats.nextDue)}`) : 'Nothing remaining';
    const readingNote = stats.readingWeek ? ` · ${stats.readingWeek} reading${stats.readingWeek === 1 ? '' : 's'} this week` : '';
    card.innerHTML = `<div class="course-accent"></div><div class="course-name">${escapeHtml(shortCourse(course))}</div><div class="course-stats"><strong>${stats.week}</strong> due this week · ${stats.remaining} remaining${readingNote}</div><div class="course-next">Next: ${next}</div>`;
    card.onclick = () => { activeCourse = course; switchView('list'); renderCourseFilters(); renderAssignments(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    container.appendChild(card);
  });
}


function calendarItemsForDay(date) {
  return assignments.filter(a => !isHidden(a) && (activeCourse === 'ALL' || a.course === activeCourse) && (!isReading(a) || calendarShowReadings) && sameDay(new Date(a.due), date)).sort((a,b)=>new Date(a.due)-new Date(b.due));
}
function renderCalendar() {
  const grid=document.getElementById('calendarGrid'), label=document.getElementById('calendarMonthLabel');
  if(!grid||!label)return;
  const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth(), first=new Date(y,m,1), days=new Date(y,m+1,0).getDate(), prev=new Date(y,m,0).getDate();
  label.textContent=calendarCursor.toLocaleDateString([],{month:'long',year:'numeric'}); grid.innerHTML='';
  for(let i=0;i<42;i++){
    const off=i-first.getDay()+1; let d,outside=false;
    if(off<1){d=new Date(y,m-1,prev+off);outside=true}else if(off>days){d=new Date(y,m+1,off-days);outside=true}else d=new Date(y,m,off);
    const items=calendarItemsForDay(d), b=document.createElement('button'); b.type='button'; b.className='calendar-day';
    if(outside)b.classList.add('outside-month'); if(sameDay(d,now))b.classList.add('is-calendar-today'); if(sameDay(d,calendarSelectedDate))b.classList.add('selected');
    b.innerHTML=`<span class="calendar-day-number">${d.getDate()}</span>`;
    if(items.length){const dots=document.createElement('span');dots.className='calendar-dots';[...new Set(items.map(a=>a.color||colorFor(a.course)))].slice(0,4).forEach(c=>{const x=document.createElement('i');x.style.background=c;dots.appendChild(x)});b.appendChild(dots)}
    b.onclick=()=>{calendarSelectedDate=startOfDay(d);if(d.getMonth()!==m)calendarCursor=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar()}; grid.appendChild(b);
  } renderCalendarDay();
}
function renderCalendarDay(){
  const c=document.getElementById('calendarDaySection');if(!c)return;const items=calendarItemsForDay(calendarSelectedDate), heading=calendarSelectedDate.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
  c.innerHTML=`<div class="section-header"><h2 class="section-title">${escapeHtml(heading.toUpperCase())}</h2><span class="section-count">${items.length}</span></div>`;
  if(!items.length){c.innerHTML+=`<section class="empty-state"><strong>Nothing due.</strong><span>No assignments or readings on this day.</span></section>`;return}
  const list=document.createElement('div');list.className='assignment-list';
  items.forEach(a=>{const node=document.getElementById('assignmentTemplate').content.cloneNode(true),card=node.querySelector('.assignment-card');card.style.setProperty('--course-color',a.color||colorFor(a.course));if(isReading(a))card.classList.add('reading-card');if(isComplete(a))card.classList.add('is-completed');
    node.querySelector('.course-pill').textContent=isReading(a)?`${shortCourse(a.course)} · READING`:shortCourse(a.course);const due=new Date(a.due);node.querySelector('.due-time').textContent=a.allDay?'Date only':formatTime(due);
    const title=node.querySelector('.assignment-title');title.textContent=a.title;if(a.url)title.href=a.url;else{title.removeAttribute('href');title.classList.add('no-link')}
    node.querySelector('.assignment-meta').textContent=isReading(a)?'Learning Suite reading schedule':`${a.source||'Canvas'}${a.points==null?'':` · ${a.points} points`}`;bindCardActions(node,a);list.appendChild(node)});c.appendChild(list);
}

function renderHidden() {
  const list = document.getElementById('hiddenList');
  const items = assignments.filter(isHidden).sort((a,b) => new Date(a.due) - new Date(b.due));
  document.getElementById('hiddenCount').textContent = items.length;
  if (!items.length) { list.innerHTML = '<div class="mini-empty">Nothing hidden.</div>'; return; }
  list.innerHTML = '';
  items.forEach(a => {
    const row = document.createElement('div');
    row.className = 'compact-row';
    row.innerHTML = `<div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(shortCourse(a.course))} · ${formatDate(new Date(a.due))}</span></div><button class="secondary-button">Restore</button>`;
    row.querySelector('button').onclick = () => { hidden.delete(a.id); saveSet(HIDDEN_KEY, hidden); render(); };
    list.appendChild(row);
  });
}

function undoLocalCompletion(a) {
  if (a.submitted || !completed.has(a.id)) return;
  const ok = confirm(`Are you sure you want to mark "${a.title}" as incomplete again?`);
  if (!ok) return;

  completed.delete(a.id);
  saveSet(COMPLETED_KEY, completed);

  // Keep Today's Focus task progress accurate if this was completed today.
  try {
    const state = loadTodayFocus();
    state.completedIds = state.completedIds.filter(id => id !== a.id);
    saveTodayFocus(state);
  } catch (_) {}

  showToast('Marked incomplete', false);
  render();
}

function renderCompleted() {
  const list = document.getElementById('completedList');
  if (!list) return;

  const cutoff = addDays(startOfDay(now), -14);
  const items = assignments
    .filter(a => isComplete(a) && new Date(a.due) >= cutoff)
    .sort((a,b) => new Date(b.due) - new Date(a.due));

  document.getElementById('completedCount').textContent = items.length;

  if (!items.length) {
    list.innerHTML = '<div class="mini-empty">Nothing completed recently.</div>';
    return;
  }

  list.innerHTML = '';
  list.className = 'assignment-list completed-assignment-list';

  items.forEach(a => {
    const node = document.getElementById('assignmentTemplate').content.cloneNode(true);
    const card = node.querySelector('.assignment-card');
    card.classList.add('completed-assignment-card');
    card.style.setProperty('--course-color', a.color);

    node.querySelector('.course-pill').textContent = shortCourse(a.course);

    const due = new Date(a.due);
    node.querySelector('.due-time').textContent = a.allDay
      ? formatDate(due)
      : `${formatDate(due)} · ${formatTime(due)}`;

    const title = node.querySelector('.assignment-title');
    title.textContent = a.title;
    if (a.url) title.href = a.url;
    else {
      title.removeAttribute('href');
      title.classList.add('no-link');
    }

    const points = a.points == null
      ? (a.source === 'Learning Suite'
          ? 'Live schedule feed'
          : a.source === 'Manual'
            ? 'Added manually'
            : 'Points not listed')
      : `${a.points} point${a.points === 1 ? '' : 's'}`;
    node.querySelector('.assignment-meta').textContent =
      `${points} · ${a.source || 'Canvas'} · ${a.submitted ? 'Completed in Canvas' : 'Completed locally'}`;

    // Completed cards use the same check circle, but filled.
    const check = node.querySelector('.check-button');
    check.classList.add('is-complete');
    check.setAttribute('aria-label', a.submitted ? 'Completed in Canvas' : 'Mark incomplete');
    check.title = a.submitted ? 'Completed in Canvas' : 'Mark incomplete';

    if (a.submitted) {
      check.disabled = true;
      card.classList.add('canvas-completed-card');
    } else {
      check.addEventListener('click', e => {
        e.stopPropagation();
        undoLocalCompletion(a);
      });
    }

    // Completed cards don't need Next Up or the actions menu.
    node.querySelector('.card-side-actions')?.remove();
    node.querySelector('.card-menu')?.remove();
    card.classList.add('completed-no-actions');

    const main = node.querySelector('.assignment-main');
    title.addEventListener('click', e => {
      e.preventDefault();
      openDetailDialog(a);
    });
    main.addEventListener('click', e => {
      if (!e.target.closest('button')) openDetailDialog(a);
    });

    list.appendChild(node);
  });
}

function htmlToText(html) {
  if(!html)return ''; const doc=new DOMParser().parseFromString(html,'text/html'); return (doc.body.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
}
function openDetailDialog(a) {
  const dialog=document.getElementById('detailDialog');
  document.getElementById('detailCourse').textContent=isReading(a)?`${shortCourse(a.course)} · READING`:shortCourse(a.course);
  document.getElementById('detailTitle').textContent=a.title; const due=new Date(a.due);
  document.getElementById('detailDue').textContent=a.allDay?formatDate(due):`${formatDate(due)} · ${formatTime(due)}`;
  const description=htmlToText(a.description)||a.notes|| (a.source==='Canvas'?'No description provided in Canvas.':a.source==='Learning Suite'?'No additional details in the schedule feed.':'No notes added.');
  document.getElementById('detailDescription').textContent=description;
  const link=document.getElementById('detailOpenLink'); if(a.url){link.href=a.url;link.hidden=false;link.textContent=a.source==='Canvas'?'Open in Canvas':a.source==='Learning Suite'?'Open Learning Suite':'Open original'}else link.hidden=true;
  if(!dialog.open)dialog.showModal();
}
function openEditDialog(a) {
  editingManualId=a.id; const dialog=document.getElementById('addDialog'); populateManualCourses(); document.getElementById('manualCourse').value=a.course; document.getElementById('manualTitle').value=a.title; const d=new Date(a.due); document.getElementById('manualDate').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; document.getElementById('manualTime').value=a.allDay?'':`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; document.getElementById('manualNotes').value=a.notes||''; document.getElementById('saveManualButton').textContent='Save changes'; dialog.showModal();
}
function deleteManualAssignment(a) {
  if(!confirm(`Delete “${a.title}”?`))return; manualAssignments=manualAssignments.filter(x=>x.id!==a.id); completed.delete(a.id); hidden.delete(a.id); removeFromNextUp(a.id, false); saveManual(); saveSet(COMPLETED_KEY,completed); saveSet(HIDDEN_KEY,hidden); assignments=assignments.filter(x=>x.id!==a.id); render(); showToast('Manual assignment deleted',false);
}

function populateManualCourses() {
  const select = document.getElementById('manualCourse');
  const current = select.value;
  const courses = [...new Set(assignments.filter(a => !a.manual).map(a => a.course))].sort();
  select.innerHTML = courses.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(shortCourse(c))}</option>`).join('') + '<option value="__OTHER__">Other class…</option>';
  if (courses.includes(current)) select.value = current;
}

function openAddDialog() {
  editingManualId = null;
  document.getElementById('saveManualButton').textContent = 'Add assignment';
  const dialog = document.getElementById('addDialog');
  const date = new Date();
  document.getElementById('manualDate').value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  document.getElementById('manualTitle').value = '';
  document.getElementById('manualTime').value = '';
  document.getElementById('manualNotes').value = '';
  dialog.showModal();
  setTimeout(() => document.getElementById('manualTitle').focus(), 40);
}

function addManualAssignment() {
  let course = document.getElementById('manualCourse').value;
  if (course === '__OTHER__') { course = prompt('Class name'); if (!course) return false; }
  const title = document.getElementById('manualTitle').value.trim();
  const date = document.getElementById('manualDate').value;
  const time = document.getElementById('manualTime').value;
  const notes = document.getElementById('manualNotes').value.trim();
  if (!title || !date) return false;
  const allDay = !time;
  const due = allDay ? new Date(`${date}T23:59:59`).toISOString() : new Date(`${date}T${time}:00`).toISOString();
  if (editingManualId) {
    const index=manualAssignments.findIndex(a=>a.id===editingManualId); if(index<0)return false;
    const item={...manualAssignments[index],course,title,due,allDay,notes}; manualAssignments[index]=item; saveManual(); assignments=assignments.map(a=>a.id===editingManualId?normalizeManual(item):a).sort((a,b)=>new Date(a.due)-new Date(b.due)); editingManualId=null; document.getElementById('saveManualButton').textContent='Add assignment'; render(); showToast('Assignment updated',false); return true;
  }
  const item = { id: `manual-${Date.now()}`, course, title, due, allDay, notes, points: null, url: '', source: 'Manual', kind: 'assignment', submitted: false };
  manualAssignments.push(item); saveManual(); assignments.push(normalizeManual(item)); assignments.sort((a,b) => new Date(a.due) - new Date(b.due)); render(); showToast('Assignment added', false); return true;
}

function hideToast() {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toastTimer = null;
  toast.hidden = true;
  toast.style.display = 'none';
  lastUndo = null;
}

function showToast(text, undo) {
  const toast = document.getElementById('toast');
  const undoBtn = document.getElementById('toastUndo');
  document.getElementById('toastText').textContent = text;
  undoBtn.hidden = !undo;
  toast.hidden = false;
  toast.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4500);
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.getElementById(`${view}View`).classList.add('active-view');
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const listControls = view === 'list' || view === 'readings' || view === 'calendar';
  document.getElementById('courseFilters').hidden = !listControls;
  document.getElementById('laterToggle').hidden = !(view === 'list' || view === 'readings');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


function showLogin() {
  const dialog = document.getElementById('loginDialog');
  document.getElementById('loginError').textContent = '';
  if (!dialog.open) dialog.showModal();
  setTimeout(() => document.getElementById('hubPassword').focus(), 40);
}

async function submitLogin(event) {
  event.preventDefault();
  const password = document.getElementById('hubPassword').value;
  const error = document.getElementById('loginError');
  error.textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not unlock Assignment Hub.');
    document.getElementById('hubPassword').value = '';
    document.getElementById('loginDialog').close();
    loadAssignments();
  } catch (err) {
    error.textContent = err.message;
  }
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }

document.querySelectorAll('.tab,.bottom-nav-item').forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.view)));
document.getElementById('laterToggle').addEventListener('click', () => { showLater = !showLater; document.getElementById('laterToggle').textContent = showLater ? 'Hide later' : 'Show later'; renderAssignments(); renderReadings(); });
document.getElementById('themeToggle').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem(THEME_KEY, document.body.classList.contains('dark') ? 'dark' : 'light'); document.getElementById('themeToggle').textContent = document.body.classList.contains('dark') ? '☀' : '☾'; });
document.getElementById('calendarPrev').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar()});
document.getElementById('calendarNext').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar()});
document.getElementById('calendarToday').addEventListener('click',()=>{now=new Date();calendarCursor=new Date(now.getFullYear(),now.getMonth(),1);calendarSelectedDate=startOfDay(now);renderCalendar()});
document.getElementById('calendarReadingsToggle').addEventListener('change',e=>{calendarShowReadings=e.target.checked;renderCalendar()});
document.getElementById('syncButton').addEventListener('click', loadAssignments);
document.getElementById('loginForm').addEventListener('submit', submitLogin);
document.getElementById('addButton').addEventListener('click', openAddDialog);
document.getElementById('closeDetailDialog').addEventListener('click', () => document.getElementById('detailDialog').close());
document.getElementById('detailDone').addEventListener('click', () => document.getElementById('detailDialog').close());
document.getElementById('closeAddDialog').addEventListener('click', () => document.getElementById('addDialog').close());
document.getElementById('cancelAddDialog').addEventListener('click', () => document.getElementById('addDialog').close());
document.getElementById('addForm').addEventListener('submit', e => { if (e.submitter?.id === 'saveManualButton' && !addManualAssignment()) e.preventDefault(); });
document.getElementById('toastUndo').addEventListener('click', () => { const undo = lastUndo; if (undo) undo(); hideToast(); });
document.getElementById('clearLocalButton').addEventListener('click', () => { if (!confirm('Clear manual assignments, local check-offs, hidden items, and Next Up on this device?')) return; completed.clear(); hidden.clear(); manualAssignments = []; nextUpIds = []; localStorage.removeItem(COMPLETED_KEY); localStorage.removeItem(HIDDEN_KEY); localStorage.removeItem(MANUAL_KEY); localStorage.removeItem(NEXT_UP_KEY); localStorage.removeItem(NEXT_UP_ESTIMATES_KEY); nextUpEstimates = {}; loadAssignments(); });
document.addEventListener('click', e => { if (!e.target.closest('.card-menu-button') && !e.target.closest('.card-menu')) document.querySelectorAll('.card-menu').forEach(m => m.hidden = true); });

if (localStorage.getItem(THEME_KEY) === 'dark') { document.body.classList.add('dark'); document.getElementById('themeToggle').textContent = '☀'; }
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));

render();
loadAssignments();

// Compact study timer
const STUDY_TIMER_KEY = 'assignmentHubStudyTimerV1';
let studyTimerInterval = null;
let studyTimerState = { preset: '25', durationSeconds: 25 * 60, remainingSeconds: 25 * 60, running: false, endAt: null };

function clampTimerMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return 30;
  return Math.min(240, Math.max(1, minutes));
}

function timerSecondsForPreset(preset) {
  if (preset === 'custom') {
    const input = document.getElementById('studyTimerCustomMinutes');
    return clampTimerMinutes(input?.value || 30) * 60;
  }
  return clampTimerMinutes(preset) * 60;
}

function saveStudyTimer() {
  localStorage.setItem(STUDY_TIMER_KEY, JSON.stringify(studyTimerState));
}

function loadStudyTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(STUDY_TIMER_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    const preset = ['25','5','10','custom'].includes(String(saved.preset)) ? String(saved.preset) : '25';
    const durationSeconds = Math.max(60, Number(saved.durationSeconds) || 25 * 60);
    let remainingSeconds = Math.max(0, Number(saved.remainingSeconds) || durationSeconds);
    let running = Boolean(saved.running);
    let endAt = Number(saved.endAt) || null;
    if (running && endAt) {
      remainingSeconds = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      if (remainingSeconds <= 0) { running = false; endAt = null; }
    }
    studyTimerState = { preset, durationSeconds, remainingSeconds, running, endAt };
  } catch (_) {}
}

function formatTimer(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function playTimerChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.6);
  } catch (_) {}
}

function renderStudyTimer() {
  const timer = document.querySelector('.study-timer');
  const display = document.getElementById('studyTimerDisplay');
  const start = document.getElementById('studyTimerStart');
  const preset = document.getElementById('studyTimerPreset');
  const custom = document.getElementById('studyTimerCustom');
  const customInput = document.getElementById('studyTimerCustomMinutes');
  if (!timer || !display || !start || !preset || !custom) return;
  preset.value = studyTimerState.preset;
  custom.hidden = studyTimerState.preset !== 'custom';
  if (studyTimerState.preset === 'custom' && customInput && !customInput.dataset.initialized) {
    customInput.value = String(Math.round(studyTimerState.durationSeconds / 60));
    customInput.dataset.initialized = '1';
  }
  display.textContent = formatTimer(studyTimerState.remainingSeconds);
  start.textContent = studyTimerState.running ? 'Pause' : (studyTimerState.remainingSeconds < studyTimerState.durationSeconds && studyTimerState.remainingSeconds > 0 ? 'Resume' : 'Start');
  timer.classList.toggle('is-running', studyTimerState.running);
  timer.classList.toggle('is-finished', !studyTimerState.running && studyTimerState.remainingSeconds === 0);
}

function tickStudyTimer() {
  if (!studyTimerState.running || !studyTimerState.endAt) return;
  const previous = studyTimerState.remainingSeconds;
  studyTimerState.remainingSeconds = Math.max(0, Math.ceil((studyTimerState.endAt - Date.now()) / 1000));
  if (studyTimerState.remainingSeconds <= 0) {
    studyTimerState.running = false;
    studyTimerState.endAt = null;
    clearInterval(studyTimerInterval);
    studyTimerInterval = null;
    if (previous > 0) {
      playTimerChime();
      if (studyTimerState.preset === '25' && studyTimerState.durationSeconds === 25 * 60) recordCompletedFocusSession();
    }
    saveStudyTimer();
  }
  renderStudyTimer();
}

function startStudyTimerInterval() {
  clearInterval(studyTimerInterval);
  studyTimerInterval = null;
  if (!studyTimerState.running) return;
  studyTimerInterval = setInterval(tickStudyTimer, 250);
}

function resetStudyTimerForCurrentPreset() {
  const seconds = timerSecondsForPreset(studyTimerState.preset);
  studyTimerState.durationSeconds = seconds;
  studyTimerState.remainingSeconds = seconds;
  studyTimerState.running = false;
  studyTimerState.endAt = null;
  clearInterval(studyTimerInterval);
  studyTimerInterval = null;
  saveStudyTimer();
  renderStudyTimer();
}

function initStudyTimer() {
  const preset = document.getElementById('studyTimerPreset');
  const start = document.getElementById('studyTimerStart');
  const reset = document.getElementById('studyTimerReset');
  const customInput = document.getElementById('studyTimerCustomMinutes');
  if (!preset || !start || !reset || !customInput) return;

  loadStudyTimer();
  renderStudyTimer();
  startStudyTimerInterval();

  preset.addEventListener('change', () => {
    studyTimerState.preset = preset.value;
    if (preset.value === 'custom') {
      customInput.dataset.initialized = '1';
      customInput.value = '30';
    }
    resetStudyTimerForCurrentPreset();
    if (preset.value === 'custom') customInput.focus();
  });

  customInput.addEventListener('change', () => {
    customInput.value = String(clampTimerMinutes(customInput.value));
    resetStudyTimerForCurrentPreset();
  });

  start.addEventListener('click', () => {
    if (studyTimerState.remainingSeconds <= 0) {
      studyTimerState.remainingSeconds = studyTimerState.durationSeconds;
    }
    studyTimerState.running = !studyTimerState.running;
    studyTimerState.endAt = studyTimerState.running ? Date.now() + studyTimerState.remainingSeconds * 1000 : null;
    saveStudyTimer();
    renderStudyTimer();
    startStudyTimerInterval();
  });

  reset.addEventListener('click', resetStudyTimerForCurrentPreset);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tickStudyTimer(); });
}

initStudyTimer();

// Scratch pad
(() => {
  const text = document.getElementById("scratchPadText");
  const clear = document.getElementById("scratchPadClear");
  if (!text || !clear) return;
  const key = "assignmentHubScratchPad";
  try { text.value = localStorage.getItem(key) || ""; } catch (_) {}
  text.addEventListener("input", () => {
    try { localStorage.setItem(key, text.value); } catch (_) {}
  });
  clear.addEventListener("click", () => {
    text.value = "";
    try { localStorage.removeItem(key); } catch (_) {}
    text.focus();
  });
})();

// Make the entire timer card flash during the final five seconds.
(() => {
  const display = document.getElementById("studyTimerDisplay");
  const card = display?.closest(".study-timer");
  if (!display || !card) return;
  const syncFinalCountdown = () => {
    const parts = display.textContent.trim().split(":").map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) return;
    const seconds = parts[0] * 60 + parts[1];
    const running = document.getElementById("studyTimerStart")?.textContent.trim().toLowerCase() !== "start";
    card.classList.toggle("timer-final-countdown", running && seconds > 0 && seconds <= 5);
  };
  new MutationObserver(syncFinalCountdown).observe(display, {childList:true,characterData:true,subtree:true});
  syncFinalCountdown();
})();

// Stronger timer-finished chime, triggered when the display reaches 0:00.
(() => {
  const display = document.getElementById("studyTimerDisplay");
  if (!display) return;
  let sounded = false;
  const chime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      [0, .22, .44].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = [880, 1100, 1320][i];
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + delay + .015);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + .18);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + .2);
      });
      setTimeout(() => ctx.close().catch(()=>{}), 1000);
    } catch (_) {}
  };
  const check = () => {
    const zero = display.textContent.trim() === "0:00";
    if (zero && !sounded) { sounded = true; chime(); }
    if (!zero) sounded = false;
  };
  new MutationObserver(check).observe(display, {childList:true,characterData:true,subtree:true});
  check();
})();


// Today's Focus — daily study motivation dashboard
const TODAY_FOCUS_KEY = 'assignmentHubTodayFocusV1';
function focusDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function defaultTodayFocus() { return { date: focusDateKey(), goal: '', sessions: 0, focusedMinutes: 0, plannedIds: [], completedIds: [] }; }
function loadTodayFocus() {
  try {
    const saved = JSON.parse(localStorage.getItem(TODAY_FOCUS_KEY) || 'null');
    if (saved && saved.date === focusDateKey()) return { ...defaultTodayFocus(), ...saved, plannedIds: Array.isArray(saved.plannedIds) ? saved.plannedIds : [], completedIds: Array.isArray(saved.completedIds) ? saved.completedIds : [] };
  } catch (_) {}
  return defaultTodayFocus();
}
function saveTodayFocus(state) { try { localStorage.setItem(TODAY_FOCUS_KEY, JSON.stringify(state)); } catch (_) {} }
function recordFocusPlannedTask(id) {
  const state = loadTodayFocus();
  if (!state.plannedIds.includes(id)) state.plannedIds.push(id);
  saveTodayFocus(state); renderTodayFocus(); updatePersonalGreeting();
}
function recordFocusCompletedTask(id) {
  const state = loadTodayFocus();
  if (!state.plannedIds.includes(id)) state.plannedIds.push(id);
  if (!state.completedIds.includes(id)) state.completedIds.push(id);
  saveTodayFocus(state); renderTodayFocus(); updatePersonalGreeting();
}
function recordCompletedFocusSession() {
  const state = loadTodayFocus();
  state.sessions += 1; state.focusedMinutes += 25;
  saveTodayFocus(state); renderTodayFocus(); updatePersonalGreeting();
}
function focusRewardCopy(sessions) {
  if (sessions <= 0) return ['Ready to light', 'Finish a 25 min focus to start the fire.'];
  if (sessions === 1) return ['Fire started', 'One focus block down.'];
  if (sessions === 2) return ['Warming up', 'Two solid focus blocks.'];
  if (sessions === 3) return ['Locked in', 'The fire is rolling now.'];
  if (sessions === 4) return ['On fire', 'Four focus sessions today.'];
  return ['Blazing', `${sessions * 25} focused minutes. Keep it going.`];
}
function renderTodayFocus() {
  const panel = document.querySelector('.today-focus-panel');
  if (!panel) return;

  const state = loadTodayFocus();

  // Today's task progress = tasks still in Next Up + tasks completed from Next Up today.
  // This means completing 1 of 5 becomes 1/5, while manually removing an unfinished
  // task reduces the denominator instead of leaving stale progress behind.
  const currentIds = [...nextUpIds];
  const completedTodayIds = state.completedIds.filter(id => !currentIds.includes(id));
  const trackedIds = [...new Set([...currentIds, ...completedTodayIds])];

  const completedCount = trackedIds.filter(id => state.completedIds.includes(id)).length;
  const total = trackedIds.length;
  const percent = total ? Math.round((completedCount / total) * 100) : 0;

  document.getElementById('focusProgressLabel').textContent =
    `${completedCount} / ${total} task${total === 1 ? '' : 's'}`;
  document.getElementById('focusProgressPercent').textContent = `${percent}%`;
  document.getElementById('focusProgressBar').style.width = `${percent}%`;

  document.getElementById('focusMinutes').textContent = state.focusedMinutes;
  document.getElementById('focusSessions').textContent = state.sessions;

  const campfire = document.getElementById('focusCampfire');
  const level = Math.min(5, state.sessions);
  campfire.dataset.level = String(level);
  campfire.setAttribute('aria-label', `Campfire level ${level} of 5`);

  const [title, detail] = focusRewardCopy(state.sessions);
  const reward = document.getElementById('focusReward');
  reward.querySelector('strong').textContent = title;
  reward.querySelector('span').textContent = detail;
}
(() => { renderTodayFocus(); })();



// Preserve today's existing focus progress and ensure the already-completed 25-minute session is registered.
(() => {
  try {
    const key = 'assignmentHubTodayFocusV1';
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    const state = saved && saved.date === today ? saved : {
      date: today, goal: '', sessions: 0, focusedMinutes: 0, plannedIds: [], completedIds: []
    };
    state.sessions = Math.max(1, Number(state.sessions || 0));
    state.focusedMinutes = Math.max(25, Number(state.focusedMinutes || 0));
    localStorage.setItem(key, JSON.stringify(state));
    if (typeof renderTodayFocus === 'function') renderTodayFocus();
  } catch (_) {}
})();


// Persist the actual Next Up state before the page closes/reloads.
window.addEventListener('pagehide', () => {
  try { saveNextUp(); } catch (_) {}
  try { saveNextUpEstimates(); } catch (_) {}
});

// Refresh greeting context without touching application state.
setInterval(updatePersonalGreeting, 60000);
