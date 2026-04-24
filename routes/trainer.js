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
    seminarsInMonth,
    selectedSeminar,
    editMode,
    dateInputValue,
  });
});

router.post('/reports/:id/seminars', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, trainer: req.session.user.id });
  if (!report || report.status !== 'active') {
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
      req.session.flash = { type: 'success', message: 'Seminar modificat.' };
      return res.redirect(`/trainer/reports/${report._id}?month=${month}&seminar=${seminar._id}`);
    }
  }

  report.seminars.push(payload);
  await report.save();
  req.session.flash = { type: 'success', message: 'Seminar salvat.' };
  res.redirect(`/trainer/reports/${report._id}?month=${month}`);
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
