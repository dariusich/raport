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

function seminarDayKey(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function calculateHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return 0;
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  if (end <= start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function validateSeminarPayload(body) {
  const errors = [];
  const date = String(body.date || '').trim();
  const startTime = String(body.startTime || '').trim();
  const endTime = String(body.endTime || '').trim();
  if (!date) errors.push('Data seminarului este obligatorie.');
  if (!startTime) errors.push('Ora de început este obligatorie.');
  if (!endTime) errors.push('Ora finală este obligatorie.');
  if (startTime && endTime && endTime <= startTime) errors.push('Ora finală trebuie să fie după ora de început.');
  return errors;
}

function accountingByTrainer(trainers, reports) {
  const currentYear = new Date().getFullYear();

  return trainers.map((trainer) => {
    const trainerReports = reports.filter((report) => String(report.trainer?._id || report.trainer) === String(trainer._id));
    const monthly = roMonths.map((name, index) => ({ name, index, count: 0 }));
    const byYear = new Map();
    const byYearMonth = new Map();
    const locations = new Set();
    const courseMap = new Map();

    for (const report of trainerReports) {
      if (report.location) locations.add(report.location);
      const courseTitle = report.title || 'Curs fără titlu';

      if (!courseMap.has(courseTitle)) {
        courseMap.set(courseTitle, {
          name: courseTitle,
          reportIds: new Set(),
          points: new Set(),
          byYear: new Map(),
          byYearMonth: new Map(),
        });
      }

      const course = courseMap.get(courseTitle);
      course.reportIds.add(String(report._id));

      for (const seminar of report.seminars || []) {
        const dayKey = seminarDayKey(seminar.date);
        if (!dayKey) continue;

        const date = new Date(dayKey + 'T00:00:00.000Z');
        const year = date.getUTCFullYear();
        const monthIndex = date.getUTCMonth();
        const yearMonthKey = year + '-' + monthIndex;
        const courseDayKey = courseTitle + '|' + dayKey;

        course.points.add(dayKey);
        course.byYear.set(year, course.byYear.get(year) || new Set());
        course.byYear.get(year).add(dayKey);
        course.byYearMonth.set(yearMonthKey, course.byYearMonth.get(yearMonthKey) || new Set());
        course.byYearMonth.get(yearMonthKey).add(dayKey);

        if (monthly[monthIndex]) monthly[monthIndex].count += 1;
        byYear.set(year, byYear.get(year) || new Set());
        byYear.get(year).add(courseDayKey);
        byYearMonth.set(yearMonthKey, byYearMonth.get(yearMonthKey) || new Set());
        byYearMonth.get(yearMonthKey).add(courseDayKey);
      }
    }

    const years = Array.from(byYear.keys()).sort((a, b) => b - a);
    const selectedYear = years.includes(currentYear) ? currentYear : years[0] || currentYear;
    const selectedYearMonthly = roMonths.map((name, index) => ({
      name,
      index,
      count: byYearMonth.get(selectedYear + '-' + index)?.size || 0,
    }));

    const courses = Array.from(courseMap.values()).map((course) => ({
      name: course.name,
      reportCount: course.reportIds.size,
      total: course.points.size,
      points: Array.from(course.points).sort(),
      byYear: Array.from(course.byYear.entries()).map(([year, days]) => ({ year, count: days.size })).sort((a, b) => b.year - a.year),
      selectedYearMonthly: roMonths.map((name, index) => ({
        name,
        index,
        count: course.byYearMonth.get(selectedYear + '-' + index)?.size || 0,
      })),
    })).sort((a, b) => a.name.localeCompare(b.name, 'ro'));

    const total = courses.reduce((sum, course) => sum + course.total, 0);

    return {
      trainer,
      reports: trainerReports,
      courses,
      monthly,
      selectedYearMonthly,
      byYear: Array.from(byYear.entries()).map(([year, days]) => ({ year, count: days.size })).sort((a, b) => b.year - a.year),
      years,
      locations: Array.from(locations),
      total,
    };
  });
}

router.get('/', async (req, res) => {
  const trainers = await User.find({ role: 'trainer' }).sort({ active: -1, name: 1 });
  const reports = await Report.find().populate('trainer').sort({ startDate: 1, title: 1 });
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

  res.redirect('/admin#traineri');
});

router.post('/trainers/:id/toggle', async (req, res) => {
  const trainer = await User.findById(req.params.id);
  if (trainer && trainer.role === 'trainer') {
    trainer.active = !trainer.active;
    await trainer.save();
  }
  res.redirect('/admin#traineri');
});

router.post('/trainers/:id/update', async (req, res) => {
  const trainer = await User.findById(req.params.id);
  if (!trainer || trainer.role !== 'trainer') {
    req.session.flash = { type: 'error', message: 'Trainerul nu a fost găsit.' };
    return res.redirect('/admin#traineri');
  }

  trainer.name = String(req.body.name || trainer.name).trim();
  trainer.username = String(req.body.username || trainer.username).toLowerCase().trim();
  trainer.location = String(req.body.location || '').trim();
  trainer.active = req.body.active === 'true';

  try {
    await trainer.save();
    req.session.flash = { type: 'success', message: 'Trainer actualizat.' };
  } catch (error) {
    req.session.flash = { type: 'error', message: 'Nu am putut actualiza trainerul. Verifică userul să fie unic.' };
  }

  res.redirect('/admin#traineri');
});

router.post('/trainers/:id/password', async (req, res) => {
  const trainer = await User.findById(req.params.id);
  if (trainer && trainer.role === 'trainer' && req.body.password) {
    trainer.passwordHash = await bcrypt.hash(req.body.password, 10);
    await trainer.save();
    req.session.flash = { type: 'success', message: 'Parola a fost schimbată.' };
  }
  res.redirect('/admin#traineri');
});

router.post('/trainers/:id/delete', async (req, res) => {
  const trainer = await User.findById(req.params.id);

  if (!trainer || trainer.role !== 'trainer') {
    if (req.accepts('json')) {
      return res.status(404).json({ ok: false, message: 'Trainerul nu a fost găsit.' });
    }
    req.session.flash = { type: 'error', message: 'Trainerul nu a fost găsit.' };
    return res.redirect('/admin#traineri');
  }

  const deletedReports = await Report.deleteMany({ trainer: trainer._id });
  await User.findByIdAndDelete(trainer._id);

  const message = `Trainer șters. Au fost șterse și ${deletedReports.deletedCount || 0} cursuri asociate.`;

  if (req.accepts('json')) {
    return res.json({ ok: true, message });
  }

  req.session.flash = { type: 'success', message };
  return res.redirect('/admin#traineri');
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
      return res.redirect('/admin#rapoarte');
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
  res.redirect('/admin#rapoarte');
});

router.get('/reports/:id', async (req, res) => {
  const report = await Report.findById(req.params.id).populate('trainer');
  if (!report) return res.status(404).render('404', { title: 'Raport negăsit' });
  const stats = reportStats(report);
  res.render('admin/report', { title: report.title, report, stats, customCommission: '' });
});


router.post('/reports/:id/seminars/:seminarId/update', async (req, res) => {
  const report = await Report.findById(req.params.id).populate('trainer');
  if (!report) {
    req.session.flash = { type: 'error', message: 'Raportul nu a fost găsit.' };
    return res.redirect('/admin#rapoarte-generate');
  }

  const seminar = report.seminars.id(req.params.seminarId);
  if (!seminar) {
    req.session.flash = { type: 'error', message: 'Seminarul nu a fost găsit.' };
    return res.redirect(`/admin/reports/${report._id}`);
  }

  const validationErrors = validateSeminarPayload(req.body);
  if (validationErrors.length) {
    req.session.flash = { type: 'error', message: validationErrors.join(' ') };
    return res.redirect(`/admin/reports/${report._id}`);
  }

  seminar.date = req.body.date;
  seminar.startTime = String(req.body.startTime || '').trim();
  seminar.endTime = String(req.body.endTime || '').trim();
  seminar.hours = calculateHours(seminar.startTime, seminar.endTime);
  seminar.activity = req.body.activity || '';
  seminar.absents = toArray(req.body.absents);
  seminar.issues = toArray(req.body.issues);
  seminar.issuesDetails = req.body.issuesDetails || '';
  seminar.roomState = req.body.roomState || '';
  seminar.brokenObjects = req.body.brokenObjects || '';
  seminar.productsQuantity = req.body.productsQuantity || '';
  seminar.mediaSent = req.body.mediaSent || '';
  seminar.talents = toArray(req.body.talents);
  seminar.notes = req.body.notes || '';

  await report.save();
  req.session.flash = { type: 'success', message: 'Seminar modificat.' };
  res.redirect(`/admin/reports/${report._id}`);
});

router.post('/reports/:id/seminars/:seminarId/delete', async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) {
    req.session.flash = { type: 'error', message: 'Raportul nu a fost găsit.' };
    return res.redirect('/admin#rapoarte-generate');
  }

  const seminar = report.seminars.id(req.params.seminarId);
  if (!seminar) {
    req.session.flash = { type: 'error', message: 'Seminarul nu a fost găsit.' };
    return res.redirect(`/admin/reports/${report._id}`);
  }

  seminar.deleteOne();
  await report.save();
  req.session.flash = { type: 'success', message: 'Seminar șters.' };
  res.redirect(`/admin/reports/${report._id}`);
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
    req.session.flash = { type: 'success', message: report.status === 'finalized' ? 'Seria a fost marcată ca finalizată.' : 'Seria a fost redeschisă.' };
  }
  const returnTo = req.body.returnTo || `/admin/reports/${req.params.id}`;
  res.redirect(returnTo);
});

