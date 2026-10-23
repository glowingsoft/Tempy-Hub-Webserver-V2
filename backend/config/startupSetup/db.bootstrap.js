/**
 * DB Bootstrap – versioned, safe, internal-only admin creation
 */

const mongoose = require("mongoose");
const { User } = require("@models/UserModel");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { nameKeyOf } = require("@utils/nameKey");
const { Membership } = require("@models/Membership");
const {
    MembershipRole,
    MembershipRoleRank,
    ModuleSlug,
    OrganizationStatus,
    ActiveInactiveStatus,
} = require("@models/domainEnums");
const { ModuleDefinition } = require("@models/ModuleDefinition");
const { StaffProfile } = require("@models/StaffProfile");
const AdminSettings = require("@models/AdminSettings");

const BOOTSTRAP_VERSION = process.env.BOOTSTRAP_VERSION || 1; // Increment this to trigger bootstrap again
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const bootstrapSchema = new mongoose.Schema(
    { version: { type: Number, default: 1 } },
    { timestamps: true } 
);

const Bootstrap =
    mongoose.models.SystemBootstrap ||
    mongoose.model("SystemBootstrap", bootstrapSchema);

/**
 * `accountState.userType` is the platform axis, not a Tempy domain role:
 *   "admin" = Tempy platform operator (superAdmin), above every organization
 *   "user"  = everyone else; their real role lives in Membership.role
 *
 * Only the platform operator is seeded as a bare user. The demo owner is seeded
 * with an Organization and a Membership, because "owner" is a scoped role and is
 * meaningless without something to own.
 */
const BOOTSTRAP_USERS = [
    {
        envEmail: "BOOTSTRAP_SUPERADMIN_EMAIL",
        fallbackEnvEmail: "BOOTSTRAP_ADMIN_EMAIL",
        envPassword: "BOOTSTRAP_SUPERADMIN_PASSWORD",
        fallbackEnvPassword: "BOOTSTRAP_ADMIN_PASSWORD",
        name: "Platform Super Admin",
        userType: "admin",
    },
    {
        envEmail: "BOOTSTRAP_OWNER_EMAIL",
        envPassword: "BOOTSTRAP_OWNER_PASSWORD",
        name: "Demo Owner",
        userType: "user",
        membershipRole: MembershipRole.OWNER,
    },
];

const DEMO_ORG_NAME = process.env.BOOTSTRAP_ORG_NAME || "Demo Care Group";

/**
 * The sellable catalogue. `PUT /admin/organizations/:id/module-access` validates
 * slugs against this collection, so entitlements cannot be set until it exists.
 * Slugs mirror ModuleSlug and docs/discovery/2026-08-27-domain-schema.md §6.
 */
const MODULE_DEFINITIONS = [
    {
        slug: ModuleSlug.SIGN_IN_ATTENDANCE,
        name: "Sign-in & attendance",
        description:
            "Kiosk and phone clock-in, attendance days, and change requests.",
    },
    {
        slug: ModuleSlug.ROTA_SCHEDULING,
        name: "Rota & scheduling",
        description: "Shift planning and publication.",
    },
    {
        slug: ModuleSlug.FIRE_DRILL_EVACUATION,
        name: "Fire drill & evacuation",
        description: "Evacuation events, roll call, and assembly point checks.",
    },
    {
        slug: ModuleSlug.PEEP_FLOOR_PLAN,
        name: "PEEP & floor plans",
        description:
            "Personal emergency evacuation plans and site floor plans.",
    },
    {
        slug: ModuleSlug.RESIDENTS,
        name: "Residents",
        description:
            "Resident directory, rooms, and occupancy for a site.",
    },
    {
        slug: ModuleSlug.DOCUMENTS_ESIGN,
        name: "Documents & e-sign",
        description: "Versioned documents and signature capture.",
    },
    {
        slug: ModuleSlug.LEAVE,
        name: "Leave",
        description: "Leave entitlements and leave requests.",
    },
    {
        slug: ModuleSlug.SHIFT_BIDDING,
        name: "Shift bidding",
        description: "Open shifts, claims, and cover alerts.",
    },
    {
        slug: ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL,
        name: "Competency, supervision & appraisal",
        description: "Staff development records and review cycles.",
    },
    {
        slug: ModuleSlug.ONBOARDING_DBS,
        name: "Onboarding & DBS",
        description: "New starter onboarding and DBS checks.",
    },
    {
        slug: ModuleSlug.PAYROLL_FORECASTING,
        name: "Payroll & forecasting",
        description: "Payroll export and cost forecasting.",
    },
    {
        slug: ModuleSlug.VISITOR_COMMS,
        name: "Visitors & communications",
        description:
            "Resident media, visitor links, visit requests, and family messaging.",
    },
    {
        slug: ModuleSlug.AGENCY_SHIFT_BIDS,
        name: "Agency shift bids",
        description: "Agency worker sourcing and shift bids.",
    },
    {
        slug: ModuleSlug.FAMILY_ENGAGEMENT,
        name: "Family engagement",
        description:
            "Family overview, groups, community wall, newsletters, gazettes, and moderation.",
    },
];

