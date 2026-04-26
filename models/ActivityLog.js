const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    actorName: { type: String, trim: true, default: '' },
    actorRole: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: 'rapoarte' },
    href: { type: String, trim: true, default: '' },
    targetType: { type: String, trim: true, default: '' },
    targetId: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ActivityLog', activityLogSchema);
