const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const multer = require('multer');
const mammoth = require('mammoth');
const User = require('../models/User');
const Report = require('../models/Report');
const SeriesRequest = require('../models/SeriesRequest');
const ActivityLog = require('../models/ActivityLog');
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

function formatDateRoShort(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ro-RO');
}

function reportPeriodLabel(report) {
  const start = formatDateRoShort(report.startDate);
  const end = formatDateRoShort(report.endDate);
  if (start && end) return `${start} - ${end}`;
  return start || end || '';
}

function reportTitleWithPeriod(report) {
  const title = report.title || 'Curs fără titlu';
  const period = reportPeriodLabel(report);
  return period ? `${title} · ${period}` : title;
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

function cellPlainValue(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    if (value.result !== undefined) return value.result instanceof Date ? value.result : String(value.result || '').trim();
    if (value.text) return String(value.text).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function parseExcelDate(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
  }
  const parsed = parseDateRo(value);
  if (parsed) return parsed;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function normalizeCellLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimePart(value) {
  const match = String(value || '').trim().match(/(\d{1,2})(?:[.:,](\d{1,2}))?/);
  if (!match) return '';
  const hour = Math.min(23, Number(match[1]));
  const minute = Math.min(59, Number(match[2] || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeRange(value) {
  const parts = String(value || '').split(/[\/\-\u2013\u2014]+/).map(normalizeTimePart).filter(Boolean);
  return { startTime: parts[0] || '', endTime: parts[1] || '' };
}

function splitLegacyNames(value, knownNames = []) {
  const text = normalizeText(value);
  if (!text) return [];
  const found = knownNames.filter((name) => text.toLowerCase().includes(name.toLowerCase()));
  if (found.length) return found;
  return text
    .split(/[,;\n]+/)
    .map((item) => cleanName(item))
    .filter((item) => item.length >= 3);
}

function normalizeLegacyEnum(value, type) {
  const text = normalizeCellLabel(value);
  if (!text) return '';
  if (type === 'products') {
    if (text.includes('insuf')) return 'insuficienta';
    if (text.includes('suf')) return 'suficienta';
  }
  if (type === 'media') {
    if (/\bda\b/.test(text)) return 'da';
    if (/\bnu\b/.test(text)) return 'nu';
  }
  return '';
}

async function parseLegacyWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = workbook.worksheets;
  if (!sheets.length) throw new Error('Fișierul Excel nu conține foi.');

  const firstSheet = sheets[0];
  const title = String(cellPlainValue(firstSheet.getCell(1, 2)) || cellPlainValue(firstSheet.getCell(1, 1)) || 'Raport importat').trim();
  const periodMatch = title.match(/(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})\s*[-–—]\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/);
  const startDate = periodMatch ? parseDateRo(periodMatch[1]) : undefined;
  const endDate = periodMatch ? parseDateRo(periodMatch[2]) : undefined;

  const trainees = [];
  for (let rowNumber = 1; rowNumber <= Math.min(firstSheet.rowCount, 40); rowNumber += 1) {
    const row = firstSheet.getRow(rowNumber);
    const indexValue = cellPlainValue(row.getCell(1));
    const name = cleanName(cellPlainValue(row.getCell(2)));
    const notes = [cellPlainValue(row.getCell(3)), cellPlainValue(row.getCell(4))].filter(Boolean).join(' · ');
    if (/^\d+(\.\d+)?$/.test(String(indexValue)) && name.length >= 5) {
      trainees.push({ name, notes });
    }
  }
  const knownNames = trainees.map((trainee) => trainee.name);

  const seminars = [];
  const rowLabels = {
    date: 'data',
    time: 'orele de inceput',
    activity: 'activitate desfasurata',
    issues: 'cursanti cu probleme',
    roomState: 'starea salii',
    brokenObjects: 'obiecte defecte',
    productsQuantity: 'cantitatea de produse',
    mediaSent: 'poze/filmulete',
    talents: 'numiti o persoana',
    notes: 'grad de satisfactie',
  };

  for (const sheet of sheets) {
    const rows = {};
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const label = normalizeCellLabel(cellPlainValue(sheet.getRow(rowNumber).getCell(1)));
      Object.entries(rowLabels).forEach(([key, needle]) => {
        if (!rows[key] && label.includes(needle)) rows[key] = rowNumber;
      });
    }
    if (!rows.date) continue;

    const lastColumn = sheet.columnCount || sheet.actualColumnCount || 40;
    for (let col = 2; col <= lastColumn; col += 1) {
      const date = parseExcelDate(cellPlainValue(sheet.getRow(rows.date).getCell(col)));
      if (!date) continue;
      const time = parseTimeRange(cellPlainValue(sheet.getRow(rows.time || 0).getCell(col)));
      const productsValue = cellPlainValue(sheet.getRow(rows.productsQuantity || 0).getCell(col));
      const mediaValue = cellPlainValue(sheet.getRow(rows.mediaSent || 0).getCell(col));
      seminars.push({
        date,
        startTime: time.startTime,
        endTime: time.endTime,
        hours: calculateHours(time.startTime, time.endTime),
        activity: cellPlainValue(sheet.getRow(rows.activity || 0).getCell(col)) || '',
        issues: splitLegacyNames(cellPlainValue(sheet.getRow(rows.issues || 0).getCell(col)), knownNames),
        issuesDetails: '',
        roomState: cellPlainValue(sheet.getRow(rows.roomState || 0).getCell(col)) || '',
        brokenObjects: cellPlainValue(sheet.getRow(rows.brokenObjects || 0).getCell(col)) || '',
        productsQuantity: normalizeLegacyEnum(productsValue, 'products'),
        mediaSent: normalizeLegacyEnum(mediaValue, 'media'),
        talents: splitLegacyNames(cellPlainValue(sheet.getRow(rows.talents || 0).getCell(col)), knownNames),
        notes: cellPlainValue(sheet.getRow(rows.notes || 0).getCell(col)) || '',
      });
    }
  }

  seminars.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { title, startDate, endDate, trainees, seminars, sheetNames: sheets.map((sheet) => sheet.name) };
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
      const courseKey = String(report._id);
      const courseTitle = reportTitleWithPeriod(report);

      if (!courseMap.has(courseKey)) {
        courseMap.set(courseKey, {
          key: courseKey,
          name: courseTitle,
          baseName: report.title || 'Curs fără titlu',
          period: reportPeriodLabel(report),
          report,
          reportIds: new Set(),
          points: new Set(),
          byYear: new Map(),
          byYearMonth: new Map(),
        });
      }

      const course = courseMap.get(courseKey);
      course.reportIds.add(String(report._id));

      for (const seminar of report.seminars || []) {
        const dayKey = seminarDayKey(seminar.date);
        if (!dayKey) continue;

        const date = new Date(dayKey + 'T00:00:00.000Z');
        const year = date.getUTCFullYear();
        const monthIndex = date.getUTCMonth();
        const yearMonthKey = year + '-' + monthIndex;
        const courseDayKey = courseKey + '|' + dayKey;

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
      key: course.key,
      name: course.name,
      baseName: course.baseName,
      period: course.period,
      report: course.report,
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

function relativeTimeRo(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'acum';
  if (minutes < 60) return `acum ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'acum o oră' : `acum ${hours} ore`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'ieri' : `acum ${days} zile`;
  return date.toLocaleDateString('ro-RO');
}

function formatActivity(log) {
  const actor = log.actorName || log.category || 'A';
  return {
    id: log._id,
    icon: actor.slice(0, 1).toUpperCase(),
    title: log.title,
    actorName: log.actorName,
    actorRole: log.actorRole,
    category: log.category,
    href: log.href,
    time: relativeTimeRo(log.createdAt),
    dateLabel: log.createdAt ? new Date(log.createdAt).toLocaleString('ro-RO') : '',
  };
}

async function logActivity(req, data) {
  const user = req.session.user || {};
  try {
    await ActivityLog.create({
      title: data.title,
      actorName: data.actorName || user.name || user.username || 'Administrator',
      actorRole: data.actorRole || user.role || 'admin',
      category: data.category || 'rapoarte',
      href: data.href || '',
      targetType: data.targetType || '',
      targetId: data.targetId ? String(data.targetId) : '',
    });
  } catch (error) {
    // Istoricul nu trebuie sa blocheze actiunea principala.
  }
}

router.get('/', async (req, res) => {
  const trainers = await User.find({ role: 'trainer' }).sort({ active: -1, name: 1 });
  const reports = await Report.find().populate('trainer').sort({ startDate: 1, title: 1 });
  const seriesRequests = await SeriesRequest.find().populate('trainer').sort({ status: 1, createdAt: -1 });
  const activityLogs = (await ActivityLog.find().sort({ createdAt: -1 }).limit(100)).map(formatActivity);
  const totalSeminars = reports.reduce((sum, r) => sum + (r.seminars?.length || 0), 0);
  const activeReports = reports.filter((r) => r.status === 'active').length;
  const finalizedReports = reports.filter((r) => r.status === 'finalized').length;
  const accounting = accountingByTrainer(trainers, reports);
  const openSeriesRequests = seriesRequests.filter((request) => request.status === 'open').length;
  const recentActivity = activityLogs.slice(0, 4);

  res.render('admin/index', {
    title: 'Admin',
    trainers,
    reports,
    totalSeminars,
    activeReports,
    finalizedReports,
    accounting,
    seriesRequests,
    openSeriesRequests,
    recentActivity,
    activityLogs,
  });
});

router.post('/activity/:id/delete', async (req, res) => {
  await ActivityLog.findByIdAndDelete(req.params.id);
  req.session.flash = { type: 'success', message: 'Intrarea din istoric a fost ștearsă.' };
  res.redirect('/admin#istoric');
});

router.post('/series-requests/:id/status', async (req, res) => {
  const request = await SeriesRequest.findById(req.params.id);
  if (!request) {
    req.session.flash = { type: 'error', message: 'Solicitarea nu a fost găsită.' };
    return res.redirect('/admin#solicitari-serii');
  }

  request.status = req.body.status === 'rejected' ? 'rejected' : 'resolved';
  request.adminNote = req.body.adminNote || '';
  request.resolvedAt = new Date();
  if (/^[a-f\d]{24}$/i.test(String(req.session.user.id || ''))) {
    request.resolvedBy = req.session.user.id;
  }
  await request.save();
  await logActivity(req, {
    title: `Solicitarea pentru ${request.courseName} a fost ${request.status === 'resolved' ? 'rezolvată' : 'respinsă'}`,
    category: 'solicitari',
    href: '/admin#solicitari-serii',
    targetType: 'SeriesRequest',
    targetId: request._id,
  });

  req.session.flash = {
    type: 'success',
    message: request.status === 'resolved' ? 'Solicitarea a fost marcată ca rezolvată.' : 'Solicitarea a fost respinsă.',
  };
  res.redirect('/admin#solicitari-serii');
});

router.post('/series-requests/:id/delete', async (req, res) => {
  const deleted = await SeriesRequest.findByIdAndDelete(req.params.id);
  if (deleted) {
    await logActivity(req, {
      title: `Solicitarea pentru ${deleted.courseName} a fost ștearsă definitiv`,
      category: 'solicitari',
      href: '/admin#istoric',
      targetType: 'SeriesRequest',
      targetId: deleted._id,
    });
  }
  req.session.flash = deleted
    ? { type: 'success', message: 'Solicitarea a fost ștearsă definitiv.' }
    : { type: 'error', message: 'Solicitarea nu a fost găsită.' };
  res.redirect('/admin#solicitari-serii');
});

router.post('/trainers', async (req, res) => {
  const { name, username, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const trainer = await User.create({
      name,
      username: String(username).toLowerCase().trim(),
      passwordHash,
      role: 'trainer',
      commissionPerSeminar: 0,
    });
    await logActivity(req, {
      title: `Trainerul ${trainer.name} a fost creat`,
      category: 'traineri',
      href: '/admin#traineri',
      targetType: 'User',
      targetId: trainer._id,
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
    await logActivity(req, {
      title: `Trainerul ${trainer.name} a fost ${trainer.active ? 'activat' : 'dezactivat'}`,
      category: 'traineri',
      href: '/admin#traineri',
      targetType: 'User',
      targetId: trainer._id,
    });
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
  trainer.active = req.body.active === 'true';

  try {
    await trainer.save();
    await logActivity(req, {
      title: `Trainerul ${trainer.name} a fost actualizat`,
      category: 'traineri',
      href: '/admin#traineri',
      targetType: 'User',
      targetId: trainer._id,
    });
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
    await logActivity(req, {
      title: `Parola trainerului ${trainer.name} a fost schimbată`,
      category: 'traineri',
      href: '/admin#traineri',
      targetType: 'User',
      targetId: trainer._id,
    });
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
  await logActivity(req, {
    title: `Trainerul ${trainer.name} a fost șters`,
    category: 'traineri',
    href: '/admin#traineri',
    targetType: 'User',
    targetId: trainer._id,
  });

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
  const reportLocation = String(req.body.location || '').trim();
  if (!reportLocation) {
    req.session.flash = { type: 'error', message: 'Alege filiala pentru seria alocată.' };
    return res.redirect('/admin#rapoarte');
  }

  const report = await Report.create({
    title: req.body.title || imported.title || 'Raport curs',
    trainer: trainer._id,
    location: reportLocation,
    startDate: req.body.startDate || imported.startDate || undefined,
    endDate: req.body.endDate || imported.endDate || undefined,
    trainees,
    adminNotes: req.body.adminNotes,
  });
  await logActivity(req, {
    title: `Raportul ${report.title} a fost alocat către ${trainer.name}`,
    category: 'rapoarte',
    href: `/admin/reports/${report._id}`,
    targetType: 'Report',
    targetId: report._id,
  });

  req.session.flash = {
    type: 'success',
    message: imported.trainees.length
      ? `Raport alocat. Am importat ${imported.trainees.length} cursanți din tabelul nominal.`
      : 'Raport alocat trainerului.',
  };
  res.redirect('/admin#rapoarte');
});

router.post('/legacy-import/preview', upload.single('legacyExcel'), async (req, res) => {
  const trainer = await User.findById(req.body.trainerId);
  if (!trainer) {
    req.session.flash = { type: 'error', message: 'Alege trainerul pentru import.' };
    return res.redirect('/admin#import-raport-vechi');
  }
  if (!req.file?.buffer) {
    req.session.flash = { type: 'error', message: 'Încarcă fișierul Excel vechi.' };
    return res.redirect('/admin#import-raport-vechi');
  }

  try {
    const parsed = await parseLegacyWorkbook(req.file.buffer);
    req.session.legacyImportDraft = {
      trainerId: String(trainer._id),
      parsed,
    };
    res.render('admin/legacy-import-preview', {
      title: 'Previzualizare import',
      trainer,
      parsed,
    });
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message || 'Nu am putut citi Excelul vechi.' };
    res.redirect('/admin#import-raport-vechi');
  }
});

router.post('/legacy-import/confirm', async (req, res) => {
  const draft = req.session.legacyImportDraft;
  if (!draft?.parsed || !draft.trainerId) {
    req.session.flash = { type: 'error', message: 'Importul a expirat. Încarcă din nou Excelul vechi.' };
    return res.redirect('/admin#import-raport-vechi');
  }

  const trainer = await User.findById(draft.trainerId);
  if (!trainer) {
    req.session.flash = { type: 'error', message: 'Trainerul selectat nu mai există.' };
    return res.redirect('/admin#import-raport-vechi');
  }

  const parsed = draft.parsed;
  const reportLocation = String(req.body.location || '').trim();
  if (!reportLocation) {
    req.session.flash = { type: 'error', message: 'Completează filiala seriei înainte de import.' };
    return res.redirect('/admin#import-raport-vechi');
  }

  const report = await Report.create({
    title: req.body.title || parsed.title || 'Raport importat',
    trainer: trainer._id,
    location: reportLocation,
    startDate: req.body.startDate || parsed.startDate || undefined,
    endDate: req.body.endDate || parsed.endDate || undefined,
    trainees: parsed.trainees || [],
    seminars: (parsed.seminars || []).map((seminar) => ({
      ...seminar,
      date: seminar.date,
      hours: calculateHours(seminar.startTime, seminar.endTime),
    })),
    adminNotes: `Importat din raport Excel vechi. Foi: ${(parsed.sheetNames || []).join(', ')}`,
  });
  await logActivity(req, {
    title: `Raportul vechi ${report.title} a fost importat pentru ${trainer.name}`,
    category: 'rapoarte',
    href: `/admin/reports/${report._id}`,
    targetType: 'Report',
    targetId: report._id,
  });

  delete req.session.legacyImportDraft;
  req.session.flash = { type: 'success', message: `Raport importat: ${report.seminars.length} seminarii și ${report.trainees.length} cursanți.` };
  res.redirect(`/admin/reports/${report._id}`);
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
  await logActivity(req, {
    title: `Seminar modificat în raportul ${report.title}`,
    category: 'rapoarte',
    href: `/admin/reports/${report._id}`,
    targetType: 'Report',
    targetId: report._id,
  });
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
  await logActivity(req, {
    title: `Seminar șters din raportul ${report.title}`,
    category: 'rapoarte',
    href: `/admin/reports/${report._id}`,
    targetType: 'Report',
    targetId: report._id,
  });
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
    await logActivity(req, {
      title: `Seria ${report.title} a fost ${report.status === 'finalized' ? 'finalizată' : 'redeschisă'}`,
      category: 'rapoarte',
      href: `/admin/reports/${report._id}`,
      targetType: 'Report',
      targetId: report._id,
    });
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
  await logActivity(req, {
    title: `Seria ${report.title} a fost marcată ca finalizată`,
    category: 'rapoarte',
    href: `/admin/reports/${report._id}`,
    targetType: 'Report',
    targetId: report._id,
  });
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
  await logActivity(req, {
    title: `Seria ${report.title} a fost ștearsă`,
    category: 'rapoarte',
    href: '/admin#rapoarte-generate',
    targetType: 'Report',
    targetId: report._id,
  });
  req.session.flash = { type: 'success', message: `Seria „${report.title}” a fost ștearsă.` };
  res.redirect(req.body.returnTo || '/admin#rapoarte');
});

router.delete('/reports/:id', async (req, res) => {
  const report = await Report.findByIdAndDelete(req.params.id);
  if (report) {
    await logActivity(req, {
      title: `Raportul ${report.title} a fost șters`,
      category: 'rapoarte',
      href: '/admin#rapoarte-generate',
      targetType: 'Report',
      targetId: report._id,
    });
  }
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
  const trainerFilter = String(req.query.trainer || 'all');
  const locationFilter = String(req.query.location || 'all');
  const courseFilter = String(req.query.course || 'all');
  const yearFilter = String(req.query.year || 'all');
  const monthFilter = String(req.query.month || 'all');
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
    const trainerId = String(report.trainer?._id || report.trainer || '');
    const location = report.location || '';
    if (trainerFilter !== 'all' && trainerId !== trainerFilter) continue;
    if (locationFilter !== 'all' && !location.includes(locationFilter)) continue;
    if (courseFilter !== 'all' && String(report._id) !== courseFilter) continue;

    for (const seminar of report.seminars || []) {
      const dayKey = seminarDayKey(seminar.date);
      if (!dayKey) continue;
      const [, monthNumber] = dayKey.split('-');
      const monthIndex = String(Number(monthNumber) - 1);
      if (yearFilter !== 'all' && !dayKey.startsWith(yearFilter + '-')) continue;
      if (monthFilter !== 'all' && monthIndex !== monthFilter) continue;

      sheet.addRow({
        trainer: report.trainer?.name || '-',
        location: location || '-',
        course: reportTitleWithPeriod(report),
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
