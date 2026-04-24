const express = require('express');
const Report = require('../models/Report');
const { requireTrainer } = require('../utils/auth');

const router = express.Router();
router.use(requireTrainer);

const roMonths = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

const pad = (n) => String(n).padStart(2, '0');
const monthKeyFromDate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

const dateInputValue = (date) => {
  if (!date) return '';
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const dateDisplayValue = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' });
};

const wantsJson = (req) => req.xhr || String(req.headers.accept || '').includes('application/json');

const buildCourseMonths = (report) => {
  const start = report.startDate ? new Date(report.startDate) : null;
  const end = report.endDate ? new Date(report.endDate) : null;

  if (!start || Number.isNaN(start.getTime())) {
    const now = new Date();
    return [{ key: monthKeyFromDate(now), label: roMonths[now.getMonth()], year: now.getFullYear() }];
  }

  const last = end && !Number.isNaN(end.getTime()) ? end : start;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const finalMonth = new Date(last.getFullYear(), last.getMonth(), 1);
  const months = [];

  while (cursor <= finalMonth) {
    months.push({
      key: `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`,
      label: roMonths[cursor.getMonth()],
      year: cursor.getFullYear(),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
};

const toArray = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];

const calculateHours = (startTime, endTime) => {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return 0;
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  if (end <= start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
};

router.get('/', async (req, res) => {
  const reports = await Report.find({ trainer: req.session.user.id }).sort({ status: 1, startDate: 1, createdAt: -1 });
  res.render('trainer/index', { title: 'Rapoartele mele', reports, roMonths });
});

router.get('/reports/:id', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, trainer: req.session.user.id });
  if (!report) return res.status(404).render('404', { title: 'Raport negăsit' });

  const months = buildCourseMonths(report);
  const selectedMonth = req.query.month || '';
  const selectedSeminarId = String(req.query.seminar || '');
  const editMode = req.query.edit === '1';
  const showMonths = req.query.showMonths === '1';
  const saveSuccess = req.query.saved === '1';
  const savedDateDisplay = dateDisplayValue(req.query.savedDate || '');
  const selectedMonthInfo = selectedMonth ? months.find((m) => m.key === selectedMonth) || null : null;

  let seminarsInMonth = [];
  if (selectedMonth) {
    seminarsInMonth = report.seminars
      .filter((seminar) => monthKeyFromDate(seminar.date) === selectedMonth)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  const selectedSeminar = selectedSeminarId
    ? report.seminars.id(selectedSeminarId) || null
    : null;

  res.render('trainer/report', {
    title: report.title,
    report,
    months,
    selectedMonth,
    selectedMonthInfo,
    showMonths,
    saveSuccess,
    savedDateDisplay,
    seminarsInMonth,
    selectedSeminar,
    editMode,
    dateInputValue,
  });
});

router.post('/reports/:id/seminars', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, trainer: req.session.user.id });
  if (!report || report.status !== 'active') {
    if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Raportul nu poate fi editat.' });
    req.session.flash = { type: 'error', message: 'Raportul nu poate fi editat.' };
    return res.redirect('/trainer');
  }

  const startTime = String(req.body.startTime || '').trim();
  const endTime = String(req.body.endTime || '').trim();
  const date = req.body.date;
  const month = date ? date.slice(0, 7) : String(req.body.selectedMonth || '');
  const seminarId = String(req.body.seminarId || '');
  const payload = {
    date,
    startTime,
    endTime,
    hours: calculateHours(startTime, endTime),
    activity: req.body.activity,
    absents: toArray(req.body.absents),
    issues: toArray(req.body.issues),
    issuesDetails: req.body.issuesDetails,
    roomState: req.body.roomState,
    brokenObjects: req.body.brokenObjects,
    productsQuantity: req.body.productsQuantity,
    mediaSent: req.body.mediaSent,
    talents: toArray(req.body.talents),
    notes: req.body.notes,
  };

  if (seminarId) {
    const seminar = report.seminars.id(seminarId);
    if (seminar) {
      Object.assign(seminar, payload);
      await report.save();
      const savedDateText = dateDisplayValue(date);
      if (wantsJson(req)) {
        return res.json({ ok: true, message: `Seminarul din data ${savedDateText} a fost salvat cu succes!`, seminarId: String(seminar._id), date, savedDateDisplay: savedDateText, month });
      }
      req.session.flash = { type: 'success', message: 'Seminar modificat.' };
      return res.redirect(`/trainer/reports/${report._id}?month=${month}&seminar=${seminar._id}&saved=1&savedDate=${encodeURIComponent(date)}#save-success`);
    }
  }

  const seminar = report.seminars.create(payload);
  report.seminars.push(seminar);
  await report.save();
  const savedDateText = dateDisplayValue(date);
  if (wantsJson(req)) {
    return res.json({ ok: true, message: `Seminarul din data ${savedDateText} a fost salvat cu succes!`, seminarId: String(seminar._id), date, savedDateDisplay: savedDateText, month });
  }
  req.session.flash = { type: 'success', message: 'Seminar salvat.' };
  res.redirect(`/trainer/reports/${report._id}?month=${month}&saved=1&savedDate=${encodeURIComponent(date)}#save-success`);
});
router.post('/reports/:id/seminars/:seminarId/delete', async (req, res) => {
  const report = await Report.findOne({ 
    _id: req.params.id, 
    trainer: req.session.user.id 
  });

  if (!report) {
    req.session.flash = { type: 'error', message: 'Raport negăsit.' };
    return res.redirect('/trainer');
  }

  report.seminars.id(req.params.seminarId)?.deleteOne();
  await report.save();

  req.session.flash = { type: 'success', message: 'Seminar șters.' };

  res.redirect(`/trainer/reports/${report._id}?month=${req.query.month || ''}`);
});
module.exports = router;
