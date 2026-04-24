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
  const setActiveTab = (id) => {
    const targetId = id || 'rapoarte';
    tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === targetId));
    tabButtons.forEach((button) => button.classList.toggle('active', button.dataset.tabTarget === targetId));
  };
  if (tabButtons.length) {
    setActiveTab((window.location.hash || '#rapoarte').replace('#', ''));
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        window.location.hash = button.dataset.tabTarget;
        setActiveTab(button.dataset.tabTarget);
      });
    });
    window.addEventListener('hashchange', () => setActiveTab((window.location.hash || '#rapoarte').replace('#', '')));
  }

  const subButtons = document.querySelectorAll('[data-subtab-target]');
  const subPanels = document.querySelectorAll('.subpanel');
  subButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.subtabTarget;
      subPanels.forEach((panel) => panel.classList.toggle('active', panel.id === id));
      subButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
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
});
