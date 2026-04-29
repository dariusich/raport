document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const themeToggleIcon = document.querySelector('[data-theme-toggle-icon]');
  const themeToggleLabel = document.querySelector('[data-theme-toggle-label]');
  const applyTheme = (theme) => {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    try {
      localStorage.setItem('rv-theme', nextTheme);
    } catch (error) {
      // Ignore storage errors in private browsing.
    }
    if (themeToggleIcon) themeToggleIcon.textContent = nextTheme === 'dark' ? '☀' : '☾';
    if (themeToggle) {
      const label = nextTheme === 'dark' ? 'Activeaza tema luminoasa' : 'Activeaza tema intunecata';
      themeToggle.setAttribute('aria-label', label);
      themeToggle.setAttribute('title', label);
    }
    if (themeToggleLabel) themeToggleLabel.textContent = '';
  };

  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  themeToggle?.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  const accountingFilters = {
    trainer: document.querySelector('#accountingTrainerFilter') || document.querySelector('#accountingFilter'),
    location: document.querySelector('#accountingLocationFilter'),
    course: document.querySelector('#accountingCourseFilter'),
    year: document.querySelector('#accountingYearFilter'),
    month: document.querySelector('#accountingMonthFilter'),
  };
  const accountingExportLink = document.querySelector('#accountingExportLink');

  const monthIndexFromDateKey = (dateKey) => {
    const [, monthNumber] = String(dateKey || '').split('-');
    return String(Number(monthNumber) - 1);
  };

  const dayMatchesFilters = (dayKey, yearValue, monthValue) => {
    const [year] = String(dayKey || '').split('-');
    const monthIndex = monthIndexFromDateKey(dayKey);
    return (yearValue === 'all' || year === yearValue) && (monthValue === 'all' || monthIndex === monthValue);
  };

  const updateAccountingCourseOptions = () => {
    const courseSelect = accountingFilters.course;
    if (!courseSelect) return;

    const currentValue = courseSelect.value || 'all';
    const trainerValue = accountingFilters.trainer?.value || 'all';
    const locationValue = accountingFilters.location?.value || 'all';
    const yearValue = accountingFilters.year?.value || 'all';
    const monthValue = accountingFilters.month?.value || 'all';
    const courses = new Map();

    document.querySelectorAll('[data-trainer-card]').forEach((card) => {
      const trainerMatch = trainerValue === 'all' || card.dataset.trainerCard === trainerValue;
      if (!trainerMatch) return;

      card.querySelectorAll('[data-course-name]').forEach((row) => {
        const courseLocation = row.dataset.courseLocation || '';
        const locationMatch = locationValue === 'all' || courseLocation === locationValue;
        if (!locationMatch) return;

        const dayPoints = (row.dataset.coursePoints || '').split('|').filter(Boolean);
        const count = dayPoints.filter((day) => dayMatchesFilters(day, yearValue, monthValue)).length;
        if (!count) return;

        const key = row.dataset.courseKey || row.dataset.courseName || '';
        if (!key) return;
        courses.set(key, row.dataset.courseName || key);
      });
    });

    courseSelect.innerHTML = '';
    courseSelect.append(new Option('Toate cursurile', 'all'));
    Array.from(courses.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'ro'))
      .forEach(([key, name]) => courseSelect.append(new Option(name, key)));

    courseSelect.value = courses.has(currentValue) ? currentValue : 'all';
  };

  const updateAccounting = () => {
    updateAccountingCourseOptions();
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
        const courseKey = row.dataset.courseKey || row.dataset.courseName || '';
        const courseMatch = courseValue === 'all' || courseKey === courseValue;
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
      if (strong) strong.textContent = `${cardVisibleTotal} ${cardVisibleTotal === 1 ? 'seminar' : 'seminarii'}`;

      card.querySelectorAll('.month-chip').forEach((chip) => {
        const idx = chip.dataset.monthIndex;
        const monthCount = courseRows.reduce((sum, row) => {
          const courseKey = row.dataset.courseKey || row.dataset.courseName || '';
          if (courseValue !== 'all' && courseKey !== courseValue) return sum;
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

    if (accountingExportLink) {
      const params = new URLSearchParams();
      Object.entries({
        trainer: trainerValue,
        location: locationValue,
        course: courseValue,
        year: yearValue,
        month: monthValue,
      }).forEach(([key, value]) => {
        if (value && value !== 'all') params.set(key, value);
      });
      accountingExportLink.href = `/admin/exports/accounting.xlsx${params.toString() ? `?${params.toString()}` : ''}`;
    }

    document.querySelectorAll('[data-trainer-export]').forEach((link) => {
      const params = new URLSearchParams();
      params.set('trainer', link.dataset.trainerExport);
      Object.entries({
        location: locationValue,
        course: courseValue,
        year: yearValue,
        month: monthValue,
      }).forEach(([key, value]) => {
        if (value && value !== 'all') params.set(key, value);
      });
      link.href = `/admin/exports/accounting.xlsx?${params.toString()}`;
    });
  };

  Object.values(accountingFilters).forEach((filter) => {
    if (filter) filter.addEventListener('change', updateAccounting);
  });
  updateAccounting();

  const reportDetail = document.querySelector('[data-admin-report-detail]');
  if (reportDetail) {
    const viewButtons = reportDetail.querySelectorAll('[data-admin-report-view]');
    const viewPanels = reportDetail.querySelectorAll('[data-admin-report-panel]');
    viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.adminReportView;
        viewButtons.forEach((item) => item.classList.toggle('active', item === button));
        viewPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.adminReportPanel === view));
      });
    });

    const monthPanels = Array.from(reportDetail.querySelectorAll('[data-admin-calendar-month]'));
    const monthTabs = Array.from(reportDetail.querySelectorAll('[data-admin-calendar-tab]'));
    let currentMonth = monthPanels.findIndex((panel) => panel.classList.contains('active'));
    if (currentMonth < 0) currentMonth = 0;
    const showMonth = (index) => {
      if (!monthPanels.length) return;
      currentMonth = Math.max(0, Math.min(index, monthPanels.length - 1));
      monthPanels.forEach((panel, idx) => panel.classList.toggle('active', idx === currentMonth));
      monthTabs.forEach((tab, idx) => tab.classList.toggle('active', idx === currentMonth));
    };
    monthTabs.forEach((tab) => {
      tab.addEventListener('click', () => showMonth(Number(tab.dataset.adminCalendarTab || 0)));
    });
    reportDetail.querySelector('[data-admin-calendar-prev]')?.addEventListener('click', () => showMonth(currentMonth - 1));
    reportDetail.querySelector('[data-admin-calendar-next]')?.addEventListener('click', () => showMonth(currentMonth + 1));

    reportDetail.querySelectorAll('[data-admin-seminar-select]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.adminSeminarSelect;
        reportDetail.querySelectorAll('[data-admin-seminar-select]').forEach((item) => item.classList.toggle('selected', item === button));
        reportDetail.querySelectorAll('[data-admin-seminar-detail]').forEach((detail) => {
          detail.classList.toggle('active', detail.dataset.adminSeminarDetail === id);
          detail.classList.remove('collapsed');
        });
        reportDetail.querySelector(`[data-admin-seminar-detail="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    reportDetail.querySelectorAll('[data-admin-detail-collapse]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = button.closest('[data-admin-seminar-detail]');
        if (!card) return;
        card.classList.toggle('collapsed');
        button.textContent = card.classList.contains('collapsed') ? '⌄' : '⌃';
      });
    });
  }

  document.querySelectorAll('[data-trainer-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.trainerToggle;
      const body = document.getElementById('trainer-actions-' + id);
      if (!body) return;
      const isOpen = body.classList.toggle('open');
      button.classList.toggle('open', isOpen);
    });
  });

  document.querySelectorAll('[data-accounting-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-trainer-card]');
      if (!card) return;
      const isOpen = card.classList.toggle('open');
      button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });

  const cropAvatarToSquare = (file, done) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = Math.min(image.width, image.height);
        const sourceX = Math.max(0, Math.round((image.width - size) / 2));
        const sourceY = Math.max(0, Math.round((image.height - size) * 0.22));
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 360;
        const context = canvas.getContext('2d');
        context.drawImage(image, sourceX, sourceY, size, size, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.86));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  document.querySelectorAll('[data-avatar-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const form = input.closest('form');
      const hidden = form?.querySelector('[data-avatar-data]');
      const preview = form?.querySelector('.trainer-avatar-preview');
      cropAvatarToSquare(file, (dataUrl) => {
        if (hidden) hidden.value = dataUrl;
        if (preview) {
          preview.classList.add('has-image');
          preview.innerHTML = `<img src="${dataUrl}" alt="Avatar trainer">`;
        }
      });
    });
  });

  const adminReportSearch = document.querySelector('#adminReportSearch');
  const adminReportStatusFilter = document.querySelector('#adminReportStatusFilter');
  const adminReportSort = document.querySelector('#adminReportSort');
  const adminReportRows = Array.from(document.querySelectorAll('[data-report-row]'));

  const updateAdminReportRows = () => {
    const query = (adminReportSearch?.value || '').toLowerCase().trim();
    const status = adminReportStatusFilter?.value || 'all';
    const tbody = document.querySelector('#adminReportsTable tbody');

    adminReportRows.forEach((row) => {
      const matchesQuery = !query
        || row.dataset.title.includes(query)
        || row.dataset.trainer.includes(query)
        || row.dataset.location.includes(query);
      const matchesStatus = status === 'all' || row.dataset.status === status;
      row.style.display = matchesQuery && matchesStatus ? '' : 'none';
    });

    if (tbody) {
      const sortedRows = [...adminReportRows].sort((a, b) => {
        const sort = adminReportSort?.value || 'updated-desc';
        if (sort === 'title-asc') return a.dataset.title.localeCompare(b.dataset.title, 'ro');
        if (sort === 'trainer-asc') return a.dataset.trainer.localeCompare(b.dataset.trainer, 'ro');
        if (sort === 'seminars-desc') return Number(b.dataset.seminars || 0) - Number(a.dataset.seminars || 0);
        return Number(b.dataset.updated || 0) - Number(a.dataset.updated || 0);
      });
      sortedRows.forEach((row) => tbody.appendChild(row));
    }
  };

  [adminReportSearch, adminReportStatusFilter, adminReportSort].forEach((field) => {
    field?.addEventListener(field.tagName === 'INPUT' ? 'input' : 'change', updateAdminReportRows);
  });
  if (adminReportRows.length) updateAdminReportRows();

  const historySearch = document.querySelector('#historySearch');
  const historyRoleFilter = document.querySelector('#historyRoleFilter');
  const historyCategoryFilter = document.querySelector('#historyCategoryFilter');
  const historyRows = Array.from(document.querySelectorAll('[data-history-row]'));
  const historyNoResults = document.querySelector('#historyNoResults');

  const updateHistoryRows = () => {
    const query = (historySearch?.value || '').toLowerCase().trim();
    const role = historyRoleFilter?.value || 'all';
    const category = historyCategoryFilter?.value || 'all';
    let visibleCount = 0;

    historyRows.forEach((row) => {
      const matchesSearch = !query || (row.dataset.search || '').includes(query);
      const matchesRole = role === 'all' || row.dataset.role === role;
      const matchesCategory = category === 'all' || row.dataset.category === category;
      const visible = matchesSearch && matchesRole && matchesCategory;
      row.style.display = visible ? '' : 'none';
      if (visible) visibleCount += 1;
    });

    historyNoResults?.classList.toggle('is-hidden', visibleCount > 0);
  };

  [historySearch, historyRoleFilter, historyCategoryFilter].forEach((field) => {
    field?.addEventListener(field.tagName === 'INPUT' ? 'input' : 'change', updateHistoryRows);
  });
  if (historyRows.length) updateHistoryRows();

  const tabButtons = document.querySelectorAll('[data-tab-target]');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const subButtons = document.querySelectorAll('[data-subtab-target]');
  const subPanels = document.querySelectorAll('.subpanel');
  const adminHome = document.querySelector('[data-admin-home]');
  const topNavLinks = Array.from(document.querySelectorAll('.topnav a'));

  const setActiveTopNav = (section = '') => {
    const normalized = ['genereaza-raport', 'import-raport-vechi', 'rapoarte-generate'].includes(section) ? 'rapoarte' : section;
    const currentPath = window.location.pathname;

    topNavLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';
      let isActive = false;

      if (!normalized) {
        isActive = href === currentPath
          || (currentPath.startsWith('/admin') && href === '/admin')
          || (currentPath.startsWith('/trainer') && href === '/trainer');
      } else {
        isActive = href.includes(`#${normalized}`);
      }

      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

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
      setActiveTopNav('');
      return;
    }
    const isReportsSubtab = ['genereaza-raport', 'import-raport-vechi', 'rapoarte-generate'].includes(hashId);
    const effectiveHashId = hashId === 'rapoarte' ? 'rapoarte-generate' : hashId;
    const targetId = isReportsSubtab || hashId === 'rapoarte' ? 'rapoarte' : hashId;
    const targetPanel = Array.from(tabPanels).find((panel) => panel.id === targetId);
    if (!targetPanel) {
      tabPanels.forEach((panel) => panel.classList.remove('active'));
      tabButtons.forEach((button) => button.classList.remove('active'));
      if (adminHome) adminHome.classList.remove('is-hidden');
      setActiveTopNav('');
      document.getElementById(hashId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === targetId));
    tabButtons.forEach((button) => button.classList.toggle('active', button.dataset.tabTarget === targetId));
    if (adminHome) adminHome.classList.add('is-hidden');
    if (isReportsSubtab || hashId === 'rapoarte') setActiveSubtab(effectiveHashId);
    setActiveTopNav(targetId);
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
  } else {
    setActiveTopNav((window.location.hash || '').replace('#', ''));
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