router.post('/reports/:id/finalize', async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) {
    req.session.flash = { type: 'error', message: 'Seria nu a fost găsită.' };
    return res.redirect(req.body.returnTo || '/admin#rapoarte');
  }
  report.status = 'finalized';
  await report.save();
  req.session.flash = { type: 'success', message: `Seria „${report.title}” a fost marcată ca finalizată.` };
  res.redirect(req.body.returnTo || '/admin#rapoarte');
});

router.post('/reports/:id/delete', async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) {
    req.session.flash = { type: 'error', message: 'Seria nu a fost găsită.' };
    return res.redirect(req.body.returnTo || '/admin#rapoarte');
  }
  await Report.findByIdAndDelete(req.params.id);
  req.session.flash = { type: 'success', message: `Seria „${report.title}” a fost ștearsă.` };
  res.redirect(req.body.returnTo || '/admin#rapoarte');
});

router.delete('/reports/:id', async (req, res) => {
  await Report.findByIdAndDelete(req.params.id);
  req.session.flash = { type: 'success', message: 'Raport șters.' };
  res.redirect('/admin#rapoarte');
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


router.get('/exports/accounting.xlsx', async (req, res) => {
  const reports = await Report.find().populate('trainer').sort({ startDate: 1, title: 1 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contabilitate');
  sheet.columns = [
    { header: 'Trainer', key: 'trainer', width: 28 },
    { header: 'Filială', key: 'location', width: 18 },
    { header: 'Curs', key: 'course', width: 34 },
    { header: 'Data seminar', key: 'date', width: 16 },
    { header: 'Program', key: 'interval', width: 18 },
    { header: 'Ore', key: 'hours', width: 10 },
    { header: 'Status curs', key: 'status', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4145A' } };

  for (const report of reports) {
    for (const seminar of report.seminars || []) {
      sheet.addRow({
        trainer: report.trainer?.name || '-',
        location: report.location || report.trainer?.location || '-',
        course: report.title,
        date: seminar.date ? new Date(seminar.date).toLocaleDateString('ro-RO') : '',
        interval: `${seminar.startTime || ''}${seminar.endTime ? ' - ' + seminar.endTime : ''}`,
        hours: seminar.hours || '',
        status: report.status === 'finalized' ? 'finalizat' : 'activ',
      });
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="contabilitate-reflexovital.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
