const express = require('express');
const Report = require('../models/Report');
const { requireTrainer } = require('../utils/auth');

const router = express.Router();
router.use(requireTrainer);

router.get('/', async (req, res) => {
  const reports = await Report.find({ trainer: req.session.user.id }).sort({ status: 1, createdAt: -1 });
  res.render('trainer/index', { title: 'Rapoartele mele', reports });
});

router.get('/reports/:id', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, trainer: req.session.user.id });
  if (!report) return res.status(404).render('404', { title: 'Raport negăsit' });
  res.render('trainer/report', { title: report.title, report });
});

router.post('/reports/:id/seminars', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, trainer: req.session.user.id });
  if (!report || report.status !== 'active') {
    req.session.flash = { type: 'error', message: 'Raportul nu poate fi editat.' };
    return res.redirect('/trainer');
  }

  const toArray = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  const startTime = String(req.body.startTime || '').trim();
  const endTime = String(req.body.endTime || '').trim();
  let hours = Number(req.body.hours || 0);

  if (!hours && startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (!Number.isNaN(sh) && !Number.isNaN(eh)) {
      const start = sh * 60 + (sm || 0);
      const end = eh * 60 + (em || 0);
      if (end > start) hours = Math.round(((end - start) / 60) * 100) / 100;
    }
  }

  report.seminars.push({
    date: req.body.date,
    startTime,
    endTime,
    hours,
    activity: req.body.activity,
    activityConform: req.body.activityConform,
    absents: toArray(req.body.absents),
    issues: toArray(req.body.issues),
    issuesDetails: req.body.issuesDetails,
    roomState: req.body.roomState,
    brokenObjects: req.body.brokenObjects,
    productsQuantity: req.body.productsQuantity,
    mediaSent: req.body.mediaSent,
    talents: toArray(req.body.talents),
    notes: req.body.notes,
  });

  await report.save();
  req.session.flash = { type: 'success', message: 'Seminar salvat.' };
  res.redirect(`/trainer/reports/${report._id}`);
});

router.post('/reports/:id/finalize', async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, trainer: req.session.user.id });
  if (!report) return res.redirect('/trainer');
  report.status = 'finalized';
  await report.save();
  req.session.flash = { type: 'success', message: 'Raport finalizat.' };
  res.redirect('/trainer');
});

module.exports = router;
