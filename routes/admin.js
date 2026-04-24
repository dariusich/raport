const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const User = require('../models/User');
const Report = require('../models/Report');
const { requireAdmin } = require('../utils/auth');
const { reportStats } = require('../utils/stats');

const router = express.Router();
router.use(requireAdmin);

function parseTrainees(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ name: line }));
}

router.get('/', async (req, res) => {
  const trainers = await User.find({ role: 'trainer' }).sort({ active: -1, name: 1 });
  const reports = await Report.find().populate('trainer').sort({ updatedAt: -1 }).limit(80);
  const totalSeminars = reports.reduce((sum, r) => sum + (r.seminars?.length || 0), 0);
  const activeReports = reports.filter((r) => r.status === 'active').length;
  const finalizedReports = reports.filter((r) => r.status === 'finalized').length;
  res.render('admin/index', { title: 'Admin', trainers, reports, totalSeminars, activeReports, finalizedReports });
});

router.post('/trainers', async (req, res) => {
  const { name, username, password, location, commissionPerSeminar } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await User.create({
      name,
      username: String(username).toLowerCase().trim(),
      passwordHash,
      role: 'trainer',
      location,
      commissionPerSeminar: Number(commissionPerSeminar || 0),
    });
    req.session.flash = { type: 'success', message: 'Trainer creat.' };
  } catch (error) {
    req.session.flash = { type: 'error', message: 'Nu am putut crea trainerul. Verifică userul să fie unic.' };
  }
  res.redirect('/admin#trainers');
});

router.post('/trainers/:id/toggle', async (req, res) => {
  const trainer = await User.findById(req.params.id);
  if (trainer && trainer.role === 'trainer') {
    trainer.active = !trainer.active;
    await trainer.save();
  }
  res.redirect('/admin#trainers');
});

router.post('/trainers/:id/password', async (req, res) => {
  const trainer = await User.findById(req.params.id);
  if (trainer && trainer.role === 'trainer' && req.body.password) {
    trainer.passwordHash = await bcrypt.hash(req.body.password, 10);
    await trainer.save();
    req.session.flash = { type: 'success', message: 'Parola a fost schimbată.' };
  }
  res.redirect('/admin#trainers');
});

router.post('/reports', async (req, res) => {
  const trainer = await User.findById(req.body.trainerId);
  if (!trainer) return res.redirect('/admin');
  await Report.create({
    title: req.body.title,
    trainer: trainer._id,
    location: req.body.location || trainer.location,
    startDate: req.body.startDate || undefined,
    endDate: req.body.endDate || undefined,
    trainees: parseTrainees(req.body.traineesText),
    adminNotes: req.body.adminNotes,
  });
  req.session.flash = { type: 'success', message: 'Raport alocat trainerului.' };
  res.redirect('/admin#reports');
});

router.get('/reports/:id', async (req, res) => {
  const report = await Report.findById(req.params.id).populate('trainer');
  if (!report) return res.status(404).render('404', { title: 'Raport negăsit' });
  const stats = reportStats(report);
  res.render('admin/report', { title: report.title, report, stats });
});

router.post('/reports/:id/commission', async (req, res) => {
  const report = await Report.findById(req.params.id).populate('trainer');
  if (!report) return res.redirect('/admin');
  const stats = reportStats(report, req.body.commission);
  res.render('admin/report', { title: report.title, report, stats, customCommission: Number(req.body.commission || 0) });
});

router.post('/reports/:id/status', async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (report) {
    report.status = req.body.status === 'active' ? 'active' : 'finalized';
    await report.save();
  }
  res.redirect(`/admin/reports/${req.params.id}`);
});

router.delete('/reports/:id', async (req, res) => {
  await Report.findByIdAndDelete(req.params.id);
  req.session.flash = { type: 'success', message: 'Raport șters.' };
  res.redirect('/admin#reports');
});

router.get('/reports/:id/export.xlsx', async (req, res) => {
  const report = await Report.findById(req.params.id).populate('trainer');
  if (!report) return res.redirect('/admin');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Raport');
  sheet.columns = [
    { header: 'Data', key: 'date', width: 14 },
    { header: 'Tema', key: 'topic', width: 28 },
    { header: 'Ore', key: 'hours', width: 8 },
    { header: 'Absenți', key: 'absents', width: 32 },
    { header: 'Probleme', key: 'issues', width: 32 },
    { header: 'Talentați', key: 'talents', width: 32 },
    { header: 'Observații', key: 'notes', width: 45 },
  ];
  sheet.getRow(1).font = { bold: true, size: 12 };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FF' } };

  for (const seminar of report.seminars) {
    sheet.addRow({
      date: seminar.date ? new Date(seminar.date).toLocaleDateString('ro-RO') : '',
      topic: seminar.topic,
      hours: seminar.hours,
      absents: seminar.absents.join(', '),
      issues: seminar.issues.join(', '),
      talents: seminar.talents.join(', '),
      notes: seminar.notes,
    });
  }

  const stats = reportStats(report);
  sheet.addRow([]);
  sheet.addRow(['Trainer', report.trainer.name]);
  sheet.addRow(['Filială', report.location]);
  sheet.addRow(['Total seminarii', stats.total]);
  sheet.addRow(['Comision/seminar', stats.commission]);
  sheet.addRow(['Total plată', stats.paymentTotal]);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="raport-${report._id}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
