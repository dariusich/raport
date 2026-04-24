const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const multer = require('multer');
const mammoth = require('mammoth');
const User = require('../models/User');
const Report = require('../models/Report');
const { requireAdmin } = require('../utils/auth');
const { reportStats, roMonths } = require('../utils/stats');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(requireAdmin);

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseDateRo(value) {
  const match = String(value || '').match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (!match) return undefined;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function cleanName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/[0-9]/g, '')
    .replace(/\b(CNP|ADRESA|INITIAL|PAREN|CRT|NR)\b/gi, '')
    .trim();
}

function parseTrainees(text) {
  return normalizeText(text)
    .split('\n')
    .map((line) => cleanName(line))
    .filter((line) => line.length >= 5)
    .map((line) => ({ name: line }));
}

function parseNominalText(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const titleLine = lines.find((line) => /ocupația|ocupatia|programul/i.test(line)) || '';
  const seriaLine = lines.find((line) => /seria/i.test(line)) || '';
  const periodMatch = seriaLine.match(/(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})\s*[-–]\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/);

  let title = '';
  if (titleLine) {
    title = titleLine
      .replace(/^.*?(ocupația|ocupatia)\s+de\s+/i, '')
      .replace(/^.*?pentru\s+/i, '')
      .trim();
  }
  if (!title && lines[0]) title = lines[0].slice(0, 120);

  const trainees = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\d{1,3}$/.test(line)) {
      const candidate = cleanName(lines[i + 1]);
      if (
        candidate &&
        candidate.length >= 5 &&
        !/^(Nr|Numele|Inițialele|Initialele|CNP|Adres)/i.test(candidate) &&
        !trainees.some((t) => t.name === candidate)
      ) {
        trainees.push({ name: candidate });
      }
    }
  }

  return {
    title: title || '',
    startDate: periodMatch ? parseDateRo(periodMatch[1]) : undefined,
    endDate: periodMatch ? parseDateRo(periodMatch[2]) : undefined,
    trainees,
  };
}

function accountingByTrainer(trainers, reports) {
  return trainers.map((trainer) => {
    const trainerReports = reports.filter((report) => String(report.trainer?._id || report.trainer) === String(trainer._id));
    const monthly = roMonths.map((name, index) => ({ name, index, count: 0 }));
    let total = 0;

    for (const report of trainerReports) {
      for (const seminar of report.seminars || []) {
        if (!seminar.date) continue;
        const monthIndex = new Date(seminar.date).getMonth();
        if (monthly[monthIndex]) monthly[monthIndex].count += 1;
        total += 1;
      }
    }

    return { trainer, reports: trainerReports, monthly, total };
  });
}

router.get('/', async (req, res) => {
  const trainers = await User.find({ role: 'trainer' }).sort({ active: -1, name: 1 });
  const reports = await Report.find().populate('trainer').sort({ updatedAt: -1 }).limit(200);
  const totalSeminars = reports.reduce((sum, r) => sum + (r.seminars?.length || 0), 0);
  const activeReports = reports.filter((r) => r.status === 'active').length;
  const finalizedReports = reports.filter((r) => r.status === 'finalized').length;
  const accounting = accountingByTrainer(trainers, reports);

  res.render('admin/index', {
    title: 'Admin',
    trainers,
    reports,
    totalSeminars,
    activeReports,
    finalizedReports,
    accounting,
  });
});

router.post('/trainers', async (req, res) => {
  const { name, username, password, location } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await User.create({
      name,
      username: String(username).toLowerCase().trim(),
      passwordHash,
      role: 'trainer',
      location,
      commissionPerSeminar: 0,
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

router.post('/reports', upload.single('nominalDoc'), async (req, res) => {
  const trainer = await User.findById(req.body.trainerId);
  if (!trainer) return res.redirect('/admin');

  let imported = { title: '', trainees: [], startDate: undefined, endDate: undefined };
  if (req.file?.buffer) {
    try {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      imported = parseNominalText(result.value);
    } catch (error) {
      req.session.flash = { type: 'error', message: 'Nu am putut citi tabelul nominal din Word. Poți lipi cursanții manual.' };
      return res.redirect('/admin#reports');
    }
  }

  const manualTrainees = parseTrainees(req.body.traineesText);
  const trainees = imported.trainees.length ? imported.trainees : manualTrainees;

  await Report.create({
    title: req.body.title || imported.title || 'Raport curs',
    trainer: trainer._id,
    location: req.body.location || trainer.location,
    startDate: req.body.startDate || imported.startDate || undefined,
    endDate: req.body.endDate || imported.endDate || undefined,
    trainees,
    adminNotes: req.body.adminNotes,
  });

  req.session.flash = {
    type: 'success',
    message: imported.trainees.length
      ? `Raport alocat. Am importat ${imported.trainees.length} cursanți din tabelul nominal.`
      : 'Raport alocat trainerului.',
  };
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
    { header: 'Ore început-final', key: 'interval', width: 18 },
    { header: 'Activitate conform programei', key: 'activity', width: 34 },
    { header: 'Conform', key: 'activityConform', width: 12 },
    { header: 'Absenți', key: 'absents', width: 32 },
    { header: 'Cursanți cu probleme', key: 'issues', width: 36 },
    { header: 'Detalii probleme', key: 'issuesDetails', width: 42 },
    { header: 'Starea sălii', key: 'roomState', width: 30 },
    { header: 'Obiecte defecte / lipsă', key: 'brokenObjects', width: 34 },
    { header: 'Produse', key: 'productsQuantity', width: 16 },
    { header: 'Poze/filmulețe', key: 'mediaSent', width: 16 },
    { header: 'Talentați', key: 'talents', width: 32 },
    { header: 'Observații', key: 'notes', width: 45 },
  ];
  sheet.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4145A' } };

  for (const seminar of report.seminars) {
    sheet.addRow({
      date: seminar.date ? new Date(seminar.date).toLocaleDateString('ro-RO') : '',
      interval: `${seminar.startTime || ''}${seminar.endTime ? ' - ' + seminar.endTime : ''}`,
      activity: seminar.activity,
      activityConform: seminar.activityConform,
      absents: seminar.absents.join(', '),
      issues: seminar.issues.join(', '),
      issuesDetails: seminar.issuesDetails,
      roomState: seminar.roomState,
      brokenObjects: seminar.brokenObjects,
      productsQuantity: seminar.productsQuantity,
      mediaSent: seminar.mediaSent,
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
