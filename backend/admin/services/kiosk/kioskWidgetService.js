const mongoose = require("mongoose");
const { KioskWidget } = require("@models/KioskWidget");
const { Kiosk } = require("@models/Kiosk");
const { AppError } = require("@services/_errors/AppError");
const {
  KioskWidgetType,
  KioskWidgetPlacement,
  KioskTextKind,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/staff/staffAccess");

const HOME_WIDGET_LIMIT = 8;
const HTTP_URL = /^https?:\/\//i;
const WIDGET_TYPES = Object.values(KioskWidgetType);
const TEXT_KINDS = Object.values(KioskTextKind);

const toOid = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError("invalid_id", 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const trimText = (value) =>
  value == null ? "" : String(value).trim();

const requireUrl = (value) => {
  const url = trimText(value);
  if (!url || !HTTP_URL.test(url)) {
    throw new AppError("invalid_kiosk_widget_url", 400);
  }
  return url;
};

const parseTextKind = (value) => {
  const kind = trimText(value) || KioskTextKind.PLAIN;
  if (!TEXT_KINDS.includes(kind)) {
    throw new AppError("invalid_kiosk_widget_text_kind", 400);
  }
  return kind;
};

const configForType = (type, config = {}) => {
  if (type === KioskWidgetType.IMAGE) {
    return {
      imageUrl: requireUrl(config.imageUrl || config.value),
      caption: trimText(config.caption),
    };
  }
  if (type === KioskWidgetType.QR) {
    return {
      url: requireUrl(config.url || config.value),
      caption: trimText(config.caption),
    };
  }
  if (type === KioskWidgetType.LINK) {
    return {
      url: requireUrl(config.url || config.value),
      label: trimText(config.label || config.caption),
    };
  }

  const body = trimText(config.body || config.value);
  if (!body) throw new AppError("kiosk_widget_text_required", 400);
  return { textKind: parseTextKind(config.textKind), body };
};

const parseWidget = (raw, index, { checkout = false } = {}) => {
  if (!raw || typeof raw !== "object") {
    throw new AppError("invalid_kiosk_widget", 400);
  }
  const type = trimText(raw.type);
  if (!WIDGET_TYPES.includes(type)) {
    throw new AppError("invalid_kiosk_widget_type", 400);
  }

  const source = { ...raw, ...(raw.config || {}) };
  const config = configForType(type, source);
  if (checkout) {
    config.showToVisitors = source.showToVisitors !== false;
    config.showToEmployees = Boolean(source.showToEmployees);
  }

  return {
    type,
    title: trimText(raw.title),
    config,
    sortOrder: Number.isFinite(Number(raw.sortOrder))
      ? Number(raw.sortOrder)
      : index + 1,
    active: raw.active !== false,
  };
};

const publicWidget = (row) => {
  if (!row) return null;
  return {
    _id: row._id,
    type: row.type,
    title: row.title || "",
    config: row.config || {},
    sortOrder: row.sortOrder,
    active: row.active !== false,
  };
};

const splitByPlacement = (rows) => {
  const homeWidgets = [];
  let checkoutWidget = null;
  for (const row of rows || []) {
    if (row.placement === KioskWidgetPlacement.CHECKOUT) {
      if (!checkoutWidget) checkoutWidget = publicWidget(row);
      continue;
    }
    homeWidgets.push(publicWidget(row));
  }
  return { homeWidgets, checkoutWidget };
};

const assertWidgetScope = async ({ actor, organizationId, branchId }) => {
  if (!branchId) throw new AppError("invalid_id", 400);
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId);
  assertMayManageStaff(standing, scoped || branchId);
  if (scoped && String(scoped) !== String(branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }
  await assertBranchInOrganization(branchId, organizationId);
};

const resolveKioskId = async ({ kioskId, branchId }) => {
  if (kioskId == null || kioskId === "" || kioskId === "all") return null;
  const id = toOid(kioskId);
  const kiosk = await Kiosk.findOne({ _id: id, branchId }).select("_id").lean();
  if (!kiosk) throw new AppError("kiosk_not_found", 404);
  return kiosk._id;
};

const widgetRowsPipeline = ({
  organizationId,
  branchId,
  kioskId,
  activeOnly = false,
}) => [
  {
    $match: {
      organizationId,
      branchId,
      ...(activeOnly ? { active: true } : {}),
    },
  },
  {
    $facet: {
      override: [
        { $match: kioskId ? { kioskId } : { _id: { $exists: false } } },
        { $sort: { sortOrder: 1 } },
      ],
      defaults: [{ $match: { kioskId: null } }, { $sort: { sortOrder: 1 } }],
    },
  },
];

const pickScopedRows = (result, kioskId) => {
  const override = result?.override || [];
  if (kioskId && override.length) {
    return { rows: override, inherited: false };
  }
  return { rows: result?.defaults || [], inherited: Boolean(kioskId) };
};

const listKioskWidgets = async ({
  actor,
  organizationId,
  branchId,
  kioskId,
}) => {
  await assertWidgetScope({ actor, organizationId, branchId });
  const orgOid = toOid(organizationId);
  const branchOid = toOid(branchId);
  const kioskOid = await resolveKioskId({ kioskId, branchId: branchOid });

  const [result] = await KioskWidget.aggregate(
    widgetRowsPipeline({
      organizationId: orgOid,
      branchId: branchOid,
      kioskId: kioskOid,
    })
  );
  const { rows, inherited } = pickScopedRows(result, kioskOid);
  return {
    branchId: branchOid,
    kioskId: kioskOid,
    inherited,
    ...splitByPlacement(rows),
  };
};

const replacePlacement = async ({
  organizationId,
  branchId,
  kioskId,
  placement,
  widgets,
}) => {
  const filter = {
    organizationId,
    branchId,
    kioskId,
    placement,
  };
  await KioskWidget.deleteMany(filter);
  if (!widgets.length) return;
  await KioskWidget.insertMany(
    widgets.map((widget) => ({
      ...widget,
      organizationId,
      branchId,
      kioskId,
      placement,
    }))
  );
};

const saveKioskWidgets = async ({
  actor,
  organizationId,
  branchId,
  kioskId,
  homeWidgets,
  checkoutWidget,
}) => {
  await assertWidgetScope({ actor, organizationId, branchId });
  const orgOid = toOid(organizationId);
  const branchOid = toOid(branchId);
  const kioskOid = await resolveKioskId({ kioskId, branchId: branchOid });

  const hasHome = Array.isArray(homeWidgets);
  const hasCheckout = checkoutWidget !== undefined;
  if (!hasHome && !hasCheckout) throw new AppError("nothing_to_update", 400);

  if (hasHome) {
    if (homeWidgets.length > HOME_WIDGET_LIMIT) {
      throw new AppError("kiosk_home_widget_limit", 400);
    }
    const parsed = homeWidgets.map((widget, index) => parseWidget(widget, index));
    await replacePlacement({
      organizationId: orgOid,
      branchId: branchOid,
      kioskId: kioskOid,
      placement: KioskWidgetPlacement.HOME,
      widgets: parsed,
    });
  }

  if (hasCheckout) {
    const parsed =
      checkoutWidget == null
        ? []
        : [parseWidget(checkoutWidget, 0, { checkout: true })];
    await replacePlacement({
      organizationId: orgOid,
      branchId: branchOid,
      kioskId: kioskOid,
      placement: KioskWidgetPlacement.CHECKOUT,
      widgets: parsed,
    });
  }

  return listKioskWidgets({
    actor,
    organizationId,
    branchId: branchOid,
    kioskId: kioskOid,
  });
};

const listKioskWidgetsForDevice = async ({ kiosk, organizationId }) => {
  const orgOid = toOid(organizationId);
  const branchOid = toOid(kiosk.branchId);
  const kioskOid = toOid(kiosk._id);

  const [result] = await KioskWidget.aggregate(
    widgetRowsPipeline({
      organizationId: orgOid,
      branchId: branchOid,
      kioskId: kioskOid,
      activeOnly: true,
    })
  );
  const { rows } = pickScopedRows(result, kioskOid);
  return splitByPlacement(rows);
};

module.exports = {
  listKioskWidgets,
  saveKioskWidgets,
  listKioskWidgetsForDevice,
};
