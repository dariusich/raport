document.querySelectorAll('[data-table-search]').forEach((input) => {
  input.addEventListener('input', () => {
    const table = document.querySelector('[data-searchable]');
    const q = input.value.toLowerCase();
    table?.querySelectorAll('tbody tr').forEach((row) => {
      row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  });
});

document.querySelectorAll('[data-trainee-filter]').forEach((input) => {
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    document.querySelectorAll('[data-trainee-name]').forEach((el) => {
      el.style.display = el.dataset.traineeName.includes(q) ? '' : 'none';
    });
  });
});
