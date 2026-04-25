const express = require('express');
const User = require('../models/User');
const Report = require('../models/Report');
const { requireAdmin } = require('../utils/auth');

const router = express.Router();

router.use(requireAdmin);

const DEFAULT_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
const OPENAI_TIMEOUT_MS = 20000;

function asDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseDateFromText(text, label) {
  const source = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const labelMatch = label
    ? source.match(new RegExp(`${label}\\s*[:=-]?\\s*(\\d{1,2})[.\\-/](\\d{1,2})[.\\-/](\\d{4})`, 'i'))
    : null;
  const match = labelMatch || (!label ? source.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/) : null);
  if (!match) return '';
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseDateRange(text) {
  const source = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const matches = Array.from(source.matchAll(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/g));
  const toDateKey = (match) => {
    if (!match) return '';
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  return {
    startDate: parseDateFromText(source, 'start|inceput') || toDateKey(matches[0]),
    endDate: parseDateFromText(source, 'final|sfarsit') || toDateKey(matches[1]),
  };
}

function parseNamesFromText(text) {
  const listMatch = String(text || '').match(/(?:cursanti|lista|participanti)\s*[:=-]\s*([\s\S]+)/i);
  if (!listMatch) return [];

  return listMatch[1]
    .split(/\n|,|;/)
    .map((line) => line.replace(/^\s*[-*0-9.)]+\s*/, '').trim())
    .filter((line) => line.length > 4 && !/^(trainer|titlu|curs|filiala|data|perioada|note|observatii)\b/i.test(line))
    .slice(0, 80);
}

function buildReportDraft(prompt, trainers) {
  const text = String(prompt || '');
  const lower = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const trainer = trainers.find((item) => lower.includes(normalize(item.name)))
    || trainers.find((item) => lower.includes(normalize(item.location)))
    || trainers[0];

  const titleMatch = text.match(/(?:titlu|curs|raport)\s*[:=-]\s*([^\n.]+)/i);
  const locationMatch = text.match(/(?:filiala|locatie)\s*[:=-]\s*([^\n,;]+)/i);
  const names = parseNamesFromText(text);
  const dateRange = parseDateRange(text);

  return {
    trainerId: trainer?._id ? String(trainer._id) : '',
    title: titleMatch?.[1]?.trim() || '',
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    location: locationMatch?.[1]?.trim() || trainer?.location || '',
    traineesText: names.join('\n'),
    adminNotes: text.length > 20 ? `Generat din cererea AI: ${text.slice(0, 500)}` : '',
  };
}

function compactReport(report) {
  return {
    id: String(report._id),
    title: report.title,
    trainer: report.trainer?.name || '',
    trainerId: String(report.trainer?._id || report.trainer || ''),
    location: report.location || report.trainer?.location || '',
    status: report.status,
    startDate: asDateKey(report.startDate),
    endDate: asDateKey(report.endDate),
    trainees: report.trainees?.length || 0,
    seminars: report.seminars?.length || 0,
    updatedAt: asDateKey(report.updatedAt),
  };
}

function buildContext(trainers, reports) {
  const activeReports = reports.filter((report) => report.status === 'active');
  const finalizedReports = reports.filter((report) => report.status === 'finalized');
  const emptyReports = reports.filter((report) => !report.seminars?.length);
  const missingDates = reports.filter((report) => !report.startDate || !report.endDate);
  const totalSeminars = reports.reduce((sum, report) => sum + (report.seminars?.length || 0), 0);
  const trainerTotals = trainers.map((trainer) => {
    const assignedReports = reports.filter((report) => String(report.trainer?._id || report.trainer) === String(trainer._id));
    return {
      id: String(trainer._id),
      name: trainer.name,
      location: trainer.location || '',
      active: trainer.active,
      reports: assignedReports.length,
      seminars: assignedReports.reduce((sum, report) => sum + (report.seminars?.length || 0), 0),
    };
  });

  return {
    totals: {
      trainers: trainers.length,
      reports: reports.length,
      activeReports: activeReports.length,
      finalizedReports: finalizedReports.length,
      totalSeminars,
      emptyReports: emptyReports.length,
      missingDates: missingDates.length,
    },
    trainers: trainerTotals,
    reports: reports.slice(0, 80).map(compactReport),
    needsAttention: {
      emptyReports: emptyReports.slice(0, 12).map(compactReport),
      missingDates: missingDates.slice(0, 12).map(compactReport),
    },
  };
}

