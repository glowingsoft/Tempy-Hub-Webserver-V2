// models/ContactUs.js
const mongoose = require('mongoose');
const validator = require('validator');

const ContactUsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    default: "",
  },
  email: {
    type: String,
    required: [true, 'email_required'], // Generic error message key
    trim: true,
    validate: {
      validator: function (value) {
        return validator.isEmail(value);
      },
      message: 'email_invalid',
    },
  },
  phoneNumber: {
    type: String,
    trim: true,
    default: "",
  },
  description: {
    type: String,
    required: true,
    trim: true,
    default: "",
  },
  status: {
    type: String,
    enum: ['pending', 'responded', 'resolved', 'closed'],
    default: 'pending',
  },
}, {
  timestamps: true,
});

ContactUsSchema.index({ status: 1, createdAt: -1 });

const ContactUs = mongoose.model('ContactUs', ContactUsSchema);

module.exports = ContactUs;