async function enforceOneMembershipPerOrg() {
    const groups = await Membership.aggregate([
        { $match: { status: ActiveInactiveStatus.ACTIVE } },
        {
            $group: {
                _id: { userId: "$userId", organizationId: "$organizationId" },
                docs: { $push: { _id: "$_id", role: "$role" } },
                n: { $sum: 1 },
            },
        },
        { $match: { n: { $gt: 1 } } },
    ]);

    let inactivated = 0;
    for (const group of groups) {
        const ranked = [...group.docs].sort(
            (a, b) =>
                (MembershipRoleRank[b.role] || 0) -
                (MembershipRoleRank[a.role] || 0)
        );
        const drop = ranked.slice(1).map((row) => row._id);
        const result = await Membership.updateMany(
            { _id: { $in: drop } },
            { $set: { status: ActiveInactiveStatus.INACTIVE } }
        );
        inactivated += result.modifiedCount;
    }
    if (inactivated) {
        console.log(
            `✅ inactivated ${inactivated} duplicate membership(s) (one role per email per org)`
        );
    }

    for (const name of [
        "userId_1_organizationId_1_branchId_1",
        "userId_1_organizationId_1",
    ]) {
        try {
            await Membership.collection.dropIndex(name);
            console.log(`✅ dropped Membership.${name}`);
        } catch (dropErr) {
            if (dropErr?.codeName !== "IndexNotFound" && dropErr?.code !== 27) {
                console.warn(`⚠️ Membership ${name} drop:`, dropErr.message);
            }
        }
    }

    try {
        await Membership.syncIndexes();
    } catch (indexErr) {
        console.warn("⚠️ Membership index sync:", indexErr.message);
    }
}

async function ensureModuleCatalogue() {
    await ModuleDefinition.bulkWrite(
        MODULE_DEFINITIONS.map((definition) => ({
            updateOne: {
                filter: { slug: definition.slug },
                update: { $setOnInsert: { ...definition, active: true } },
                upsert: true,
            },
        }))
    );

    // Care-home directory: existing tenants keep Residents on so SM/LM
    // routes do not 403 until Owner turns the module off.
    await Organization.updateMany(
        { "moduleAccess.moduleSlug": { $ne: ModuleSlug.RESIDENTS } },
        {
            $push: {
                moduleAccess: {
                    moduleSlug: ModuleSlug.RESIDENTS,
                    enabled: true,
                    purchasedAt: new Date(),
                },
            },
        }
    );
}

async function ensureAttendanceDayIndexes() {
    const { AttendanceDay } = require("@models/AttendanceDay");
    try {
        const indexes = await AttendanceDay.collection.indexes();
        const workDateIdx = indexes.find((idx) => idx.name === "staffId_1_workDate_1");
        if (workDateIdx?.unique) {
            await AttendanceDay.collection.dropIndex("staffId_1_workDate_1");
            console.log("✅ dropped unique AttendanceDay.staffId_1_workDate_1");
        }
    } catch (dropErr) {
        if (dropErr?.codeName !== "IndexNotFound" && dropErr?.code !== 27) {
            console.warn("⚠️ AttendanceDay index drop:", dropErr.message);
        }
    }
    try {
        await AttendanceDay.syncIndexes();
    } catch (indexErr) {
        console.warn("⚠️ AttendanceDay index sync:", indexErr.message);
    }
}

