const moment = require("moment-timezone");
const {
  RequirementCellStatus,
  RequirementAssignmentSource,
} = require("@models/domainEnums");

const addDays = (date, days) =>
  moment.utc(date).add(Number(days) || 0, "days").toDate();

const addMonths = (date, months) =>
  moment.utc(date).add(Number(months) || 0, "months").toDate();

const requirementApplies = (staff, requirement) => {
  const titles = requirement.appliesTo?.jobTitleIds || [];
  const departments = requirement.appliesTo?.departmentIds || [];
  if (!titles.length && !departments.length) return false;

  const titleOk =
    titles.length > 0 &&
    titles.some((id) => String(id) === String(staff.jobTitleId));
  const staffDepartments = (staff.departmentIds || []).map(String);
  const deptOk =
    departments.length > 0 &&
    departments.some((id) => staffDepartments.includes(String(id)));
  return titleOk || deptOk;
};

const assignmentSourceFor = (staff, requirement) => {
  const titles = requirement.appliesTo?.jobTitleIds || [];
  const departments = requirement.appliesTo?.departmentIds || [];
  const titleOk = titles.some((id) => String(id) === String(staff.jobTitleId));
  if (titleOk) return RequirementAssignmentSource.JOB_TITLE;
  const staffDepartments = (staff.departmentIds || []).map(String);
  const deptOk = departments.some((id) => staffDepartments.includes(String(id)));
  if (deptOk) return RequirementAssignmentSource.DEPARTMENT;
  return RequirementAssignmentSource.MANUAL;
};

const resolveDueDate = ({ assignment, latest, requirement }) => {
  if (latest?.expiresAt) return new Date(latest.expiresAt);
  if (assignment?.dueDate) return new Date(assignment.dueDate);
  const start = assignment?.assignedAt || requirement.createdAt;
  return addDays(start, requirement.firstCompletionDays);
};

const resolveAmberDays = (requirement, orgAmberDays) => {
  if (requirement.amberDaysOverride != null) return requirement.amberDaysOverride;
  if (orgAmberDays != null) return orgAmberDays;
  return null;
};

const cellFromDates = ({
  applies,
  assignment,
  latest,
  requirement,
  orgAmberDays,
  today = new Date(),
}) => {
  if (!assignment && !applies) {
    return {
      requirementId: requirement._id,
      status: RequirementCellStatus.NA,
      dueDate: null,
      completedAt: null,
      expiresAt: null,
      met: false,
      expected: false,
    };
  }

  const dueDate = resolveDueDate({ assignment, latest, requirement });
  const completedAt = latest?.completedAt || null;
  const expiresAt = latest?.expiresAt || null;
  const now = moment.utc(today);
  const due = moment.utc(dueDate);
  const amberDays = resolveAmberDays(requirement, orgAmberDays);

  let status = RequirementCellStatus.IN_PROGRESS;
  let met = false;

  if (now.isSameOrAfter(due)) {
    status = RequirementCellStatus.EXPIRED;
  } else if (latest) {
    if (
      amberDays != null &&
      now.isSameOrAfter(due.clone().subtract(amberDays, "days"))
    ) {
      status = RequirementCellStatus.DUE_SOON;
    } else {
      status = RequirementCellStatus.VALID;
    }
    met = true;
  }

  return {
    requirementId: requirement._id,
    status,
    dueDate,
    completedAt,
    expiresAt,
    met,
    expected: true,
  };
};

const trainingListStatus = (cell) => {
  if (cell.status === RequirementCellStatus.VALID) return "completed";
  if (cell.status === RequirementCellStatus.DUE_SOON) return "completed";
  if (cell.status === RequirementCellStatus.EXPIRED) return "expired";
  return "in_progress";
};

module.exports = {
  addDays,
  addMonths,
  requirementApplies,
  assignmentSourceFor,
  resolveDueDate,
  cellFromDates,
  trainingListStatus,
};
