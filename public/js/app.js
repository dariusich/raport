document.addEventListener('DOMContentLoaded', () => {
  const accountingFilters = {
    trainer: document.querySelector('#accountingTrainerFilter') || document.querySelector('#accountingFilter'),
    location: document.querySelector('#accountingLocationFilter'),
    year: document.querySelector('#accountingYearFilter'),
    month: document.querySelector('#accountingMonthFilter'),
  };

  const updateAccounting = () => {
    const trainerValue = accountingFilters.trainer?.value || 'all';
    const locationValue = accountingFilters.location?.value || 'all';
    const yearValue = accountingFilters.year?.value || 'all';
    const monthValue = accountingFilters.month?.value || 'all';
    let filteredTotal = 0;

    document.querySelectorAll('[data-trainer-card]').forEach((card) => {
      const points = (card.dataset.points || '').split('|').filter(Boolean);
      const location = card.dataset.location || '';
      const trainerMatch = trainerValue === 'all' || card.dataset.trainerCard === trainerValue;
      const locationMatch = locationValue === 'all' || location.includes(locationValue);
      const dateMatch = points.length === 0
        ? yearValue === 'all' && monthValue === 'all'
        : points.some((point) => {
          const [year, month] = point.split('-');
          return (yearValue === 'all' || year === yearValue) && (monthValue === 'all' || month === monthValue);
        });

      const visible = trainerMatch && locationMatch && dateMatch;
      card.style.display = visible ? '' : 'none';

      let visibleCount = Number(card.dataset.total || 0);
      if (visible && (yearValue !== 'all' || monthValue !== 'all')) {
        visibleCount = points.filter((point) => {
          const [year, month] = point.split('-');
          return (yearValue === 'all' || year === yearValue) && (monthValue === 'all' || month === monthValue);
        }).length;
      }
      card.dataset.visibleTotal = visibleCount;
      if (visible) filteredTotal += visibleCount;

      const strong = card.querySelector('.accounting-head strong');
      if (strong) strong.textContent = `${visibleCount} seminarii`;

      const commission = card.querySelector('input[name="commission"]');
      const total = card.querySelector('[data-total]');
      if (commission && total) total.textContent = ((Number(commission.value) || 0) * visibleCount).toFixed(2) + ' lei';
    });

    const totalBox = document.querySelector('#filteredTotal');
    if (totalBox) totalBox.textContent = filteredTotal;
  };

  Object.values(accountingFilters).forEach((filter) => {
    if (filter) filter.addEventListener('change', updateAccounting);
  });
  updateAccounting();

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
});
