const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Shift } = require("@models/Shift");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { ShiftStatus, ShiftClaimStatus } = require("@models/domainEnums");

const DEFAULT_TZ = "Europe/London";
const BOOKED_STATUSES = [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED];

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const hoursLabel = (value) => `${round1(value)}h`;

const dayLabel = (value, tz) => moment.tz(value, tz).format("ddd D MMM");
const timeLabel = (value, tz) => moment.tz(value, tz).format("HH:mm");

/** "Thu 23 Oct · 15:00 – 23:00", or with the end day when the shift crosses midnight. */
const shiftLabelOf = (shift, tz) => {
  if (!shift?.startsAt || !shift?.endsAt) return "";
  const sameDay = moment
    .tz(shift.startsAt, tz)
    .isSame(moment.tz(shift.endsAt, tz), "day");
  const end = sameDay
    ? timeLabel(shift.endsAt, tz)
    : `${dayLabel(shift.endsAt, tz)} ${timeLabel(shift.endsAt, tz)}`;
  return `${dayLabel(shift.startsAt, tz)} · ${timeLabel(shift.startsAt, tz)} – ${end}`;
};

const idOf = (value) => (value?._id ?? value) && String(value?._id ?? value);

/**
 * Adds the fields the manager approval card needs (weekly hours, contract, label)
 * to claim rows from `claimDetailStages`. Existing fields are never changed.
 * Runs a fixed number of queries per page, not per row.
 */
const withClaimHours = async (claims) => {
  const rows = Array.isArray(claims) ? claims : [];
  if (!rows.length) return rows;

  const staffIds = [...new Set(rows.map((row) => idOf(row.staffId)).filter(Boolean))];
  const branchIds = [
    ...new Set(
      rows.map((row) => idOf(row.branchId) || idOf(row.shift?.branchId)).filter(Boolean),
    ),
  ];

  const [profiles, branches] = await Promise.all([
    StaffProfile.find({ _id: { $in: staffIds } })
      .select("contractedWeeklyHours")
      .lean(),
    Branch.find({ _id: { $in: branchIds } })
      .select("timezone")
      .lean(),
  ]);
  const contractOf = new Map(
    profiles.map((p) => [
      String(p._id),
      p.contractedWeeklyHours == null ? null : Number(p.contractedWeeklyHours),
    ]),
  );
  const tzOf = new Map(branches.map((b) => [String(b._id), b.timezone || DEFAULT_TZ]));

  // One ISO week per claim, in the claim's branch timezone.
  const plans = rows.map((row) => {
    const tz = tzOf.get(idOf(row.branchId) || idOf(row.shift?.branchId)) || DEFAULT_TZ;
    const shift = row.shift;
    if (!shift?.startsAt || !shift?.endsAt) return { tz, shift: null };
    const weekStart = moment.tz(shift.startsAt, tz).startOf("isoWeek");
    return {
      tz,
      shift,
      staffId: idOf(row.staffId),
      shiftId: idOf(row.shiftId),
      from: weekStart.toDate(),
      to: weekStart.clone().add(1, "week").toDate(),
    };
  });

  const windows = new Map();
  plans.forEach((plan) => {
    if (!plan.shift || !plan.staffId) return;
    windows.set(`${plan.staffId}|${plan.from.toISOString()}`, plan);
  });

  const booked = windows.size
    ? await Shift.find({
        status: { $in: BOOKED_STATUSES },
        $or: [...windows.values()].map((plan) => ({
          staffId: new mongoose.Types.ObjectId(plan.staffId),
          startsAt: { $gte: plan.from, $lt: plan.to },
        })),
      })
        .select("staffId startsAt endsAt")
        .lean()
    : [];

  return rows.map((row, index) => {
    const plan = plans[index];
    const contracted = contractOf.has(idOf(row.staffId))
      ? contractOf.get(idOf(row.staffId))
      : null;
    const contractedHours = {
      hours: contracted,
      label: contracted == null ? "" : hoursLabel(contracted),
    };
    const extra = {
      timeZone: plan.tz,
      shiftLabel: shiftLabelOf(plan.shift, plan.tz),
      contractedHours,
      canDecide: row.status === ShiftClaimStatus.PENDING,
    };

    if (!plan.shift) {
      return { ...row, ...extra, hoursThisWeek: null };
    }

    // The claimed shift is excluded here, so an approved claim is not counted twice.
    const bookedHours = booked
      .filter(
        (s) =>
          String(s.staffId) === plan.staffId &&
          String(s._id) !== plan.shiftId &&
          s.startsAt >= plan.from &&
          s.startsAt < plan.to,
      )
      .reduce((sum, s) => sum + (new Date(s.endsAt) - new Date(s.startsAt)) / 3600000, 0);
    const shiftHours =
      (new Date(plan.shift.endsAt) - new Date(plan.shift.startsAt)) / 3600000;
    const totalHours = bookedHours + shiftHours;

    return {
      ...row,
      ...extra,
      hoursThisWeek: {
        weekStart: plan.from,
        bookedHours: round1(bookedHours),
        shiftHours: round1(shiftHours),
        totalHours: round1(totalHours),
        label: hoursLabel(totalHours),
        overContract: contracted != null && totalHours > contracted,
      },
    };
  });
};

module.exports = { withClaimHours };
