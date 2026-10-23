/* Weekly planner — notes saved locally, one text area per day. */
(() => {
  'use strict';

  const STORAGE_KEY = 'calisthenics_week_plan';
  const EXERCISE_KEY = 'calisthenics_week_exercises';
  const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const state = { weekStart: startOfWeek(new Date()), plan: loadPlan(), exercises: loadExercises() };
  let savedTimer = 0;

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfWeek(date) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = day.getDay() === 0 ? -6 : 1 - day.getDay();
    return addDays(day, offset);
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function sameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }

  function formatDay(date) {
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  function formatWeekRange(start) {
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const startLabel = start.toLocaleDateString('fr-FR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
    const endLabel = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    return `Du ${startLabel} au ${endLabel} ${end.getFullYear()}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function csvField(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportWeek() {
    const rows = [['Date', 'Jour', 'Exercice', 'Répétitions', 'Lest', 'Notes'].map(csvField).join(',')];
    let hasContent = false;
    DAY_NAMES.forEach((name, index) => {
      const key = dateKey(addDays(state.weekStart, index));
      const note = String(state.plan[key] || '');
      const exercises = (state.exercises[key] || []).filter(exercise =>
        [exercise.name, exercise.reps, exercise.load].some(value => String(value || '').trim())
      );
      if (note.trim() || exercises.length) hasContent = true;
      if (exercises.length) {
        exercises.forEach((exercise, position) => {
          rows.push([key, name, exercise.name, exercise.reps, exercise.load, position === 0 ? note : ''].map(csvField).join(','));
        });
      } else {
        rows.push([key, name, '', '', '', note].map(csvField).join(','));
      }
    });
    if (!hasContent) {
      notify("Ajoute au moins une note avant d'exporter.", 'info');
      return;
    }
    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `semaine-${dateKey(state.weekStart)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Semaine exportée pour Google Sheets.');
  }

  function loadPlan() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePlan() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plan));
      return true;
    } catch {
      return false;
    }
  }

  function loadExercises() {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXERCISE_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      Object.entries(parsed).forEach(([key, rows]) => {
        if (!Array.isArray(rows)) return;
        clean[key] = rows.map(row => ({
          name: String(row?.name || ''),
          reps: String(row?.reps || ''),
          load: String(row?.load || ''),
        }));
      });
      return clean;
    } catch {
      return {};
    }
  }

  function saveExercises() {
    try {
      localStorage.setItem(EXERCISE_KEY, JSON.stringify(state.exercises));
      return true;
    } catch {
      return false;
    }
  }

  function persistWeek() {
    if (savePlan() && saveExercises()) {
      markSaved();
      return true;
    }
    const status = document.getElementById('week-save-state');
    if (status) status.textContent = 'Sauvegarde impossible';
    return false;
  }

  function markSaved() {
    const el = document.getElementById('week-save-state');
    if (!el) return;
    el.textContent = 'Enregistré';
    clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      el.textContent = 'Sauvegarde automatique';
    }, 1800);
  }

  function exerciseRowHtml(exercise, index, key, dayLabel) {
    const position = index + 1;
    return `
      <div class="week-exercise" data-index="${index}">
        <input class="week-exercise-name" type="text" value="${escapeHtml(exercise.name)}" placeholder="Nom" autocomplete="off" aria-label="Nom de l'exercice ${position} pour ${dayLabel}">
        <div class="week-exercise-bottom">
          <input class="week-exercise-reps" type="text" inputmode="numeric" value="${escapeHtml(exercise.reps)}" placeholder="Reps" autocomplete="off" aria-label="Répétitions de l'exercice ${position} pour ${dayLabel}">
          <input class="week-exercise-load" type="text" inputmode="decimal" value="${escapeHtml(exercise.load)}" placeholder="Lest" autocomplete="off" aria-label="Lest de l'exercice ${position} pour ${dayLabel}">
          <button type="button" class="week-exercise-remove" data-date="${key}" data-index="${index}" aria-label="Supprimer l'exercice ${position} de ${dayLabel}">×</button>
        </div>
      </div>`;
  }

  function render() {
    const grid = document.getElementById('week-grid');
    const range = document.getElementById('week-range');
    if (!grid || !range) return;

    const today = new Date();
    range.textContent = formatWeekRange(state.weekStart);
    grid.innerHTML = DAY_NAMES.map((name, index) => {
      const day = addDays(state.weekStart, index);
      const key = dateKey(day);
      const value = state.plan[key] || '';
      const dayLabel = `${name} ${formatDay(day)}`;
      const exercises = state.exercises[key] || [];
      const classes = ['week-day'];
      if (index >= 5) classes.push('is-weekend');
      if (sameDay(day, today)) classes.push('is-today');
      return `
        <div class="${classes.join(' ')}" data-date="${key}">
          <div class="week-day-head">
            <span class="week-day-name">${name}</span>
            <span class="week-day-date">${formatDay(day)}</span>
          </div>
          <button type="button" class="week-add-exercise" data-date="${key}" aria-label="Ajouter un exercice pour ${dayLabel}">
            <span class="week-add-plus" aria-hidden="true">+</span> Ajouter un exercice
          </button>
          <div class="week-exercises" data-date="${key}">${exercises.map((exercise, position) => exerciseRowHtml(exercise, position, key, dayLabel)).join('')}</div>
          <textarea class="week-note" data-date="${key}" aria-label="Note pour ${dayLabel}" placeholder="Notes du jour…">${escapeHtml(value)}</textarea>
        </div>`;
    }).join('');
  }

  function init() {
    if (!document.getElementById('week-grid')) return;

    document.getElementById('week-prev')?.addEventListener('click', () => {
      state.weekStart = addDays(state.weekStart, -7);
      render();
    });
    document.getElementById('week-next')?.addEventListener('click', () => {
      state.weekStart = addDays(state.weekStart, 7);
      render();
    });
    document.getElementById('week-today')?.addEventListener('click', () => {
      state.weekStart = startOfWeek(new Date());
      render();
    });
    document.getElementById('week-export')?.addEventListener('click', exportWeek);

    document.getElementById('week-grid')?.addEventListener('click', (event) => {
      const addButton = event.target.closest('.week-add-exercise');
      if (addButton) {
        const key = addButton.dataset.date;
        if (!state.exercises[key]) state.exercises[key] = [];
        state.exercises[key].push({ name: '', reps: '', load: '' });
        persistWeek();
        render();
        document.querySelector(`.week-day[data-date="${key}"] .week-exercise:last-child .week-exercise-name`)?.focus();
        return;
      }

      const removeButton = event.target.closest('.week-exercise-remove');
      if (!removeButton) return;
      const key = removeButton.dataset.date;
      const index = Number(removeButton.dataset.index);
      const rows = state.exercises[key];
      if (!rows || !Number.isInteger(index)) return;
      rows.splice(index, 1);
      if (!rows.length) delete state.exercises[key];
      persistWeek();
      render();
      document.querySelector(`.week-day[data-date="${key}"] .week-add-exercise`)?.focus();
    });

    document.getElementById('week-grid')?.addEventListener('input', (event) => {
      const field = event.target.closest('.week-exercise input');
      if (field) {
        const row = field.closest('.week-exercise');
        const key = field.closest('.week-day')?.dataset.date;
        const index = Number(row?.dataset.index);
        const item = state.exercises[key]?.[index];
        if (!item) return;
        if (field.classList.contains('week-exercise-name')) item.name = field.value;
        else if (field.classList.contains('week-exercise-reps')) item.reps = field.value;
        else if (field.classList.contains('week-exercise-load')) item.load = field.value;
        else return;
        persistWeek();
        return;
      }

      const note = event.target.closest('.week-note');
      if (!note) return;
      const key = note.dataset.date;
      if (note.value) state.plan[key] = note.value;
      else delete state.plan[key];
      persistWeek();
    });

    document.addEventListener('site:tabchange', (event) => {
      if (event.detail === 'week') render();
    });

    render();
  }

  init();
})();
