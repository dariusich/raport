document.addEventListener('DOMContentLoaded', () => {
  const accountingFilter = document.querySelector('#accountingFilter');
  if (accountingFilter) {
    accountingFilter.addEventListener('change', () => {
      const value = accountingFilter.value;
      document.querySelectorAll('[data-trainer-card]').forEach((card) => {
        card.style.display = value === 'all' || card.dataset.trainerCard === value ? '' : 'none';
      });
    });
  }

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
  });
});
