(() => {
  const TASK_COURSE = 'Task';
  const MANUAL_KEY = 'assignmentHubManualAssignments';
  const ACCIDENTAL_COURSES = new Set(['internship advisor meeting']);

  function isTaskCourse(course) {
    return String(course || '').trim().toLowerCase() === TASK_COURSE.toLowerCase();
  }

  function migrateAccidentalTaskCourse() {
    try {
      const saved = JSON.parse(localStorage.getItem(MANUAL_KEY) || '[]');
      if (!Array.isArray(saved)) return false;

      let changed = false;
      const migrated = saved.map(item => {
        const course = String(item?.course || '').trim().toLowerCase();
        if (!ACCIDENTAL_COURSES.has(course)) return item;
        changed = true;
        return { ...item, course: TASK_COURSE };
      });

      if (changed) localStorage.setItem(MANUAL_KEY, JSON.stringify(migrated));
      return changed;
    } catch (_) {
      return false;
    }
  }

  function ensureTaskOption({ selectTask = false } = {}) {
    const select = document.getElementById('manualCourse');
    if (!select) return;

    let option = [...select.options].find(opt => isTaskCourse(opt.value));
    if (!option) {
      option = document.createElement('option');
      option.value = TASK_COURSE;
      option.textContent = 'Task (no class)';
      select.insertBefore(option, select.firstChild);
    } else {
      option.textContent = 'Task (no class)';
      if (option !== select.firstChild) select.insertBefore(option, select.firstChild);
    }

    if (selectTask) select.value = TASK_COURSE;
  }

  function removeTaskFromClassUi() {
    document.querySelectorAll('#courseFilters .filter-chip').forEach(button => {
      if (button.textContent.trim().toLowerCase() === TASK_COURSE.toLowerCase()) button.remove();
    });

    document.querySelectorAll('#courseGrid .course-card').forEach(card => {
      const name = card.querySelector('.course-name')?.textContent?.trim().toLowerCase();
      if (name === TASK_COURSE.toLowerCase()) card.remove();
    });
  }

  // Preserve the site's existing render logic, then remove the personal Task
  // category only from UI that specifically represents academic classes.
  if (typeof window.renderCourseFilters === 'function') {
    const originalRenderCourseFilters = window.renderCourseFilters;
    window.renderCourseFilters = function(...args) {
      const result = originalRenderCourseFilters.apply(this, args);
      removeTaskFromClassUi();
      return result;
    };
  }

  if (typeof window.renderCourses === 'function') {
    const originalRenderCourses = window.renderCourses;
    window.renderCourses = function(...args) {
      const result = originalRenderCourses.apply(this, args);
      removeTaskFromClassUi();
      return result;
    };
  }

  if (typeof window.populateManualCourses === 'function') {
    const originalPopulateManualCourses = window.populateManualCourses;
    window.populateManualCourses = function(...args) {
      const current = document.getElementById('manualCourse')?.value;
      const result = originalPopulateManualCourses.apply(this, args);
      ensureTaskOption();
      const select = document.getElementById('manualCourse');
      if (select && current && [...select.options].some(opt => opt.value === current)) select.value = current;
      return result;
    };
  }

  // New manual items default to a classless task. Real course assignments can
  // still choose any existing class exactly as before.
  document.getElementById('addButton')?.addEventListener('click', () => {
    requestAnimationFrame(() => ensureTaskOption({ selectTask: true }));
  });

  const migrated = migrateAccidentalTaskCourse();
  if (migrated) {
    // app.js already read localStorage before this helper loaded, so refresh once
    // to let it pick up the corrected saved item.
    location.reload();
    return;
  }

  ensureTaskOption();
  if (typeof window.render === 'function') window.render();
  removeTaskFromClassUi();
})();

// Keep Wayne's sitting poses physically anchored to the card edge. The inline
// Wayne rotation code positions the helper absolutely inside .app-shell, so its
// coordinates must be relative to that shell rather than to the document.
(() => {
  function installWayneCardAnchoring() {
    const helper = document.querySelector('.wayne-floating-helper');
    const shell = document.querySelector('.app-shell');
    const bubble = helper?.querySelector('.wayne-bubble');
    const todayFocus = document.querySelector('.today-focus-panel');
    const nextUp = document.querySelector('.next-up-panel');
    const sitToday = document.getElementById('wayneDangleMascot');
    const sitNextUp = document.getElementById('wayneDangleNextUp');
    const courseFilters = document.getElementById('courseFilters');
    const assignmentSections = document.getElementById('assignmentSections');
    const dashboardGrid = document.querySelector('.dashboard-grid');

    if (!helper || !shell || !bubble || !todayFocus || !nextUp || !sitToday || !sitNextUp) return;

    let frame = null;

    function correctSittingPosition() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (window.innerWidth <= 1100 || !helper.classList.contains('wayne-sitting-mode')) return;

        const onToday = helper.classList.contains('wayne-sit-today');
        const onNextUp = helper.classList.contains('wayne-sit-nextup');
        if (!onToday && !onNextUp) return;

        const card = onToday ? todayFocus : nextUp;
        const sitter = onToday ? sitToday : sitNextUp;
        const cardRect = card.getBoundingClientRect();
        const shellRect = shell.getBoundingClientRect();
        const sitterRect = sitter.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();

        const feetOverlap = 16;
        const rightInset = 10;
        const gap = 10;

        const top = cardRect.top - shellRect.top - sitterRect.height + feetOverlap;
        const sitterLeft = cardRect.right - shellRect.left - sitterRect.width - rightInset;
        const left = sitterLeft - bubbleRect.width - gap;

        const desiredLeft = `${Math.round(left)}px`;
        const desiredTop = `${Math.round(top)}px`;

        if (helper.style.left !== desiredLeft) helper.style.left = desiredLeft;
        if (helper.style.top !== desiredTop) helper.style.top = desiredTop;
      });
    }

    // Wayne's own pose changes still trigger a correction.
    const helperObserver = new MutationObserver(correctSittingPosition);
    helperObserver.observe(helper, { attributes: true, attributeFilter: ['class', 'style'] });

    // Canvas rendering adds the class chips and assignment cards after Wayne is
    // already on screen. Watch those layout changes so he moves with his seat.
    const layoutObserver = new MutationObserver(correctSittingPosition);
    if (courseFilters) layoutObserver.observe(courseFilters, { childList: true, subtree: true });
    if (assignmentSections) layoutObserver.observe(assignmentSections, { childList: true, subtree: true });

    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(correctSittingPosition);
      [shell, todayFocus, nextUp, courseFilters, assignmentSections, dashboardGrid]
        .filter(Boolean)
        .forEach(element => resizeObserver.observe(element));
    }

    window.addEventListener('resize', correctSittingPosition);
    sitToday.addEventListener('load', correctSittingPosition);
    sitNextUp.addEventListener('load', correctSittingPosition);

    // Run after the inline Wayne rotation script has initialized its first pose.
    requestAnimationFrame(() => requestAnimationFrame(correctSittingPosition));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(installWayneCardAnchoring, 0), { once: true });
  } else {
    setTimeout(installWayneCardAnchoring, 0);
  }
})();
