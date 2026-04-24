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
});
