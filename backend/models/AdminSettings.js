const mongoose = require('mongoose');

const adminSettingsSchema = new mongoose.Schema({
  terms_and_conditions: {
    type: String,
    trim: true,
  },
  about_us: {
    type: String,
    trim: true,
  },
  privacy_policy: {
    type: String,
    trim: true,
  },
  faqs: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

const AdminSettings = mongoose.model('AdminSettings', adminSettingsSchema);

module.exports = AdminSettings;
