document.addEventListener('DOMContentLoaded', () => {
  const accountingFilters = {
    trainer: document.querySelector('#accountingTrainerFilter') || document.querySelector('#accountingFilter'),
    location: document.querySelector('#accountingLocationFilter'),
    course: document.querySelector('#accountingCourseFilter'),
    year: document.querySelector('#accountingYearFilter'),
    month: document.querySelector('#accountingMonthFilter'),
  };

  const monthIndexFromDateKey = (dateKey) => {
    const [, monthNumber] = String(dateKey || '').split('-');
    return String(Number(monthNumber) - 1);
  };

  const dayMatchesFilters = (dayKey, yearValue, monthValue) => {
    const [year] = String(dayKey || '').split('-');
    const monthIndex = monthIndexFromDateKey(dayKey);
    return (yearValue === 'all' || year === yearValue) && (monthValue === 'all' || monthIndex === monthValue);
  };

  const updateAccounting = () => {
    const trainerValue = accountingFilters.trainer?.value || 'all';
    const locationValue = accountingFilters.location?.value || 'all';
    const courseValue = accountingFilters.course?.value || 'all';
    const yearValue = accountingFilters.year?.value || 'all';
    const monthValue = accountingFilters.month?.value || 'all';
    let filteredTotal = 0;

    document.querySelectorAll('[data-trainer-card]').forEach((card) => {
      const location = card.dataset.location || '';
      const trainerMatch = trainerValue === 'all' || card.dataset.trainerCard === trainerValue;
      const locationMatch = locationValue === 'all' || location.includes(locationValue);
      let cardVisibleTotal = 0;
      let hasVisibleCourse = false;

      const courseRows = Array.from(card.querySelectorAll('[data-course-name]'));

      courseRows.forEach((row) => {
        const courseName = row.dataset.courseName || '';
        const courseMatch = courseValue === 'all' || courseName === courseValue;
        const dayPoints = (row.dataset.coursePoints || '').split('|').filter(Boolean);
        const count = courseMatch ? dayPoints.filter((day) => dayMatchesFilters(day, yearValue, monthValue)).length : 0;

        const rowVisible = courseMatch && count > 0;
        row.style.display = rowVisible ? '' : 'none';
        row.dataset.visibleTotal = count;

        const strong = row.querySelector('strong');
        if (strong) strong.textContent = `${count} seminarii`;

        if (rowVisible) hasVisibleCourse = true;
        cardVisibleTotal += count;
      });

      const visible = trainerMatch && locationMatch && hasVisibleCourse;
      card.style.display = visible ? '' : 'none';
      card.dataset.visibleTotal = cardVisibleTotal;
      if (visible) filteredTotal += cardVisibleTotal;

      const strong = card.querySelector('.accounting-head strong');
      if (strong) strong.textContent = `${cardVisibleTotal} seminarii`;

      card.querySelectorAll('.month-chip').forEach((chip) => {
        const idx = chip.dataset.monthIndex;
        const monthCount = courseRows.reduce((sum, row) => {
          const courseName = row.dataset.courseName || '';
          if (courseValue !== 'all' && courseName !== courseValue) return sum;
          const dayPoints = (row.dataset.coursePoints || '').split('|').filter(Boolean);
          return sum + dayPoints.filter((day) => {
            const [year] = day.split('-');
            return (yearValue === 'all' || year === yearValue) && monthIndexFromDateKey(day) === idx;
          }).length;
        }, 0);
        const label = chip.textContent.split(':')[0];
        chip.innerHTML = `${label}: <b>${monthCount}</b>`;
        chip.classList.toggle('has-count', monthCount > 0);
      });

      const commission = card.querySelector('input[name="commission"]');
      const total = card.querySelector('[data-total]');
      if (commission && total) total.textContent = ((Number(commission.value) || 0) * cardVisibleTotal).toFixed(2) + ' lei';
    });

    const totalBox = document.querySelector('#filteredTotal');
    if (totalBox) totalBox.textContent = filteredTotal;
  };

  Object.values(accountingFilters).forEach((filter) => {
    if (filter) filter.addEventListener('change', updateAccounting);
  });
  updateAccounting();

  document.querySelectorAll('[data-trainer-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.trainerToggle;
      const body = document.getElementById('trainer-actions-' + id);
      if (!body) return;
      const isOpen = body.classList.toggle('open');
      button.classList.toggle('open', isOpen);
    });
  });

  const tabButtons = document.querySelectorAll('[data-tab-target]');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const subButtons = document.querySelectorAll('[data-subtab-target]');
  const subPanels = document.querySelectorAll('.subpanel');
  const adminHome = document.querySelector('[data-admin-home]');

  const setActiveSubtab = (id) => {
    if (!id || !document.getElementById(id)) return;
    subPanels.forEach((panel) => panel.classList.toggle('active', panel.id === id));
    subButtons.forEach((button) => button.classList.toggle('active', button.dataset.subtabTarget === id));
  };

  const setActiveTab = (id) => {
    const hashId = id || '';
    if (!hashId) {
      tabPanels.forEach((panel) => panel.classList.remove('active'));
      tabButtons.forEach((button) => button.classList.remove('active'));
      if (adminHome) adminHome.classList.remove('is-hidden');
      return;
    }
    const isReportsSubtab = ['genereaza-raport', 'rapoarte-generate'].includes(hashId);
    const targetId = isReportsSubtab ? 'rapoarte' : hashId;
    tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === targetId));
    tabButtons.forEach((button) => button.classList.toggle('active', button.dataset.tabTarget === targetId));
    if (adminHome) adminHome.classList.add('is-hidden');
    if (isReportsSubtab) setActiveSubtab(hashId);
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (tabButtons.length) {
    setActiveTab((window.location.hash || '').replace('#', ''));
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        window.location.hash = button.dataset.tabTarget;
        setActiveTab(button.dataset.tabTarget);
      });
    });
    window.addEventListener('hashchange', () => setActiveTab((window.location.hash || '').replace('#', '')));
  }

  subButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.subtabTarget;
      window.location.hash = id;
      setActiveTab(id);
    });
  });

  document.querySelectorAll('[data-multi-select]').forEach((details) => {
    const summary = details.querySelector('summary');
    const boxes = details.querySelectorAll('input[type="checkbox"]');
    const update = () => {
      const selected = Array.from(boxes).filter((box) => box.checked).map((box) => box.value);
      if (!selected.length) {
        summary.textContent = summary.dataset.default || 'Selectează';
      } else if (selected.length <= 2) {
        summary.textContent = selected.join(', ');
      } else {
        summary.textContent = `${selected.length} persoane selectate`;
      }
    };
    boxes.forEach((box) => box.addEventListener('change', update));
    update();
  });

  
  document.querySelectorAll('textarea[name="activity"], [name="activityConform"], [name="absents"], [name="issues"], [name="issuesDetails"], [name="roomState"], [name="brokenObjects"], [name="productsQuantity"], [name="mediaSent"], [name="talents"], [name="notes"]').forEach((el) => {
    el.required = false;
    el.removeAttribute('required');
  });

  document.querySelectorAll('.js-toggle-admin-seminar').forEach((button) => {
    button.addEventListener('click', () => {
      const row = document.getElementById(button.dataset.target);
      if (!row) return;
      row.classList.toggle('open');
      button.textContent = row.classList.contains('open') ? 'Închide' : 'Modifică';
    });
  });

  document.querySelectorAll('[data-user-menu]').forEach((menu) => {
    const button = menu.querySelector('[data-user-menu-button]');
    if (!button) return;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      document.querySelectorAll('[data-user-menu]').forEach((other) => {
        if (other !== menu) other.classList.remove('open');
      });
      menu.classList.toggle('open');
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('[data-user-menu]').forEach((menu) => menu.classList.remove('open'));
  });

  const showToast = (message, type = 'success') => {
    if (!message) return;
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 20);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  };

  const flash = document.querySelector('.flash');
  if (flash) {
    showToast(flash.textContent.trim(), flash.classList.contains('flash-error') ? 'error' : 'success');
    setTimeout(() => flash.remove(), 250);
  }

  document.querySelectorAll('.password-form').forEach((form) => {
    const input = form.querySelector('.password-input');
    const button = form.querySelector('.password-toggle');
    if (!input || !button) return;

    button.addEventListener('click', () => {
      if (input.classList.contains('is-hidden')) {
        input.classList.remove('is-hidden');
        input.focus();
        return;
      }

      if (!input.value.trim()) {
        showToast('Introdu parola nouă.', 'error');
        input.focus();
        return;
      }

      form.submit();
    });
  });

  const deleteTrainerModal = document.getElementById('deleteTrainerModal');
  const deleteTrainerText = document.getElementById('deleteTrainerText');
  const deleteTrainerConfirm = deleteTrainerModal?.querySelector('[data-modal-confirm]');
  const deleteTrainerCancel = deleteTrainerModal?.querySelector('[data-modal-cancel]');
  let pendingDeleteButton = null;

  const closeDeleteTrainerModal = () => {
    if (!deleteTrainerModal) return;
    deleteTrainerModal.classList.remove('open');
    deleteTrainerModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    pendingDeleteButton = null;
  };

  document.querySelectorAll('.js-delete-trainer').forEach((button) => {
    button.addEventListener('click', () => {
      pendingDeleteButton = button;
      const name = button.dataset.trainerName || 'acest trainer';
      if (deleteTrainerText) {
        deleteTrainerText.textContent = `Sigur vrei să ștergi trainerul ${name}? Se vor șterge și toate cursurile asociate lui.`;
      }
      deleteTrainerModal?.classList.add('open');
      deleteTrainerModal?.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    });
  });

  deleteTrainerCancel?.addEventListener('click', closeDeleteTrainerModal);
  deleteTrainerModal?.addEventListener('click', (event) => {
    if (event.target === deleteTrainerModal) closeDeleteTrainerModal();
  });

  deleteTrainerConfirm?.addEventListener('click', async () => {
    if (!pendingDeleteButton) return;
    const button = pendingDeleteButton;
    const url = button.dataset.deleteUrl;
    deleteTrainerConfirm.disabled = true;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || 'Nu am putut șterge trainerul.');

      button.closest('.trainer-accordion-item')?.remove();
      closeDeleteTrainerModal();
      showToast(result.message || 'Trainer șters.');
    } catch (error) {
      showToast(error.message || 'A apărut o eroare la ștergere.', 'error');
    } finally {
      deleteTrainerConfirm.disabled = false;
    }
  });

});
