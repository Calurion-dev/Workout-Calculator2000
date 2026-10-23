/* Weekly planner — notes saved locally, one text area per day. */
(() => {
  'use strict';

  const STORAGE_KEY = 'calisthenics_week_plan';
  const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const state = { weekStart: startOfWeek(new Date()), plan: loadPlan() };
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
    const rows = [['Date', 'Jour', 'Contenu'].map(csvField).join(',')];
    let hasContent = false;
    DAY_NAMES.forEach((name, index) => {
      const key = dateKey(addDays(state.weekStart, index));
      const note = String(state.plan[key] || '');
      if (note.trim()) hasContent = true;
      rows.push([key, name, note].map(csvField).join(','));
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

  function markSaved() {
    const el = document.getElementById('week-save-state');
    if (!el) return;
    el.textContent = 'Enregistré';
    clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      el.textContent = 'Sauvegarde automatique';
    }, 1800);
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
      const classes = ['week-day'];
      if (index >= 5) classes.push('is-weekend');
      if (sameDay(day, today)) classes.push('is-today');
      return `
        <div class="${classes.join(' ')}" data-date="${key}">
          <div class="week-day-head">
            <span class="week-day-name">${name}</span>
            <span class="week-day-date">${formatDay(day)}</span>
          </div>
          <button type="button" class="week-add-exercise" data-date="${key}" aria-label="Ajouter un exercice pour ${name} ${formatDay(day)}">
            <span class="week-add-plus" aria-hidden="true">+</span> Ajouter un exercice
          </button>
          <textarea class="week-note" data-date="${key}" aria-label="Note pour ${name} ${formatDay(day)}" placeholder="Séance, repos, objectif…">${escapeHtml(value)}</textarea>
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
      const button = event.target.closest('.week-add-exercise');
      if (!button) return;
      const note = button.parentElement?.querySelector('.week-note');
      if (!note) return;
      note.value += `${note.value && !note.value.endsWith('\n') ? '\n' : ''}• `;
      note.focus();
      note.setSelectionRange(note.value.length, note.value.length);
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });

    document.getElementById('week-grid')?.addEventListener('input', (event) => {
      const note = event.target.closest('.week-note');
      if (!note) return;
      const key = note.dataset.date;
      if (note.value) state.plan[key] = note.value;
      else delete state.plan[key];
      if (savePlan()) markSaved();
      else {
        const status = document.getElementById('week-save-state');
        if (status) status.textContent = 'Sauvegarde impossible';
      }
    });

    document.addEventListener('site:tabchange', (event) => {
      if (event.detail === 'week') render();
    });

    render();
  }

  init();
})();
