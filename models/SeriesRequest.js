const mongoose = require('mongoose');

const seriesRequestSchema = new mongoose.Schema(
  {
    trainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseName: { type: String, required: true, trim: true },
    startDate: { type: Date },
    endDate: { type: Date },
    location: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['open', 'resolved', 'rejected'], default: 'open' },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    adminNote: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SeriesRequest', seriesRequestSchema);
