const mongoose = require("mongoose");

// Define the NotificationTypes enum
const NotificationTypes = {
  NEW_MESSAGE: "newMessage",
  FAMILY_UPLOAD_APPROVED: "familyUploadApproved",
  FAMILY_NEW_POST: "familyNewPost",
  FAMILY_UPLOAD_REJECTED: "familyUploadRejected",
  FAMILY_NEWSLETTER: "familyNewsletter",
  FAMILY_GAZETTE: "familyGazette",
  FAMILY_GAZETTE_REMINDER: "familyGazetteReminder",
  FAMILY_VISIT: "familyVisit",
  FAMILY_JOIN_REQUEST: "familyJoinRequest",
  FAMILY_UPLOAD_PENDING: "familyUploadPending",
  FAMILY_ACCESS: "familyAccess",
  VISITOR_SURVEY: "visitorSurvey",
  SYSTEM: "system",
  REMINDER: "reminder",
  DOCUMENTS_UPDATE: "documentsUpdate",
  NEW_BOOKING: "newBooking",
  BOOKING_REQUEST: "BookingRequest",
  BOOKING_APPROVED: "bookingApproved",
  BOOKING_REJECTED: "bookingRejected",
  BOOKING_PICKED: "bookingPicked",
  BOOKING_COMPLETED: "bookingCompleted",
  BOOKING_CANCELED: "bookingCanceled",
  LEAVE_REQUEST_UPDATE: "leaveRequestUpdate",
  SHIFT_CLAIM_UPDATE: "shiftClaimUpdate",
  REQUIREMENT_ASSIGNED: "requirementAssigned",
  MEETING_BOOKED: "meetingBooked",
};

// Define the NotificationSchema
const NotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(NotificationTypes), // Reference the notification types enum
    required: true,
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference to the sender (optional)
    default: null,
  },
  objectId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  objectType: {
    type: String,
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference to the user for whom this notification is intended
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  body: {
    type: String,
    required: true,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Automatically update `updatedAt` field on modification
NotificationSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Export both Notification model and NotificationTypes enum
const NotificationExp = mongoose.model("Notification", NotificationSchema);
module.exports = {
  NotificationExp,
};
module.exports.NotificationTypes = NotificationTypes;
