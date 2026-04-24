const roMonths = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];

function reportStats(report, commissionOverride) {
  const monthly = roMonths.map((name, index) => ({ name, index, count: 0 }));
  for (const seminar of report.seminars || []) {
    if (!seminar.date) continue;
    const monthIndex = new Date(seminar.date).getMonth();
    if (monthly[monthIndex]) monthly[monthIndex].count += 1;
  }
  const total = (report.seminars || []).length;
  const commission = Number(commissionOverride ?? report.trainer?.commissionPerSeminar ?? 0) || 0;
  return { monthly, total, commission, paymentTotal: total * commission };
}

module.exports = { reportStats, roMonths };