async function runDBBootstrap() {
    try {
        await enforceOneMembershipPerOrg();
        await ensureModuleCatalogue();
        await ensureAttendanceDayIndexes();

        const existing = await Bootstrap.findOne();
        if (existing?.version >= BOOTSTRAP_VERSION) {
            console.log("ℹ️ Bootstrap already up-to-date");
            return;
        }

        // Admin Settings
        if (!(await AdminSettings.findOne())) {
            await AdminSettings.create({
                terms_and_conditions: "Your terms and conditions text here.",
                customer_terms_and_conditions: "Your customer terms and conditions text here.",
                about_us: "Information about us here.",
                privacy_policy: "Your privacy policy text here.",
            });
            console.log("✅ Admin settings created");
        }
  
        // `leaveShiftBidding` split into `leave` + `shiftBidding`. Anyone holding
        // the old slug keeps both capabilities, so nobody silently loses access.
        const legacyLeaveSlug = "leaveShiftBidding";
        const legacyHolders = await Organization.find({
            "moduleAccess.moduleSlug": legacyLeaveSlug,
        }).select("moduleAccess");

        for (const organization of legacyHolders) {
            const legacy = organization.moduleAccess.find(
                (entry) => entry.moduleSlug === legacyLeaveSlug
            );
            const replacements = [ModuleSlug.LEAVE, ModuleSlug.SHIFT_BIDDING];

            organization.moduleAccess = organization.moduleAccess.filter(
                (entry) => entry.moduleSlug !== legacyLeaveSlug
            );

            for (const slug of replacements) {
                const alreadyHeld = organization.moduleAccess.some(
                    (entry) => entry.moduleSlug === slug
                );
                if (!alreadyHeld) {
                    organization.moduleAccess.push({
                        moduleSlug: slug,
                        enabled: legacy.enabled,
                        purchasedAt: legacy.purchasedAt,
                    });
                }
            }

            await organization.save();
        }

        if (legacyHolders.length) {
            console.log(
                `✅ ${legacyHolders.length} organization(s) migrated off ${legacyLeaveSlug}`
            );
        }

        await ModuleDefinition.deleteOne({ slug: legacyLeaveSlug });

        // Backfill the normalised name keys that the unique-name indexes use.
        // Rows predating those indexes have no key, and a duplicate that already
        // exists must be reported rather than silently skipped — someone has to
        // rename it before the constraint can hold.
        for (const [label, Model, scoped] of [
            ["organization", Organization, false],
            ["branch", Branch, true],
        ]) {
            const pending = await Model.find({ nameKey: { $exists: false } })
                .select("name organizationId")
                .lean();

            let filled = 0;
            for (const row of pending) {
                const nameKey = nameKeyOf(row.name);
                const clash = { nameKey, _id: { $ne: row._id } };
                if (scoped) clash.organizationId = row.organizationId;

                if (await Model.exists(clash)) {
                    console.warn(
                        `⚠️ duplicate ${label} name "${row.name}" (${row._id}) — rename it; unique index not applied to this row`
                    );
                    continue;
                }

                await Model.updateOne({ _id: row._id }, { $set: { nameKey } });
                filled += 1;
            }

            if (filled) console.log(`✅ ${filled} ${label} name key(s) backfilled`);
        }

        // Bootstrap Users
        for (const spec of BOOTSTRAP_USERS) {
            const {
                envEmail,
                envPassword,
                fallbackEnvEmail,
                fallbackEnvPassword,
                name,
                userType,
                membershipRole,
            } = spec;

            const email =
                process.env[envEmail] ||
                (fallbackEnvEmail ? process.env[fallbackEnvEmail] : null);
            const password =
                process.env[envPassword] ||
                (fallbackEnvPassword ? process.env[fallbackEnvPassword] : null);

            if (!email || !password) continue;

            const label = membershipRole || userType;

            try {
                let user = await User.findOne({ email: email.toLowerCase() });

                if (!user) {
                    user = await User.create({
                        name,
                        email: email.toLowerCase(),
                        password,
                        timezone: TIMEZONE,
                        accountState: { userType, status: "active" },
                        verificationStatus: {
                            email: "verified",
                            phoneNumber: "pending",
                        },
                    });
                    console.log(`✅ ${label} user created`);
                }

                if (!membershipRole) continue;

                // A scoped role needs something to be scoped to.
                let organization = await Organization.findOne({
                    name: DEMO_ORG_NAME,
                });

                if (!organization) {
                    organization = await Organization.create({
                        name: DEMO_ORG_NAME,
                        ownerUserId: user._id,
                        // Seeded organizations skip the owner invitation, so
                        // they must not inherit the pendingActivation default.
                        status: OrganizationStatus.ACTIVE,
                        moduleAccess: Object.values(ModuleSlug).map((slug) => ({
                            moduleSlug: slug,
                            enabled: true,
                            purchasedAt: new Date(),
                        })),
                    });
                    console.log(`✅ organization "${DEMO_ORG_NAME}" created`);
                }

                const hasMembership = await Membership.exists({
                    userId: user._id,
                    organizationId: organization._id,
                    status: ActiveInactiveStatus.ACTIVE,
                });

                if (!hasMembership) {
                    await Membership.create({
                        userId: user._id,
                        organizationId: organization._id,
                        branchId: null, // org-wide: an owner acts on every site
                        role: membershipRole,
                    });
                    console.log(`✅ ${membershipRole} membership created`);
                }
            } catch (err) {
                console.error(`❌ Failed to bootstrap ${label}:`, err.message);
            }
        }

        // Null nfcTagId values break the old sparse unique index (only one null
        // allowed). Unset them and rebuild indexes with a partial filter instead.
        const clearedNfc = await StaffProfile.updateMany(
            { $or: [{ nfcTagId: null }, { nfcTagId: "" }] },
            { $unset: { nfcTagId: "" } }
        );
        if (clearedNfc.modifiedCount) {
            console.log(
                `✅ cleared empty nfcTagId on ${clearedNfc.modifiedCount} staff profile(s)`
            );
        }

        // StaffProfile uniqueness moved from userId → (userId, organizationId)
        // so bank staff can hold employment in more than one care group.
        try {
            await StaffProfile.collection.dropIndex("userId_1");
            console.log("✅ dropped global StaffProfile.userId unique index");
        } catch (dropErr) {
            if (dropErr?.codeName !== "IndexNotFound" && dropErr?.code !== 27) {
                console.warn("⚠️ StaffProfile userId index drop:", dropErr.message);
            }
        }

        try {
            await StaffProfile.syncIndexes();
        } catch (indexErr) {
            console.warn("⚠️ StaffProfile index sync:", indexErr.message);
        }

        // Backfill profiles skipped when invite accept hit the old one-profile-global rule.
        const { StaffInvitation } = require("@models/StaffInvitation");
        const { StaffInvitationStatus } = require("@models/domainEnums");
        const staffService = require("@adminServices/staff/staffService");

        const acceptedWithEmployment = await StaffInvitation.find({
            status: StaffInvitationStatus.ACCEPTED,
            acceptedByUserId: { $ne: null },
            jobTitleId: { $ne: null },
            branchId: { $ne: null },
        })
            .select(
                "acceptedByUserId organizationId branchId jobTitleId departmentIds reportsToStaffId startDate employeeCode role"
            )
            .lean();

        let repaired = 0;
        const { STAFF_PROFILE_ROLES } = require("@adminServices/staff/staffAccess");

        for (const invitation of acceptedWithEmployment) {
            if (!STAFF_PROFILE_ROLES.includes(invitation.role)) continue;
            const created = await staffService.insertStaffProfile({
                userId: invitation.acceptedByUserId,
                organizationId: invitation.organizationId,
                branchId: invitation.branchId,
                jobTitleId: invitation.jobTitleId,
                departmentIds: invitation.departmentIds,
                reportsToStaffId: invitation.reportsToStaffId,
                startDate: invitation.startDate || new Date(),
                employeeCode: invitation.employeeCode,
            });
            if (created) repaired += 1;
        }
        if (repaired) {
            console.log(
                `✅ repaired ${repaired} staff profile(s) from accepted invitations`
            );
        }

        // Mark bootstrap complete
        await Bootstrap.findOneAndUpdate(
            {},
            { $set: { version: BOOTSTRAP_VERSION } },
            { upsert: true }
        );
    } catch (err) {
        console.error("❌ DB bootstrap failed", err);
        throw err;
    }
}

module.exports = runDBBootstrap;
