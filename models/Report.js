const mongoose = require('mongoose');

const traineeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const seminarSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    startTime: { type: String, trim: true, default: '' },
    endTime: { type: String, trim: true, default: '' },
    hours: { type: Number, default: 0 },
    activity: { type: String, trim: true, default: '' },
    activityConform: { type: String, enum: ['da', 'partial', 'nu', ''], default: '' },
    absents: [{ type: String, trim: true }],
    issues: [{ type: String, trim: true }],
    issuesDetails: { type: String, trim: true, default: '' },
    roomState: { type: String, trim: true, default: '' },
    brokenObjects: { type: String, trim: true, default: '' },
    productsQuantity: { type: String, enum: ['suficienta', 'insuficienta', ''], default: '' },
    mediaSent: { type: String, enum: ['da', 'nu', ''], default: '' },
    talents: [{ type: String, trim: true }],
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

const reportSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    trainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    location: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'finalized'], default: 'active' },
    startDate: { type: Date },
    endDate: { type: Date },
    trainees: [traineeSchema],
    seminars: [seminarSchema],
    adminNotes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Report', reportSchema);
