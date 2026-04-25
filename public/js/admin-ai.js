document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.pathname.startsWith('/admin')) return;

  const widget = document.createElement('section');
  widget.className = 'admin-ai-widget';
  widget.innerHTML = `
    <button class="admin-ai-launcher" type="button" aria-label="Deschide AI Admin">AI</button>
    <div class="admin-ai-panel" aria-hidden="true">
      <div class="admin-ai-head">
        <div>
          <span>AI Admin</span>
          <strong>Cu ce lucram acum?</strong>
        </div>
        <button type="button" class="admin-ai-close" aria-label="Inchide AI">x</button>
      </div>
      <div class="admin-ai-suggestions">
        <button type="button" data-ai-prompt="Verifica rapoartele care au probleme si spune-mi ce trebuie facut.">Verifica rapoarte</button>
        <button type="button" data-ai-prompt="Fa-mi un sumar pentru contabilitate si trainerii cu cele mai multe seminarii.">Sumar contabilitate</button>
        <button type="button" data-ai-prompt="Ajuta-ma sa creez un raport nou. Titlu: Curs cosmetica. Perioada: 01.05.2026 - 15.05.2026.">Draft raport</button>
      </div>
      <form class="admin-ai-form">
        <textarea name="prompt" rows="4" placeholder="Scrie ce vrei sa faca AI-ul in admin..."></textarea>
        <button class="btn primary full" type="submit">Ruleaza AI</button>
      </form>
      <div class="admin-ai-output" aria-live="polite"></div>
    </div>
  `;

  document.body.appendChild(widget);

  const launcher = widget.querySelector('.admin-ai-launcher');
  const panel = widget.querySelector('.admin-ai-panel');
  const close = widget.querySelector('.admin-ai-close');
  const form = widget.querySelector('.admin-ai-form');
  const textarea = form.querySelector('textarea');
  const output = widget.querySelector('.admin-ai-output');

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const detectMode = (prompt) => {
    const text = String(prompt || '').toLowerCase();
    if (/raport|curs|trainer|cursant|serie/.test(text)) return 'report-draft';
    if (/contabil|plata|lei|comision|excel|luna|seminarii/.test(text)) return 'accounting';
    if (/verifica|probleme|lips|gres|corect/.test(text)) return 'quality';
    return 'general';
  };

  const openPanel = () => {
    widget.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    textarea.focus();
  };

  const closePanel = () => {
    widget.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  };

  const setLoading = (loading) => {
    form.querySelector('button[type="submit"]').disabled = loading;
    widget.classList.toggle('is-loading', loading);
  };

  const goToHash = (hash) => {
    if (!hash) return;
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const fillReportForm = (payload = {}) => {
    goToHash('genereaza-raport');
    const formEl = document.querySelector('form[action="/admin/reports"]');
    if (!formEl) return;

    const setField = (name, value) => {
      const field = formEl.querySelector(`[name="${name}"]`);
      if (!field || value === undefined || value === null || value === '') return;
      field.value = value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };

    setField('trainerId', payload.trainerId);
    setField('title', payload.title);
    setField('startDate', payload.startDate);
    setField('endDate', payload.endDate);
    setField('location', payload.location);
    setField('traineesText', payload.traineesText);
    setField('adminNotes', payload.adminNotes);
    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const applyAction = (action) => {
    const payload = action.payload || {};
    if (action.type === 'go_to_tab') goToHash(payload.hash);
    if (action.type === 'fill_report_form') fillReportForm(payload);
    if (action.type === 'open_report' && payload.reportId) window.location.href = `/admin/reports/${payload.reportId}`;
    if (action.type === 'set_accounting_filters') {
      goToHash('contabilitate');
      Object.entries(payload).forEach(([key, value]) => {
        const field = document.querySelector(`#accounting${key[0].toUpperCase()}${key.slice(1)}Filter`);
        if (field && value) {
          field.value = value;
          field.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  };

  const renderResult = (result) => {
    const insights = (result.insights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const actions = (result.actions || []).map((action, index) => (
      `<button type="button" data-action-index="${index}">${escapeHtml(action.label || 'Aplica actiunea')}</button>`
    )).join('');
    const provider = result.provider === 'openai'
      ? `OpenAI ${result.model || ''}`
      : `Mod local: ${result.fallbackReason || 'OpenAI nu este disponibil momentan.'}`;

    output.innerHTML = `
      <article class="admin-ai-result">
        <p>${escapeHtml(result.answer || 'Am pregatit rezultatul.')}</p>
        ${insights ? `<ul>${insights}</ul>` : ''}
        ${actions ? `<div class="admin-ai-actions">${actions}</div>` : ''}
        <small>${escapeHtml(provider)}</small>
      </article>
    `;

    output.querySelectorAll('[data-action-index]').forEach((button) => {
      button.addEventListener('click', () => applyAction(result.actions[Number(button.dataset.actionIndex)]));
    });
  };

  const runAi = async () => {
    const prompt = textarea.value.trim();
    if (!prompt) {
      textarea.focus();
      return;
    }

    setLoading(true);
    output.innerHTML = '<div class="admin-ai-wait">AI-ul lucreaza...</div>';

    try {
      const response = await fetch('/admin/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mode: detectMode(prompt), prompt, page: window.location.hash || '#dashboard' }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'AI-ul nu a raspuns.');
      renderResult(result);
    } catch (error) {
      output.innerHTML = `<div class="admin-ai-error">${escapeHtml(error.message || 'A aparut o eroare.')}</div>`;
    } finally {
      setLoading(false);
    }
  };

  launcher.addEventListener('click', openPanel);
  close.addEventListener('click', closePanel);

  widget.querySelectorAll('[data-ai-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      textarea.value = button.dataset.aiPrompt;
      openPanel();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runAi();
  });
});