function localAssistant({ mode, prompt, context, trainers }) {
  const actions = [];
  const insights = [];
  let answer = '';

  if (mode === 'report-draft') {
    const draft = buildReportDraft(prompt, trainers);
    actions.push({
      type: 'fill_report_form',
      label: 'Completeaza formularul de raport',
      payload: draft,
    });
    actions.push({ type: 'go_to_tab', label: 'Deschide tabul Rapoarte', payload: { hash: 'genereaza-raport' } });
    answer = draft.title
      ? `Am pregatit un draft pentru raportul "${draft.title}". Am completat doar campurile pe care le-am putut identifica sigur.`
      : 'Am pregatit formularul de raport cu ce am putut extrage sigur. Completeaza manual campurile care lipsesc.';
    if (!draft.traineesText) insights.push('Nu am completat lista cursantilor fiindca nu ai inclus o lista explicita de nume.');
  } else if (mode === 'accounting') {
    const busiest = [...context.trainers].sort((a, b) => b.seminars - a.seminars).slice(0, 3);
    insights.push(...busiest.map((trainer) => `${trainer.name}: ${trainer.seminars} seminarii in ${trainer.reports} rapoarte.`));
    actions.push({ type: 'go_to_tab', label: 'Deschide Contabilitate', payload: { hash: 'contabilitate' } });
    answer = `Total contabilitate: ${context.totals.totalSeminars} seminarii, ${context.totals.finalizedReports} rapoarte finalizate si ${context.totals.activeReports} active.`;
  } else if (mode === 'quality') {
    insights.push(`${context.totals.emptyReports} rapoarte nu au inca seminarii completate.`);
    insights.push(`${context.totals.missingDates} rapoarte au perioada incompleta.`);
    if (context.needsAttention.emptyReports[0]) {
      actions.push({
        type: 'open_report',
        label: `Deschide primul raport fara seminarii: ${context.needsAttention.emptyReports[0].title}`,
        payload: { reportId: context.needsAttention.emptyReports[0].id },
      });
    }
    answer = 'Am verificat rapoartele si am gasit punctele care merita revizuite inainte de contabilitate.';
  } else {
    insights.push(`Ai ${context.totals.trainers} traineri si ${context.totals.reports} rapoarte in sistem.`);
    insights.push(`Sunt ${context.totals.activeReports} rapoarte active si ${context.totals.finalizedReports} finalizate.`);
    actions.push({ type: 'go_to_tab', label: 'Mergi la Rapoarte generate', payload: { hash: 'rapoarte-generate' } });
    answer = 'Pot completa rapoarte, analiza contabilitatea, verifica probleme in rapoarte si ghida actiuni in pagina admin.';
  }

  return { answer, insights, actions, provider: 'local' };
}

function publicOpenAiError(error) {
  const message = String(error?.message || error || '');
  if (/401|invalid_api_key|Incorrect API key/i.test(message)) return 'Cheia OpenAI nu este valida sau nu a fost salvata corect in Render.';
  if (/429|quota|billing|insufficient_quota/i.test(message)) return 'OpenAI a refuzat cererea din cauza limitei, creditelor sau billing-ului.';
  if (/model|does not exist|not have access/i.test(message)) return `Modelul ${DEFAULT_MODEL} nu este disponibil pentru cheia ta OpenAI.`;
  if (/timeout|aborted/i.test(message)) return 'OpenAI nu a raspuns in timp util.';
  return 'OpenAI a refuzat cererea. Verifica Logs in Render pentru detalii.';
}

function normalizeAiPayload(payload, extra = {}) {
  return {
    answer: String(payload.answer || '').slice(0, 1600),
    insights: Array.isArray(payload.insights) ? payload.insights.map(String).slice(0, 8) : [],
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 6) : [],
    provider: payload.provider || 'openai',
    fallbackReason: extra.fallbackReason || payload.fallbackReason || '',
  };
}

async function askOpenAi({ mode, prompt, context }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;

  const instructions = [
    'Esti AI operator pentru pagina /admin Reflexovital.',
    'Raspunzi in romana, concis, cu actiuni concrete pentru administrator.',
    'Nu propune actiuni distructive automate. Stergerea, finalizarea si modificarile sensibile raman facute manual de admin.',
    'Returneaza strict JSON valid cu cheile: answer, insights, actions.',
    'actions poate contine doar tipurile: go_to_tab, fill_report_form, open_report, set_accounting_filters.',
    'Pentru fill_report_form foloseste payload cu trainerId, title, startDate, endDate, location, traineesText, adminNotes.',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      instructions,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({ mode, prompt, context }).slice(0, 18000),
            },
          ],
        },
      ],
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message.slice(0, 500));
  }

  const data = await response.json();
  const text = data.output_text
    || data.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('\n')
    || '';
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  return normalizeAiPayload(JSON.parse(jsonText), { fallbackReason: '' });
}

router.post('/', async (req, res) => {
  try {
    const mode = String(req.body.mode || 'general');
    const prompt = String(req.body.prompt || '').slice(0, 4000);
    const trainers = await User.find({ role: 'trainer' }).sort({ active: -1, name: 1 });
    const reports = await Report.find().populate('trainer').sort({ updatedAt: -1 }).limit(250);
    const context = buildContext(trainers, reports);

    let result = null;
    try {
      result = await askOpenAi({ mode, prompt, context });
    } catch (error) {
      console.error('Admin AI unavailable:', error.message);
      return res.status(503).json({ ok: false, message: publicOpenAiError(error) });
    }

    if (!result) {
      return res.status(503).json({
        ok: false,
        message: 'AI-ul avansat nu este activ. Lipseste OPENAI_API_KEY din Render sau serviciul nu a fost redeploy-at dupa salvare.',
      });
    }

    res.json({
      ok: true,
      ...normalizeAiPayload(result),
      model: result.provider === 'openai' ? DEFAULT_MODEL : null,
    });
  } catch (error) {
    console.error('Admin AI error:', error);
    res.status(500).json({ ok: false, message: 'AI-ul nu a putut procesa cererea acum.' });
  }
});

module.exports = router;
