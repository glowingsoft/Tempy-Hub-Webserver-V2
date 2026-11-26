# Tempy Hub Backend: Complete Project Guide

> Snapshot of branch `mobile-side-apis` at commit `d0ad01f`, 25 November 2026.
> Sections 11 to 13 were generated from the code: routes from the mounted Express routers, models from the loaded Mongoose schemas, functions from the parsed source. If this guide and the code disagree, the code is right.

## Contents

1. [What the project is](#1-what-the-project-is)
2. [Tech stack](#2-tech-stack)
3. [Folder structure](#3-folder-structure)
4. [Setup and commands](#4-setup-and-commands)
5. [How a request is processed](#5-how-a-request-is-processed)
6. [Authentication](#6-authentication)
7. [Authorization](#7-authorization)
8. [Main business flows](#8-main-business-flows)
9. [Realtime, jobs and uploads](#9-realtime-jobs-and-uploads)
10. [How to add a feature](#10-how-to-add-a-feature)
11. [Route reference](#11-route-reference)
12. [Data models](#12-data-models)
13. [Function reference](#13-function-reference)

## 1. What the project is

Tempy Hub is a multi-tenant SaaS API for care homes. One server supports the platform admin panel, owner and manager portals, staff and manager mobile apps, the family app, and reception kiosks.

| Term | Meaning |
|---|---|
| Organization | The customer (care group). Buys modules through `moduleAccess`. |
| Branch | One care home. The UI calls it a "site". |
| User | A login account. Holds no business role, except that `accountState.userType: "admin"` marks a platform admin. |
| Membership | A user's role in an organization, and in a branch when scoped. One active membership per user per organization. |
| StaffProfile | The employment record. `reportsToStaffId` is the line manager; `supervisorStaffId` is the supervisor. |
| Resident | A person living in the home. |
| FamilyMember | Links a family user to a resident. One may be next of kin. |
| ExternalPerson | Visitor, contractor, professional or guest. |
| Kiosk | A registered reception tablet with its own device token. |

Feature areas: organizations and memberships, staff directory, rota and shift claims, attendance, leave, visitors and surveys, kiosk, fire drill and evacuation, PEEP (Personal Emergency Evacuation Plans) and floor plans, residents, family engagement (wall, uploads, visits, newsletters, gazettes, chat), documents and signatures, training, competency, supervision and appraisal, announcements, dashboards, and storage billing.

## 2. Tech stack

| Area | Technology |
|---|---|
| Runtime | Node.js (CI uses 20), Express 4, CommonJS, `module-alias` |
| Database | MongoDB with Mongoose 8. **A replica set is required** for transactions. |
| Cache and locks | Redis (`ioredis`) and in-process `node-cache` |
| Realtime | Socket.IO with a Redis adapter |
| Auth | JWT (`jsonwebtoken`), `bcryptjs` |
| Files | AWS S3, local `uploads/`, `multer`, `sharp` |
| Messaging | AWS SES, SendGrid, Brevo, AWS Pinpoint, Vonage, Firebase push |
| PDF and ZIP | Puppeteer, EJS, `fontkit`, `yazl` |
| Scheduling | `node-cron` |
| Languages | `i18n`: `en` and `es` |
| API docs | Swagger UI and a Postman collection |

## 3. Folder structure

```text
backend/
  server.js            Entry point
  admin/               Management API: routes, controllers, services
  app/                 Mobile, family and kiosk API: routes, controllers, services
  commonModules/       Auth, uploads, chat, notifications, settings
  middlewares/         Auth, membership, family, kiosk, security, uploads
  models/              Mongoose models; domainEnums.js holds shared enums
  services/            AppError, handleServiceError, moderation
  helperUtils/         Responses, pagination, email, rate limit, backup
  config/              Redis, sockets, cron, logging, Swagger, i18n, bootstrap
  assets/              Locales and PDF templates
aliasConfig/           Import aliases
postman_collection/    Collection and scripts that edit it
swagger/               Swagger output and scripts
```

`docs/`, `scripts/`, `tests/`, `uploads/` and `logs/` are git-ignored, so a fresh clone may not have them.

**The app and admin areas share logic.** Controllers in `backend/app` often call services in `backend/admin/services`. Put domain rules in the service so both APIs get them.

| Alias | Path |
|---|---|
| `@utils` | `backend/helperUtils` |
| `@models` | `backend/models` |
| `@config` | `backend/config` |
| `@middlewares` | `backend/middlewares` |
| `@adminServices` | `backend/admin/services` |
| `@appServices` | `backend/app/services` |
| `@commonServices` | `backend/commonModules/services` |
| `@controllersCommonModules` | `backend/commonModules/controllers` |
| `@services` | `backend/services` |
| `@assets` | `backend/assets` |
| `@socketIo` | `backend/config/sockets` |
| `@redisCache` | `backend/config/redis/redisCache.js` |
| `@notificationsUtil` | `communicationService.js` in common services |

## 4. Setup and commands

1. Run `npm install`.
2. Copy `.env.example` to `.env` and fill it in.
3. Start MongoDB as a replica set: `mongod --dbpath <path> --replSet rs0`. The first time only, run `rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})` in `mongosh`.
4. Run `npm run dev`. The README gives 6060 as the dev port; the code falls back to 8080 when `PORT` is unset.
5. Check `GET /health`, then open `/api/v1/docs`.

| Command | Purpose |
|---|---|
| `npm run dev` | Nodemon, `NODE_ENV=dev` |
| `npm run prod` | `NODE_ENV=prod` |
| `npm run mobileapps` | `NODE_ENV=mobileapps`: development CORS, but route rate limits are on |
| `npm run pm2:dev:start` / `pm2:prod:start` | PM2 cluster mode, one process per CPU |
| `npm run postman:build` | Normalize and validate the Postman collection |
| `npm run swagger:validate` | Check that the Swagger JSON parses |
| `npm run backfill:staff-permissions` | One-off data script |
| `npm test` | Runs the local, git-ignored tests folder |

### Environment variables

| Group | Variables |
|---|---|
| Server | `PORT`, `HOST`, `NODE_ENV`, `CLOUDFLARE_TUNNEL`, `PUBLIC_API_URL`, `FRONTEND_URL` |
| Database | `BASE_URL` (this is the **MongoDB URI**, not a web URL), `REDIS_URL` |
| Security | `JWT_SECRET`, `ADMIN_ACCESS_TOKEN`, `FAMILY_CODE_SECRET` |
| Email and SMS | `EMAIL_ENABLED`, `SENDGRID_*`, `AWS_EMAIL_*`, `AWS_SENDER_EMAIL`, `AWS_PINPOINT_*`, `BREVO_EMAIL_API_KEY`, `SUPPORT_EMAIL` |
| S3 | `AWS_S3_REGION`, `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_BASE_URL` |
| Azure (legacy upload code) | `AZURE_STORAGE_*` |
| Bootstrap | `BOOTSTRAP_VERSION`, `BOOTSTRAP_SUPERADMIN_*`, `BOOTSTRAP_OWNER_*`, `BOOTSTRAP_ORG_NAME` |
| Cron | `CRON_ENABLED`, `CRON_HEARTBEAT*`, `CRON_AUTO_CHECKOUT*`, `CRON_STORAGE_USAGE*` |
| Invitations | `STAFF_INVITE_TTL_DAYS`, `FAMILY_INVITE_TTL_DAYS`, `VISITOR_ACCOUNT_INVITE_TTL_DAYS`, `FAMILY_CODE_TTL_DAYS`, `FAMILY_INVITE_RETURN_LINK` |
| PDF | `PDF_BROWSER_PATH`, `PDF_BROWSER_NO_SANDBOX`, `PDF_MAX_CONCURRENT` |

Mail sent through `mailer.js` is logged instead of delivered unless `EMAIL_ENABLED=true`. Increase `BOOTSTRAP_VERSION` to run the startup seed again.

### Deployment

GitHub Actions deploys pushes to `dev` and `main` to EC2 using SCP, `npm install --force`, PM2 and an Nginx restart.

## 5. How a request is processed

```text
Request
 -> Helmet, HPP, compression, body parsing (10 MB), CORS
 -> i18n, access log, text moderation (POST/PUT/PATCH)
 -> /api/v1/app | /api/v1/admin | /api/v1
 -> route guards: auth, membership, module, role, permission
 -> controller: validates input, calls service
 -> service: rules and database
 -> sendResponse  (errors: AppError -> handleServiceError)
```

| Prefix | Used by |
|---|---|
| `/api/v1/app` | Staff and manager apps, family app, kiosk |
| `/api/v1/admin` | Web portals |
| `/api/v1` | Auth, uploads, chat, notifications |
| `/api/v1/docs`, `/api/v1/openapi.json`, `/api/v1/postman` | API documentation |

Response shape: `{ "message": "...", "data": ..., "meta": ... }`. `data` and `meta` appear only when set. `error` details appear when `NODE_ENV` is `dev` or `localhost`. `message` is translated from `translationKey` into the user's language.

Throw `new AppError("translation_key", statusCode, values)` in services. A malformed ObjectId becomes a 400. Unknown errors become a 500.

Route rate limiters count per IP and do nothing when `NODE_ENV=dev`. The global limiter is commented out. Text moderation answers 400 when any string in the body is profane.

### Scope headers

| Header | Use |
|---|---|
| `Authorization: Bearer <token>` | User token |
| `x-org-id` | Organization. Alternatives: route parameter or `?organizationId=` |
| `x-branch-id` | Branch. Alternatives: route parameter or `?branchId=` |
| `x-kiosk-token` | Kiosk device token |

If only a branch is supplied, its organization is looked up. The resolved scope is available as `req.orgId`, `req.branchId`, `req.membership` and `req.organization`.

## 6. Authentication

There is no public registration. `register` and `socialAuth` exist in the code but are not mounted.

1. `POST /auth/login` checks the password, email verification and account status. Platform admins must also send the admin access token.
2. If `audience` is missing, staff and admin accounts get `staff`; everyone else gets `family`.
3. The service checks that the account really exists for that audience.
4. It resolves the `surface` (which product is signing in) and checks the role against it.
5. It signs a JWT containing `_id`, `audience` and, when resolved, `surface`.
6. The client calls `GET /auth/me` with `x-org-id` to get the module menu and permissions.

| Audience | Required record |
|---|---|
| `staff` | An active membership, or platform admin |
| `family` | Any non-staff account. A resident link is not needed to sign in. |
| `resident` | A Resident linked to the user |
| `visitor` | An ExternalPerson linked to the user |
| `kiosk` | Device token issued by the kiosk flow, not by login |

| Surface | Who may enter |
|---|---|
| `staffApp` | Staff role and above |
| `managerApp` | Line manager and site manager only |
| `ownerAdmin` | Owner and super admin |
| `platformAdmin` | Platform admin only |
| `familyApp`, `residentApp`, `visitorApp` | Matching audience |

Accounts are created by accepting a staff, family or visitor account invitation. Password reset is: forgot password, verify OTP, then reset password with the reset token.

`auth` caches each user for one hour in the process, so a status change may take up to an hour to apply unless the code clears `userCache`.

## 7. Authorization

| Check | Question | Middleware |
|---|---|---|
| Membership | Do they belong to this organization or branch? | `requireMembership` |
| Module | Has the organization bought this feature, unexpired? | `requireModule` |
| Role | Is their role on the list? | `requireRoles` |
| Permission | Do they hold this permission? | `requirePermission` |

Roles, highest first: `superAdmin` 5, `owner` 4, `siteManager` 3, `lineManager` 2, `staff` 1. A platform admin acts as an implicit super admin in any organization, bypasses module checks, and can enter suspended organizations.

Permissions are named `<module>.<view|manage|approve>`. `approve` exists only for leave, attendance, rota, family engagement and documents.

**Only line managers depend on stored permissions.** Super admin, owner, site manager and staff pass every `requirePermission` check. Staff are therefore limited by `requireRoles` and by the services, so a manager-only route must use `requireRoles` as well. Line managers also get documents and rota view/approve by default when those modules are licensed.

Other guards: `hasReportsIf` (a line manager must have direct reports), `requireFamilyAccess` (live resident link), `requireNextOfKin`, `requireFamilyModule` (404 when the module is off), `requireKioskSession`, `requireKioskModule`, `requireAudience`, and `roleMiddleware` (platform `userType`, **not** membership role). `requireSurface` exists for optional use.

Services also enforce scope. `actorStanding`, `assertMayManageStaff`, `assertMayApproveForStaff` and `assertMaySuperviseStaff` are in `staffAccess.js`: site managers are limited to their branch, and line managers to their direct reports or supervisees.

Modules: `signInAttendance`, `rotaScheduling`, `fireDrillEvacuation`, `peepFloorPlan`, `residents`, `documentsEsign`, `leave`, `shiftBidding`, `competencySupervisionAppraisal`, `onboardingDbs`, `payrollForecasting`, `visitorComms`, `agencyShiftBids`, `familyEngagement`. Note that visitor routes are gated by `fireDrillEvacuation`, and shift claims by `rotaScheduling`.

## 8. Main business flows

### Organization onboarding
Creating an organization invites its owner and leaves it `pendingActivation`. Accepting the invitation activates it and gives the owner their membership. Next: set modules, create branches, invite members, and set up departments, job titles and staff profiles. Non-platform users cannot use pending or suspended organizations.

### Rota and shift claims
Open shifts (`open`, no staff member) are visible to a branch or the whole organization, and staff claim them. Approving one claim, in a transaction, assigns and schedules the shift and rejects the other pending claims. On the admin API line managers may also approve; on the app API only site manager and above may.

### Attendance
Clock-in blocks a second open session, matches the active shift, and records `onTime`, `late` or `unscheduled` using the branch grace period. `clientEventId` supports offline replay. Clock-out is refused during a break. Unscheduled work can be sent for roster approval. Staff can ask for corrections through change requests. Auto-checkout defaults to 3 hours after the shift ends, or 10 hours after clock-in when there is no shift.

### Leave
The leave year is 1 April to 31 March. Staff may request **annual** leave only; sickness uses `report-sickness`; managers record sickness or absence. Requests check dates, overlap and balance. Approval checks the approver's scope and the balance again, then updates the entitlement in a transaction.

### Kiosk
Find the branch, register with the activation code and admin PIN, then use the kiosk token. Staff check in by OTP, PIN or QR code. QR tokens last 2 minutes and pairing sessions 3 minutes: the phone scans, `/kiosk` emits `kiosk:pairing:ready`, then the kiosk confirms. Contractor QR check-in needs an open invitation. Visitors can check in at the kiosk too.

### Visitors
`awaitingApproval` then `onSite` then `checkedOut`, or `denied`. Open visits are closed by default 1 hour after the visit window, or 10 hours after check-in when there is none.

### Evacuation
A branch has at most one active event (`real` or `mock`). Starting it seeds the rollcall. Marks are `safe`, `missing`, `unknown` or `offSite`. Managers can alert, update and give the all-clear to families. A kiosk may close only an event that kiosk started.

### Family engagement
A relative joins by invitation, or by family code and approval. Links are read on every request, so removal takes effect at once. The next of kin manages members and must hand over before leaving or deleting their account; other relatives cannot remove them, but staff can. Staff moderate uploads, publish wall posts, send newsletters, generate and print gazettes, decide visits and send chat messages. Confirmed visits create the ordinary kiosk invitation.

### Compliance
Requirements (training or competency) are assigned to staff and completed with records; status is calculated from dates. Supervision defaults to every 3 months and appraisal to every 12, with organization and per-person settings. Appraisals are acknowledged by staff and signed by a manager.

### Documents
Documents have versions, scope (org, branch, personal), audience and categories. Signatures attach to a version. QR links open through a public token route.

## 9. Realtime, jobs and uploads

| Socket namespace | Token | Server event |
|---|---|---|
| `/auth` | `auth.token`; optional `organizationId` | `auth:me:updated` |
| `/chat` | `auth.token` | `receiveMessage` |
| `/kiosk` | `auth.kioskToken` | `kiosk:pairing:ready` |

Order socket handlers are boilerplate and are not enabled. Sockets share the HTTP port. Chat clients only receive; messages are sent through HTTP.

| Job | Default schedule | Purpose |
|---|---|---|
| heartbeat | every minute | Shows cron is alive |
| auto-checkout | every 30 minutes | Closes stale attendance and visits |
| family-scheduled-posts | every minute | Publishes due posts |
| family-scheduled-newsletters | every minute | Sends due newsletters |
| family-gazette-scheduler | every 15 minutes | Generates due gazettes and reminders |
| family-gazette-recovery | every 5 minutes | Recovers stuck gazettes |
| storage-usage | 02:30 daily | Measures stored files |

Jobs take a Redis lock when Redis is available. **Without Redis, every PM2 process runs every job.** `eventReminder.cron.js` is not registered. A MongoDB backup is attempted every 24 hours.

Upload limits: local single file 3 MB; S3 up to 20 files of 5 MB; family photos up to 10 files, 10 MB each and 50 MB together.

## 10. How to add a feature

1. Add enums to `domainEnums.js` and the model, with indexes for its queries.
2. Put rules and queries in a service. Throw `AppError`. Always filter by organization, and check branch or team scope.
3. Write a thin controller: validate, call the service, `sendResponse`; in `catch` call `handleServiceError`.
4. Add the route with its guards: `auth`, `requireMembership`, then `requireModule`, `requireRoles` and `requirePermission` as needed. Use `requireRoles` for manager actions.
5. Declare fixed paths such as `/mine` before `/:id`.
6. Mount the router in the area's `routes/index.js`.
7. Add translation keys to `en.json` and `es.json`.
8. Use a transaction when several documents must change together; prefer one aggregation to repeated queries.
9. Update Postman and Swagger, then check `/api/v1/docs`.

## 11. Route reference

509 mounted API routes: POST 160, GET 256, PATCH 27, PUT 49, DELETE 17. Health and documentation routes in server.js are not counted.

**Guards:** `member` = requireMembership; `roles:` = requireRoles; `module:` = requireModule; `perm:` = requirePermission; `familyLink` = requireFamilyAccess; `userType:` = roleMiddleware; `rate:15/10m` = 15 requests per 10 minutes per IP. **MANAGERS** = superAdmin, owner, siteManager; **APPROVERS** = MANAGERS + lineManager; **OWNERS** = superAdmin, owner; **ALL** = every role. **PUBLIC** = no user or kiosk session guard (the path itself may need a token or code).

The service column lists direct service calls visible in the controller; `-` means it goes through a helper or destructured import.

### App: support

Base: `/api/v1/app/support`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/` | **PUBLIC** rate:5/10m | `app/supportController.createSupportRequest` | `supportService.createSupportRequest` |

### App: kiosk

Base: `/api/v1/app/kiosk`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/branches/search` | **PUBLIC** rate:40/15m | `app/kioskController.searchBranches` | `kioskService.searchBranchesForKiosk` |
| POST | `/register` | **PUBLIC**  | `app/kioskController.register` | `kioskService.registerKiosk` |
| POST | `/session` | **PUBLIC**  | `app/kioskController.verifyAdminPin` | `kioskService.verifyKioskAdminPin` |
| POST | `/scan` | auth, member | `app/kioskController.scanFromPhone` | `kioskService.scanKioskFromPhone` |
| POST | `/contractor/scan` | auth | `app/kioskController.scanFromContractor` | `kioskService.scanContractorFromPhone` |
| GET | `/evacuations/on-site-summary` | requireKioskSession, kioskModule:fireDrillEvacuation | `app/kioskEvacuationController.getOnSiteSummary` | `evacuationService.getOnSiteSummary` |
| GET | `/evacuations/active` | requireKioskSession, kioskModule:fireDrillEvacuation | `app/kioskEvacuationController.getActiveEvacuation` | `evacuationService.getActiveEvacuation` |
| POST | `/evacuations/emergency-pin` | requireKioskSession, kioskModule:fireDrillEvacuation, rate:20/15m | `app/kioskEvacuationController.verifyEmergencyPin` | `kioskService.verifyKioskEmergencyPin` |
| POST | `/evacuations` | requireKioskSession, kioskModule:fireDrillEvacuation | `app/kioskEvacuationController.startEvacuation` | `kioskService.assertKioskFireEvacuationEnabled`, `evacuationService.startEvacuation` |
| POST | `/evacuations/close` | requireKioskSession, kioskModule:fireDrillEvacuation | `app/kioskEvacuationController.closeEvacuation` | `evacuationService.closeActiveEvacuationForBranch` |
| GET | `/me` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.getMe` | `kioskService.getKioskSession` |
| GET | `/widgets` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.listWidgets` | `kioskWidgetService.listKioskWidgetsForDevice`, `kioskService.publicOrganization` |
| PATCH | `/me` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.updateMe` | `kioskService.updateKioskSettings` |
| GET | `/qr` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.getQr` | `kioskService.getKioskQr` |
| GET | `/pairing/pending` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.getPendingPairing` | `kioskService.getPendingPairing` |
| POST | `/pairing/:sessionId/confirm` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.confirmPairing` | `kioskService.confirmPairingAndClockIn` |
| POST | `/pairing/:sessionId/cancel` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.cancelPairing` | `kioskService.cancelPairing` |
| GET | `/visits/categories` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.listCategories` | `kioskVisitService.listVisitCategories` |
| GET | `/visits/people/search` | requireKioskSession, kioskModule:signInAttendance, rate:60/15m | `app/kioskVisitController.searchPeople` | `kioskVisitService.searchVisitPeople` |
| GET | `/visits/policies` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.listPolicies` | `kioskVisitService.listVisitPolicies` |
| GET | `/visits/on-site` | requireKioskSession, kioskModule:signInAttendance, rate:60/15m | `app/kioskVisitController.listOnSite` | `kioskVisitService.listOnSiteVisits` |
| POST | `/visits/invite/verify` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.verifyInvite` | `kioskVisitService.verifyInvite` |
| POST | `/visits/invite/resend` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.resendInvite` | `kioskVisitService.resendInvite` |
| POST | `/visits/check-in` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.checkIn` | `kioskVisitService.checkInAtKiosk` |
| POST | `/visits/check-out` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.checkOut` | `kioskVisitService.checkOutAtKiosk`, `visitorSurveyService.getKioskVisitorSurvey` |
| POST | `/visits/:visitSessionId/feedback` | requireKioskSession, kioskModule:signInAttendance | `app/kioskVisitController.submitVisitorFeedback` | `visitorSurveyService.createKioskVisitorSurveyResponse` |
| GET | `/staff/search` | requireKioskSession, kioskModule:signInAttendance, rate:60/15m | `app/kioskController.searchStaff` | `kioskService.searchStaffForKiosk` |
| GET | `/staff/:staffId/preview` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.getStaffPreview` | `kioskService.getStaffPreviewForKiosk` |
| POST | `/attendance/otp/request` | requireKioskSession, kioskModule:signInAttendance, rate:20/15m | `app/kioskController.requestCheckInOtp` | `kioskService.requestKioskCheckInOtp` |
| POST | `/attendance/otp/verify` | requireKioskSession, kioskModule:signInAttendance, rate:20/15m | `app/kioskController.verifyCheckInOtp` | `kioskService.verifyKioskCheckInOtp` |
| POST | `/attendance/verify` | requireKioskSession, kioskModule:signInAttendance, rate:20/15m | `app/kioskController.verifyStaffPin` | `kioskService.verifyStaffPinAtKiosk` |
| GET | `/attendance/today` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.getToday` | `kioskService.getTodayAtKiosk` |
| GET | `/attendance/on-site` | requireKioskSession, kioskModule:signInAttendance, rate:60/15m | `app/kioskController.listOnSite` | `kioskService.listOnSiteAtKiosk` |
| POST | `/attendance/clock-in` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.clockIn` | `kioskService.clockInAtKiosk` |
| POST | `/attendance/clock-out` | requireKioskSession, kioskModule:signInAttendance | `app/kioskController.clockOut` | `kioskService.clockOutAtKiosk` |

### App: invitations

Base: `/api/v1/app/invitations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth | `app/invitationController.listMyInvitations` | `membershipService.listMyInvitations` |
| GET | `/:invitationId` | auth | `app/invitationController.getMyInvitation` | `membershipService.getMyInvitation` |
| POST | `/:invitationId/accept` | auth | `app/invitationController.acceptMyInvitation` | `membershipService.acceptMyInvitation` |

### App: family-invitations

Base: `/api/v1/app/family-invitations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth | `app/familyInvitationController.listMyInvitations` | `familyService.listMyInvitations` |
| GET | `/:invitationId` | auth | `app/familyInvitationController.getMyInvitation` | `familyService.getMyInvitation` |
| POST | `/:invitationId/accept` | auth | `app/familyInvitationController.acceptMyInvitation` | `familyService.acceptMyInvitation` |

### App: family

Base: `/api/v1/app/family`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/relationships` | auth, audience:family | `app/familyController.listRelationships` | - |
| GET | `/residents` | auth, audience:family | `app/familyController.listMyResidents` | - |
| GET | `/home` | auth, audience:family, familyLink | `app/familyController.getHome` | - |
| GET | `/codes/current` | auth, audience:family, familyLink(query.residentId), requireNextOfKin | `app/familyController.getCurrentFamilyCode` | - |
| POST | `/codes` | auth, audience:family, familyLink(body.residentId), requireNextOfKin | `app/familyController.createFamilyCode` | - |
| GET | `/member-invitations` | auth, audience:family, familyLink(query.residentId), requireNextOfKin | `app/familyController.listSentInvitations` | - |
| POST | `/member-invitations` | auth, audience:family, rate:20/15m, familyLink(body.residentId), requireNextOfKin | `app/familyController.inviteRelative` | - |
| GET | `/join/preview` | auth, audience:family | `app/familyController.previewJoinCode` | - |
| POST | `/join` | auth, audience:family | `app/familyController.requestToJoin` | - |
| GET | `/join-requests/current` | auth, audience:family | `app/familyController.getCurrentJoinRequest` | - |
| GET | `/join-requests` | auth, audience:family, familyLink(query.residentId), requireNextOfKin | `app/familyController.listJoinRequests` | - |
| PUT | `/join-requests/:id` | auth, audience:family | `app/familyController.updateJoinRequest` | - |
| GET | `/members` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listMembers` | - |
| DELETE | `/members/:memberId` | auth, audience:family | `app/familyController.removeMember` | - |
| GET | `/handover/candidates` | auth, audience:family, familyLink(query.residentId), requireNextOfKin | `app/familyController.listHandoverCandidates` | - |
| POST | `/handover` | auth, audience:family, familyLink(body.residentId), requireNextOfKin | `app/familyController.requestHandover` | - |
| GET | `/handover/current` | auth, audience:family | `app/familyController.getCurrentHandover` | - |
| PUT | `/handover/:id` | auth, audience:family | `app/familyController.updateHandover` | - |
| GET | `/timeline` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listTimeline` | - |
| GET | `/gallery` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listGallery` | - |
| GET | `/visits/next` | auth, audience:family, familyLink(query.residentId) | `app/familyController.getNextVisit` | - |
| GET | `/visits/options` | auth, audience:family, familyLink(query.residentId) | `app/familyController.getVisitOptions` | - |
| GET | `/visits` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listVisits` | - |
| POST | `/visits` | auth, audience:family, rate:60/15m, familyLink(body.residentId) | `app/familyController.requestVisit` | - |
| PUT | `/visits/:id` | auth, audience:family, rate:60/15m, familyLink | `app/familyController.updateVisit` | - |
| GET | `/visit-pass` | auth, audience:family, familyLink(query.residentId) | `app/familyController.getVisitPass` | - |
| PUT | `/visit-pass` | auth, audience:family, rate:60/15m, familyLink(body.residentId) | `app/familyController.updateVisitPass` | - |
| GET | `/gazettes/next` | auth, audience:family, familyLink(query.residentId) | `app/familyController.getNextGazette` | - |
| GET | `/gazettes` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listGazettes` | - |
| GET | `/gazettes/:gazetteId` | auth, audience:family, familyLink | `app/familyController.getGazette` | - |
| GET | `/gazettes/:gazetteId/pdf` | auth, audience:family, rate:30/15m, familyLink | `app/familyController.downloadGazettePdf` | `familyGazetteService.getPdf` |
| GET | `/newsletters` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listNewsletters` | - |
| GET | `/newsletters/:newsletterId` | auth, audience:family, familyLink | `app/familyController.getNewsletter` | - |
| GET | `/newsletters/:newsletterId/pdf` | auth, audience:family, rate:30/15m, familyLink | `app/familyController.downloadNewsletterPdf` | `familyNewsletterService.getPdf` |
| GET | `/wall` | auth, audience:family, familyLink(query.residentId) | `app/familyController.listWall` | - |
| GET | `/wall/pinned` | auth, audience:family, familyLink | `app/familyController.listPinnedPosts` | - |
| PUT | `/wall/:postId/pin` | auth, audience:family, rate:60/15m, familyLink | `app/familyController.setPostPinned` | - |
| PUT | `/wall/seen` | auth, audience:family, familyLink | `app/familyController.markPostsSeen` | - |
| POST | `/wall/:postId/report` | auth, audience:family, rate:60/15m, familyLink | `app/familyController.reportPost` | - |
| PUT | `/wall/:postId/reaction` | auth, audience:family, familyLink | `app/familyController.addReaction` | - |
| DELETE | `/wall/:postId/reaction` | auth, audience:family, familyLink | `app/familyController.removeReaction` | - |
| POST | `/media/batch` | auth, audience:family, rate:12/15m, familyLink, receivePhotos | `app/familyController.uploadPhotos` | - |
| POST | `/media` | auth, audience:family, rate:60/15m, familyLink, receivePhoto | `app/familyController.uploadPhoto` | - |
| POST | `/uploads` | auth, audience:family, rate:60/15m, familyLink(body.residentId) | `app/familyController.createUpload` | - |
| GET | `/uploads` | auth, audience:family, familyLink | `app/familyController.listMyUploads` | - |
| PUT | `/uploads/:id` | auth, audience:family, familyLink | `app/familyController.updateUpload` | - |
| DELETE | `/uploads/:id` | auth, audience:family, rate:60/15m, familyLink | `app/familyController.deleteUpload` | - |
| POST | `/leave` | auth, audience:family, familyLink(body.residentId) | `app/familyController.leaveFamily` | - |

### App: family-visits

Base: `/api/v1/app/family-visits`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `app/familyVisitManagerController.listRequests` | - |
| PUT | `/visiting` | auth, member, requireFamilyModule, roles:ALL, checkFamilyFilters, rate:20/15m, perm:familyEngagement.manage | `app/familyVisitManagerController.updateVisiting` | - |
| GET | `/settings` | auth, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `app/familyVisitManagerController.getSettings` | - |
| PUT | `/settings` | auth, member, requireFamilyModule, roles:ALL, checkFamilyFilters, rate:20/15m, perm:familyEngagement.manage | `app/familyVisitManagerController.updateSettings` | - |
| PUT | `/:id` | auth, member, requireFamilyModule, roles:ALL, checkFamilyFilters, rate:120/15m, perm:familyEngagement.approve | `app/familyVisitManagerController.updateRequest` | - |

### App: residents

Base: `/api/v1/app/residents`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:residents, roles:MANAGERS | `app/residentController.listResidents` | - |
| GET | `/:residentId` | auth, member, module:residents, roles:MANAGERS | `app/residentController.getResident` | - |
| GET | `/:residentId/peep-record` | auth, member, module:residents, roles:MANAGERS, module:peepFloorPlan, perm:peepFloorPlan.view | `app/residentController.getPeepRecord` | - |
| POST | `/:residentId/deactivate` | auth, member, module:residents, roles:MANAGERS | `app/residentController.deactivateResident` | - |
| GET | `/:residentId/screen` | auth, member, module:residents, roles:MANAGERS, screenTabAccess | `app/residentController.getResidentScreen` | - |
| GET | `/:residentId/family` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.view | `app/residentController.getFamily` | - |
| PUT | `/:residentId/family/next-of-kin` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.manage | `app/residentController.setNextOfKin` | - |
| DELETE | `/:residentId/family/members/:memberId` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.manage | `app/residentController.removeFamilyMember` | - |
| GET | `/:residentId/family/code` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.view | `app/residentController.getFamilyCode` | - |
| POST | `/:residentId/family/code` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.manage | `app/residentController.createFamilyCode` | - |
| PUT | `/:residentId/family/visiting-password` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.manage | `app/residentController.setVisitingPassword` | - |
| PUT | `/:residentId/family/photos/:uploadId` | auth, member, module:residents, roles:MANAGERS, requireFamilyModule, perm:familyEngagement.approve | `app/residentController.updateFamilyPhoto` | - |

### App: announcements

Base: `/api/v1/app/announcements`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/mine` | auth, member | `app/announcementController.listMine` | - |
| GET | `/mine/:announcementId` | auth, member | `app/announcementController.getMine` | - |
| POST | `/mine/:announcementId/acknowledge` | auth, member | `app/announcementController.acknowledgeAnnouncement` | - |
| GET | `/` | auth, member, roles:MANAGERS | `app/announcementController.listAnnouncements` | - |
| POST | `/` | auth, member, rate:30/15m, roles:MANAGERS | `app/announcementController.createAnnouncement` | - |
| GET | `/:announcementId` | auth, member, roles:MANAGERS | `app/announcementController.getAnnouncement` | - |
| POST | `/:announcementId/remind` | auth, member, rate:30/15m, roles:MANAGERS | `app/announcementController.remindAnnouncement` | - |

### App: departments

Base: `/api/v1/app/departments`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, roles:MANAGERS | `app/departmentController.listDepartments` | `siteLiveService.listSiteDepartments` |

### App: visitor-feedback

Base: `/api/v1/app/visitor-feedback`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, roles:MANAGERS | `app/visitorFeedbackController.getScreen` | - |
| PUT | `/settings` | auth, member, roles:MANAGERS | `app/visitorFeedbackController.saveSettings` | - |

### App: visit-sessions

Base: `/api/v1/app/visit-sessions`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:visitSessionId/approve` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/visitSessionController.approve` | `visitSessionService.approveVisitSession` |
| POST | `/:visitSessionId/deny` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/visitSessionController.deny` | `visitSessionService.denyVisitSession` |

### App: shifts

Base: `/api/v1/app/shifts`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/my` | auth, member, module:rotaScheduling | `app/shiftController.listMyShifts` | `shiftService.listMyShifts` |
| GET | `/open` | auth, member, module:rotaScheduling | `app/shiftController.listOpenShifts` | `shiftService.listOpenShifts` |
| GET | `/active` | auth, member, module:rotaScheduling | `app/shiftController.getActiveShift` | `shiftService.getActiveShift` |
| GET | `/:shiftId` | auth, member, module:rotaScheduling | `app/shiftController.getMyShift` | `shiftService.getMyShift` |
| POST | `/:shiftId/claims` | auth, member, module:rotaScheduling | `app/shiftController.createClaim` | `shiftService.createClaim` |

### App: shift-claims

Base: `/api/v1/app/shift-claims`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:claimId/withdraw` | auth, member, module:rotaScheduling | `app/shiftController.withdrawClaim` | `shiftService.withdrawClaim` |
| POST | `/:claimId/approve` | auth, member, module:rotaScheduling, roles:MANAGERS, perm:rotaScheduling.approve | `admin/shiftController.approveClaim` | `shiftService.approveClaim` |
| POST | `/:claimId/reject` | auth, member, module:rotaScheduling, roles:MANAGERS, perm:rotaScheduling.approve | `admin/shiftController.rejectClaim` | `shiftService.rejectClaim` |

### App: attendance

Base: `/api/v1/app/attendance`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/today` | auth, member, module:signInAttendance | `app/attendanceController.getTodayAttendance` | `attendanceService.getTodayAttendance` |
| POST | `/clock-in` | auth, member, module:signInAttendance | `app/attendanceController.clockIn` | `attendanceService.clockIn` |
| POST | `/clock-out` | auth, member, module:signInAttendance | `app/attendanceController.clockOut` | `attendanceService.clockOut` |
| POST | `/break-in` | auth, member, module:signInAttendance | `app/attendanceController.startBreak` | `attendanceService.startBreak` |
| POST | `/break-out` | auth, member, module:signInAttendance | `app/attendanceController.endBreak` | `attendanceService.endBreak` |
| GET | `/` | auth, member, module:signInAttendance | `app/attendanceController.listMyAttendance` | `attendanceService.listMyAttendance` |
| POST | `/change-requests` | auth, member, module:signInAttendance | `app/attendanceController.createChangeRequest` | `attendanceService.createChangeRequest` |
| POST | `/:dayId/roster-request` | auth, member, module:signInAttendance | `app/attendanceController.requestRoster` | `attendanceService.requestRosterForDay` |

### App: leave-requests

Base: `/api/v1/app/leave-requests`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/entitlements` | auth, member, module:leave | `app/leaveController.listMyEntitlements` | `leaveService.listMyEntitlements` |
| GET | `/scores` | auth, member, module:leave | `app/leaveController.listMyLeaveScores` | `leaveService.listMyLeaveScores` |
| GET | `/` | auth, member, module:leave | `app/leaveController.listMyLeaveRequests` | `leaveService.listMyLeaveRequests` |
| POST | `/report-sickness` | auth, member, module:leave | `app/leaveController.reportSickness` | `leaveService.reportSickness` |
| POST | `/` | auth, member, module:leave | `app/leaveController.createLeaveRequest` | `leaveService.createLeaveRequest` |
| GET | `/:requestId` | auth, member, module:leave | `app/leaveController.getMyLeaveRequest` | `leaveService.getMyLeaveRequest` |
| POST | `/:requestId/cancel` | auth, member, module:leave | `app/leaveController.cancelLeaveRequest` | `leaveService.cancelLeaveRequest` |

### App: leave-approvals

Base: `/api/v1/app/leave-approvals`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:requestId/approve` | auth, member, module:leave, roles:APPROVERS, hasReportsIf:lineManager, perm:leave.approve | `admin/leaveController.approveLeaveRequest` | `leaveService.approveLeaveRequest` |
| POST | `/:requestId/reject` | auth, member, module:leave, roles:APPROVERS, hasReportsIf:lineManager, perm:leave.approve | `admin/leaveController.rejectLeaveRequest` | `leaveService.rejectLeaveRequest` |

### App: evacuations

Base: `/api/v1/app/evacuations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/active` | auth, member, module:fireDrillEvacuation | `app/evacuationController.getActiveEvacuation` | `evacuationService.getActiveEvacuation` |
| GET | `/me/drills` | auth, member, module:fireDrillEvacuation | `app/evacuationController.myDrills` | `evacuationService.myDrills` |
| POST | `/me/check` | auth, member, module:fireDrillEvacuation | `app/evacuationController.markMyself` | `evacuationService.markSelfCheck` |
| GET | `/:evacuationEventId/rollcall` | auth, member, module:fireDrillEvacuation, roles:MANAGERS | `app/evacuationController.getRollcall` | `evacuationService.getRollcall` |
| POST | `/:evacuationEventId/alert-families` | auth, member, module:fireDrillEvacuation, roles:MANAGERS | `app/evacuationController.alertFamilies` | - |
| POST | `/:evacuationEventId/update-families` | auth, member, module:fireDrillEvacuation, roles:MANAGERS | `app/evacuationController.updateFamilies` | - |
| POST | `/:evacuationEventId/all-clear` | auth, member, module:fireDrillEvacuation, roles:MANAGERS | `app/evacuationController.allClearFamilies` | - |

### App: supervision

Base: `/api/v1/app/supervision`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:competencySupervisionAppraisal | `app/supervisionController.mySupervision` | `supervisionService.mySupervision` |
| GET | `/:supervisionId` | auth, member, module:competencySupervisionAppraisal | `app/supervisionController.getSupervision` | `supervisionService.getSupervision` |

### App: appraisal

Base: `/api/v1/app/appraisal`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:competencySupervisionAppraisal | `app/appraisalController.myAppraisal` | `appraisalService.myAppraisal` |
| GET | `/:appraisalId` | auth, member, module:competencySupervisionAppraisal | `app/appraisalController.getAppraisal` | `appraisalService.getAppraisal` |
| POST | `/:appraisalId/acknowledge` | auth, member, module:competencySupervisionAppraisal | `app/appraisalController.acknowledgeAppraisal` | `appraisalService.acknowledgeAppraisal` |

### App: compliance

Base: `/api/v1/app/compliance`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:competencySupervisionAppraisal | `app/complianceController.getMyCompliance` | - |

### App: training

Base: `/api/v1/app/training`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:competencySupervisionAppraisal | `app/requirementListController.myTraining` | `requirementService.myRequirementAssignments` |

### App: competencies

Base: `/api/v1/app/competencies`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:competencySupervisionAppraisal | `app/requirementListController.myCompetencies` | `requirementService.myRequirementAssignments` |

### App: documents

Base: `/api/v1/app/documents`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/shared/:token` | **PUBLIC** rate:60/15m | `app/documentController.openSharedDocument` | `documentService.getSharedDocumentUrl` |
| GET | `/folders` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.view | `app/documentController.listFolders` | - |
| POST | `/folders` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `app/documentController.createFolder` | - |
| POST | `/bulk-upload` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `app/documentController.bulkUpload` | - |
| GET | `/visitor-library` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.view | `app/documentController.listVisitorDocuments` | - |
| POST | `/qr-code` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `app/documentController.createQrCode` | - |
| POST | `/:documentId/qr-link/regenerate` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `app/documentController.regenerateQrLink` | - |
| DELETE | `/:documentId/qr-link` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `app/documentController.revokeQrLink` | - |
| GET | `/` | auth, member, module:documentsEsign, perm:documentsEsign.view | `app/documentController.listDocuments` | `staffDocumentsService.listStaffDocuments` |
| POST | `/:documentId/sign` | auth, member, module:documentsEsign, perm:documentsEsign.view | `app/documentController.signDocument` | `staffDocumentsService.signStaffDocument` |
| GET | `/:documentId` | auth, member, module:documentsEsign, perm:documentsEsign.view | `app/documentController.getDocument` | `staffDocumentsService.getStaffDocument` |

### App: settings

Base: `/api/v1/app/settings`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/terms-conditions` | **PUBLIC** rate:15/10m | `common/settingsController.getTermsAndConditions` | `settingsService.getTermsAndConditions` |
| GET | `/about-us` | **PUBLIC** rate:15/10m | `common/settingsController.getAboutUs` | `settingsService.getAboutUs` |
| GET | `/privacy-policy` | **PUBLIC** rate:15/10m | `common/settingsController.getPrivacyPolicy` | `settingsService.getPrivacyPolicy` |
| GET | `/faqs` | **PUBLIC** rate:15/10m | `common/settingsController.getFaqs` | `settingsService.getFaqs` |

### App: home

Base: `/api/v1/app/home`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member | `app/homeController.getHome` | `homeService.getStaffHome` |

### App: staff

Base: `/api/v1/app/staff`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/dashboard` | auth, member | `app/staffAppDashboardController.getDashboard` | - |
| GET | `/dashboard-settings` | auth, member | `app/staffDashboardSettingsController.getStaffDashboardSettings` | `staffDashboardSettingsService.getStaffDashboardSettingsForStaff` |

### App: site-live

Base: `/api/v1/app/site-live`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/compliance/download/:token` | **PUBLIC**  | `app/siteLiveController.downloadComplianceExport` | - |
| GET | `/activity` | auth, member, roles:MANAGERS | `app/siteLiveController.getSiteLiveActivity` | `siteLiveService.getSiteLiveActivity` |
| GET | `/people` | auth, member, roles:MANAGERS | `app/siteLiveController.listPeople` | `siteLiveService.listPeople` |
| GET | `/directory` | auth, member, roles:MANAGERS | `app/siteLiveController.listDirectory` | `siteLiveService.listDirectory` |
| GET | `/statistics` | auth, member, roles:MANAGERS | `app/siteLiveController.getStatistics` | - |
| GET | `/compliance` | auth, member, roles:MANAGERS | `app/siteLiveController.getCompliance` | - |
| GET | `/compliance/export` | auth, member, roles:MANAGERS | `app/siteLiveController.exportCompliance` | - |
| POST | `/people/:personKind/:recordId/check-out` | auth, member, roles:MANAGERS | `app/siteLiveController.checkOutPerson` | `siteLiveService.checkOutPerson` |
| GET | `/` | auth, member, roles:MANAGERS | `app/siteLiveController.getSiteLive` | `siteLiveService.getSiteLive` |

### App: approvals

Base: `/api/v1/app/approvals`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/detail` | auth, member, roles:MANAGERS | `app/approvalsController.getApprovalDetail` | - |
| PUT | `/join-requests/:requestId` | auth, member, requireFamilyModule, roles:MANAGERS, perm:familyEngagement.approve | `app/approvalsController.decideJoinRequest` | - |
| GET | `/` | auth, member, roles:MANAGERS | `app/approvalsController.listApprovals` | - |

### App: team-live

Base: `/api/v1/app/team-live`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/activity` | auth, member, roles:APPROVERS | `app/teamLiveController.getTeamLiveActivity` | `teamLiveService.getTeamLiveActivity` |
| GET | `/rota` | auth, member, roles:APPROVERS | `app/teamLiveController.getTeamRota` | `teamRotaService.getTeamRota` |
| GET | `/` | auth, member, roles:APPROVERS | `app/teamLiveController.getTeamLive` | `teamLiveService.getTeamLive` |

### App: line-home

Base: `/api/v1/app/line-home`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/today` | auth, member, roles:lineManager | `admin/lineHomeController.getToday` | - |
| GET | `/` | auth, member, roles:lineManager | `admin/lineHomeController.getHome` | - |

### App: users

Base: `/api/v1/app/users`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/profile` | auth | `app/userController.getUserProfile` | - |
| GET | `/profile/:userId` | auth | `app/userController.getOtherUserProfile` | - |
| PUT | `/profile` | auth | `app/userController.updateUserProfile` | `userService.updateUserProfile` |
| GET | `/notification-preferences` | auth | `app/userController.getNotificationPreferences` | - |
| PUT | `/notification-preferences` | auth | `app/userController.updateNotificationPreferences` | - |
| POST | `/:userIdToBlock/block` | auth | `app/userController.blockUser` | `userService.blockUser` |
| POST | `/:userIdToReport/report` | auth | `app/userController.reportUser` | `userService.reportUser` |
| POST | `/add-update-subscription` | auth | `app/userController.addOrUpdateSubscription` | `userService.addOrUpdateSubscription` |
| POST | `/remove-subscription/:subscriptionId` | auth | `app/userController.removeSubscription` | `userService.removeSubscription` |
| GET | `/subscriptions` | auth | `app/userController.getSubscriptions` | `userService.getSubscriptions` |

### Admin: settings

Base: `/api/v1/admin/settings`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/all` | auth, settingsAccess, rate:15/10m | `admin/allSettingsController.getAll` | - |
| PUT | `/all` | auth, settingsAccess, rate:15/10m | `admin/allSettingsController.updateAll` | - |
| GET | `/terms-conditions` | **PUBLIC** rate:15/10m | `common/settingsController.getTermsAndConditions` | `settingsService.getTermsAndConditions` |
| GET | `/about-us` | **PUBLIC** rate:15/10m | `common/settingsController.getAboutUs` | `settingsService.getAboutUs` |
| GET | `/privacy-policy` | **PUBLIC** rate:15/10m | `common/settingsController.getPrivacyPolicy` | `settingsService.getPrivacyPolicy` |
| GET | `/faqs` | **PUBLIC** rate:15/10m | `common/settingsController.getFaqs` | `settingsService.getFaqs` |
| POST | `/faqs` | auth, userType:admin | `admin/adminPanelController.createFaq` | `adminPanelService.createFaq` |
| PUT | `/faqs/:id` | auth, userType:admin | `admin/adminPanelController.updateFaq` | `adminPanelService.updateFaq` |
| DELETE | `/faqs/:id` | auth, userType:admin | `admin/adminPanelController.deleteFaq` | `adminPanelService.deleteFaq` |
| POST | `/create` | auth, userType:admin | `common/settingsController.createAdminSettings` | `settingsService.createAdminSettings` |
| PUT | `/update/:id` | auth, userType:admin | `common/settingsController.updateAdminSettings` | `settingsService.updateAdminSettings` |

### Admin: util

Base: `/api/v1/admin/util`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/bulk-insert` | auth, userType:admin | `admin/dbController.bulkInsertHandler` | `dbService.bulkInsertDocuments` |
| POST | `/delete-collection` | auth, userType:admin | `admin/dbController.deleteCollectionHandler` | `dbService.deleteAllDocuments` |

### Admin: billing

Base: `/api/v1/admin/billing`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/usage` | auth, billingAccess, rate:120/10m | `admin/billingController.listUsage` | - |
| GET | `/usage/:organizationId` | auth, billingAccess, rate:120/10m | `admin/billingController.getUsageDetail` | - |

### Admin: organizations

Base: `/api/v1/admin/organizations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/` | auth | `admin/organizationController.createOrganization` | `organizationService.createOrganization` |
| GET | `/` | auth | `admin/organizationController.listOrganizations` | `organizationService.listOrganizations` |
| GET | `/:organizationId/dashboard` | auth, member, roles:OWNERS | `admin/ownerDashboardController.getDashboard` | - |
| GET | `/:organizationId/site-dashboard` | auth, member, roles:siteManager | `admin/siteDashboardController.getDashboard` | - |
| GET | `/:organizationId/staff-dashboard` | auth, member, roles:staff | `admin/staffDashboardController.getDashboard` | - |
| GET | `/:organizationId/line-dashboard` | auth, member, roles:lineManager | `admin/lineDashboardController.getDashboard` | - |
| GET | `/:organizationId/line-home` | auth, member, roles:lineManager | `admin/lineHomeController.getHome` | - |
| GET | `/:organizationId/line-home/today` | auth, member, roles:lineManager | `admin/lineHomeController.getToday` | - |
| GET | `/:organizationId/site-live/activity` | auth, member, roles:MANAGERS | `app/siteLiveController.getSiteLiveActivity` | `siteLiveService.getSiteLiveActivity` |
| GET | `/:organizationId/site-live` | auth, member, roles:MANAGERS | `app/siteLiveController.getSiteLive` | `siteLiveService.getSiteLive` |
| GET | `/:organizationId/team-live/activity` | auth, member, roles:APPROVERS | `app/teamLiveController.getTeamLiveActivity` | `teamLiveService.getTeamLiveActivity` |
| GET | `/:organizationId/team-live/rota` | auth, member, roles:APPROVERS | `app/teamLiveController.getTeamRota` | `teamRotaService.getTeamRota` |
| GET | `/:organizationId/team-live` | auth, member, roles:APPROVERS | `app/teamLiveController.getTeamLive` | `teamLiveService.getTeamLive` |
| GET | `/:organizationId` | auth, member | `admin/organizationController.getOrganization` | `organizationService.getOrganization` |
| PATCH | `/:organizationId` | auth, member, roles:OWNERS | `admin/organizationController.updateOrganization` | `organizationService.updateOrganization` |
| GET | `/:organizationId/staff-dashboard-settings` | auth, member, roles:OWNERS | `admin/staffDashboardSettingsController.getStaffDashboardSettings` | `staffDashboardSettingsService.getStaffDashboardSettings` |
| PUT | `/:organizationId/staff-dashboard-settings` | auth, member, roles:OWNERS | `admin/staffDashboardSettingsController.saveStaffDashboardSettings` | `staffDashboardSettingsService.saveStaffDashboardSettings` |
| POST | `/:organizationId/staff-dashboard-settings/reset` | auth, member, roles:OWNERS | `admin/staffDashboardSettingsController.resetStaffDashboardSettings` | `staffDashboardSettingsService.resetStaffDashboardSettings` |
| GET | `/:organizationId/visitor-survey-settings` | auth, member, roles:APPROVERS | `admin/visitorSurveyController.getVisitorSurveySettings` | `visitorSurveyService.getVisitorSurveySettings` |
| PUT | `/:organizationId/visitor-survey-settings` | auth, member, roles:OWNERS | `admin/visitorSurveyController.saveVisitorSurveySettings` | `visitorSurveyService.saveVisitorSurveySettings` |
| GET | `/:organizationId/visitor-survey-questions` | auth, member, roles:APPROVERS | `admin/visitorSurveyController.listVisitorSurveyQuestions` | `visitorSurveyService.listVisitorSurveyQuestions` |
| PUT | `/:organizationId/visitor-survey-questions` | auth, member, roles:OWNERS | `admin/visitorSurveyController.saveVisitorSurveyQuestions` | `visitorSurveyService.saveVisitorSurveyQuestions` |
| GET | `/:organizationId/visitor-survey-responses` | auth, member, roles:APPROVERS | `admin/visitorSurveyController.listVisitorSurveyResponses` | `visitorSurveyService.listVisitorSurveyResponses` |
| POST | `/:organizationId/visitor-survey-responses` | auth, member, roles:APPROVERS | `admin/visitorSurveyController.createVisitorSurveyResponse` | `visitorSurveyService.createVisitorSurveyResponse` |
| GET | `/:organizationId/module-access` | auth, member, roles:OWNERS | `admin/organizationController.getModuleAccess` | `organizationService.getModuleAccess` |
| PUT | `/:organizationId/module-access` | auth, member, roles:OWNERS | `admin/organizationController.setModuleAccess` | `organizationService.setModuleAccess` |
| POST | `/:organizationId/branches` | auth, member, roles:OWNERS | `admin/branchController.createBranch` | `branchService.createBranch` |
| GET | `/:organizationId/branches` | auth, member | `admin/branchController.listBranches` | `branchService.listBranches` |
| GET | `/:organizationId/members` | auth, member | `admin/membershipController.listMembers` | `membershipService.listMembers` |
| GET | `/:organizationId/family-overview` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.getOverview` | - |
| GET | `/:organizationId/family-invitations` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyInvitationController.listInvitations` | `familyService.listInvitations` |
| GET | `/:organizationId/family-posts` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listPosts` | - |
| GET | `/:organizationId/family-post-authors` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listPostAuthors` | - |
| GET | `/:organizationId/family-gazettes` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listGazettes` | - |
| GET | `/:organizationId/family-gazettes/download` | auth, member, rate:20/15m, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.downloadGazetteZip` | `familyGazetteAdminService.downloadEntries`, `familyGazetteAdminService.zipStream` |
| GET | `/:organizationId/family-gazettes/:itemId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.getGazette` | - |
| GET | `/:organizationId/family-gazettes/:itemId/pdf` | auth, member, rate:30/15m, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.downloadGazettePdf` | `familyGazetteAdminService.getPdf` |
| GET | `/:organizationId/family-newsletters` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listNewsletters` | - |
| GET | `/:organizationId/family-newsletters/:newsletterId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.getNewsletter` | - |
| GET | `/:organizationId/family-newsletters/:newsletterId/pdf` | auth, member, rate:30/15m, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.downloadNewsletterPdf` | `familyNewsletterService.getPdf` |
| GET | `/:organizationId/family-uploads` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listUploads` | - |
| GET | `/:organizationId/family-visits` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyVisitStaffController.listVisits` | - |
| GET | `/:organizationId/family-groups` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listFamilyGroups` | - |
| GET | `/:organizationId/family-groups/:residentId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.getFamilyGroup` | - |
| GET | `/:organizationId/family-members` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.listAllMembers` | - |
| GET | `/:organizationId/family-members/:memberId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyStaffController.getMember` | - |
| GET | `/:organizationId/family-invitations/:invitationId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view, scopeToOwnBranch, checkFamilyFilters | `admin/familyInvitationController.getInvitation` | `familyService.getInvitation` |
| GET | `/:organizationId/grantable-permissions` | auth, member, roles:APPROVERS | `admin/membershipController.listGrantablePermissions` | `membershipService.listGrantablePermissions` |
| POST | `/:organizationId/invitations` | auth, member, roles:APPROVERS | `admin/membershipController.inviteMember` | `membershipService.inviteMember` |
| GET | `/:organizationId/invitations` | auth, member, roles:MANAGERS | `admin/membershipController.listInvitations` | `membershipService.listInvitations` |
| GET | `/:organizationId/invitations/:invitationId` | auth, member, roles:MANAGERS | `admin/membershipController.getInvitation` | `membershipService.getInvitation` |
| PATCH | `/:organizationId/invitations/:invitationId` | auth, member, roles:APPROVERS | `admin/membershipController.updateInvitation` | `membershipService.updateInvitation` |
| POST | `/:organizationId/departments` | auth, member, roles:MANAGERS | `admin/staffController.createDepartment` | `staffService.createDepartment` |
| GET | `/:organizationId/departments` | auth, member | `admin/staffController.listDepartments` | `staffService.listDepartments` |
| GET | `/:organizationId/departments/:departmentId` | auth, member | `admin/staffController.getDepartment` | `staffService.getDepartment` |
| PATCH | `/:organizationId/departments/:departmentId` | auth, member, roles:MANAGERS | `admin/staffController.updateDepartment` | `staffService.updateDepartment` |
| POST | `/:organizationId/job-titles` | auth, member, roles:MANAGERS | `admin/staffController.createJobTitle` | `staffService.createJobTitle` |
| GET | `/:organizationId/job-titles` | auth, member | `admin/staffController.listJobTitles` | `staffService.listJobTitles` |
| PATCH | `/:organizationId/job-titles/:jobTitleId` | auth, member, roles:MANAGERS | `admin/staffController.updateJobTitle` | `staffService.updateJobTitle` |
| POST | `/:organizationId/staff-profiles` | auth, member, roles:MANAGERS | `admin/staffController.createStaffProfile` | `staffService.createStaffProfile` |
| GET | `/:organizationId/staff-profiles/direct-reports` | auth, member | `admin/staffController.listDirectReports` | `staffService.listDirectReports` |
| GET | `/:organizationId/staff-profiles` | auth, member | `admin/staffController.listStaffProfiles` | `staffService.listStaffProfiles` |
| PATCH | `/:organizationId/staff-profiles/:staffProfileId/compliance-settings` | auth, member, roles:MANAGERS, module:competencySupervisionAppraisal | `admin/appraisalController.updateStaffComplianceSettings` | `appraisalService.updateStaffComplianceSettings` |
| PATCH | `/:organizationId/staff-profiles/:staffProfileId/supervision-settings` | auth, member, roles:MANAGERS, module:competencySupervisionAppraisal | `admin/supervisionController.updateSupervisionSettings` | `supervisionService.updateSupervisionSettings` |
| GET | `/:organizationId/supervision` | auth, member, roles:ALL, module:competencySupervisionAppraisal | `admin/supervisionController.listTeamSupervision` | `supervisionService.listTeamSupervision` |
| POST | `/:organizationId/supervision` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/supervisionController.createSupervision` | `supervisionService.createSupervision` |
| GET | `/:organizationId/supervision/:supervisionId` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/supervisionController.getSupervision` | `supervisionService.getSupervision` |
| PUT | `/:organizationId/supervision/:supervisionId` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/supervisionController.updateSupervision` | `supervisionService.updateSupervision` |
| POST | `/:organizationId/supervision/:supervisionId/action-points/sign-off` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/supervisionController.signOffActionPoints` | `supervisionService.signOffActionPoints` |
| POST | `/:organizationId/supervision/:supervisionId/action-points/:actionPointId/sign-off` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/supervisionController.signOffActionPoint` | `supervisionService.signOffActionPoint` |
| PATCH | `/:organizationId/staff-profiles/:staffProfileId/appraisal-settings` | auth, member, roles:MANAGERS, module:competencySupervisionAppraisal | `admin/appraisalController.updateAppraisalSettings` | `appraisalService.updateStaffComplianceSettings` |
| GET | `/:organizationId/compliance-history` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.listComplianceHistory` | `complianceHistoryService.listComplianceHistory` |
| GET | `/:organizationId/appraisals` | auth, member, roles:ALL, module:competencySupervisionAppraisal | `admin/appraisalController.listTeamAppraisals` | `appraisalService.listTeamAppraisals` |
| POST | `/:organizationId/appraisals` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.createAppraisal` | `appraisalService.createAppraisal` |
| GET | `/:organizationId/appraisals/:appraisalId` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.getAppraisal` | `appraisalService.getAppraisal` |
| PUT | `/:organizationId/appraisals/:appraisalId` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.updateAppraisal` | `appraisalService.updateAppraisal` |
| POST | `/:organizationId/appraisals/:appraisalId/action-points/sign-off` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.signOffActionPoints` | `appraisalService.signOffActionPoints` |
| POST | `/:organizationId/appraisals/:appraisalId/action-points/:actionPointId/sign-off` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.signOffActionPoint` | `appraisalService.signOffActionPoint` |
| POST | `/:organizationId/appraisals/:appraisalId/manager-sign` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/appraisalController.managerSignAppraisal` | `appraisalService.managerSignAppraisal` |
| GET | `/:organizationId/requirements` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/requirementController.listRequirements` | `requirementService.listRequirements` |
| GET | `/:organizationId/requirements/:requirementId` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/requirementController.getRequirement` | `requirementService.getRequirement` |
| POST | `/:organizationId/requirements` | auth, member, roles:MANAGERS, module:competencySupervisionAppraisal | `admin/requirementController.createRequirement` | `requirementService.createRequirement` |
| GET | `/:organizationId/assignments` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/requirementController.listAssignments` | `requirementService.listAssignments` |
| POST | `/:organizationId/assignments` | auth, member, roles:APPROVERS, module:competencySupervisionAppraisal | `admin/requirementController.createAssignments` | `requirementService.createAssignments` |
| GET | `/:organizationId/competency-matrix` | auth, member, roles:ALL, module:competencySupervisionAppraisal | `admin/requirementController.competencyMatrix` | `requirementService.competencyMatrix` |
| GET | `/:organizationId/training-records` | auth, member, roles:ALL, module:competencySupervisionAppraisal | `admin/requirementController.listTrainingRecords` | `requirementService.listTrainingRecords` |
| POST | `/:organizationId/shifts` | auth, member, roles:MANAGERS, module:rotaScheduling, perm:rotaScheduling.manage | `admin/shiftController.createShift` | `shiftService.createShift` |
| GET | `/:organizationId/rota/board` | auth, member, module:rotaScheduling | `admin/shiftController.getRotaBoard` | `rotaBoardService.getRotaBoard` |
| GET | `/:organizationId/shifts` | auth, member, module:rotaScheduling | `admin/shiftController.listShifts` | `shiftService.listShifts` |
| GET | `/:organizationId/shift-claims` | auth, member, roles:APPROVERS, module:rotaScheduling, perm:rotaScheduling.view | `admin/shiftController.listClaims` | `shiftService.listClaims` |
| GET | `/:organizationId/shift-claims/:claimId` | auth, member, roles:APPROVERS, module:rotaScheduling, perm:rotaScheduling.view | `admin/shiftController.getClaim` | `shiftService.getClaim` |
| GET | `/:organizationId/reports/attendance` | auth, member, module:signInAttendance, perm:signInAttendance.view | `admin/attendanceController.attendanceReport` | `attendanceService.attendanceReport` |
| GET | `/:organizationId/reports/visitor-check-ins` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitSessionController.visitorCheckInsReport` | `visitSessionService.visitorCheckInsReport` |
| GET | `/:organizationId/reports/staff-hours-summary` | auth, member, module:signInAttendance, perm:signInAttendance.view | `admin/attendanceController.staffHoursSummary` | `attendanceService.staffHoursSummary` |
| GET | `/:organizationId/reports/sickness-rate` | auth, member, module:signInAttendance, perm:signInAttendance.view | `admin/attendanceController.sicknessRateReport` | `attendanceService.sicknessRateReport` |
| GET | `/:organizationId/reports/late-check-ins` | auth, member, module:signInAttendance, perm:signInAttendance.view | `admin/attendanceController.lateCheckInsReport` | `attendanceService.lateCheckInsReport` |
| GET | `/:organizationId/attendance/rota` | auth, member, module:signInAttendance, perm:signInAttendance.view | `admin/attendanceController.listAttendanceRota` | `attendanceService.listAttendanceRota` |
| GET | `/:organizationId/attendance` | auth, member, module:signInAttendance, perm:signInAttendance.view | `admin/attendanceController.listAttendanceDays` | `attendanceService.listAttendanceDays` |
| POST | `/:organizationId/attendance/:attendanceDayId/approve-roster` | auth, member, roles:MANAGERS, module:signInAttendance, perm:signInAttendance.approve | `admin/attendanceController.approveRoster` | `attendanceService.approveRosterForDay` |
| POST | `/:organizationId/attendance/:attendanceDayId/reject-roster` | auth, member, roles:MANAGERS, module:signInAttendance, perm:signInAttendance.approve | `admin/attendanceController.rejectRoster` | `attendanceService.rejectRosterForDay` |
| GET | `/:organizationId/attendance-change-requests` | auth, member, roles:MANAGERS, module:signInAttendance, perm:signInAttendance.approve | `admin/attendanceController.listChangeRequests` | `attendanceService.listChangeRequests` |
| GET | `/:organizationId/leave-requests` | auth, member, module:leave, perm:leave.view | `admin/leaveController.listLeaveRequests` | `leaveService.listLeaveRequests` |
| GET | `/:organizationId/leave-requests/:requestId` | auth, member, module:leave, perm:leave.view | `admin/leaveController.getLeaveRequest` | `leaveService.getLeaveRequest` |
| POST | `/:organizationId/leave-requests/record` | auth, member, roles:MANAGERS, module:leave, perm:leave.manage | `admin/leaveController.recordManagerLeave` | `leaveService.recordManagerLeave` |
| GET | `/:organizationId/leave-entitlements` | auth, member, module:leave, perm:leave.view | `admin/leaveController.listEntitlements` | `leaveService.listEntitlements` |
| GET | `/:organizationId/leave-scores` | auth, member, module:leave, perm:leave.view | `admin/leaveController.listLeaveScores` | `leaveService.listLeaveScores` |
| PUT | `/:organizationId/leave-entitlements` | auth, member, roles:MANAGERS, module:leave, perm:leave.manage | `admin/leaveController.upsertEntitlement` | `leaveService.upsertEntitlement` |
| GET | `/:organizationId/evacuations/on-site-summary` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/evacuationController.getOnSiteSummary` | `evacuationService.getOnSiteSummary` |
| GET | `/:organizationId/evacuations/active` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/evacuationController.getActiveEvacuation` | `evacuationService.getActiveEvacuation` |
| GET | `/:organizationId/evacuations` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/evacuationController.listEvacuations` | `evacuationService.listEvacuations` |
| POST | `/:organizationId/evacuations` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/evacuationController.startEvacuation` | `evacuationService.startEvacuation` |
| POST | `/:organizationId/external-people` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/externalPersonController.createExternalPerson` | `externalPersonService.createExternalPerson` |
| GET | `/:organizationId/external-people` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/externalPersonController.listExternalPeople` | `externalPersonService.listExternalPeople` |
| PATCH | `/:organizationId/users/:userId/account` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/externalPersonController.updateVisitorUserAccount` | `externalPersonService.updateVisitorUserAccount` |
| GET | `/:organizationId/person-categories` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/personCategoryController.listPersonCategories` | `personCategoryService.listPersonCategories` |
| POST | `/:organizationId/person-categories` | auth, member, roles:APPROVERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/personCategoryController.createPersonCategory` | `personCategoryService.createPersonCategory` |
| PATCH | `/:organizationId/person-categories/:categoryId` | auth, member, roles:APPROVERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/personCategoryController.updatePersonCategory` | `personCategoryService.updatePersonCategory` |
| DELETE | `/:organizationId/person-categories/:categoryId` | auth, member, roles:APPROVERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/personCategoryController.deletePersonCategory` | `personCategoryService.deletePersonCategory` |
| GET | `/:organizationId/visit-sessions/on-site-counts` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitSessionController.getOnSiteCounts` | `visitSessionService.getOnSiteCounts` |
| GET | `/:organizationId/visit-sessions/analytics` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitSessionController.getVisitAnalytics` | `visitSessionService.getVisitAnalytics` |
| POST | `/:organizationId/visit-sessions/register-and-check-in` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/visitSessionController.registerAndCheckIn` | `visitSessionService.registerAndCheckIn` |
| POST | `/:organizationId/visit-sessions/check-in` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/visitSessionController.checkIn` | `visitSessionService.checkIn` |
| POST | `/:organizationId/visitor-invitations` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/visitorInvitationController.createVisitorInvitation` | `visitorInvitationService.createVisitorInvitation` |
| POST | `/:organizationId/visitor-account-invitations` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/visitorAccountInvitationController.createVisitorAccountInvitation` | `visitorAccountInvitationService.createVisitorAccountInvitation` |
| GET | `/:organizationId/visitor-account-invitations` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitorAccountInvitationController.listVisitorAccountInvitations` | `visitorAccountInvitationService.listVisitorAccountInvitations` |
| POST | `/:organizationId/visitor-account-invitations/:invitationId/resend` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/visitorAccountInvitationController.resendVisitorAccountInvitation` | `visitorAccountInvitationService.resendVisitorAccountInvitation` |
| POST | `/:organizationId/visitor-account-invitations/:invitationId/revoke` | auth, member, roles:MANAGERS, module:fireDrillEvacuation, perm:fireDrillEvacuation.manage | `admin/visitorAccountInvitationController.revokeVisitorAccountInvitation` | `visitorAccountInvitationService.revokeVisitorAccountInvitation` |
| GET | `/:organizationId/visitor-invitations` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitorInvitationController.listVisitorInvitations` | `visitorInvitationService.listVisitorInvitations` |
| GET | `/:organizationId/visit-sessions` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitSessionController.listVisitSessions` | `visitSessionService.listVisitSessions` |
| GET | `/:organizationId/kiosk-widgets` | auth, member, roles:MANAGERS, module:signInAttendance | `admin/kioskWidgetController.listKioskWidgets` | `kioskWidgetService.listKioskWidgets` |
| PUT | `/:organizationId/kiosk-widgets` | auth, member, roles:MANAGERS, module:signInAttendance | `admin/kioskWidgetController.saveKioskWidgets` | `kioskWidgetService.saveKioskWidgets` |
| GET | `/:organizationId/floor-plans` | auth, member, module:peepFloorPlan, perm:peepFloorPlan.view | `admin/floorPlanController.listFloorPlans` | `floorPlanService.listFloorPlans` |
| POST | `/:organizationId/floor-plans` | auth, member, roles:MANAGERS, module:peepFloorPlan, perm:peepFloorPlan.manage | `admin/floorPlanController.createFloorPlan` | `floorPlanService.createFloorPlan` |
| GET | `/:organizationId/peep-floor-summary` | auth, member, module:peepFloorPlan, perm:peepFloorPlan.view | `admin/peepRecordController.getPeepFloorSummary` | `peepRecordService.getPeepFloorSummary` |
| GET | `/:organizationId/peep-records` | auth, member, module:peepFloorPlan, perm:peepFloorPlan.view | `admin/peepRecordController.listPeepRecords` | `peepRecordService.listPeepRecords` |
| POST | `/:organizationId/peep-records` | auth, member, roles:MANAGERS, module:peepFloorPlan, perm:peepFloorPlan.manage | `admin/peepRecordController.createPeepRecord` | `peepRecordService.createPeepRecord` |
| GET | `/:organizationId/residents/:residentId/peep-record` | auth, member, module:peepFloorPlan, perm:peepFloorPlan.view | `admin/peepRecordController.getPeepRecordByResident` | `peepRecordService.getPeepRecordByResident` |
| GET | `/:organizationId/document-categories` | auth, member, module:documentsEsign, perm:documentsEsign.view | `admin/documentController.listDocumentCategories` | `documentCategoryService.listDocumentCategories` |
| POST | `/:organizationId/document-categories` | auth, member, roles:APPROVERS, module:documentsEsign, perm:documentsEsign.manage | `admin/documentController.createDocumentCategory` | `documentCategoryService.createDocumentCategory` |
| PATCH | `/:organizationId/document-categories/:categoryId` | auth, member, roles:APPROVERS, module:documentsEsign, perm:documentsEsign.manage | `admin/documentController.updateDocumentCategory` | `documentCategoryService.updateDocumentCategory` |
| DELETE | `/:organizationId/document-categories/:categoryId` | auth, member, roles:APPROVERS, module:documentsEsign, perm:documentsEsign.manage | `admin/documentController.deleteDocumentCategory` | `documentCategoryService.deleteDocumentCategory` |
| GET | `/:organizationId/documents` | auth, member, module:documentsEsign, perm:documentsEsign.view | `admin/documentController.listDocuments` | `documentService.listDocuments` |
| POST | `/:organizationId/documents` | auth, member, roles:MANAGERS, module:documentsEsign, perm:documentsEsign.manage | `admin/documentController.createDocument` | `documentService.createDocument` |
| GET | `/:organizationId/resident-media` | auth, member, roles:MANAGERS | `admin/residentMediaController.listResidentMedia` | `residentMediaService.listResidentMedia` |
| POST | `/:organizationId/resident-media/:mediaId/review` | auth, member, roles:MANAGERS | `admin/residentMediaController.reviewResidentMedia` | `residentMediaService.reviewResidentMedia` |

### Admin: branches

Base: `/api/v1/admin/branches`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:branchId` | auth, member | `admin/branchController.getBranch` | `branchService.getBranch` |
| PATCH | `/:branchId` | auth, member, roles:MANAGERS | `admin/branchController.updateBranch` | `branchService.updateBranch` |
| POST | `/:branchId/activation-codes` | auth, member, roles:OWNERS | `admin/branchController.issueActivationCode` | `branchService.issueActivationCode` |
| GET | `/:branchId/activation-codes` | auth, member, roles:MANAGERS | `admin/branchController.listActivationCodes` | `branchService.listActivationCodes` |
| POST | `/:branchId/activation-codes/:activationCodeId/revoke` | auth, member, roles:OWNERS | `admin/branchController.revokeActivationCode` | `branchService.revokeActivationCode` |

### Admin: memberships

Base: `/api/v1/admin/memberships`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:membershipId` | auth, member | `admin/membershipController.getMembership` | `membershipService.getMembership` |
| PATCH | `/:membershipId` | auth, member, roles:MANAGERS | `admin/membershipController.updateMembership` | `membershipService.updateMembership` |
| POST | `/:membershipId/deactivate` | auth, member, roles:MANAGERS | `admin/membershipController.deactivateMembership` | `membershipService.deactivateMembership` |

### Admin: invitations

Base: `/api/v1/admin/invitations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| PATCH | `/:invitationId` | auth, member, roles:APPROVERS | `admin/membershipController.updateInvitation` | `membershipService.updateInvitation` |
| POST | `/:invitationId/resend` | auth, member, roles:MANAGERS | `admin/membershipController.resendInvitation` | `membershipService.resendInvitation` |
| POST | `/:invitationId/revoke` | auth, member, roles:MANAGERS | `admin/membershipController.revokeInvitation` | `membershipService.revokeInvitation` |

### Admin: departments

Base: `/api/v1/admin/departments`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:departmentId` | auth, member | `admin/staffController.getDepartment` | `staffService.getDepartment` |
| PATCH | `/:departmentId` | auth, member, roles:MANAGERS | `admin/staffController.updateDepartment` | `staffService.updateDepartment` |

### Admin: job-titles

Base: `/api/v1/admin/job-titles`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:jobTitleId` | auth, member | `admin/staffController.getJobTitle` | `staffService.getJobTitle` |
| PATCH | `/:jobTitleId` | auth, member, roles:MANAGERS | `admin/staffController.updateJobTitle` | `staffService.updateJobTitle` |

### Admin: staff-profiles

Base: `/api/v1/admin/staff-profiles`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:staffProfileId` | auth, member | `admin/staffController.getStaffProfile` | `staffService.getStaffProfile` |
| PATCH | `/:staffProfileId` | auth, member, roles:MANAGERS | `admin/staffController.updateStaffProfile` | `staffService.updateStaffProfile` |

### Admin: shifts

Base: `/api/v1/admin/shifts`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:shiftId` | auth, member, module:rotaScheduling | `admin/shiftController.getShift` | `shiftService.getShift` |
| PATCH | `/:shiftId` | auth, member, module:rotaScheduling, roles:MANAGERS, perm:rotaScheduling.manage | `admin/shiftController.updateShift` | `shiftService.updateShift` |

### Admin: shift-claims

Base: `/api/v1/admin/shift-claims`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:claimId/approve` | auth, member, module:rotaScheduling, roles:APPROVERS, hasReportsIf:lineManager, perm:rotaScheduling.approve | `admin/shiftController.approveClaim` | `shiftService.approveClaim` |
| POST | `/:claimId/reject` | auth, member, module:rotaScheduling, roles:APPROVERS, hasReportsIf:lineManager, perm:rotaScheduling.approve | `admin/shiftController.rejectClaim` | `shiftService.rejectClaim` |

### Admin: attendance

Base: `/api/v1/admin/attendance`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:attendanceDayId` | auth, member, module:signInAttendance | `admin/attendanceController.getAttendanceDay` | `attendanceService.getAttendanceDay` |
| PATCH | `/:attendanceDayId` | auth, member, module:signInAttendance, roles:MANAGERS, perm:signInAttendance.manage | `admin/attendanceController.updateAttendanceDay` | `attendanceService.updateAttendanceDay` |

### Admin: attendance-change-requests

Base: `/api/v1/admin/attendance-change-requests`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:requestId/approve` | auth, member, module:signInAttendance, roles:APPROVERS, hasReportsIf:lineManager, perm:signInAttendance.approve | `admin/attendanceController.approveChangeRequest` | `attendanceService.approveChangeRequest` |
| POST | `/:requestId/reject` | auth, member, module:signInAttendance, roles:APPROVERS, hasReportsIf:lineManager, perm:signInAttendance.approve | `admin/attendanceController.rejectChangeRequest` | `attendanceService.rejectChangeRequest` |

### Admin: leave-requests

Base: `/api/v1/admin/leave-requests`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:requestId` | auth, member, module:leave | `admin/leaveController.getLeaveRequest` | `leaveService.getLeaveRequest` |
| POST | `/:requestId/close` | auth, member, module:leave, roles:MANAGERS, perm:leave.manage | `admin/leaveController.closeLeaveRequest` | `leaveService.closeLeaveRequest` |

### Admin: leave-approvals

Base: `/api/v1/admin/leave-approvals`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:requestId/approve` | auth, member, module:leave, roles:APPROVERS, hasReportsIf:lineManager, perm:leave.approve | `admin/leaveController.approveLeaveRequest` | `leaveService.approveLeaveRequest` |
| POST | `/:requestId/reject` | auth, member, module:leave, roles:APPROVERS, hasReportsIf:lineManager, perm:leave.approve | `admin/leaveController.rejectLeaveRequest` | `leaveService.rejectLeaveRequest` |

### Admin: evacuations

Base: `/api/v1/admin/evacuations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:evacuationEventId` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/evacuationController.getEvacuationEvent` | `evacuationService.getEvacuationEvent` |
| POST | `/:evacuationEventId/close` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/evacuationController.closeEvacuation` | `evacuationService.closeEvacuation` |
| GET | `/:evacuationEventId/checks` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/evacuationController.listEvacChecks` | `evacuationService.listEvacChecks` |
| POST | `/:evacuationEventId/checks` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/evacuationController.upsertEvacCheck` | `evacuationService.upsertEvacCheck` |

### Admin: external-people

Base: `/api/v1/admin/external-people`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:externalPersonId` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/externalPersonController.getExternalPerson` | `externalPersonService.getExternalPerson` |
| PATCH | `/:externalPersonId` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/externalPersonController.updateExternalPerson` | `externalPersonService.updateExternalPerson` |

### Admin: visit-sessions

Base: `/api/v1/admin/visit-sessions`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:visitSessionId` | auth, member, module:fireDrillEvacuation, perm:fireDrillEvacuation.view | `admin/visitSessionController.getVisitSession` | `visitSessionService.getVisitSession` |
| POST | `/:visitSessionId/check-out` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/visitSessionController.checkOut` | `visitSessionService.checkOut` |
| POST | `/:visitSessionId/approve` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/visitSessionController.approve` | `visitSessionService.approveVisitSession` |
| POST | `/:visitSessionId/deny` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/visitSessionController.deny` | `visitSessionService.denyVisitSession` |

### Admin: visitor-invitations

Base: `/api/v1/admin/visitor-invitations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/:invitationId/resend` | auth, member, module:fireDrillEvacuation, roles:MANAGERS, perm:fireDrillEvacuation.manage | `admin/visitorInvitationController.resendVisitorInvitation` | `visitorInvitationService.resendVisitorInvitation` |

### Admin: residents

Base: `/api/v1/admin/residents`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, module:residents, roles:ALL | `admin/residentController.listResidents` | `residentService.listResidents` |
| POST | `/` | auth, member, module:residents, roles:APPROVERS | `admin/residentController.createResident` | `residentService.createResident` |
| GET | `/:residentId` | auth, member, module:residents, roles:ALL | `admin/residentController.getResident` | `residentService.getResident` |
| PATCH | `/:residentId` | auth, member, module:residents, roles:APPROVERS | `admin/residentController.updateResident` | `residentService.updateResident` |
| PUT | `/:residentId/restriction` | auth, member, module:residents, roles:APPROVERS | `admin/residentController.setRestriction` | `residentService.setRestriction` |
| PUT | `/:residentId/out` | auth, member, module:residents, roles:APPROVERS | `admin/residentController.setOut` | `residentService.setOut` |
| PUT | `/:residentId/visitor-passcode` | auth, member, module:residents, roles:APPROVERS | `admin/residentController.setVisitorPasscode` | `residentService.setVisitorPasscode` |
| POST | `/:residentId/verify-passcode` | auth, member, module:residents, roles:APPROVERS | `admin/residentController.verifyVisitorPasscode` | `residentService.verifyVisitorPasscode` |

### Admin: family-invitations

Base: `/api/v1/admin/family-invitations`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/` | auth, member, requireFamilyModule, roles:ALL, rate:30/15m, perm:familyEngagement.manage | `admin/familyInvitationController.inviteFamilyMember` | `familyService.inviteFamilyMember` |
| PUT | `/:invitationId` | auth, member, requireFamilyModule, roles:ALL, rate:30/15m, perm:familyEngagement.manage | `admin/familyInvitationController.updateInvitation` | - |
| DELETE | `/:invitationId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyInvitationController.deleteInvitation` | - |

### Admin: family

Base: `/api/v1/admin/family`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/relationships` | auth | `admin/familyStaffController.listRelationships` | - |
| PUT | `/members/:memberId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.updateMember` | - |
| PUT | `/members/:memberId/access` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.updateMemberAccess` | - |
| GET | `/residents/:residentId/members` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view | `admin/familyStaffController.listMembers` | - |
| DELETE | `/residents/:residentId/members/:memberId` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.removeMember` | - |
| PUT | `/residents/:residentId/next-of-kin` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.setNextOfKin` | - |
| GET | `/residents/:residentId/code` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view | `admin/familyStaffController.getCode` | - |
| POST | `/residents/:residentId/code` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.createCode` | - |
| GET | `/join-requests` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view | `admin/familyStaffController.listJoinRequests` | - |
| PUT | `/join-requests/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.approve | `admin/familyStaffController.updateJoinRequest` | - |
| POST | `/uploads/media/batch` | auth, member, requireFamilyModule, roles:ALL, rate:12/15m, perm:familyEngagement.manage, receivePhotos | `admin/familyStaffController.uploadPostPhotos` | - |
| POST | `/uploads/media` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage, receivePhoto | `admin/familyStaffController.uploadPostPhoto` | - |
| POST | `/uploads` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage | `admin/familyStaffController.sendUpload` | - |
| PUT | `/uploads/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.approve | `admin/familyStaffController.updateUpload` | - |
| GET | `/posts/taggable-residents` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view | `admin/familyStaffController.listTaggableResidents` | - |
| POST | `/posts/media/batch` | auth, member, requireFamilyModule, roles:ALL, rate:12/15m, perm:familyEngagement.manage, receivePhotos | `admin/familyStaffController.uploadPostPhotos` | - |
| POST | `/posts/media` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage, receivePhoto | `admin/familyStaffController.uploadPostPhoto` | - |
| POST | `/posts` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage | `admin/familyStaffController.createPost` | - |
| PUT | `/posts/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.updatePost` | - |
| DELETE | `/posts/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.removePost` | - |
| PUT | `/posts/:id/reports` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.updatePostReports` | - |
| POST | `/newsletters` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.createNewsletter` | - |
| PUT | `/newsletters/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.updateNewsletter` | - |
| POST | `/gazette-issues` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage | `admin/familyStaffController.generateGazettes` | - |
| PUT | `/gazette-issues` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage | `admin/familyStaffController.updateGazetteIssue` | - |
| PUT | `/gazettes/:itemId` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage | `admin/familyStaffController.updateGazette` | - |
| PUT | `/newsletters/:id/delivery` | auth, member, requireFamilyModule, roles:ALL, rate:20/15m, perm:familyEngagement.manage | `admin/familyStaffController.updateNewsletterDelivery` | - |
| DELETE | `/newsletters/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.manage | `admin/familyStaffController.removeNewsletter` | - |
| GET | `/handovers` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.view | `admin/familyStaffController.listHandovers` | - |
| POST | `/visits` | auth, member, requireFamilyModule, roles:ALL, rate:60/15m, perm:familyEngagement.manage | `admin/familyVisitStaffController.inviteFamily` | - |
| PUT | `/visits/:id` | auth, member, requireFamilyModule, roles:ALL, perm:familyEngagement.approve | `admin/familyVisitStaffController.updateVisit` | - |

### Admin: kiosks

Base: `/api/v1/admin/kiosks`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, roles:MANAGERS | `admin/kioskAdminController.listKiosks` | `kioskService.listKiosksForAdmin` |
| POST | `/` | auth, member, roles:MANAGERS | `admin/kioskAdminController.createKiosk` | `kioskService.createKioskForAdmin` |
| GET | `/:kioskId` | auth, member, roles:MANAGERS | `admin/kioskAdminController.getKiosk` | `kioskService.getKioskForAdmin` |
| PATCH | `/:kioskId` | auth, member, roles:MANAGERS | `admin/kioskAdminController.updateKiosk` | `kioskService.updateKioskForAdmin` |
| POST | `/:kioskId/toggle-lock` | auth, member, roles:MANAGERS | `admin/kioskAdminController.toggleLock` | `kioskService.toggleKioskLockForAdmin` |

### Admin: floor-plans

Base: `/api/v1/admin/floor-plans`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:floorPlanId` | auth, member, module:peepFloorPlan, perm:peepFloorPlan.view | `admin/floorPlanController.getFloorPlan` | `floorPlanService.getFloorPlan` |
| PATCH | `/:floorPlanId` | auth, member, module:peepFloorPlan, roles:MANAGERS, perm:peepFloorPlan.manage | `admin/floorPlanController.updateFloorPlan` | `floorPlanService.updateFloorPlan` |
| PUT | `/:floorPlanId/pins` | auth, member, module:peepFloorPlan, roles:MANAGERS, perm:peepFloorPlan.manage | `admin/floorPlanController.upsertFloorPlanPin` | `floorPlanService.upsertFloorPlanPin` |
| DELETE | `/:floorPlanId/pins/:pinId` | auth, member, module:peepFloorPlan, roles:MANAGERS, perm:peepFloorPlan.manage | `admin/floorPlanController.deleteFloorPlanPin` | `floorPlanService.deleteFloorPlanPin` |

### Admin: peep-records

Base: `/api/v1/admin/peep-records`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:peepRecordId` | auth, member, module:peepFloorPlan, perm:peepFloorPlan.view | `admin/peepRecordController.getPeepRecord` | `peepRecordService.getPeepRecord` |
| PATCH | `/:peepRecordId` | auth, member, module:peepFloorPlan, roles:MANAGERS, perm:peepFloorPlan.manage | `admin/peepRecordController.updatePeepRecord` | `peepRecordService.updatePeepRecord` |

### Admin: statistics

Base: `/api/v1/admin/statistics`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, roles:MANAGERS | `admin/statisticsController.getStatistics` | `statisticsService.getStatistics` |

### Admin: platform

Base: `/api/v1/admin/platform`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/dashboard` | auth, userType:admin, rate:120/10m | `admin/superAdminDashboardController.getDashboard` | - |

### Admin: documents

Base: `/api/v1/admin/documents`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:documentId/acknowledgements` | auth, member, module:documentsEsign, perm:documentsEsign.view | `admin/documentController.listAcknowledgements` | `documentService.listDocumentAcknowledgements` |
| POST | `/:documentId/versions` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `admin/documentController.addDocumentVersion` | `documentService.addDocumentVersion` |
| GET | `/:documentId` | auth, member, module:documentsEsign, perm:documentsEsign.view | `admin/documentController.getDocument` | `documentService.getDocument` |
| PATCH | `/:documentId` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `admin/documentController.updateDocument` | `documentService.updateDocument` |
| DELETE | `/:documentId` | auth, member, module:documentsEsign, roles:MANAGERS, perm:documentsEsign.manage | `admin/documentController.deleteDocument` | `documentService.deleteDocument` |

### Admin: requirements

Base: `/api/v1/admin/requirements`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| PATCH | `/:requirementId` | auth, member, module:competencySupervisionAppraisal, roles:MANAGERS | `admin/requirementController.updateRequirement` | `requirementService.updateRequirement` |

### Admin: assignments

Base: `/api/v1/admin/assignments`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/:assignmentId` | auth, member, module:competencySupervisionAppraisal, roles:APPROVERS | `admin/requirementController.getAssignment` | `requirementService.getAssignment` |
| PATCH | `/:assignmentId` | auth, member, module:competencySupervisionAppraisal, roles:APPROVERS | `admin/requirementController.updateAssignment` | `requirementService.updateAssignment` |
| DELETE | `/:assignmentId` | auth, member, module:competencySupervisionAppraisal, roles:APPROVERS | `admin/requirementController.deleteAssignment` | `requirementService.deleteAssignment` |
| POST | `/:assignmentId/records` | auth, member, module:competencySupervisionAppraisal, roles:APPROVERS | `admin/requirementController.createRecord` | `requirementService.createRecord` |

### Admin: announcements

Base: `/api/v1/admin/announcements`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, member, roles:MANAGERS | `admin/announcementController.listAnnouncements` | - |
| POST | `/` | auth, member, roles:MANAGERS, rate:30/15m | `admin/announcementController.createAnnouncement` | - |
| GET | `/:announcementId` | auth, member, roles:MANAGERS | `admin/announcementController.getAnnouncement` | - |
| POST | `/:announcementId/remind` | auth, member, roles:MANAGERS, rate:30/15m | `admin/announcementController.remindAnnouncement` | - |

### Admin: module-definitions

Base: `/api/v1/admin/module-definitions`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth | `admin/organizationController.listModuleDefinitions` | `organizationService.listModuleDefinitions` |

### Common: upload

Base: `/api/v1/upload`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/` | **PUBLIC** rate:20/10m | `common/uploadController.uploadFile` | `uploadService.buildUploadedFileResponse` |
| GET | `/:filename` | **PUBLIC**  | `common/uploadController.getFileByName` | `uploadService.getFilePath` |
| GET | `/details/:filename` | **PUBLIC**  | `common/uploadController.getFileDetails` | `uploadService.getFileDetails` |
| GET | `/` | **PUBLIC**  | `common/uploadController.getAllFiles` | `uploadService.getAllFiles` |
| POST | `/s3` | **PUBLIC**  | `common/uploadAWSController.uploadFiles` | `uploadAwsService.uploadFiles` |
| DELETE | `/s3` | **PUBLIC**  | `common/uploadAWSController.deleteFiles` | `uploadAwsService.deleteFiles` |

### Common: auth

Base: `/api/v1/auth`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| POST | `/login` | **PUBLIC** rate:15/15m | `common/authController.login` | `authService.login` |
| GET | `/me` | auth | `common/authController.me` | `authService.me` |
| POST | `/forgot-password` | **PUBLIC** rate:15/15m | `common/authController.generateOtp` | - |
| POST | `/resend-otp/email` | **PUBLIC** rate:15/15m | `common/authController.generateOtp` | - |
| POST | `/resend-otp/phone` | **PUBLIC** rate:15/15m | `common/authController.generateOtp` | - |
| POST | `/verify-otp/email` | **PUBLIC** rate:15/15m | `common/authController.verifyOtp` | - |
| POST | `/verify-otp/phone` | **PUBLIC** rate:15/15m | `common/authController.verifyOtp` | - |
| POST | `/reset-password` | **PUBLIC** rate:15/15m | `common/authController.resetPassword` | `authService.resetPassword` |
| POST | `/change-password` | auth, rate:15/15m | `common/authController.changePassword` | `authService.changePassword` |
| GET | `/invitations/:token` | **PUBLIC** rate:15/15m | `common/authController.previewInvitation` | `membershipService.previewInvitation` |
| POST | `/invitations/:token/accept` | **PUBLIC** rate:15/15m | `common/authController.acceptInvitation` | `membershipService.acceptInvitation` |
| GET | `/family-invitations/:token` | **PUBLIC** rate:15/15m | `common/authController.previewFamilyInvitation` | `familyService.previewInvitation` |
| POST | `/family-invitations/:token/accept` | **PUBLIC** rate:15/15m | `common/authController.acceptFamilyInvitation` | `familyService.acceptInvitation` |
| GET | `/visitor-account-invitations/:token` | **PUBLIC** rate:15/15m | `common/authController.previewVisitorAccountInvitation` | `visitorAccountInvitationService.previewVisitorAccountInvitation` |
| POST | `/visitor-account-invitations/:token/accept` | **PUBLIC** rate:15/15m | `common/authController.acceptVisitorAccountInvitation` | `visitorAccountInvitationService.acceptVisitorAccountInvitation` |
| POST | `/logout` | auth | `common/authController.logout` | `authService.logout` |
| DELETE | `/delete-account` | auth | `common/authController.deleteAccount` | `authService.deleteAccount` |

### Common: chats

Base: `/api/v1/chats`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | auth, rate:120/10m, audience:family | `common/chatModule/messageController.listChats` | - |
| GET | `/messages` | auth, rate:120/10m, audience:family | `common/chatModule/messageController.listChatMessages` | - |
| PUT | `/:conversationId/action` | auth, rate:60/10m, audience:family | `common/chatModule/messageController.updateChat` | - |
| POST | `/message` | auth, rate:20/15m, audience:staff, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.manage | `common/chatModule/messageController.sendMessage` | - |
| GET | `/contacts` | auth, rate:120/10m, audience:staff, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `common/chatModule/messageController.listContacts` | - |
| GET | `/contacts/:conversationId` | auth, rate:120/10m, audience:staff, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `common/chatModule/messageController.getContact` | - |
| GET | `/recipients` | auth, rate:120/10m, audience:staff, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `common/chatModule/messageController.listRecipients` | - |
| GET | `/sent` | auth, rate:120/10m, audience:staff, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `common/chatModule/messageController.listSentMessages` | - |
| GET | `/sent/:broadcastId` | auth, rate:120/10m, audience:staff, member, requireFamilyModule, roles:ALL, checkFamilyFilters, perm:familyEngagement.view | `common/chatModule/messageController.getSentMessage` | - |

### Common: notifications

Base: `/api/v1/notifications`

| Method | Path | Guards | Controller function | Service |
|---|---|---|---|---|
| GET | `/` | rate:50/10m, auth | `common/notificationsController.getNotifications` | `notificationService.getNotifications` |
| PUT | `/read-all` | rate:50/10m, auth | `common/notificationsController.readAllNotifications` | `notificationService.readAllNotifications` |
| PUT | `/:id/read` | rate:50/10m, auth | `common/notificationsController.readNotification` | `notificationService.readNotification` |

## 12. Data models

84 Mongoose models. `*` = required; `→` = reference. Arrays of sub-documents show the array name only.

### AdminSettings

Collection: `adminsettings`

Fields: `terms_and_conditions`, `about_us`, `privacy_policy`, `faqs`, `createdAt`, `updatedAt`

### Announcement

Collection: `announcements`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `createdBy→User*`, `subject*`, `description*`, `category`, `audience`, `departmentIds`, `recipients`, `remindedAt`, `createdAt`, `updatedAt`

### AppraisalRecord

Collection: `appraisalrecords`

Fields: `organizationId→Organization*`, `staffId→StaffProfile*`, `branchId→Branch*`, `kind`, `periodLabel`, `scheduledAt`, `completedAt`, `conductedByStaffId→StaffProfile`, `conductedByUserId→User`, `managerComments`, `goals`, `trainingNeeds`, `actionPoints`, `file`, `staffSignedAt`, `staffSignedByUserId→User`, `staffSignatureUrl`, `siteManagerSignedAt`, `siteManagerSignedByUserId→User`, `siteManagerSignatureUrl`, `lockedAt`, `status`, `createdAt`, `updatedAt`

### AttendanceChangeRequest

Collection: `attendancechangerequests`

Fields: `attendanceDayId→AttendanceDay*`, `requestedBy→User*`, `reviewedBy→User`, `payload*`, `status`, `createdAt`, `updatedAt`

### AttendanceDay

Collection: `attendancedays`. Unique: `staffId`, `clientEventId`

Fields: `staffId→StaffProfile*`, `branchId→Branch*`, `workDate*`, `shiftId→Shift`, `clockInAt*`, `clockOutAt`, `breaks`, `checkInMethod`, `punctualityStatus`, `presenceStatus`, `workedMinutes`, `autoClosed`, `signOutResolvedAt`, `signOutResolvedByUserId→User`, `rosterRequestStatus`, `rosterRequestedAt`, `rosterReviewedBy→User`, `rosterReviewedAt`, `clientEventId`, `occurredAt`, `geo.lat`, `geo.lng`, `geo.accuracy`, `createdAt`, `updatedAt`

### Branch

Collection: `branches`. Unique: `code`, `organizationId+code`, `organizationId+nameKey`

Fields: `organizationId→Organization*`, `name*`, `nameKey`, `code*`, `address`, `timezone`, `status`, `emergencyPinHash`, `assemblyPoint`, `settings.enableBreaks`, `settings.lateGraceMinutes`, `settings.earlyClockInMinutes`, `settings.allowPhoneCheckIn`, `settings.paidBreaks`, `settings.enableLeaveRequests`, `settings.autoClockOutHoursAfterShiftEnd`, `settings.autoClockOutHoursAfterClockIn`, `settings.visitorAutoCheckoutHoursAfterVisitUntil`, `settings.visitorAutoCheckoutHoursAfterCheckIn`, `settings.maxShiftHours`, `settings.breakBands`, `activatedAt`, `managerUserId→User`, `createdAt`, `updatedAt`

### BranchActivationCode

Collection: `branchactivationcodes`

Fields: `branchId→Branch*`, `organizationId→Organization*`, `codeHash*`, `issuedByUserId→User*`, `issuedToUserId→User`, `expiresAt`, `failedAttempts`, `lockedAt`, `usedAt`, `usedByKioskId→Kiosk`, `kioskId→Kiosk`, `status`, `createdAt`

### BranchUsage

Collection: `branchusages`. Unique: `branchId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `imageBytes`, `imageCount`, `fileBytes`, `fileCount`, `categories`, `measuredAt`, `createdAt`, `updatedAt`

### ContactUs

Collection: `contactus`

Fields: `name*`, `email`, `phoneNumber`, `description*`, `status`, `createdAt`, `updatedAt`

### Conversation

Collection: `conversations`. Unique: `branchId+recipientId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `recipientId→User*`, `chatState`, `unreadCount`, `lastMessage→Message`, `lastMessageAt`, `createdAt`, `updatedAt`

### Department

Collection: `departments`. Unique: `organizationId+branchId+nameKey`

Fields: `organizationId→Organization*`, `branchId→Branch`, `name*`, `nameKey*`, `sortOrder`, `active`, `createdAt`, `updatedAt`

### device

Collection: `devices`

Fields: `userId→User*`, `devices`, `createdAt`, `updatedAt`

### Document

Collection: `documents`

Fields: `organizationId→Organization*`, `branchId→Branch`, `ownerUserId→User`, `title*`, `scope*`, `categoryId→DocumentCategory`, `audiences`, `requiresSignature`, `currentVersionId→DocumentVersion`, `createdAt`, `updatedAt`

### DocumentCategory

Collection: `documentcategories`. Unique: `organizationId+titleKey`, `organizationId+legacyKey`

Fields: `organizationId→Organization*`, `title*`, `titleKey*`, `legacyKey`, `active`, `createdBy→User`, `createdAt`, `updatedAt`

### DocumentShareLink

Collection: `documentsharelinks`. Unique: `token`, `documentId`

Fields: `organizationId→Organization*`, `documentId→Document*`, `token*`, `createdBy→User*`, `active`, `revokedAt`, `revokedBy→User`, `createdAt`

### DocumentSignature

Collection: `documentsignatures`. Unique: `documentVersionId+signerStaffId`

Fields: `documentId→Document*`, `documentVersionId→DocumentVersion*`, `branchId→Branch*`, `signerUserId→User`, `signerStaffId→StaffProfile`, `signerExternalPersonId→ExternalPerson`, `signerName*`, `signatureUrl`, `signedAt*`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt`

### DocumentVersion

Collection: `documentversions`. Unique: `documentId+version`

Fields: `documentId→Document*`, `version*`, `file*`, `uploadedBy→User*`, `createdAt`

### EvacCheck

Collection: `evacchecks`. Unique: `clientEventId`, `evacuationEventId+personKind+personId`

Fields: `evacuationEventId→EvacuationEvent*`, `personKind*`, `personId*`, `status`, `markedAt*`, `locationLabel`, `geo.lat`, `geo.lng`, `geo.accuracy`, `lastSeenLabel`, `lastSeenAt`, `clientEventId`, `createdAt`, `updatedAt`

### EvacuationEvent

Collection: `evacuationevents`

Fields: `branchId→Branch*`, `type*`, `startedAt*`, `closedAt`, `startedByUserId→User`, `kioskId→Kiosk`, `status`, `familyAlert`, `createdAt`, `updatedAt`

### ExternalPerson

Collection: `externalpeople`. Unique: `branchId+email`, `userId+branchId`, `qrToken`, `nfcTagId`

Fields: `branchId→Branch*`, `type*`, `userId→User`, `name*`, `email`, `phone`, `photoUrl`, `carRegistration`, `departmentId→Department`, `categoryId→PersonCategory`, `visitorCategory`, `policiesSigned`, `qrToken`, `nfcTagId`, `signOutReminder.pending`, `signOutReminder.missedSignInAt`, `createdAt`, `updatedAt`

### FamilyCode

Collection: `familycodes`. Unique: `codeHash`, `residentId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `codeHash*`, `codeCipher*`, `status`, `expiresAt*`, `createdBy→User*`, `voidedAt`, `voidedBy→User`, `createdAt`, `updatedAt`

### FamilyCodeFailure

Collection: `familycodefailures`

Fields: `userId→User*`, `createdAt`

### FamilyGazetteIssue

Collection: `familygazetteissues`. Unique: `branchId+number`, `branchId+periodStart`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `number*`, `periodStart*`, `periodEnd*`, `closesAt*`, `status`, `messageCap*`, `generatedBy→User`, `generatedAt`, `createdAt`, `updatedAt`

### FamilyGazetteItem

Collection: `familygazetteitems`. Unique: `issueId+residentId`

Fields: `issueId→FamilyGazetteIssue*`, `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `status`, `uploadIds→FamilyUpload`, `movedUploadIds→FamilyUpload`, `removedUploadIds→FamilyUpload`, `postIds→FamilyPost`, `messageCount`, `overCap`, `familyCount`, `pdfKey`, `pageCount`, `failureReason`, `generatedAt`, `renderClaimedAt`, `printedBy→User`, `printedAt`, `givenAt`, `createdAt`, `updatedAt`

### FamilyGazetteReminder

Collection: `familygazettereminders`. Unique: `branchId+periodStart`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `periodStart*`, `closesAt*`, `sentAt`, `createdAt`, `updatedAt`

### FamilyHandover

Collection: `familyhandovers`. Unique: `residentId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `fromUserId→User*`, `toUserId→User`, `homeChooses`, `status`, `requestedAt`, `decidedAt`, `createdAt`, `updatedAt`

### FamilyInvitation

Collection: `familyinvitations`. Unique: `residentId+email`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `email`, `name`, `relationship`, `isNextOfKin`, `tokenHash*`, `status`, `expiresAt*`, `invitedByUserId→User*`, `acceptedAt`, `acceptedByUserId→User`, `revokedAt`, `revokedByUserId→User`, `lastSentAt`, `sendCount`, `createdAt`, `updatedAt`

### FamilyMedia

Collection: `familymedias`

Fields: `uploadedBy→User*`, `postId→FamilyPost`, `uploadId→FamilyUpload`, `storageKey*`, `url*`, `blurredKey`, `blurredUrl`, `mimeType*`, `width`, `height`, `size`, `createdAt`, `updatedAt`

### FamilyMember

Collection: `familymembers`. Unique: `userId+residentId`, `residentId`

Fields: `userId→User*`, `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `relationship`, `isNextOfKin`, `status`, `joinedVia`, `requestedAt`, `decidedBy→User`, `decidedAt`, `removedBy→User`, `removedAt`, `inactiveBy→User`, `inactiveAt`, `createdAt`, `updatedAt`

### FamilyNewsletter

Collection: `familynewsletters`. Unique: `branchId+month`, `branchId+issueNumber`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `authorId→User*`, `month*`, `periodStart*`, `periodEnd*`, `issueNumber*`, `template`, `title*`, `status`, `sections.welcome`, `sections.highlights`, `sections.comingUp`, `sections.notices`, `sections.newResidents`, `sections.gallery`, `welcome.text`, `welcome.signedBy`, `highlights`, `comingUp`, `notices`, `newResidents`, `gallery`, `footer.homeName`, `footer.address`, `footer.phone`, `footer.email`, `delivery.inApp`, `delivery.email`, `delivery.pdf`, `sendAt`, `sentAt`, `sentBy→User`, `pdfKey`, `sentTo.families`, `sentTo.members`, `deliveryLog`, `emailedTo`, `createdAt`, `updatedAt`

### FamilyPost

Collection: `familyposts`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `authorId→User*`, `title`, `message`, `mediaIds→FamilyMedia`, `taggedResidentIds→Resident`, `audience`, `isPinned`, `scheduledAt`, `status`, `removedBy→User`, `removedAt`, `createdAt`, `updatedAt`

### FamilyPostPin

Collection: `familypostpins`. Unique: `postId+userId`

Fields: `postId→FamilyPost*`, `userId→User*`, `createdAt`, `updatedAt`

### FamilyPostReport

Collection: `familypostreports`. Unique: `postId+reporterId`

Fields: `postId→FamilyPost*`, `organizationId→Organization*`, `branchId→Branch*`, `reporterId→User*`, `reason`, `status`, `resolvedBy→User`, `resolvedAt`, `createdAt`, `updatedAt`

### FamilyPostView

Collection: `familypostviews`. Unique: `postId+userId`

Fields: `postId→FamilyPost*`, `userId→User*`, `organizationId→Organization*`, `branchId→Branch*`, `residentIds→Resident`, `createdAt`, `updatedAt`

### FamilyReaction

Collection: `familyreactions`. Unique: `postId+userId`

Fields: `postId→FamilyPost*`, `userId→User*`, `createdAt`, `updatedAt`

### FamilySettings

Collection: `familysettings`. Unique: `organizationId`

Fields: `organizationId→Organization*`, `gazette.issueEveryDays`, `gazette.messageCap`, `gazette.anchorDate`, `deadlineReminder`, `communityWall`, `updatedBy→User`, `createdAt`, `updatedAt`

### FamilyUpload

Collection: `familyuploads`. Unique: `authorId+clientId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `authorId→User*`, `message`, `mediaIds→FamilyMedia`, `includeInGazette`, `status`, `rejectionReason`, `decidedBy→User`, `decidedAt`, `deleteAfter`, `clientId`, `createdAt`, `updatedAt`

### FamilyVisit

Collection: `familyvisits`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident*`, `source*`, `requestedBy→User`, `invitedBy→User`, `startAt*`, `endAt*`, `partySize`, `note`, `status*`, `decidedBy→User`, `decidedAt`, `decisionNote`, `invitationId→Invitation`, `replies`, `createdAt`, `updatedAt`

### FamilyVisitPass

Collection: `familyvisitpasses`. Unique: `userId+residentId`

Fields: `userId→User*`, `residentId→Resident*`, `guests`, `carRegistration`, `createdAt`, `updatedAt`

### FamilyVisitSettings

Collection: `familyvisitsettings`. Unique: `branchId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `visitingHours.start`, `visitingHours.end`, `protectedTimes`, `daysAhead`, `maxPartySize`, `loungeCapacityPerSlot`, `paused`, `pausedReason`, `pausedAt`, `pausedBy→User`, `createdAt`, `updatedAt`

### Faq

Collection: `faqs`

Fields: `question*`, `answer*`, `createdAt`, `updatedAt`

### FloorPlan

Collection: `floorplans`. Unique: `organizationId+branchId+name`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `name*`, `imageUrl`, `pdfUrl`, `version`, `meta`, `createdAt`, `updatedAt`

### FloorPlanPin

Collection: `floorplanpins`. Unique: `floorPlanId+residentId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `floorPlanId→FloorPlan*`, `residentId→Resident*`, `x*`, `y*`, `createdAt`, `updatedAt`

### Invitation

Collection: `invitations`. Unique: `inviteCode`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `residentId→Resident`, `visitorName*`, `visitorEmail*`, `externalPersonId→ExternalPerson`, `hostStaffId→StaffProfile`, `badgeType`, `arrivalAt*`, `visitingUntil*`, `instructions`, `additionalRecipients`, `expressCheckIn`, `supportingDocumentUrl`, `inviteCode*`, `status`, `guestResponseAt`, `visitSessionId→VisitSession`, `createdBy→User*`, `cancelledAt`, `cancelledBy→User`, `createdAt`, `updatedAt`

### JobTitle

Collection: `jobtitles`. Unique: `organizationId+branchId+nameKey`

Fields: `organizationId→Organization*`, `branchId→Branch`, `departmentId→Department`, `name*`, `nameKey*`, `level`, `active`, `createdAt`, `updatedAt`

### Kiosk

Collection: `kiosks`. Unique: `deviceId`, `scanToken`, `nfcTagId`

Fields: `branchId→Branch*`, `deviceId`, `receptionIdentifier`, `fireEvacuation`, `locationLabel`, `deviceType`, `adminPinHash`, `setupStatus`, `kioskMode`, `scanToken`, `scanTokenExpiresAt`, `nfcTagId`, `lastHeartbeatAt`, `lastCheckInAt`, `createdAt`, `updatedAt`

### KioskPairingSession

Collection: `kioskpairingsessions`

Fields: `kioskId→Kiosk*`, `branchId→Branch*`, `organizationId→Organization*`, `staffId→StaffProfile`, `externalPersonId→ExternalPerson`, `invitationId→Invitation`, `scanToken*`, `status`, `expiresAt*`, `confirmedAt`, `createdAt`, `updatedAt`

### KioskWidget

Collection: `kioskwidgets`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `kioskId→Kiosk`, `placement*`, `type*`, `title`, `config`, `sortOrder`, `active`, `createdAt`, `updatedAt`

### Language

Collection: `languages`. Unique: `code`

Fields: `title`, `transliteration`, `flag`, `code`, `active`, `createdAt`, `updatedAt`

### LeaveEntitlement

Collection: `leaveentitlements`. Unique: `staffId+year+leaveType`

Fields: `staffId→StaffProfile*`, `organizationId→Organization`, `branchId→Branch`, `year*`, `leaveType`, `entitlementDays*`, `carriedOverDays`, `takenDays`, `pendingDays`, `createdAt`, `updatedAt`

### LeaveRequest

Collection: `leaverequests`

Fields: `staffId→StaffProfile*`, `organizationId→Organization`, `branchId→Branch`, `leaveType`, `startDate*`, `endDate*`, `shiftId→Shift`, `totalDays*`, `reason`, `attachmentUrl`, `status`, `decidedBy→User`, `decidedAt`, `decisionNote`, `source`, `recordedByUserId→User`, `createdBy→User*`, `createdAt`, `updatedAt`

### Membership

Collection: `memberships`. Unique: `userId+organizationId`

Fields: `userId→User*`, `organizationId→Organization*`, `branchId→Branch`, `role*`, `permissions`, `status`, `deactivatedAt`, `createdAt`, `updatedAt`

### Message

Collection: `messages`. Unique: `broadcastId+recipientId`

Fields: `conversationId→Conversation*`, `organizationId→Organization*`, `branchId→Branch*`, `broadcastId*`, `senderId→User*`, `recipientId→User*`, `subject`, `messageType`, `messageContent*`, `readAt`, `createdAt`, `updatedAt`

### ModuleDefinition

Collection: `moduledefinitions`. Unique: `slug`

Fields: `slug*`, `name*`, `description`, `active`, `createdAt`, `updatedAt`

### Notification

Collection: `notifications`

Fields: `type*`, `subjectId→User`, `objectId*`, `objectType*`, `receiverId→User*`, `title*`, `body*`, `isRead`, `isDeleted`, `createdAt`, `updatedAt`

### Organization

Collection: `organizations`. Unique: `nameKey`

Fields: `name*`, `nameKey`, `ownerUserId→User`, `status`, `moduleAccess`, `settings.emergencyNotifyOffsite`, `settings.defaultSupervisionIntervalMonths`, `settings.defaultAppraisalIntervalMonths`, `settings.defaultAnnualLeaveDays`, `settings.appraisalWriterStaffIds→StaffProfile`, `settings.amberDays`, `settings.staffDashboardCards.checkIn`, `settings.staffDashboardCards.pendingLeave`, `settings.visitorSurvey.enabled`, `settings.visitorSurvey.notifyVia.email`, `settings.visitorSurvey.notifyVia.inApp`, `settings.visitorSurvey.recipients.siteManager`, `settings.visitorSurvey.recipients.lineManager`, `settings.visitorSurvey.include.ratingSummary`, `settings.visitorSurvey.include.visitDuration`, `settings.visitorSurvey.include.whoTheyVisited`, `settings.visitorSurvey.include.freeText`, `createdAt`, `updatedAt`

### OrganizationUsage

Collection: `organizationusages`. Unique: `organizationId`

Fields: `organizationId→Organization*`, `imageBytes`, `imageCount`, `fileBytes`, `fileCount`, `unmeasured`, `categories`, `version`, `measuredAt`, `measuringSince`, `createdAt`, `updatedAt`

### PeepRecord

Collection: `peeprecords`. Unique: `residentId`

Fields: `organizationId→Organization*`, `residentId→Resident*`, `branchId→Branch*`, `peepLevel*`, `supportNeeds`, `primaryRoute`, `secondaryRoute`, `equipmentRequired`, `responsibleStaff`, `reviewDueAt`, `lastReviewedAt`, `consentStatus`, `mcaBestInterestNotes`, `mobilityNotes`, `assistanceRequired`, `evacuationStrategy`, `createdAt`, `updatedAt`

### PersonCategory

Collection: `personcategories`. Unique: `organizationId+branchId+nameKey`

Fields: `organizationId→Organization`, `branchId→Branch`, `name*`, `nameKey*`, `appliesTo`, `active`, `createdAt`, `updatedAt`

### PlatformBilling

Collection: `platformbillings`. Unique: `key`

Fields: `key`, `planLimitGb`, `baseTierGbp`, `overageGbpPerGb`, `createdAt`, `updatedAt`

### Requirement

Collection: `requirements`

Fields: `organizationId→Organization*`, `branchId→Branch`, `name*`, `type*`, `renewalMonths*`, `firstCompletionDays*`, `amberDaysOverride`, `evidenceRequired`, `staffEvidenceAllowed`, `appliesTo.jobTitleIds→JobTitle`, `appliesTo.departmentIds→Department`, `createdAt`, `updatedAt`

### RequirementAssignment

Collection: `requirementassignments`. Unique: `organizationId+staffId+requirementId`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `staffId→StaffProfile*`, `requirementId→Requirement*`, `assignedAt*`, `assignedBy→User`, `source*`, `dueDate*`, `renewalMonthsOverride`, `createdAt`, `updatedAt`

### RequirementRecord

Collection: `requirementrecords`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `assignmentId→RequirementAssignment*`, `staffId→StaffProfile*`, `requirementId→Requirement*`, `completedAt*`, `expiresAt*`, `documents`, `signedOffBy→User*`, `notes`, `createdAt`, `updatedAt`

### Resident

Collection: `residents`. Unique: `qrToken`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `userId→User`, `name*`, `email`, `phone`, `photoUrl`, `admissionStatus`, `careLevel`, `roomNumber`, `admittedAt`, `qrToken`, `photographyConsent`, `photographyConsentCheckedAt`, `photographyConsentRecordedBy→User`, `visitorPasscodeRequired`, `visitorPasscodeHash`, `visitorPasscodeSetAt`, `restricted`, `restrictedReason`, `restrictedAt`, `restrictedByUserId→User`, `isOut`, `outDestination`, `outNote`, `outSince`, `expectedReturnAt`, `outByUserId→User`, `discharge.reason`, `discharge.message`, `discharge.dischargedAt`, `discharge.dischargedByUserId→User`, `discharge.familyAccessEndsAt`, `discharge.familiesNotified`, `discharge.visitsCancelled`, `discharge.visitPassesCancelled`, `createdAt`, `updatedAt`

### ResidentMedia

Collection: `residentmedias`

Fields: `residentId→Resident*`, `branchId→Branch*`, `mediaType`, `url*`, `thumbnailUrl`, `caption`, `takenAt`, `consentVerified`, `reviewStatus`, `reviewedBy→User`, `reviewedAt`, `reviewReason`, `visibleToFamily`, `uploadedBy→User*`, `createdAt`, `updatedAt`

### ResidentStatus

Collection: `residentstatuses`. Unique: `residentId`

Fields: `residentId→Resident*`, `organizationId→Organization*`, `branchId→Branch*`, `restricted`, `restrictedReason`, `restrictedAt`, `restrictedByUserId→User`, `isOut`, `outDestination`, `outNote`, `outSince`, `expectedReturnAt`, `outByUserId→User`, `discharge.reason`, `discharge.message`, `discharge.dischargedAt`, `discharge.dischargedByUserId→User`, `discharge.familyAccessEndsAt`, `discharge.familiesNotified`, `discharge.visitsCancelled`, `createdAt`, `updatedAt`

### ResidentVisitorLink

Collection: `residentvisitorlinks`. Unique: `residentId+externalPersonId`

Fields: `residentId→Resident*`, `externalPersonId→ExternalPerson*`, `branchId→Branch*`, `relationship`, `isNextOfKin`, `canBookVisits`, `canViewMedia`, `status`, `createdBy→User*`, `createdAt`, `updatedAt`

### Review

Collection: `reviews`

Fields: `reviewType*`, `object*`, `subject→User*`, `rating*`, `comment`, `createdAt`, `updatedAt`

### Shift

Collection: `shifts`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `staffId→StaffProfile`, `startsAt*`, `endsAt*`, `status`, `visibility`, `urgentCover`, `openedAt`, `filledAt`, `filledByClaimId→ShiftClaim`, `createdAt`, `updatedAt`

### ShiftClaim

Collection: `shiftclaims`. Unique: `shiftId+staffId`, `clientEventId`

Fields: `shiftId→Shift*`, `organizationId→Organization*`, `branchId→Branch*`, `staffId→StaffProfile*`, `status`, `note`, `decidedBy→User`, `decidedAt`, `decisionNote`, `clientEventId`, `createdAt`, `updatedAt`

### StaffActivityLog

Collection: `staffactivitylogs`

Fields: `staffId→StaffProfile*`, `actorUserId→User*`, `action*`, `meta`, `createdAt`

### StaffAsset

Collection: `staffassets`

Fields: `staffId→StaffProfile*`, `name*`, `type`, `serialNumber`, `assignedAt*`, `status`, `createdAt`, `updatedAt`

### StaffInvitation

Collection: `staffinvitations`. Unique: `organizationId+email`

Fields: `organizationId→Organization*`, `branchId→Branch`, `email`, `name`, `role*`, `permissions`, `jobTitleId→JobTitle`, `departmentIds→Department`, `reportsToStaffId→StaffProfile`, `startDate`, `employeeCode`, `isBranchManager`, `tokenHash*`, `status`, `expiresAt*`, `invitedByUserId→User*`, `acceptedAt`, `acceptedByUserId→User`, `revokedAt`, `revokedByUserId→User`, `lastSentAt`, `sendCount`, `createdAt`, `updatedAt`

### StaffProfile

Collection: `staffprofiles`. Unique: `qrToken`, `userId+organizationId`, `organizationId+employeeCode`, `nfcTagId`

Fields: `userId→User*`, `organizationId→Organization*`, `branchId→Branch*`, `employeeCode*`, `departmentIds→Department`, `jobTitleId→JobTitle`, `reportsToStaffId→StaffProfile`, `supervisorStaffId→StaffProfile`, `supervisionIntervalMonths`, `appraisalIntervalMonths`, `startDate*`, `contractedWeeklyHours`, `phone`, `emergencyContactName`, `emergencyContactPhone`, `photoUrl`, `bannerUrl`, `qrToken*`, `nfcTagId`, `pinHash`, `ward`, `locationLabel`, `status`, `inactiveAt`, `indicators`, `lastSeenAt`, `signOutReminder.pending`, `signOutReminder.missedSignInAt`, `createdAt`, `updatedAt`

### StoredObject

Collection: `storedobjects`. Unique: `key`

Fields: `key*`, `size`, `missing`, `measuredAt`

### SupervisionRecord

Collection: `supervisionrecords`

Fields: `organizationId→Organization*`, `staffId→StaffProfile*`, `branchId→Branch*`, `scheduledAt`, `locationLabel`, `completedAt`, `conductedByStaffId→StaffProfile`, `conductedByUserId→User`, `topics`, `notes`, `actionPoints`, `file`, `status`, `createdAt`, `updatedAt`

### SupportRequest

Collection: `supportrequests`

Fields: `name*`, `email`, `subject*`, `message*`, `status`, `createdAt`, `updatedAt`

### UsageSnapshot

Collection: `usagesnapshots`. Unique: `month`

Fields: `month*`, `imageBytes`, `fileBytes`, `organizations`, `capturedAt`, `createdAt`, `updatedAt`

### User

Collection: `users`. Unique: `email`

Fields: `profileIcon`, `name`, `email`, `previousEmail`, `phoneNumber`, `notificationPreferences.shiftClaims`, `notificationPreferences.leaveAndSickness`, `notificationPreferences.kioskOffline`, `notificationPreferences.agencyBids`, `notificationPreferences.photosWaiting`, `notificationPreferences.joinRequests`, `notificationPreferences.visitRequests`, `notificationPreferences.reportedPosts`, `notificationPreferences.gazetteReminders`, `notificationPreferences.quietHours.start`, `notificationPreferences.quietHours.end`, `verificationStatus.email`, `verificationStatus.phoneNumber`, `password`, `passwordChangedAt`, `accountState.userType`, `accountState.status`, `accountState.reason`, `accountState.suspensionDate`, `accountState.finalDeletionDate`, `otpInfo.emailOtp.otp`, `otpInfo.emailOtp.otpUsed`, `otpInfo.emailOtp.otpExpires`, `otpInfo.emailOtp.otpRequestCount`, `otpInfo.emailOtp.otpRequestTimestamp`, `otpInfo.emailOtp.kioskVerifiedUntil`, `otpInfo.phoneNumberOtp.otp`, `otpInfo.phoneNumberOtp.otpUsed`, `otpInfo.phoneNumberOtp.otpExpires`, `otpInfo.phoneNumberOtp.otpRequestCount`, `otpInfo.phoneNumberOtp.otpRequestTimestamp`, `resetToken`, `timezone*`, `language`, `blockedUsers→User`, `reportCount`, `reportedBy→User`, `subscriptions`, `provider`, `googleId`, `facebookId`, `appleId`, `createdAt`, `updatedAt`

### VisitorAccountInvitation

Collection: `visitoraccountinvitations`. Unique: `branchId+email`, `tokenHash`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `email*`, `name`, `personType*`, `tokenHash*`, `status`, `expiresAt*`, `invitedByUserId→User*`, `acceptedAt`, `acceptedByUserId→User`, `externalPersonId→ExternalPerson`, `lastSentAt`, `revokedAt`, `revokedByUserId→User`, `createdAt`, `updatedAt`

### VisitorSurveyQuestion

Collection: `visitorsurveyquestions`. Unique: `organizationId+key`

Fields: `organizationId→Organization*`, `key*`, `prompt*`, `type*`, `options`, `required`, `sortOrder`, `active`, `source`, `createdAt`, `updatedAt`

### VisitorSurveyResponse

Collection: `visitorsurveyresponses`

Fields: `organizationId→Organization*`, `branchId→Branch*`, `visitSessionId→VisitSession`, `externalPersonId→ExternalPerson`, `hostStaffId→StaffProfile`, `visitorName*`, `stayDuration`, `answers`, `rating`, `whoVisited`, `comments`, `source`, `submittedByUserId→User`, `notifiedAt`, `createdAt`, `updatedAt`

### VisitRequest

Collection: `visitrequests`

Fields: `branchId→Branch*`, `residentId→Resident*`, `externalPersonId→ExternalPerson*`, `requestedStartAt*`, `requestedEndAt*`, `partySize`, `note`, `status`, `decidedBy→User`, `decidedAt`, `decisionNote`, `invitationId→Invitation`, `createdAt`, `updatedAt`

### VisitSession

Collection: `visitsessions`

Fields: `branchId→Branch*`, `externalPersonId→ExternalPerson`, `invitationId→Invitation`, `personType*`, `method*`, `hostStaffId→StaffProfile`, `residentId→Resident`, `hostName`, `status`, `purposeOfVisit`, `kioskId→Kiosk`, `arrivedAt`, `checkInAt`, `checkOutAt`, `autoClosed`, `signOutResolvedAt`, `signOutResolvedByUserId→User`, `residentPasscodeVerified`, `residentPasscodeVerifiedAt`, `policiesSigned`, `createdAt`, `updatedAt`

## 13. Function reference

2701 named top-level functions, class methods and schema methods in 301 files (474 JavaScript files parsed under backend). Exported functions show signature and line. The text after a colon is the author's own code comment; arrows show the routes a controller serves. Where the code has no comment, only the signature is given. Internal helpers are listed by name and line.

### backend/admin/controllers

#### adminPanelController.js

- `async dashboard(req, res)` L9
- `async getUserStatsByRegion(req, res)` L23
- `async topRatedUsers(req, res)` L48
- `async allUsers(req, res)` L62
- `async getSupportRequests(req, res)` L84
- `async updateSupportRequestStatus(req, res)` L107
- `async deleteSupportRequest(req, res)` L130
- `async getContactRequests(req, res)` L148
- `async updateContactRequestStatus(req, res)` L171
- `async deleteContactRequest(req, res)` L194
- `async getFaqs(req, res)` L213
- `async createFaq(req, res)` L234 → `POST /admin/settings/faqs`
- `async updateFaq(req, res)` L256 → `PUT /admin/settings/faqs/:id`
- `async deleteFaq(req, res)` L279 → `DELETE /admin/settings/faqs/:id`
- `async updateUserAccountState(req, res)` L298

#### allSettingsController.js

- `getAll(req)` L13 → `GET /admin/settings/all`
- `updateAll(req)` L21 → `PUT /admin/settings/all`
- Internal: `contextOf` L5

#### announcementController.js

- `listAnnouncements(req)` L8 → `GET /admin/announcements`
- `createAnnouncement(req)` L18 → `POST /admin/announcements`
- `getAnnouncement(req)` L31 → `GET /admin/announcements/:announcementId`
- `remindAnnouncement(req)` L39 → `POST /admin/announcements/:announcementId/remind`
- Internal: `scope` L5

#### appraisalController.js

- `async updateAppraisalSettings(req, res)` L15 → `PATCH /admin/organizations/:organizationId/staff-profiles/:staffProfileId/appraisal-settings`
- `async updateStaffComplianceSettings(req, res)` L30 → `PATCH /admin/organizations/:organizationId/staff-profiles/:staffProfileId/compliance-settings`
- `async listComplianceHistory(req, res)` L45 → `GET /admin/organizations/:organizationId/compliance-history`
- `async listTeamAppraisals(req, res)` L73 → `GET /admin/organizations/:organizationId/appraisals`
- `async getAppraisal(req, res)` L111 → `GET /admin/organizations/:organizationId/appraisals/:appraisalId`
- `async createAppraisal(req, res)` L146 → `POST /admin/organizations/:organizationId/appraisals`
- `async updateAppraisal(req, res)` L161 → `PUT /admin/organizations/:organizationId/appraisals/:appraisalId`
- `async signOffActionPoint(req, res)` L179 → `POST /admin/organizations/:organizationId/appraisals/:appraisalId/action-points/:actionPointId/sign-off`
- `async signOffActionPoints(req, res)` L199 → `POST /admin/organizations/:organizationId/appraisals/:appraisalId/action-points/sign-off`
- `async managerSignAppraisal(req, res)` L219 → `POST /admin/organizations/:organizationId/appraisals/:appraisalId/manager-sign`
- Internal: `settingsPayload` L6, `meetingBody` L130

#### attendanceController.js

- `async listAttendanceDays(req, res)` L9 → `GET /admin/organizations/:organizationId/attendance`
- `async attendanceReport(req, res)` L51 → `GET /admin/organizations/:organizationId/reports/attendance`
- `async listAttendanceRota(req, res)` L87 → `GET /admin/organizations/:organizationId/attendance/rota`
- `async getAttendanceDay(req, res)` L111 → `GET /admin/attendance/:attendanceDayId`
- `async updateAttendanceDay(req, res)` L130 → `PATCH /admin/attendance/:attendanceDayId`
- `async listChangeRequests(req, res)` L152 → `GET /admin/organizations/:organizationId/attendance-change-requests`
- `async approveChangeRequest(req, res)` L176 → `POST /admin/attendance-change-requests/:requestId/approve`
- `async rejectChangeRequest(req, res)` L196 → `POST /admin/attendance-change-requests/:requestId/reject`
- `async approveRoster(req, res)` L216 → `POST /admin/organizations/:organizationId/attendance/:attendanceDayId/approve-roster`
- `async rejectRoster(req, res)` L237 → `POST /admin/organizations/:organizationId/attendance/:attendanceDayId/reject-roster`
- `async lateCheckInsReport(req, res)` L256 → `GET /admin/organizations/:organizationId/reports/late-check-ins`
- `async sicknessRateReport(req, res)` L286 → `GET /admin/organizations/:organizationId/reports/sickness-rate`
- `async staffHoursSummary(req, res)` L326 → `GET /admin/organizations/:organizationId/reports/staff-hours-summary`

#### billingController.js

- `listUsage(req)` L7 → `GET /admin/billing/usage`
- `getUsageDetail(req)` L25 → `GET /admin/billing/usage/:organizationId`

#### branchController.js

- `async createBranch(req, res)` L9 → `POST /admin/organizations/:organizationId/branches`
- `async listBranches(req, res)` L36 → `GET /admin/organizations/:organizationId/branches`
- `async getBranch(req, res)` L60 → `GET /admin/branches/:branchId`
- `async updateBranch(req, res)` L77 → `PATCH /admin/branches/:branchId`
- `async issueActivationCode(req, res)` L106 → `POST /admin/branches/:branchId/activation-codes`
- `async listActivationCodes(req, res)` L127 → `GET /admin/branches/:branchId/activation-codes`
- `async revokeActivationCode(req, res)` L151 → `POST /admin/branches/:branchId/activation-codes/:activationCodeId/revoke`

#### dbController.js

- `async bulkInsertHandler(req, res)` L5 → `POST /admin/util/bulk-insert`
- `async deleteCollectionHandler(req, res)` L29 → `POST /admin/util/delete-collection`

#### documentController.js

- `async listDocuments(req, res)` L10 → `GET /admin/organizations/:organizationId/documents`
- `async createDocument(req, res)` L40 → `POST /admin/organizations/:organizationId/documents`
- `async getDocument(req, res)` L67 → `GET /admin/documents/:documentId`
- `async updateDocument(req, res)` L88 → `PATCH /admin/documents/:documentId`
- `async deleteDocument(req, res)` L115 → `DELETE /admin/documents/:documentId`
- `async addDocumentVersion(req, res)` L136 → `POST /admin/documents/:documentId/versions`
- `async listAcknowledgements(req, res)` L158 → `GET /admin/documents/:documentId/acknowledgements`
- `async listDocumentCategories(req, res)` L184 → `GET /admin/organizations/:organizationId/document-categories`
- `async createDocumentCategory(req, res)` L209 → `POST /admin/organizations/:organizationId/document-categories`
- `async deleteDocumentCategory(req, res)` L230 → `DELETE /admin/organizations/:organizationId/document-categories/:categoryId`
- `async updateDocumentCategory(req, res)` L251 → `PATCH /admin/organizations/:organizationId/document-categories/:categoryId`

#### evacuationController.js

- `async getOnSiteSummary(req, res)` L8 → `GET /admin/organizations/:organizationId/evacuations/on-site-summary`
- `async startEvacuation(req, res)` L27 → `POST /admin/organizations/:organizationId/evacuations`
- `async getActiveEvacuation(req, res)` L49 → `GET /admin/organizations/:organizationId/evacuations/active`
- `async listEvacuations(req, res)` L70 → `GET /admin/organizations/:organizationId/evacuations`
- `async getEvacuationEvent(req, res)` L96 → `GET /admin/evacuations/:evacuationEventId`
- `async closeEvacuation(req, res)` L115 → `POST /admin/evacuations/:evacuationEventId/close`
- `async listEvacChecks(req, res)` L134 → `GET /admin/evacuations/:evacuationEventId/checks`
- `async upsertEvacCheck(req, res)` L156 → `POST /admin/evacuations/:evacuationEventId/checks`

#### externalPersonController.js

- `async createExternalPerson(req, res)` L10 → `POST /admin/organizations/:organizationId/external-people`
- `async listExternalPeople(req, res)` L47 → `GET /admin/organizations/:organizationId/external-people`
- `async getExternalPerson(req, res)` L87 → `GET /admin/external-people/:externalPersonId`
- `async updateExternalPerson(req, res)` L106 → `PATCH /admin/external-people/:externalPersonId`
- `async updateVisitorUserAccount(req, res)` L134 → `PATCH /admin/organizations/:organizationId/users/:userId/account`

#### familyInvitationController.js

- `async inviteFamilyMember(req, res)` L13 → `POST /admin/family-invitations`
- `async listInvitations(req, res)` L46 → `GET /admin/organizations/:organizationId/family-invitations`
- `async getInvitation(req, res)` L72 → `GET /admin/organizations/:organizationId/family-invitations/:invitationId`
- `deleteInvitation(req)` L126 → `DELETE /admin/family-invitations/:invitationId`
- `updateInvitation(req, res)` L103: built by `respondByAction` → `PUT /admin/family-invitations/:invitationId`
- Internal: `invitationAction` L93

#### familyStaffController.js

- `listGazettes(req)` L21 → `GET /admin/organizations/:organizationId/family-gazettes`
- `getGazette(req)` L36 → `GET /admin/organizations/:organizationId/family-gazettes/:itemId`
- `async downloadGazettePdf(req, res)` L44 → `GET /admin/organizations/:organizationId/family-gazettes/:itemId/pdf`
- `async downloadGazetteZip(req, res)` L62 → `GET /admin/organizations/:organizationId/family-gazettes/download`
- `generateGazettes(req)` L82 → `POST /admin/family/gazette-issues`
- `getOverview(req)` L146 → `GET /admin/organizations/:organizationId/family-overview`
- `listRelationships()` L155 → `GET /admin/family/relationships`
- `listMembers(req)` L161 → `GET /admin/family/residents/:residentId/members`
- `listAllMembers(req)` L169 → `GET /admin/organizations/:organizationId/family-members`
- `listFamilyGroups(req)` L189 → `GET /admin/organizations/:organizationId/family-groups`
- `getFamilyGroup(req)` L204 → `GET /admin/organizations/:organizationId/family-groups/:residentId`
- `listUploads(req)` L213 → `GET /admin/organizations/:organizationId/family-uploads`
- `sendUpload(req)` L230 → `POST /admin/family/uploads`
- `listPosts(req)` L269 → `GET /admin/organizations/:organizationId/family-posts`
- `updateMember(req)` L295 → `PUT /admin/family/members/:memberId`
- `getMember(req)` L328 → `GET /admin/organizations/:organizationId/family-members/:memberId`
- `listPostAuthors(req)` L348 → `GET /admin/organizations/:organizationId/family-post-authors`
- `listTaggableResidents(req)` L356 → `GET /admin/family/posts/taggable-residents`
- `uploadPostPhoto(req)` L365 → `POST /admin/family/uploads/media`, `POST /admin/family/posts/media`
- `uploadPostPhotos(req)` L371 → `POST /admin/family/uploads/media/batch`, `POST /admin/family/posts/media/batch`
- `createPost(req)` L380 → `POST /admin/family/posts`
- `updatePost(req)` L398 → `PUT /admin/family/posts/:id`
- `removePost(req)` L416 → `DELETE /admin/family/posts/:id`
- `listNewsletters(req)` L426 → `GET /admin/organizations/:organizationId/family-newsletters`
- `getNewsletter(req)` L442 → `GET /admin/organizations/:organizationId/family-newsletters/:newsletterId`
- `createNewsletter(req)` L451 → `POST /admin/family/newsletters`
- `updateNewsletter(req)` L479 → `PUT /admin/family/newsletters/:id`
- `async downloadNewsletterPdf(req, res)` L526 → `GET /admin/organizations/:organizationId/family-newsletters/:newsletterId/pdf`
- `removeNewsletter(req)` L545 → `DELETE /admin/family/newsletters/:id`
- `setNextOfKin(req)` L555 → `PUT /admin/family/residents/:residentId/next-of-kin`
- `removeMember(req)` L565 → `DELETE /admin/family/residents/:residentId/members/:memberId`
- `listJoinRequests(req)` L575 → `GET /admin/family/join-requests`
- `listHandovers(req)` L605 → `GET /admin/family/handovers`
- `getCode(req)` L620 → `GET /admin/family/residents/:residentId/code`
- `createCode(req)` L628 → `POST /admin/family/residents/:residentId/code`
- `updateGazetteIssue(req, res)` L91: built by `respondByAction` → `PUT /admin/family/gazette-issues`
- `updateGazette(req, res)` L113: built by `respondByAction` → `PUT /admin/family/gazettes/:itemId`
- `updateUpload(req, res)` L249: built by `respondByAction` → `PUT /admin/family/uploads/:id`
- `updateMemberAccess(req, res)` L305: built by `respondByAction` → `PUT /admin/family/members/:memberId/access`
- `updatePostReports(req, res)` L336: built by `respondByAction` → `PUT /admin/family/posts/:id/reports`
- `updateNewsletterDelivery(req, res)` L493: built by `respondByAction` → `PUT /admin/family/newsletters/:id/delivery`
- `updateJoinRequest(req, res)` L599: built by `respondByAction` → `PUT /admin/family/join-requests/:id`
- Internal: `withScope` L159, `uploadScope` L243, `decide` L589

#### familyVisitStaffController.js

- `listVisits(req)` L11 → `GET /admin/organizations/:organizationId/family-visits`
- `inviteFamily(req)` L29 → `POST /admin/family/visits`
- `updateVisit(req, res)` L52: built by `respondByAction` → `PUT /admin/family/visits/:id`
- Internal: `withScope` L8, `decide` L41

#### floorPlanController.js

- `async listFloorPlans(req, res)` L9 → `GET /admin/organizations/:organizationId/floor-plans`
- `async createFloorPlan(req, res)` L35 → `POST /admin/organizations/:organizationId/floor-plans`
- `async getFloorPlan(req, res)` L62 → `GET /admin/floor-plans/:floorPlanId`
- `async updateFloorPlan(req, res)` L81 → `PATCH /admin/floor-plans/:floorPlanId`
- `async upsertFloorPlanPin(req, res)` L104 → `PUT /admin/floor-plans/:floorPlanId/pins`
- `async deleteFloorPlanPin(req, res)` L130 → `DELETE /admin/floor-plans/:floorPlanId/pins/:pinId`

#### homeController.js

- `async getHome(req, res)` L4

#### kioskAdminController.js

- `async listKiosks(req, res)` L9 → `GET /admin/kiosks`
- `async getKiosk(req, res)` L38 → `GET /admin/kiosks/:kioskId`
- `async createKiosk(req, res)` L57 → `POST /admin/kiosks`
- `async updateKiosk(req, res)` L81 → `PATCH /admin/kiosks/:kioskId`
- `async toggleLock(req, res)` L104 → `POST /admin/kiosks/:kioskId/toggle-lock`

#### kioskWidgetController.js

- `async listKioskWidgets(req, res)` L5 → `GET /admin/organizations/:organizationId/kiosk-widgets`
- `async saveKioskWidgets(req, res)` L25 → `PUT /admin/organizations/:organizationId/kiosk-widgets`

#### languageController.js

- `async createLanguage(req, res)` L9
- `async getLanguages(req, res)` L35
- `async updateLanguage(req, res)` L52
- `async deleteLanguage(req, res)` L81
- `async updateUserLanguage(req, res)` L100

#### leaveController.js

- `async listLeaveRequests(req, res)` L9 → `GET /admin/organizations/:organizationId/leave-requests`
- `async getLeaveRequest(req, res)` L39 → `GET /admin/organizations/:organizationId/leave-requests/:requestId`, `GET /admin/leave-requests/:requestId`
- `async approveLeaveRequest(req, res)` L58 → `POST /app/leave-approvals/:requestId/approve`, `POST /admin/leave-approvals/:requestId/approve`
- `async rejectLeaveRequest(req, res)` L79 → `POST /app/leave-approvals/:requestId/reject`, `POST /admin/leave-approvals/:requestId/reject`
- `async recordManagerLeave(req, res)` L100 → `POST /admin/organizations/:organizationId/leave-requests/record`
- `async closeLeaveRequest(req, res)` L133 → `POST /admin/leave-requests/:requestId/close`
- `async listEntitlements(req, res)` L152 → `GET /admin/organizations/:organizationId/leave-entitlements`
- `async listLeaveScores(req, res)` L179 → `GET /admin/organizations/:organizationId/leave-scores`
- `async upsertEntitlement(req, res)` L206 → `PUT /admin/organizations/:organizationId/leave-entitlements`

#### lineDashboardController.js

- `getDashboard(req)` L4 → `GET /admin/organizations/:organizationId/line-dashboard`

#### lineHomeController.js

- `getHome(req)` L6 → `GET /app/line-home`, `GET /admin/organizations/:organizationId/line-home`
- `getToday(req)` L14 → `GET /app/line-home/today`, `GET /admin/organizations/:organizationId/line-home/today`

#### membershipController.js

- `async listMembers(req, res)` L9 → `GET /admin/organizations/:organizationId/members`
- `async listGrantablePermissions(req, res)` L36 → `GET /admin/organizations/:organizationId/grantable-permissions`
- `async getMembership(req, res)` L54 → `GET /admin/memberships/:membershipId`
- `async updateMembership(req, res)` L74 → `PATCH /admin/memberships/:membershipId`
- `async deactivateMembership(req, res)` L97 → `POST /admin/memberships/:membershipId/deactivate`
- `async inviteMember(req, res)` L116 → `POST /admin/organizations/:organizationId/invitations`
- `async listInvitations(req, res)` L146 → `GET /admin/organizations/:organizationId/invitations`
- `async getInvitation(req, res)` L170 → `GET /admin/organizations/:organizationId/invitations/:invitationId`
- `async updateInvitation(req, res)` L190 → `PATCH /admin/organizations/:organizationId/invitations/:invitationId`, `PATCH /admin/invitations/:invitationId`
- `async resendInvitation(req, res)` L219 → `POST /admin/invitations/:invitationId/resend`
- `async revokeInvitation(req, res)` L238 → `POST /admin/invitations/:invitationId/revoke`

#### organizationController.js

- `async createOrganization(req, res)` L9 → `POST /admin/organizations`
- `async listOrganizations(req, res)` L32 → `GET /admin/organizations`
- `async getOrganization(req, res)` L56 → `GET /admin/organizations/:organizationId`
- `async updateOrganization(req, res)` L70 → `PATCH /admin/organizations/:organizationId`
- `async getModuleAccess(req, res)` L90 → `GET /admin/organizations/:organizationId/module-access`
- `async setModuleAccess(req, res)` L104 → `PUT /admin/organizations/:organizationId/module-access`
- `async listModuleDefinitions(req, res)` L123 → `GET /admin/module-definitions`

#### ownerDashboardController.js

- `getDashboard(req)` L4 → `GET /admin/organizations/:organizationId/dashboard`

#### peepRecordController.js

- `async listPeepRecords(req, res)` L9 → `GET /admin/organizations/:organizationId/peep-records`
- `async getPeepFloorSummary(req, res)` L36 → `GET /admin/organizations/:organizationId/peep-floor-summary`
- `async getPeepRecord(req, res)` L56 → `GET /admin/peep-records/:peepRecordId`
- `async getPeepRecordByResident(req, res)` L75 → `GET /admin/organizations/:organizationId/residents/:residentId/peep-record`
- `async createPeepRecord(req, res)` L96 → `POST /admin/organizations/:organizationId/peep-records`
- `async updatePeepRecord(req, res)` L127 → `PATCH /admin/peep-records/:peepRecordId`

#### personCategoryController.js

- `async listPersonCategories(req, res)` L10 → `GET /admin/organizations/:organizationId/person-categories`
- `async createPersonCategory(req, res)` L37 → `POST /admin/organizations/:organizationId/person-categories`
- `async updatePersonCategory(req, res)` L67 → `PATCH /admin/organizations/:organizationId/person-categories/:categoryId`
- `async deletePersonCategory(req, res)` L91 → `DELETE /admin/organizations/:organizationId/person-categories/:categoryId`

#### requirementController.js

- `async listRequirements(req, res)` L9 → `GET /admin/organizations/:organizationId/requirements`
- `async getRequirement(req, res)` L34 → `GET /admin/organizations/:organizationId/requirements/:requirementId`
- `async createRequirement(req, res)` L54 → `POST /admin/organizations/:organizationId/requirements`
- `async updateRequirement(req, res)` L81 → `PATCH /admin/requirements/:requirementId`
- `async listAssignments(req, res)` L108 → `GET /admin/organizations/:organizationId/assignments`
- `async createAssignments(req, res)` L135 → `POST /admin/organizations/:organizationId/assignments`
- `async getAssignment(req, res)` L154 → `GET /admin/assignments/:assignmentId`
- `async updateAssignment(req, res)` L173 → `PATCH /admin/assignments/:assignmentId`
- `async deleteAssignment(req, res)` L194 → `DELETE /admin/assignments/:assignmentId`
- `async createRecord(req, res)` L213 → `POST /admin/assignments/:assignmentId/records`
- `async competencyMatrix(req, res)` L235 → `GET /admin/organizations/:organizationId/competency-matrix`
- `async listTrainingRecords(req, res)` L262 → `GET /admin/organizations/:organizationId/training-records`

#### residentController.js

- `async createResident(req, res)` L9 → `POST /admin/residents`
- `async listResidents(req, res)` L45 → `GET /admin/residents`
- `async getResident(req, res)` L71 → `GET /admin/residents/:residentId`
- `async updateResident(req, res)` L90 → `PATCH /admin/residents/:residentId`
- `async setVisitorPasscode(req, res)` L118 → `PUT /admin/residents/:residentId/visitor-passcode`
- `async verifyVisitorPasscode(req, res)` L138 → `POST /admin/residents/:residentId/verify-passcode`
- `async setRestriction(req, res)` L158 → `PUT /admin/residents/:residentId/restriction`
- `async setOut(req, res)` L179 → `PUT /admin/residents/:residentId/out`

#### residentMediaController.js

- `async listResidentMedia(req, res)` L9 → `GET /admin/organizations/:organizationId/resident-media`
- `async reviewResidentMedia(req, res)` L35 → `POST /admin/organizations/:organizationId/resident-media/:mediaId/review`

#### shiftController.js

- `async createShift(req, res)` L12 → `POST /admin/organizations/:organizationId/shifts`
- `async getRotaBoard(req, res)` L40 → `GET /admin/organizations/:organizationId/rota/board`
- `async listShifts(req, res)` L65 → `GET /admin/organizations/:organizationId/shifts`
- `async getShift(req, res)` L93 → `GET /admin/shifts/:shiftId`
- `async updateShift(req, res)` L111 → `PATCH /admin/shifts/:shiftId`
- `async listClaims(req, res)` L137 → `GET /admin/organizations/:organizationId/shift-claims`
- `async getClaim(req, res)` L162 → `GET /admin/organizations/:organizationId/shift-claims/:claimId`
- `async approveClaim(req, res)` L181 → `POST /app/shift-claims/:claimId/approve`, `POST /admin/shift-claims/:claimId/approve`
- `async rejectClaim(req, res)` L202 → `POST /app/shift-claims/:claimId/reject`, `POST /admin/shift-claims/:claimId/reject`

#### siteDashboardController.js

- `getDashboard(req)` L4 → `GET /admin/organizations/:organizationId/site-dashboard`

#### staffController.js

- `async createDepartment(req, res)` L9 → `POST /admin/organizations/:organizationId/departments`
- `async listDepartments(req, res)` L39 → `GET /admin/organizations/:organizationId/departments`
- `async getDepartment(req, res)` L65 → `GET /admin/organizations/:organizationId/departments/:departmentId`, `GET /admin/departments/:departmentId`
- `async updateDepartment(req, res)` L85 → `PATCH /admin/organizations/:organizationId/departments/:departmentId`, `PATCH /admin/departments/:departmentId`
- `async createJobTitle(req, res)` L110 → `POST /admin/organizations/:organizationId/job-titles`
- `async listJobTitles(req, res)` L144 → `GET /admin/organizations/:organizationId/job-titles`
- `async getJobTitle(req, res)` L173 → `GET /admin/job-titles/:jobTitleId`
- `async updateJobTitle(req, res)` L191 → `PATCH /admin/organizations/:organizationId/job-titles/:jobTitleId`, `PATCH /admin/job-titles/:jobTitleId`
- `async createStaffProfile(req, res)` L226 → `POST /admin/organizations/:organizationId/staff-profiles`
- `async listStaffProfiles(req, res)` L269 → `GET /admin/organizations/:organizationId/staff-profiles`
- `async listDirectReports(req, res)` L298 → `GET /admin/organizations/:organizationId/staff-profiles/direct-reports`
- `async getStaffProfile(req, res)` L316 → `GET /admin/staff-profiles/:staffProfileId`
- `async updateStaffProfile(req, res)` L334 → `PATCH /admin/staff-profiles/:staffProfileId`

#### staffDashboardController.js

- `getDashboard(req)` L4 → `GET /admin/organizations/:organizationId/staff-dashboard`

#### staffDashboardSettingsController.js

- `async getStaffDashboardSettings(req, res)` L5 → `GET /admin/organizations/:organizationId/staff-dashboard-settings`
- `async saveStaffDashboardSettings(req, res)` L21 → `PUT /admin/organizations/:organizationId/staff-dashboard-settings`
- `async resetStaffDashboardSettings(req, res)` L38 → `POST /admin/organizations/:organizationId/staff-dashboard-settings/reset`

#### statisticsController.js

- `async getStatistics(req, res)` L6 → `GET /admin/statistics`

#### superAdminDashboardController.js

- `getDashboard(req)` L5 → `GET /admin/platform/dashboard`

#### supervisionController.js

- `async updateSupervisionSettings(req, res)` L5 → `PATCH /admin/organizations/:organizationId/staff-profiles/:staffProfileId/supervision-settings`
- `async listTeamSupervision(req, res)` L27 → `GET /admin/organizations/:organizationId/supervision`
- `async getSupervision(req, res)` L66 → `GET /admin/organizations/:organizationId/supervision/:supervisionId`
- `async createSupervision(req, res)` L86 → `POST /admin/organizations/:organizationId/supervision`
- `async updateSupervision(req, res)` L113 → `PUT /admin/organizations/:organizationId/supervision/:supervisionId`
- `async signOffActionPoint(req, res)` L140 → `POST /admin/organizations/:organizationId/supervision/:supervisionId/action-points/:actionPointId/sign-off`
- `async signOffActionPoints(req, res)` L160 → `POST /admin/organizations/:organizationId/supervision/:supervisionId/action-points/sign-off`

#### userController.js

- `async allUsers(req, res)` L8
- `async blockUser(req, res)` L22
- `async reportUser(req, res)` L44
- `async addOrUpdateSubscription(req, res)` L66
- `async removeSubscription(req, res)` L87
- `async getSubscriptions(req, res)` L103
- `async getUserWithPopulatedFields(userId, fieldsToPopulate = [])` L117
- `async getUserProfile(req, res, next, fieldsToPopulate = [])` L120
- `async getOtherUserProfile(req, res)` L138
- `async updateUserProfile(req, res)` L154

#### visitSessionController.js

- `async checkIn(req, res)` L13 → `POST /admin/organizations/:organizationId/visit-sessions/check-in`
- `async registerAndCheckIn(req, res)` L46 → `POST /admin/organizations/:organizationId/visit-sessions/register-and-check-in`
- `async checkOut(req, res)` L87 → `POST /admin/visit-sessions/:visitSessionId/check-out`
- `async approve(req, res)` L106 → `POST /app/visit-sessions/:visitSessionId/approve`, `POST /admin/visit-sessions/:visitSessionId/approve`
- `async deny(req, res)` L127 → `POST /app/visit-sessions/:visitSessionId/deny`, `POST /admin/visit-sessions/:visitSessionId/deny`
- `async listVisitSessions(req, res)` L148 → `GET /admin/organizations/:organizationId/visit-sessions`
- `async getVisitSession(req, res)` L178 → `GET /admin/visit-sessions/:visitSessionId`
- `async getOnSiteCounts(req, res)` L197 → `GET /admin/organizations/:organizationId/visit-sessions/on-site-counts`
- `async getVisitAnalytics(req, res)` L217 → `GET /admin/organizations/:organizationId/visit-sessions/analytics`
- `async visitorCheckInsReport(req, res)` L243 → `GET /admin/organizations/:organizationId/reports/visitor-check-ins`

#### visitorAccountInvitationController.js

- `async listVisitorAccountInvitations(req, res)` L9 → `GET /admin/organizations/:organizationId/visitor-account-invitations`
- `async createVisitorAccountInvitation(req, res)` L35 → `POST /admin/organizations/:organizationId/visitor-account-invitations`
- `async resendVisitorAccountInvitation(req, res)` L64 → `POST /admin/organizations/:organizationId/visitor-account-invitations/:invitationId/resend`
- `async revokeVisitorAccountInvitation(req, res)` L82 → `POST /admin/organizations/:organizationId/visitor-account-invitations/:invitationId/revoke`
- `async previewVisitorAccountInvitation(req, res)` L100
- `async acceptVisitorAccountInvitation(req, res)` L116

#### visitorInvitationController.js

- `async createVisitorInvitation(req, res)` L9 → `POST /admin/organizations/:organizationId/visitor-invitations`
- `async listVisitorInvitations(req, res)` L44 → `GET /admin/organizations/:organizationId/visitor-invitations`
- `async resendVisitorInvitation(req, res)` L69 → `POST /admin/visitor-invitations/:invitationId/resend`

#### visitorSurveyController.js

- `async getVisitorSurveySettings(req, res)` L8 → `GET /admin/organizations/:organizationId/visitor-survey-settings`
- `async saveVisitorSurveySettings(req, res)` L25 → `PUT /admin/organizations/:organizationId/visitor-survey-settings`
- `async listVisitorSurveyQuestions(req, res)` L43 → `GET /admin/organizations/:organizationId/visitor-survey-questions`
- `async saveVisitorSurveyQuestions(req, res)` L61 → `PUT /admin/organizations/:organizationId/visitor-survey-questions`
- `async createVisitorSurveyResponse(req, res)` L79 → `POST /admin/organizations/:organizationId/visitor-survey-responses`
- `async listVisitorSurveyResponses(req, res)` L104 → `GET /admin/organizations/:organizationId/visitor-survey-responses`

### backend/admin/routes

#### billingRoutes.js

- Internal: `billingAccess` L12

#### settingsRoutes.js

- Internal: `settingsAccess` L26

### backend/admin/services/adminPanel

#### adminPanelService.js

- `async getDashboard()` L31
- `async getUserStatsByRegion({ year })` L85
- `async getTopRatedUsers()` L185
- `async listUsers({ page, limit, skip, status, keyword })` L196
- `async getSupportRequests({ page, limit, skip, keyword, status, applyLimit, })` L266
- `async updateSupportRequestStatus({ id, status })` L313
- `async deleteSupportRequest({ id })` L324
- `async getContactRequests({ page, limit, skip, keyword, status, applyLimit, })` L333
- `async updateContactRequestStatus({ id, status })` L385
- `async deleteContactRequest({ id })` L396
- `async getFaqs({ page, limit, skip, keyword })` L405
- `async createFaq({ question, answer })` L421
- `async updateFaq({ id, question, answer })` L427
- `async deleteFaq({ id })` L439
- `async updateUserAccountState({ userId, status })` L448

#### dbService.js

- `async bulkInsertDocuments({ values, collectionName })` L4
- `async deleteAllDocuments({ collectionName })` L16

#### regionMapping.js

- `regionSwitchBranches()` L266

### backend/admin/services/appraisal

#### appraisalRecordPipeline.js

- `emptyStatusCounts()` L11
- `async countAppraisalStatuses(match)` L17: Tab totals ignore the current `status` filter.

#### appraisalService.js

- `updateAppraisalSettings(payload)` L178
- `async listTeamAppraisals({ actor, organizationId, branchId, staffId, status, keyword, page, limit, skip, format, })` L301
- `async getAppraisal({ actor, organizationId, appraisalId })` L402
- `async createAppraisal({ actor, organizationId, staffId, kind, status, scheduledAt, periodLabel, completedAt, managerComments, goals, trainingNeeds, actionPoints, file, })` L466
- `async updateAppraisal({ actor, organizationId, appraisalId, kind, status, scheduledAt, periodLabel, completedAt, managerComments, goals, trainingNeeds, actionPoints, file, })` L613
- `async signOffActionPoint({ actor, organizationId, appraisalId, actionPointId, })` L697
- `async signOffActionPoints({ actor, organizationId, appraisalId, actionPointIds, })` L719
- `async managerSignAppraisal({ actor, organizationId, appraisalId, signatureUrl, })` L741
- `async myAppraisal({ actor, organizationId, status, page, limit, skip, format, })` L786
- `async acknowledgeAppraisal({ actor, organizationId, appraisalId, signatureUrl, })` L858
- Internal: `toObjectId` L42, `timezoneFor` L49, `atZone` L54, `loadStaff` L60, `uniqueIds` L70, `scopedAppraisalStaffIds` L82, `assertCanAccessStaff` L116, `assertCanWriteAppraisal` L152, `assertWriterForStaff` L172, `standingMeetings` L180, `parseMeetingStatus` L188, `escapeRegex` L199, `staffIdsMatchingKeyword` L201, `emptyPage` L231, `csvCell` L247, `csvDate` L253, `appraisalStatusLabel` L259, `appraisalsToCsv` L266, `csvExport` L288, `parseExportFormat` L293, `assertMayViewAppraisal` L379, `optionalSignatureUrl` L415, `withSignatureUrls` L418, `textFrom` L427, `actionPointsFrom` L429, `fileFrom` L440, `parseKind` L445, `parseAppraisalStatus` L453, `loadAppraisal` L537, `shapeAppraisal` L546, `uniquePointIds` L559, `applyAppraisalActionPointSignOffs` L576, `maybeLock` L686, `supervisorNameOf` L764

#### complianceHistoryService.js

- `async listComplianceHistory({ actor, organizationId, branchId, staffId, type, from, to, page, limit, skip, })` L124
- Internal: `toObjectId` L20, `parseType` L27, `completedAtRange` L36, `emptyPage` L55, `meetingMatch` L60, `shapeMeeting` L71

#### cycle.js

- `parseSupervisionInterval(value)` L17
- `parseAppraisalInterval(value)` L20
- `orgCycleDefaults(settings = {})` L23
- `effectiveIntervals(staff, settings)` L30
- `assertAppraisalAfterSupervision(appraisalMonths, supervisionMonths)` L38
- `async loadOrgCycleSettings(organizationId)` L44
- `async assertNoStaffCycleConflict({ organizationId, appraisalDefault, supervisionDefault, })` L52
- Internal: `parseInterval` L9

### backend/admin/services/attendance

#### attendanceService.js

- `async listLeaveRegisterDays({ staffIds, from, to })` L163
- `async closeExpiredOpenSessions({ branchId, staffId } = {})` L272
- `shapeStaffAttendance(day, now = new Date(), settings = {})` L484
- `async getStaffAttendanceSnapshot({ staffId, now = new Date(), branchSettings = {}, })` L503
- `summaryFromCounts(counts, leaveDays = [])` L817
- `async staffCannotClockIn(staffId)` L962
- `async getTodayAttendance({ userId, organizationId })` L967
- `async clockIn({ userId, organizationId, checkInMethod = CheckInMethod.PHONE, clientEventId, geo, occurredAt, image, })` L983
- `async clockOut({ userId, organizationId, clientEventId, occurredAt, })` L1055
- `async clockInForStaff({ staffProfile, organizationId, branchId, checkInMethod = CheckInMethod.KIOSK, clientEventId, occurredAt, image, })` L1086
- `async clockOutForStaff({ staffProfile, branchId, clientEventId, occurredAt, })` L1147
- `async listOnSiteForBranch({ branchId, keyword, page, limit, skip, })` L1173
- `async getOpenClockInSessionForStaff({ staffProfile })` L1267
- `async getTodayAttendanceForStaff({ staffProfile, organizationId, branchId, })` L1285
- `async startBreak({ userId, organizationId, occurredAt })` L1301
- `async endBreak({ userId, organizationId, occurredAt })` L1324
- `async listMyAttendance({ userId, organizationId, page, limit, skip, from, to, punctualityStatus, format, })` L1344
- `async createChangeRequest({ userId, organizationId, attendanceDayId, payload, })` L1401
- `async listAttendanceDays({ organizationId, page, limit, skip, branchId, staffId, from, to, presenceStatus, leaveType, punctualityStatus, keyword, actor, format, })` L1431
- `async listAttendanceRota({ organizationId, branchId, staffId, from, to, timezone, keyword, actor, })` L1670
- `async getAttendanceDay({ attendanceDayId, organizationId, actor })` L1794
- `async updateAttendanceDay({ actor, organizationId, attendanceDayId, clockInAt, clockOutAt, breaks, })` L1814
- `async listChangeRequests({ organizationId, page, limit, skip, status, actor, })` L1864
- `async approveChangeRequest({ actor, organizationId, requestId, managerStaffId = null, })` L1907
- `async rejectChangeRequest({ actor, organizationId, requestId, managerStaffId = null, })` L1955
- `async requestRosterForDay({ userId, organizationId, attendanceDayId, })` L2006
- `async approveRosterForDay({ actor, organizationId, attendanceDayId, startsAt, endsAt, })` L2035
- `async rejectRosterForDay({ actor, organizationId, attendanceDayId, })` L2079
- `async attendanceReport({ actor, organizationId, branchId, departmentId, from, to, page, limit, skip, })` L2164
- `async staffHoursSummary({ actor, organizationId, branchId, departmentId, from, to, })` L2445
- `async lateCheckInsReport({ actor, organizationId, branchId, departmentId, from, to, keyword, presenceStatus, page, limit, skip, })` L2699
- `async sicknessRateReport({ actor, organizationId, branchId, departmentId, from, to, keyword, format, page, limit, skip, })` L2900
- Internal: `escapeRegex` L89, `startOfUtcDay` L92, `unpaidBreakMinutesFromRules` L98, `computeWorkedMinutes` L112, `expandLeaveToRegisterDays` L133, `requireStaffProfile` L226, `getBranchSettings` L237, `hoursFromSettings` L247, `autoCheckoutHours` L252, `autoCheckoutDueAtMs` L263, `normalizeClientEventId` L373, `findByClientEventId` L379, `toClockInPhotoUrl` L385, `greetingForHour` L389, `presentClockIn` L395, `getOpenAttendanceDay` L452, `assertNotAlreadyClockedIn` L461, `assertNotOnSickOrAbsence` L466, `latestAttendanceForWorkDate` L481, `assertClientEventAvailable` L514, `requireOpenAttendanceDay` L524, `staffSummary` L541, `utcDateKey` L609, `formatClockedHours` L611, `withComputedWorkedMinutes` L623, `csvCell` L637, `csvClock` L643, `attendanceStatusLabel` L649, `attendanceDaysToCsv` L661, `csvExport` L684, `parseExportFormat` L689, `fetchAttendanceDays` L697, `mergeAttendanceAndLeave` L705, `filterRegisterRows` L728, `paginateRows` L740, `emptyPunctualityStatusCounts` L747, `punctualityStatusCountFacets` L751, `punctualityStatusCountsFromFacet` L754, `parsePunctualityStatus` L757, `registerSummary` L781, `emptyRegisterPage` L808, `staffIdsMatchingKeyword` L834, `listStaffSummaries` L860, `attachAttendanceDetails` L893, `assertPhoneCheckInAllowed` L932, `resolvePunctuality` L939, `clockInFromActiveShift` L947, `assertStaffAtBranch` L1080, `breakTakenMinutes` L1257, `resolveDayRange` L1544, `resolveRotaRange` L1565, `resolveReportRange` L1572, `buildRotaWeeks` L1578, `rotaCellFromRow` L1598, `staffRotaTotals` L1620, `rotaCellFromRows` L1651, `loadAttendanceDayInOrg` L1993, `emptyWeekBuckets` L2104, `shapeReportStaff` L2148, `bumpWeek` L2159, `emptyCheckInMethodCounts` L2423, `emptyStaffHoursSummary` L2426, `emptyPresenceStatusCounts` L2670, `parsePresenceStatus` L2673, `presenceStatusCountsFromFacet` L2684, `shapeLateCheckInRow` L2687, `sicknessDaysOf` L2862, `sicknessRowsToCsv` L2880

### backend/admin/services/billing

#### billingUsageService.js

- `toGb(bytes)` L57
- `async getBilling()` L112
- `async listUsage({ actor, role, branchId, organizationId, filterOrganizationId, keyword, sort = "usedDesc", page, limit, skip, })` L282
- `async getUsageDetail({ branchId, ...access })` L520
- `async getSettings({ actor })` L527
- `async updateSettings({ actor, planLimitGb, baseTierGbp, overageGbpPerGb })` L532
- `async recalculateOrganization(organizationId, now = new Date())` L609: Measures one organization now; used by the nightly job. Returns false when a measurement was already running.
- `async recordUsageSnapshot(now = new Date())` L615
- `async recalculateAll({ unmeasuredOnly = false } = {})` L634
- Internal: `isPlatformAdmin` L49, `requirePlatformAdmin` L53, `percent` L58, `statusOf` L61, `usageStages` L69, `figuresOf` L125, `rowOf` L149, `branchRowOf` L159, `summaryOf` L168, `totalsOf` L197, `organizationStages` L238, `branchStages` L244, `searchOn` L257, `pageOf` L262, `requireOrganizationExists` L277, `sharesOf` L367, `detailOf` L378, `requireDetailAccess` L426, `getOrganizationUsageDetail` L434, `getBranchUsageDetail` L483, `claimMeasurement` L559, `runClaimedMeasurement` L579

#### storageMeasure.js

- `async gatherReferences(organizationId)` L84: Every stored file the organization's records point to, once each, as { key, kind, size? }.
- `async sizesOf(references)` L238: Sizes by key: null for a file the bucket does not have; absent for one that could not be measured now.
- `async measureOrganization(organizationId)` L287
- Internal: `chunksOf` L32, `inPool` L37, `urlKey` L49, `refs` L55, `familyMediaOf` L60, `emptyFigures` L282, `emptyCategories` L284

### backend/admin/services/dashboard

#### approvalsService.js

- `async getSiteApprovalDetail({ actor, organizationId, organization, isPlatformAdmin, type, itemId, })` L70
- `async listSiteApprovals({ actor, organizationId, organization, isPlatformAdmin, branchId, tab = "all", page = 1, limit = 20, skip = (page - 1) * limit, now = new Date(), })` L570
- Internal: `moduleIsActive` L46, `availableTabs` L55, `timestampOf` L186, `shortDate` L189, `shortTime` L199, `dayDistanceFromNow` L209, `daysSince` L217, `titleCase` L222, `dayCount` L227, `joinRequestDetail` L231, `clockTime` L318, `personInFamily` L326, `visitorEntryScreen` L347, `hoursLabel` L415, `shiftDayLabel` L422, `shiftClaimScreen` L432, `cardFor` L497, `shapeItem` L561

#### compliancePdf.js

- `async renderCompliancePdf({ report, day })` L56
- Internal: `sans` L17, `serif` L18, `percentOf` L20, `months` L26, `viewOf` L28

#### complianceRows.js

- `async trainingRows({ staff, cells })` L39
- `requirementRows(cells, type)` L61
- `async meetingRows({ staff, supervisionStandings, appraisalStandings, })` L98
- Internal: `staffNames` L21

#### lineDashboardService.js

- `async getLineDashboard({ actor, organizationId, now = new Date(), })` L112
- Internal: `weekStart` L25, `lastSevenDays` L27, `attendanceOfDays` L37, `messagesSent` L103

#### lineHomeService.js

- `async getLineHome({ actor, organizationId, now = new Date() })` L375
- Internal: `thisMonthOf` L41, `leavePendingOf` L116, `shiftClaimOf` L124, `supervisionsOf` L179, `rotaWindowOf` L247, `emptyOwnShifts` L293, `ownShiftsOf` L300

#### lineHomeTodayService.js

- `async getLineHomeToday({ actor, organizationId, tab: tabQuery, page, limit, skip, now = new Date(), })` L308
- Internal: `parseTab` L36, `emptyCounts` L42, `pageRows` L96, `facetOf` L103, `countOf` L110, `onShiftFacet` L112, `attendanceFacets` L136, `sickFacet` L251, `uncoveredNightOf` L294

#### ownerDashboardService.js

- `async complianceSnapshot({ organization, branchZones, now, branchId = null, })` L396
- `openShifts({ organization, now, branchId = null, include = {} })` L621
- `async getOwnerDashboard({ organizationId, now = new Date() })` L654
- Internal: `percentOf` L66, `localDay` L68, `utcDay` L69, `countOf` L71, `humanise` L76, `attendanceWeek` L81, `leaveBreakdown` L146, `staffByDepartment` L189, `evacuationRisk` L224, `activeModules` L258, `fireDrills` L294, `latestRecord` L346, `requirementScores` L353, `meetingScores` L376, `workforceUtilisation` L568

#### siteDashboardService.js

- `async getSiteDashboard({ actor, organizationId, people, period = "thisMonth", now = new Date(), })` L285
- `async getSiteStatistics({ actor, organizationId, branchId, period = "thisMonth", departmentId, now = new Date(), })` L394
- `async getSiteCompliance({ page, limit, skip, ...scope })` L609
- `async exportSiteCompliance({ format, ...scope })` L670
- Internal: `startOfUtcDay` L65, `parsePeople` L70, `staffOnSite` L77, `visitorsOnSite` L131, `residentsOnSite` L181, `peopleOnSite` L210, `activityRange` L227, `visitActivity` L235, `hoursAndMinutes` L391, `percentOf` L453, `meetingPercent` L456, `byPercentThenName` L465, `staffDetails` L468, `cycleProgress` L512, `buildSiteCompliance` L529, `percentText` L634, `staffCells` L636, `csvCell` L647, `complianceCsv` L652

#### staffDashboardService.js

- `async getStaffDashboard({ actor, organizationId, weekStart, now = new Date(), })` L223
- Internal: `byUrgency` L52, `hours` L55, `weekDays` L57, `parseWeekStart` L65, `loadStaff` L72, `scheduledHoursByDay` L95, `attendanceOfWeek` L105, `documentsToSign` L144, `requirementCard` L168, `meetingCard` L194

#### superAdminDashboardService.js

- `async getDashboard({ organizationId, year, now = new Date() })` L119
- Internal: `percentOf` L48, `countOf` L51, `modulesOf` L56, `cumulativeByMonth` L62, `usageOf` L91, `sharesOf` L107

### backend/admin/services/documents

#### documentCategoryService.js

- `shapeCategory(row)` L44
- `async ensureDocumentCategories(organizationId)` L63
- `async listDocumentCategories({ actor, organizationId, status, keyword, page, limit, skip, })` L138
- `async createDocumentCategory({ actor, organizationId, title })` L205
- `async updateDocumentCategory({ actor, organizationId, categoryId, title, active, })` L227
- `async deleteDocumentCategory({ actor, organizationId, categoryId })` L261
- `async resolveCategoryId({ organizationId, categoryId, category, fallbackToOther, allowInactive, })` L285: Active category in this organization. `categoryId` wins. A legacy slug or a title still resolves so older clients keep working. Omitted on create falls back to Other.
- `async policyCategoryIds(organizationId)` L333
- Internal: `toOid` L37, `assertMayManageCategories` L57, `activeFilterOf` L113, `shapeListedCategory` L121

#### documentService.js

- `versionFile(version)` L73
- `shapeDocument(row)` L87
- `async listDocuments({ actor, organizationId, page, limit, skip, branchId, keyword, category, categoryId, audience, scope, requiresSignature, })` L179
- `async getDocument({ actor, organizationId, documentId })` L239
- `async createDocument({ actor, organizationId, title, category, categoryId, audiences, branchId, requiresSignature, file, })` L249
- `async updateDocument({ actor, organizationId, documentId, title, category, categoryId, audiences, branchId, requiresSignature, })` L323
- `async deleteDocument({ actor, organizationId, documentId })` L376
- `async addDocumentVersion({ actor, organizationId, documentId, file, })` L403
- `async listDocumentAcknowledgements({ actor, organizationId, documentId, page, limit, skip, })` L450
- `async listSiteFolders({ actor, organizationId, branchId })` L530
- `async bulkCreateDocuments({ actor, organizationId, branchId, categoryId, audiences, requiresSignature, files, })` L623
- `async listVisitorDocuments({ actor, organizationId, branchId, keyword, page, limit, skip, })` L736
- `async createQrCode({ actor, organizationId, documentId, link, caption, baseUrl, })` L850
- `async regenerateQrLink({ actor, organizationId, documentId, caption, baseUrl, })` L876
- `async revokeQrLink({ actor, organizationId, documentId })` L892
- `async getSharedDocumentUrl({ token })` L902
- Internal: `toOid` L35, `parseAudiences` L42, `parseStoredFile` L55, `visibleMatch` L145, `assertCanViewDocument` L158, `loadShaped` L169, `fileTitle` L525, `pdfPages` L673, `cleanQrLink` L687, `isVisitorFacing` L703, `fileType` L706, `fillPages` L715, `shareUrl` L794, `activeShareLink` L797, `cleanCaption` L817, `visitorDocument` L824, `documentQr` L832

### backend/admin/services/evacuation

#### evacuationNotify.js

- `async countFamilies(branchId)` L14
- `async sendFamilyMessage({ event, actor, title, body })` L16
- Internal: `familyRecipients` L6

#### evacuationService.js

- `async getOnSiteSummary({ branchId, organizationId, actor })` L409: People currently on site (staff / residents / visitors / contractors). With branchId: one site. Without: all sites in the org (Owner / SA). Site Manager is always limited to their site.
- `async startEvacuation({ organizationId, branchId, type, startedByUserId = null, kioskId = null, actor = null, })` L847
- `async getActiveEvacuation({ organizationId, branchId, includeStats = true, actor = null, type, selfUserId = null, })` L904
- `async getEvacuationEvent({ organizationId, evacuationEventId, actor, })` L961
- `async listEvacuations({ organizationId, actor, page, limit, skip, branchId, status, type, })` L1010
- `async closeEvacuation({ organizationId, evacuationEventId, actor = null, kioskId = null, })` L1137
- `async getRollcall({ organizationId, evacuationEventId, actor, status, personKind, page, limit, skip, })` L1372
- `async alertFamilies({ organizationId, evacuationEventId, actor })` L1431
- `async updateFamilies({ organizationId, evacuationEventId, actor, presets, })` L1491
- `async allClearFamilies({ organizationId, evacuationEventId, actor, })` L1537
- `async closeActiveEvacuationForBranch({ organizationId, branchId, kioskId, })` L1586: Close the active event for a branch in one flow (kiosk all-clear).
- `async upsertEvacCheck({ organizationId, evacuationEventId, personKind, personId, status, markedAt, locationLabel, geo, lastSeenLabel, lastSeenAt, clientEventId, actor = null, allowSelfOnly …)` L1629
- `async listEvacChecks({ organizationId, evacuationEventId, actor, status, personKind, unaccountedOnly = false, })` L1737
- `async markSelfCheck({ organizationId, userId, status, locationLabel, geo, clientEventId, branchId, })` L1780
- `async myDrills({ actor, organizationId, page, limit, skip })` L1894: Mock drills this staff marked on, last 12 months, one aggregation.
- Internal: `emptyKindBucket` L56, `EMPTY_KIND_STATS` L64, `startOfUtcDay` L71, `toObjectId` L77, `parseEvacuationType` L84, `optionalEvacuationType` L91, `activeEvacuationMatch` L96, `parseCheckStatus` L112, `parsePersonKind` L120, `emptyRollcallStats` L127, `statsFromGroupedRows` L137, `rollcallStatsPipeline` L167, `familyAlertOf` L254, `shapeKiosk` L267, `selfCheckLookupPipeline` L291, `formatEventDoc` L368, `assertSiteManagerBranch` L395, `seedRollcallChecks` L496, `rollcallDetailLookup` L769, `loadEventWithBranchAndStats` L808, `withSelfCheck` L894, `emptyEvacuationStatusCounts` L984, `countEvacuationsByStatus` L991, `loadFamilyEvent` L1194, `loadEventForFamilyMessage` L1230, `getFamilyAlert` L1239, `loadScopedEvent` L1255, `listUnaccounted` L1272, `claimFamilyAlert` L1416, `respondWithEvent` L1423, `parseFamilyUpdatePresets` L1480, `enrichSingleCheck` L1621, `drillScoreMeta` L1834, `durationUnit` L1842, `drillDurationLabel` L1845, `withDrillDurationLabel` L1859

### backend/admin/services/family

#### familyAuthor.js

- `authorRoleStages({ userField = "authorId", output = "authorRole", } = {})` L13: Adds a role label ("Site Manager") for the user in userField, as the field named output; rows need an organizationId.

#### familyGazetteAdminService.js

- `async listGazettes({ organizationId, branchId, status, keyword, page, limit, skip, })` L155
- `async getGazette({ organizationId, branchId, itemId })` L348
- `async renderIssue({ issueId, now = new Date() })` L510
- `async recoverStuckGazettes({ now = new Date(), limit = RECOVER_PER_RUN, } = {})` L554
- `renderInBackground(issueId)` L596
- `async generateForSite({ actor, organizationId, branchId, now = new Date(), background = true, })` L604
- `async printAll({ actor, organizationId, branchId, itemIds, now = new Date(), })` L658
- `async retryIssue({ actor, organizationId, branchId, background = true, })` L701
- `async regenerate({ actor, organizationId, itemId, removeUploadIds, uploadIds, now = new Date(), })` L733
- `async markPrinted({ actor, organizationId, itemId, now = new Date(), })` L764
- `async markGiven({ actor, organizationId, itemId, givenOn, now = new Date(), })` L785
- `async getPdf({ organizationId, branchId, itemId })` L817
- `async downloadEntries({ organizationId, branchId })` L822
- `zipStream(entries)` L886
- Internal: `labelOf` L104, `escapeRegex` L110, `currentIssues` L112, `issueSummary` L126, `homeNames` L139, `matching` L148, `loadItemInOrganization` L329, `photoOf` L345, `groupOf` L492, `currentIssueForStaff` L648, `loadItemForStaff` L720, `idList` L726

#### familyGazetteCard.js

- `async getWallGazetteCard({ organizationId, branchId, now = new Date(), })` L143
- Internal: `sitesOf` L20, `cardOfSite` L30

#### familyGazetteEngine.js

- `choosePeriod({ rules, timezone, at = new Date(), scheduled = false, })` L29
- `selectContent({ cap, familyCount, uploads, usedUploadIds, removedUploadIds, posts, chosenUploadIds = null, })` L48
- `async generateIssue({ organizationId, branchId, period, actor = null, now = new Date(), })` L240
- `async rebuildItem({ item, issue, removeUploadIds = [], chosenUploadIds = null, now = new Date(), })` L334
- Internal: `isDuplicateKey` L26, `idOf` L45, `group` L99, `gather` L109, `nextNumber` L197, `findIssue` L205, `openIssue` L212

#### familyGazetteNotifications.js

- `async recipientsOf(match)` L18: Everyone actively linked to a resident, or to anyone at a site, each person once.
- `async notifyPrinted({ item, actorId = null })` L43: A gazette is published to the family app when the home marks it printed, so that is when the family of the resident hears about it. Called only for the gazette that was actually moved to printed, so each family is told once. A notification that cannot be saved never undoes the printing.
- `async notifyClosingSoon({ receivers, closesAt, timezone, issueKey, })` L83: "Gazette closes on 28 Oct": everyone linked to a resident at the site is asked for a photo or message.
- Internal: `firstName` L12, `deliver` L26

#### familyGazettePdf.js

- `gazetteTitle(residentName)` L20: "The Hughes Family Gazette"; a resident known by one name gets "Margaret's Gazette".
- `periodLabel({ periodStart, periodEnd, timezone })` L27
- `async drawGazette({ gazette, photos = new Map() })` L94: One resident's gazette, the way the sample shows it: a cover with the family's title and a letter, "From your family" with every message, "Life at the home" with the wall posts about them, and a note on how to be in the next issue. Large print for easy reading. `photos` maps a media id to the image bytes.
- `async renderGazettePdf(options)` L99
- Internal: `sans` L15, `serif` L16, `firstWord` L17, `viewOf` L35

#### familyGazettePeriod.js

- `periodByIndex({ anchorDate, issueEveryDays, timezone, index })` L14
- `indexAt({ anchorDate, issueEveryDays, timezone, at = new Date() })` L32: Which issue a moment falls in. Before the anchor it is still the first one, which has not started.
- `currentPeriod(options)` L41
- `lastClosedPeriod(options)` L44
- `manualPeriod({ issueEveryDays, timezone, at = new Date() })` L53: A gazette asked for by hand when no schedule is set: the last `issueEveryDays` whole days up to today.
- Internal: `startOfDay` L11

#### familyGazetteScheduler.js

- `async scheduledSites()` L28
- `async generateDueIssues({ now = new Date() } = {})` L69
- `async sendDueReminders({ now = new Date() } = {})` L122
- Internal: `isDuplicateKey` L26

#### familyGazetteService.js

- `lifeEntry(post)` L45
- `coverOf(messages)` L64
- `sendersOf(messages, kinOf)` L68
- `async loadInput({ item })` L98
- `async renderItem({ itemId, now = new Date() })` L302
- `async getItemPdf({ itemId })` L359
- Internal: `cut` L39, `relationshipLabels` L42, `single` L89, `loadPhotos` L230, `loadItem` L268, `draw` L278, `fileNameOf` L292

#### familyGroupService.js

- `async listFamilyGroups({ organizationId, branchId, status, keyword, page, limit, skip, })` L146: One row per admitted resident. meta.counts ignores the status filter so the tabs stay stable.
- `async getFamilyGroup({ organizationId, branchId, residentId })` L228: One resident's family group, as the detail page shows it: the resident, the primary next of kin, the linked members and a summary. The group id is the resident's id.
- Internal: `first` L27, `nextOfKinOnly` L29, `groupStages` L37, `countsOf` L134

#### familyMessageStaffService.js

- `async sendMessage({ actor, organizationId, branchId, audience, residentIds, recipientIds, conversationId, message, subject, alsoEmail, now = new Date(), })` L223
- `async listContacts({ actor, organizationId, branchId, keyword, page, limit, skip, })` L322: notRead stays true until the contact opens the latest message.
- `async getContact({ actor, organizationId, conversationId, page, limit, skip, })` L403
- `async listRecipients({ actor, organizationId, branchId, keyword, page, limit, skip, })` L463
- `async listSent({ actor, organizationId, branchId, keyword, page, limit, skip, })` L528
- `async getSent({ actor, organizationId, broadcastId, page, limit, skip })` L590
- Internal: `cleanIds` L37, `residentsByPerson` L50, `recipientsOf` L84, `saveMessages` L136, `contactInScope` L176, `emailFamily` L201

#### familyModerationService.js

- `async listUploads({ organizationId, branchId, residentId, status, keyword, residentMustExist = false, page, limit, skip, })` L158: Every status by default, newest first; status=pending lists the queue oldest first. meta.counts (with a total) ignores the status filter; meta.oldestPendingAt feeds the "oldest" age.
- `async getUpload({ actor, organizationId, uploadId })` L244
- `async approveUpload({ actor, organizationId, uploadId, residentId, blur })` L363
- `async rejectUpload({ actor, organizationId, uploadId, residentId, reason, reasonKey, note, })` L392
- Internal: `reasonText` L36, `statusCountsOf` L50, `loadWaitingUpload` L263, `settle` L298, `decisionOf` L308, `notifyAuthor` L316, `saveBlurredCopies` L333

#### familyNewsletterEmail.js

- `escapeHtml(value)` L17
- `renderEmailHtml({ homeName, title, periodLabel, welcome })` L34: Everything a manager typed is escaped: the email shows it as text and never as markup.
- `async emailRecipients({ organizationId, branchId })` L57: One address per person, lower case: everyone actively linked to a resident at the site.
- `async sendNewsletterEmails({ newsletter, homeName, periodLabel, pdf, filename, alreadySent = [], onSent, })` L82: Each family member gets their own message with the PDF attached, so nobody sees another family's address. A message that fails is counted and the rest still go out.
- Internal: `oneLine` L21, `excerpt` L26

#### familyNewsletterPdf.js

- `async renderNewsletterPdf({ newsletter, organizationName = "", photos = new Map(), timezone = "Europe/London", })` L94: Renders the newsletter the way the template shows it: header, welcome, the month's posts, coming up and notices side by side, the photo gallery and a footer. Only sections that are switched on are drawn. `photos` maps a media id to the image bytes.
- Internal: `sans` L10, `serif` L11, `viewOf` L13

#### familyNewsletterService.js

- `async getNewsletter({ organizationId, branchId, newsletterId })` L366
- `async listNewsletters({ organizationId, branchId, status, month, keyword, page, limit, skip, })` L445
- `async createDraft({ actor, organizationId, branchId, month, title, template, })` L568
- `async updateDraft({ actor, organizationId, newsletterId, ...patch })` L666
- `async deleteDraft({ actor, organizationId, newsletterId })` L747
- `async pruneForSend(newsletter)` L835
- `async getPdf({ organizationId, branchId, newsletterId })` L1009
- `async sendNow({ actor, organizationId, newsletterId, delivery })` L1128
- `async schedule({ actor, organizationId, newsletterId, sendAt, delivery, })` L1149
- `async cancelSchedule({ actor, organizationId, newsletterId })` L1181
- `async sendDueNewsletters({ now = new Date(), limit = DUE_PER_RUN, } = {})` L1196
- `async recoverStuckNewsletters({ now = new Date(), limit = DUE_PER_RUN, } = {})` L1215
- Internal: `isDuplicateKey` L69, `firstLine` L71, `cut` L76, `highlightFromPost` L79, `monthWindow` L95, `shortName` L106, `formatAddress` L115, `plainText` L123, `objectList` L137, `uniqueIds` L151, `checkSections` L161, `checkComingUp` L176, `checkNotices` L197, `checkDelivery` L203, `checkTemplate` L215, `checkFooter` L223, `checkHighlights` L234, `checkGallery` L266, `checkNewResidents` L288, `statusCountsOf` L328, `recipientsOf` L339, `autoFill` L519, `nextIssueNumber` L560, `loadDraft` L641, `parseSendAt` L759, `loadForDelivery` L774, `hasContent` L796, `chosenDelivery` L808, `assertReadyToSend` L822, `claim` L827, `recipientUsers` L878, `notifyInApp` L890, `slug` L923, `pdfFilename` L929, `loadPhotos` L932, `buildPdf` L965, `storePdf` L991, `emailFamilies` L1038, `deliver` L1067

#### familyOverviewService.js

- `async activityOf({ scope, since })` L29
- `async getOverview({ actor, organizationId, branchId, days })` L219
- Internal: `nextNewsletterOf` L75, `gazetteProgressOf` L113, `checklistOf` L192

#### familyPdfKit.js

- `printable(value)` L68
- `showable(style, value)` L74: A letter the font does not have (an emoji, Arabic or Chinese) is shown as ? instead of an empty box.
- `fitFontSize({ style, text, width, max, min })` L86: The largest font size, from max down to min, at which the text fits one line of the given width in points.
- `cssString(value)` L94: A value placed inside a CSS string in a stylesheet: quotes, backslashes, line breaks and "&lt;" cannot break out of it.
- `async prepareImage(buffer)` L101
- `async photoUris(photos)` L113
- `renderTemplate(name, data, directory = TEMPLATE_DIR)` L129: Fills a template from assets/pdf/family. Everything printed with &lt;%= %> is HTML-escaped.
- Internal: `fontOf` L48, `fontCss` L56

#### familyPdfRenderer.js

- `async htmlToPdf(html)` L92: Prints the page to an A4 PDF. The page has no scripts and may load nothing but the data inside it, so whatever a manager or family member typed can never run code or reach another address.
- `async closeBrowser()` L124
- Internal: `resolveBrowserExecutable` L11, `getBrowser` L41, `acquire` L69, `release` L78, `pageCountOf` L84

#### familyPostFilters.js

- `publishedPostsOfSite({ organizationId, branchId, includeTagged = false, })` L21: The live posts of one site that are safe to reuse in a printed or sent document.

#### familyPostService.js

- `async listPosts({ organizationId, branchId, residentId, authorId, status, pinned, hasPhotos, reported, from, to, sort, keyword, days, audience, page, limit, skip, })` L304
- `async listTaggableResidents({ actor, organizationId, branchId })` L450
- `async listAuthors({ organizationId, branchId, keyword })` L480: Who has posted on the wall, for the Author filter: one row per person, with their role and number of posts.
- `async createPost({ actor, organizationId, branchId, title, message, status, scheduledAt, mediaIds = [], taggedResidentIds = [], isPinned, audience = FamilyPostAudience.ALL, })` L546
- `async updatePost({ actor, organizationId, postId, title, message, status, scheduledAt, mediaIds, taggedResidentIds, isPinned, audience, })` L674
- `async publishDuePosts({ now = new Date(), limit = DUE_PER_RUN, } = {})` L803
- `async removePost({ actor, organizationId, postId })` L832
- Internal: `parseSchedule` L68, `checkAudience` L84, `normaliseTitle` L92, `normaliseMessage` L99, `normaliseIds` L105, `assertTaggable` L124, `inferSite` L144, `assertMediaUsable` L185, `resolveBranch` L203, `postRowStages` L205, `statusCountsOf` L279, `dateFilter` L290, `getPostRow` L440, `notifyFamilies` L508, `loadOpenPost` L639, `nextState` L756

#### familySearch.js

- `async searchClause({ keyword, organizationId, branchId, fields = [], resident, person, })` L68: A search box over a list: `fields` are on the document itself, `resident` and `person` point at the fields holding a resident id (or an array of them) or a user id. The text is taken literally. Returns the $or to add to the list's filter, or null when nothing was typed; a search that finds nothing returns an $or that matches nothing.
- Internal: `regexOn` L9, `residentIdsMatching` L12, `userIdsMatching` L28

#### familyService.js

- `async requireManageableResident({ actor, organizationId, residentId, })` L54
- `async createInvitation({ inviterId, organizationId, resident, email, name, relationship, isNextOfKin = false, })` L100: Everything that makes an invitation, once the caller is known to be allowed to send it.
- `async inviteFamilyMember({ actor, organizationId, residentId, ...fields })` L181
- `async listInvitations({ organizationId, branchId, page, limit, skip, status, residentId, keyword, })` L227
- `async getInvitation({ invitationId, organizationId, branchId })` L312
- `async resendInvitation({ actor, invitationId, organizationId })` L387
- `async editInvitation({ actor, invitationId, organizationId, name, relationship, })` L431: Fix a pending invitation's name or relationship; the email and link stay as they were.
- `async deleteInvitation({ actor, invitationId, organizationId })` L485: Only an invitation that went nowhere can be deleted: revoked or expired. An accepted one stays as the record.
- `async revokeInvitation({ actor, invitationId, organizationId })` L517
- `async previewInvitation(token)` L621
- `async listMyInvitations({ user, page, limit, skip })` L626
- `async getMyInvitation({ user, invitationId })` L684
- `async acceptInvitation({ token, name, password, timezone })` L812
- `async acceptMyInvitation({ user, invitationId })` L817
- Internal: `toObjectId` L36, `buildAcceptUrl` L40, `stripHash` L45, `dispatchInvitation` L73, `invitationStatusNow` L201, `statusCountsOf` L216, `assertFamilyModuleOn` L542, `findByToken` L548, `shapeInvitationPreview` L570, `requireMyPendingInvitation` L661, `redeemInvitation` L690

#### familySettingsService.js

- `async getSettings({ organizationId })` L27
- `async getGazetteRules({ organizationId })` L35: For the gazette engine: the same values as above, as the dates and numbers it works with.
- `async updateSettings({ actor, organizationId, gazette, deadlineReminder, communityWall, })` L57: Only what is sent changes. Saving is what switches the schedule on, so the first save also needs a start day: the first issue begins on it.
- Internal: `present` L13, `wholeNumber` L46

#### familySite.js

- `async resolveSite({ actor, organizationId, branchId })` L12: The site staff are acting on: the one asked for, or their own. A site or line manager cannot reach another site; an owner or super admin must say which one.
- `async assertMayChangeSite({ actor, organizationId, branchId })` L23: Same rule for something that already belongs to a site.

#### familyStaffService.js

- `async listScope({ actor, organizationId, branchId, residentId })` L47: What a list covers: one resident, or everything the caller's role allows (a site manager sees their own site).
- `async listAllMembers({ organizationId, branchId, residentId, status, isNextOfKin, keyword, page, limit, skip, })` L139: Without a status it lists active, pending and inactive; meta.counts covers the other statuses too (never removed) and ignores the status filter.
- `async getMember({ organizationId, branchId, memberId })` L236
- `async listMembers({ organizationId, residentId })` L353
- `async editMember({ actor, organizationId, memberId, relationship, })` L395: Staff fix how someone is listed: their relationship. Their name, email and phone belong to their account.
- `async changeMemberAccess({ actor, organizationId, memberId, action, })` L433: Pause someone's access, or switch it back on. The next of kin cannot be paused: hand over first.
- `async setNextOfKin({ actor, organizationId, residentId, memberId, })` L464: Also how the home finishes a "let the home choose" handover.
- `async removeMember({ actor, organizationId, residentId, memberId, })` L491: Unlike the family app, staff may remove the next of kin too, which leaves the resident without one.
- `async listJoinRequests({ actor, organizationId, branchId, residentId, page, limit, skip, })` L516
- `async decideJoinRequest({ actor, organizationId, requestId, decision, })` L558
- `async listHandovers({ actor, organizationId, branchId, residentId, homeChooses, page, limit, skip, })` L587
- `async getCode({ actor, organizationId, residentId })` L657
- `async createCode({ actor, organizationId, residentId })` L666
- `async getFamily({ actor, organizationId, residentId })` L678
- Internal: `loadLink` L70, `requireReadableResident` L93, `LISTED_STATUSES` L124, `statusCountsOf` L127, `uploadCountsOf` L226, `codeLinkFor` L651

#### familyStaffUploadService.js

- `async sendUpload({ actor, organizationId, residentId, message, mediaIds, includeInGazette, clientId, })` L6

#### familyVisitPause.js

- `async cancelUpcomingVisits({ organizationId, branchId, actorId, reason = "", now = new Date(), })` L51: Pausing visiting cancels every visit still to come at the site, withdraws the kiosk codes issued for them and tells the families affected. A notification that cannot be saved never undoes the pause.
- Internal: `unique` L18, `tellFamilies` L20

#### familyVisitStaffService.js

- `async listVisits({ actor, organizationId, branchId, residentId, status, source, range, withVisiting = false, page, limit, skip, now = new Date(), })` L121: Visit requests and home invitations for a resident, a site, or everything the caller's role covers.
- `async inviteFamily({ actor, organizationId, residentId, date, startTime, endTime, note, now = new Date(), })` L168: The home invites a resident's family to a visit; each member answers for themselves.
- `async getVisit({ actor, organizationId, visitId })` L224
- `async findVisit({ actor, organizationId, visitId })` L233
- `async decideVisit({ actor, organizationId, visitId, decision, note, now = new Date(), })` L339: Confirm or decline a family's request, or cancel a visit the home no longer wants.
- `async getSettings({ actor, organizationId, branchId })` L382
- `async updateSettings({ actor, organizationId, branchId, body = {}, now = new Date(), })` L426: Saves the visiting hours and rules of a site, and pauses or resumes visiting; fields left out stay as they were.
- `setVisiting({ actor, organizationId, branchId, paused, reason, now, })` L500: Pause Visiting: stops new requests and cancels the visits still to come, telling the families affected.
- Internal: `countReplies` L68, `assertEnum` L78, `loadVisit` L211, `settle` L242, `withdraw` L302, `settingsView` L356, `requireSite` L373, `cleanVisitingHours` L387, `cleanProtectedTimes` L394, `cleanWhole` L419

#### familyWallActivityService.js

- `async decoratePosts({ rows, organizationId })` L36
- `async dismissReports({ actor, organizationId, postId })` L180
- `actionReports({ postId, actorId })` L200
- `async getAttention({ organizationId, branchId })` L212
- `async getStaffActivity({ organizationId, branchId, days })` L263
- Internal: `countOf` L33, `loadPostSite` L164

### backend/admin/services/kiosk

#### kioskService.js

- `async searchBranchesForKiosk({ keyword, page, limit, skip, deviceId, })` L92: Public branch lookup for kiosk setup. Keyword matches org name, branch name, code, or address. Only sites with sign-in attendance enabled.
- `async searchStaffForKiosk({ organizationId, branchId, keyword, page, limit, skip, })` L310
- `async getStaffPreviewForKiosk({ organizationId, branchId, staffId, })` L391
- `async requestKioskCheckInOtp({ organizationId, branchId, staffId, })` L410
- `async verifyKioskCheckInOtp({ organizationId, branchId, staffId, otp, })` L457
- `async getKioskQr({ kiosk, organizationId })` L522
- `async scanKioskFromPhone({ scanToken, userId, organizationId, })` L571
- `async scanContractorFromPhone({ scanToken, userId })` L639
- `async getPendingPairing({ kioskId })` L724
- `async confirmPairingAndClockIn({ kioskId, organizationId, branchId, sessionId, clientEventId, occurredAt, image, })` L811
- `async cancelPairing({ kioskId, sessionId })` L882
- `async assertAttendanceModule(organizationId)` L896
- `async publicOrganization(organizationId)` L935
- `async registerKiosk({ branchId, activationCode, deviceId, adminPin, receptionIdentifier, locationLabel, deviceType, fireEvacuation, })` L1074
- `async verifyKioskAdminPin({ branchId, deviceId, adminPin })` L1164
- `async getKioskSession({ kiosk, branch })` L1203
- `async updateKioskSettings({ kiosk, branch, fireEvacuation })` L1223
- `assertKioskFireEvacuationEnabled(kiosk)` L1240
- `async verifyKioskEmergencyPin({ kiosk, branchId, emergencyPin })` L1246
- `async verifyStaffPinAtKiosk({ organizationId, branchId, kioskId, staffId, nfcTagId, employeeCode, pin, })` L1268
- `async clockInAtKiosk({ organizationId, branchId, kioskId, staffId, nfcTagId, employeeCode, pin, clientEventId, occurredAt, image, })` L1316
- `async clockOutAtKiosk({ organizationId, branchId, kioskId, staffId, nfcTagId, employeeCode, pin, clientEventId, occurredAt, })` L1352
- `async listOnSiteAtKiosk({ branchId, keyword, page, limit, skip })` L1384
- `async getTodayAtKiosk({ organizationId, branchId, staffId, nfcTagId, employeeCode, pin, })` L1393
- `async listKiosksForAdmin({ actor, organizationId, page, limit, skip, branchId, keyword, setupStatus, kioskMode, presence, deviceType, })` L1586
- `async getKioskForAdmin({ actor, organizationId, kioskId })` L1731
- `async createKioskForAdmin({ actor, organizationId, branchId, receptionIdentifier, locationLabel, deviceType, })` L1756
- `async updateKioskForAdmin({ actor, organizationId, kioskId, receptionIdentifier, locationLabel, deviceType, branchId, fireEvacuation, })` L1799
- `async toggleKioskLockForAdmin({ actor, organizationId, kioskId })` L1852
- Internal: `escapeRegex` L56, `publicAddress` L59, `isModuleEnabled` L77, `shapeStaffPreview` L251, `assertStaffAtKioskBranch` L292, `resolvePhoneForStaff` L404, `randomScanToken` L520, `expireStalePairingSessions` L560, `fireEvacuationEnabled` L912, `parseOptionalBoolean` L914, `deviceKioskFlags` L925, `organizationForKiosk` L944, `sanitizeKiosk` L955, `kioskAuthPayload` L972, `resolveStaffForKiosk` L988, `assertKioskUnlocked` L1192, `touchLastCheckIn` L1263, `parseSetupStatus` L1420, `parseDeviceType` L1429, `parseKioskMode` L1438, `parsePresence` L1446, `heartbeatCutoff` L1455, `applyPresenceMatch` L1457, `orgBranchIds` L1475, `kioskListStages` L1490, `branchPublic` L1530, `shapeAdminKiosk` L1548, `emptyKioskList` L1570, `loadKioskVisitDetail` L1672

#### kioskVisitService.js

- `async searchVisitPeople({ branchId, keyword, page, limit, skip, })` L110
- `async listVisitPolicies({ organizationId, branchId, personType })` L147
- `async verifyInvite({ branchId, inviteCode })` L256
- `async resendInvite({ branchId, organizationId, email })` L271
- `async confirmContractorQrCheckIn({ organizationId, branchId, kioskId, externalPersonId, invitationId, photoUrl, })` L335
- `async checkInAtKiosk({ organizationId, branchId, kiosk, method, inviteCode, ...walkIn })` L475
- `async checkOutAtKiosk({ branchId, kiosk, visitSessionId, externalPersonId, inviteCode, })` L512
- `async listOnSiteVisits({ branchId, keyword, page, limit, skip })` L557
- Internal: `escapeRegex` L40, `applyPersonPhoto` L43, `greetingForHour` L55, `shapeVisit` L61, `applySignatures` L216, `checkInByInvitation` L278, `checkInWalkIn` L390, `withSignOutReminder` L468

#### kioskWidgetService.js

- `async listKioskWidgets({ actor, organizationId, branchId, kioskId, })` L176
- `async saveKioskWidgets({ actor, organizationId, branchId, kioskId, homeWidgets, checkoutWidget, })` L229
- `async listKioskWidgetsForDevice({ kiosk, organizationId })` L282
- Internal: `toOid` L22, `trimText` L29, `requireUrl` L32, `parseTextKind` L40, `configForType` L48, `parseWidget` L73, `publicWidget` L100, `splitByPlacement` L112, `assertWidgetScope` L125, `resolveKioskId` L136, `widgetRowsPipeline` L144, `pickScopedRows` L168, `replacePlacement` L203

### backend/admin/services/leave

#### leaveService.js

- `entitlementYearFromDate(date)` L162
- `calculateHolidayEntitlement({ startDate, contractedWeeklyHours = FULL_TIME_WEEKLY_HOURS, year, fullYearDays = DEFAULT_FULL_YEAR_HOLIDAY_DAYS, })` L183: Holiday pot for a leave year: full-year days × hours factor × time in year. Mid-year start uses startDate; hours use contractedWeeklyHours vs 37.5.
- `async createLeaveRequest({ userId, organizationId, leaveType, startDate, endDate, totalDays, reason, attachmentUrl, branchId, })` L651
- `async reportSickness({ userId, organizationId, startDate, shiftId, reason, })` L754
- `async listMyLeaveRequests({ userId, organizationId, page, limit, skip, status, leaveType, })` L841
- `async getMyLeaveRequest({ userId, organizationId, requestId })` L907
- `async cancelLeaveRequest({ userId, organizationId, requestId })` L921
- `async listMyEntitlements({ userId, organizationId, year })` L969
- `async listMyLeaveScores({ userId, organizationId, from, to })` L984
- `async listLeaveScores({ organizationId, page, limit, skip, branchId, staffId, from, to, actor, })` L1000
- `async listLeaveRequests({ organizationId, page, limit, skip, branchId, staffId, status, leaveType, from, to, keyword, actor, })` L1142
- `async getLeaveRequest({ requestId, organizationId, actor })` L1202
- `async approveLeaveRequest({ actor, organizationId, requestId, decisionNote, managerStaffId = null, })` L1223
- `async rejectLeaveRequest({ actor, organizationId, requestId, decisionNote, managerStaffId = null, })` L1314
- `async recordManagerLeave({ actor, organizationId, staffId, leaveType, startDate, endDate, totalDays, reason, branchId, })` L1366
- `async closeLeaveRequest({ actor, organizationId, requestId })` L1440
- `async listEntitlements({ organizationId, page, limit, skip, branchId, staffId, year, leaveType, actor, })` L1486
- `async upsertEntitlement({ actor, organizationId, staffId, year, leaveType, entitlementDays, carriedOverDays, recalculate, fullYearDays, })` L1529
- `async seedDefaultAnnualLeave({ profile, session } = {})` L1593
- Internal: `assertKnownLeaveType` L36, `startOfUtcDay` L46, `siteTimezone` L52, `isLeaveModuleEnabled` L58, `orgFullYearLeaveDays` L67, `usesHolidayBalance` L78, `assertHolidaySpan` L81, `parseLeaveDates` L98, `assertLeaveTotalDays` L116, `assertLeaveRequestsEnabled` L127, `requireStaffProfile` L140, `getStaffProfileOrThrow` L151, `leaveYearBounds` L168, `remainingDays` L217, `roundDays` L227, `balanceAfterOf` L229, `parseScoreRange` L241, `scoreMatch` L253, `emptyScore` L280, `shapeScore` L290, `attachScoreStaff` L304, `getOrCreateEntitlement` L323, `assertSufficientBalance` L348, `assertNoOverlap` L383, `staffSummary` L399, `userLookup` L410, `attachLeaveRequestDetails` L420, `assertObjectId` L572, `resolveLeaveBranchId` L578, `getLeaveRequestOrThrow` L588, `staffBranchForScope` L611, `adjustEntitlementPending` L616, `adjustEntitlementTaken` L633, `requireShiftForSickness` L716, `emptyLeaveStatusCounts` L1062, `leaveStatusCountFacets` L1066, `leaveStatusCountsFromFacet` L1069, `leaveYearScoreFacets` L1073, `leaveYearScoresFromFacet` L1094, `escapeRegex` L1102, `staffIdsMatchingKeyword` L1105, `parseLeaveRequestStatus` L1131

### backend/admin/services/organizations

#### branchService.js

- `async revokeBranchSiteManagerScope({ organizationId, branchId, userId, })` L248: Soft-revokes Site Manager scope on one branch for a user (membership → inactive). Does not touch other branches or org-wide roles.
- `async revokeOtherBranchSiteManagers({ organizationId, branchId, keepUserId = null, })` L276: Ensures only `keepUserId` (if any) remains an active Site Manager on this branch. Clears leftover scope when managers were reassigned without revocation.
- `async assignExistingBranchManager({ organizationId, branchId, userId, })` L301: Makes someone the site manager for a branch and records them on the branch row. Revokes any other active Site Manager memberships on this branch first.
- `async createBranch({ actor, organizationId, name, code: requestedCode, address, timezone, assemblyPoint, settings, manager, })` L364
- `async listBranches({ organizationId, page, limit, skip, keyword, status, })` L453
- `async getBranch({ branchId, organizationId })` L602: Branch routes carry no organization in the path, so every lookup is pinned to the caller's resolved scope — otherwise an org id header would be enough to read another tenant's branch.
- `async updateBranch({ actor, branchId, organizationId, name, code: requestedCode, address, timezone, assemblyPoint, settings, emergencyPin, status, managerUserId, manager, })` L619
- `async issueActivationCode({ branchId, organizationId, issuedByUserId, issuedToUserId, expiresInHours, kioskId = null, })` L750: The plaintext code is returned exactly once; only its hash is stored, so a lost code has to be reissued rather than recovered. Issuing supersedes any code still live for the branch, so at most one of the 10,000 possible codes is guessable at a time.
- `async listActivationCodes({ branchId, organizationId, page, limit, skip, status, })` L795
- `async revokeActivationCode({ branchId, organizationId, activationCodeId, })` L819
- `async verifyActivationCode({ branchId, code })` L849: Checks a code presented during device registration and consumes it on success. Every failure costs one of `MAX_FAILED_ATTEMPTS`; exhausting the budget locks the code so a 4-digit space cannot be walked. Callers should also rate-limit by IP, since locking one code does not stop an attacker moving to the next.
- Internal: `randomDigits` L27, `normalizeBranchCode` L33, `assertValidBranchCode` L35, `assertBranchCodeFree` L46, `duplicateBranchKeyError` L52, `resolveBranchCode` L59, `toObjectId` L85, `normalizeHoursSetting` L107, `normalizeEarlyClockInMinutes` L116, `normalizeMaxShiftHours` L127, `normalizeBreakBands` L138, `buildSettings` L163, `applyManager` L198, `assertBranchNameFree` L236, `branchStatusCountFacets` L418, `branchStatusCountsFromFacet` L421, `activationCodeLookup` L425, `branchManagersLookup` L496

#### membershipService.js

- `async listMembers({ organizationId, page, limit, skip, keyword, role, branchId, status, hasStaffProfile, })` L414
- `async listGrantablePermissions({ actor, organizationId })` L494: What the caller may put in a `permissions` array here, grouped by module so the admin panel can render it directly. Modules the organization has not bought are absent entirely: granting against them would be meaningless.
- `async getMembership({ membershipId, organizationId })` L537
- `async updateMembership({ actor, membershipId, organizationId, role, branchId, permissions, status, })` L552
- `async deactivateMembership({ actor, membershipId, organizationId })` L632
- `async inviteMember({ actor, organizationId, email, name, role, branchId, permissions, jobTitleId, departmentIds, reportsToStaffId, startDate, employeeCode, isBranchManager = false, })` L683
- `async listInvitations({ organizationId, page, limit, skip, status, keyword, })` L883
- `async getInvitation({ invitationId, organizationId })` L916
- `async updateInvitation({ actor, invitationId, organizationId, name, role, branchId, permissions, jobTitleId, departmentIds, reportsToStaffId, startDate, employeeCode, isBranchManager, })` L936
- `async resendInvitation({ actor, invitationId, organizationId })` L1072: Issues a fresh token: the old one is unrecoverable, only its hash was kept.
- `async revokeInvitation({ actor, invitationId, organizationId })` L1115
- `async previewInvitation(token)` L1206: Public preview so the accept screen can show what is being joined.
- `async listMyInvitations({ user, page, limit, skip })` L1215: Pending invitations for a logged-in user (matched by email). Lets existing staff accept a second org/branch without digging through email.
- `async getMyInvitation({ user, invitationId })` L1267
- `async acceptInvitation({ token, name, password, timezone })` L1461
- `async acceptMyInvitation({ user, invitationId })` L1470: Logged-in user accepts one of their pending invitations. No password — email ownership is already proven by the session.
- Internal: `toObjectId` L46, `staffInvitationStatusCountFacets` L50, `staffInvitationStatusCountsFromFacet` L53, `parseStaffInvitationStatus` L56, `isPlatformAdmin` L82, `actorStanding` L88, `assertMayGrant` L114, `grantablePermissions` L142, `assertPermissionsGrantable` L151, `assertBranchInOrganization` L174, `assertNotLastOwner` L184, `emptyMembershipStatusCounts` L379, `membershipStatusCountFacets` L382, `membershipStatusCountsFromFacet` L385, `parseMembershipStatus` L388, `parseOptionalBool` L399, `emptyMemberPage` L406, `buildAcceptUrl` L658, `dispatchInvitation` L663, `userNameStage` L861, `findByToken` L1149, `shapeInvitationPreview` L1170, `requireMyPendingInvitation` L1244, `shouldProvisionStaffProfile` L1272, `provisionStaffProfileFromInvitation` L1279, `redeemInvitation` L1302

#### organizationService.js

- `toObjectId(value)` L33
- `async createOrganization({ actor, name, owner, settings, moduleAccess, })` L222: Creates the organization and invites its owner. The organization starts inert: no owner membership exists and every scoped route refuses it until the invited person accepts. That acceptance is what proves the email address is real before the account gains control of a tenant, and it is where the owner sets their own password rather than being handed one.
- `async activateOrganization({ organizationId, ownerUserId, session })` L316: Called when an owner invitation is redeemed. The organization becomes usable and gains the owner it was created for.
- `async listOrganizations({ actor, page, limit, skip, keyword, status })` L332
- `async getOrganization(organizationId)` L389
- `async updateOrganization({ organizationId, name, settings, status })` L396
- `async getModuleAccess(organizationId)` L481
- `async setModuleAccess({ actor, organizationId, moduleAccess })` L537: Full replacement: the payload is the complete entitlement set for the org.
- `async listModuleDefinitions({ page, limit, skip, includeInactive })` L560
- Internal: `parseDefaultAnnualLeaveDays` L37, `presentSettings` L46, `withSettings` L63, `writerStaffIds` L68, `ownerSummaryFromUser` L92, `attachOwnersToOrganizations` L101, `assertMayCreateOrganization` L162, `assertOrganizationNameFree` L169, `assertOwnerEmailNotStaff` L187, `organizationStatusCountFacets` L326, `organizationStatusCountsFromFacet` L329, `normalizeModuleAccess` L506

#### permissionCatalogue.js

- `permissionKey(moduleSlug, verb)` L36
- `CATALOGUE(moduleSlug)` L53: Every valid permission, in module order.
- `getPermission(key)` L65
- `isKnownPermission(key)` L67
- `enabledModuleSlugs(organization)` L70: Slugs the organization has actually bought and not let lapse.
- `withDefaultStaffPermissions(role, organization, permissions)` L101
- `effectivePermissions(membership, organization)` L128
- `modulesForMenu(permissionKeys, moduleNameBySlug = new Map())` L153: Groups effective permission keys by module for menu rendering. Only modules the organization has bought appear, and only verbs the person actually holds within each module.
- `platformAdminModuleMenu(moduleNameBySlug = new Map())` L180: Platform operator menu — sellable modules with only verbs that exist.
- Internal: `verbsForModule` L46, `licensedKeys` L122

#### staffDashboardSettingsService.js

- `async getStaffDashboardSettings({ organizationId })` L75
- `async saveStaffDashboardSettings({ organizationId, cards })` L80
- `async resetStaffDashboardSettings({ organizationId })` L93
- `async getStaffDashboardSettingsForStaff({ userId, organizationId, })` L96
- Internal: `defaultCards` L26, `presentCards` L29, `parseCards` L37, `withCatalog` L50, `isModuleEnabled` L58, `loadOrganization` L67

### backend/admin/services/peep

#### floorPlanService.js

- `async listFloorPlans({ actor, organizationId, page, limit, skip, branchId, keyword, status, })` L251
- `async createFloorPlan({ actor, organizationId, branchId, name, imageUrl, pdfUrl, meta, })` L302
- `async getFloorPlan({ actor, organizationId, floorPlanId })` L337
- `async updateFloorPlan({ actor, organizationId, floorPlanId, name, imageUrl, pdfUrl, meta, })` L347
- `async upsertFloorPlanPin({ actor, organizationId, floorPlanId, residentId, x, y, })` L393
- `async deleteFloorPlanPin({ actor, organizationId, floorPlanId, pinId, })` L432
- Internal: `toOid` L24, `hasAssetUrl` L31, `publicAssetUrl` L33, `withPublicAssetUrls` L43, `hasPlanFile` L52, `parsePlanStatus` L55, `parsePinCoord` L63, `emptyFieldMatch` L71, `andMatch` L98, `floorPlanStatusCountFacets` L106, `planEnrichStages` L136, `loadShapedPlan` L178, `loadPlanForWrite` L196, `assertMayAccessPlan` L237

#### peepRecordService.js

- `async listPeepRecords({ actor, organizationId, page, limit, skip, branchId, keyword, peepLevel, floorPlanId, })` L185
- `async getPeepRecord({ actor, organizationId, peepRecordId })` L257
- `async getPeepRecordByResident({ actor, organizationId, residentId, })` L265
- `async createPeepRecord({ actor, organizationId, residentId, peepLevel, supportNeeds, primaryRoute, secondaryRoute, equipmentRequired, responsibleStaff, reviewDueAt, consentStatus, })` L294
- `async updatePeepRecord({ actor, organizationId, peepRecordId, peepLevel, supportNeeds, primaryRoute, secondaryRoute, equipmentRequired, responsibleStaff, reviewDueAt, lastReviewedAt, consent…)` L344
- `async getPeepFloorSummary({ actor, organizationId, branchId, keyword })` L442
- Internal: `toOid` L24, `trimText` L31, `isAllFilter` L34, `emptyPeepLevelCounts` L39, `peepLevelCountsFromGroup` L43, `parsePeepLevel` L46, `defaultReviewDueAt` L58, `loadShapedRecord` L140, `assertMayAccessRecord` L154, `requireAdmittedResident` L168, `emptyLevels` L416, `escapeRegex` L422, `emptySummary` L436

### backend/admin/services/requirements

#### requirementDates.js

- `addDays(date, days)` L7
- `addMonths(date, months)` L10
- `requirementApplies(staff, requirement)` L13
- `assignmentSourceFor(staff, requirement)` L28
- `resolveDueDate({ assignment, latest, requirement })` L39
- `cellFromDates({ assignment, latest, requirement, orgAmberDays, today = new Date(), })` L52
- `trainingListStatus(cell)` L110
- Internal: `resolveAmberDays` L46

#### requirementService.js

- `async listRequirements({ actor, organizationId, branchId, type, keyword, page, limit, skip, })` L272
- `async getRequirement({ actor, organizationId, requirementId, branchId })` L354
- `async createRequirement({ actor, organizationId, branchId, name, type, renewalMonths, firstCompletionDays, amberDaysOverride, evidenceRequired, staffEvidenceAllowed, appliesTo, })` L403
- `async updateRequirement({ actor, organizationId, requirementId, name, renewalMonths, firstCompletionDays, amberDaysOverride, evidenceRequired, staffEvidenceAllowed, appliesTo, branchId, })` L456
- `async createAssignments({ actor, organizationId, requirementId, staffIds, })` L530
- `async getAssignment({ actor, organizationId, assignmentId })` L611
- `async updateAssignment({ actor, organizationId, assignmentId, dueDate, renewalMonthsOverride, })` L671
- `async deleteAssignment({ actor, organizationId, assignmentId })` L708
- `async createRecord({ actor, organizationId, assignmentId, completedAt, notes, documents, })` L724
- `async competencyMatrix({ actor, organizationId, branchId, staffId, jobTitleId, departmentId, keyword, page, limit, skip, })` L921
- `async listAssignments({ actor, organizationId, branchId, staffId, requirementId, type, keyword, page, limit, skip, applyLimit = true, })` L1128
- `async listTrainingRecords({ actor, organizationId, branchId, staffId, requirementId, type, status, keyword, page, limit, skip, })` L1223
- `async myRequirementAssignments({ actor, organizationId, type, status, page, limit, skip, })` L1285
- Internal: `toOid` L44, `optionalOid` L49, `oidList` L54, `parseStoredFile` L62, `shapeFiles` L78, `positiveInt` L91, `orgAmberDays` L101, `assertLibraryManager` L108, `assertCanAccessStaff` L124, `requirementBranchFilter` L139, `loadRequirement` L150, `actorStaffProfileId` L159, `staffIdsForRequirementList` L170, `withActiveMembership` L193, `matchingStaff` L211, `insertAssignments` L231, `autoAssignRequirement` L242, `parseAppliesTo` L267, `loadAssignment` L602, `latestByAssignment` L770, `shapeStaff` L813, `shapeAssignmentRow` L877, `scoreShapedAssignments` L1274

### backend/admin/services/residents

#### residentAccess.js

- `scopeBranchFilter(standing, branchId)` L36
- `assertMayAccessResidents(standing, branchId)` L42: Owner/SA anywhere in the org; SM and LM only on their own site.

#### residentMediaService.js

- `async listResidentMedia({ actor, organizationId, page, limit, skip, branchId, status, residentId, })` L39
- `async reviewResidentMedia({ actor, organizationId, mediaId, decision, reason, })` L138
- Internal: `toObjectId` L22, `parseReviewStatus` L24, `parseDecision` L33

#### residentScreenService.js

- `async profileScreen({ resident })` L52
- `peepScreen({ resident, peep })` L137
- `familyScreen({ family })` L170
- Internal: `formatDate` L14, `formatTime` L20, `titleCase` L28, `row` L33, `floorOf` L39, `floorLabel` L49, `consentLabel` L129, `memberTag` L164

#### residentService.js

- `async listResidents({ actor, organizationId, page, limit, skip, branchId, admissionStatus, keyword, })` L153
- `async getResident({ actor, organizationId, residentId })` L255
- `async createResident({ actor, organizationId, branchId, name, email, phone, photoUrl, roomNumber, careLevel, admissionStatus, visitorPasscode, photographyConsent, })` L282
- `async updateResident({ actor, organizationId, residentId, name, email, phone, photoUrl, roomNumber, careLevel, admissionStatus, branchId, photographyConsent, })` L344
- `async setVisitorPasscode({ actor, organizationId, residentId, visitorPasscode, })` L423
- `async verifyVisitorPasscode({ actor, organizationId, residentId, visitorPasscode, })` L451
- `async listManagerResidents({ actor, organizationId, branchId, tab, admissionStatus, keyword, page, limit, skip, })` L628
- `async getManagerResident({ actor, organizationId, residentId })` L694
- `async setRestriction({ actor, organizationId, residentId, restricted, reason, })` L704
- `async setOut({ actor, organizationId, residentId, out, destination, note, expectedReturnAt, })` L737
- `async deactivateResident({ actor, organizationId, residentId, reason, message, })` L779
- Internal: `parseAdmissionStatus` L41, `parseCareLevel` L48, `assertPasscodeShape` L57, `hashPasscode` L65, `generateQrToken` L67, `parsePhotographyConsent` L79, `branchSummary` L85, `toPublicResident` L88, `requireResidentInOrg` L102, `loadBranch` L126, `attachPeep` L138, `applyPasscodeFields` L268, `toId` L494, `parseTab` L496, `parseAdmission` L503, `parseFlag` L512, `parseDate` L518, `parseDischargeReason` L525, `toPeep` L533, `loadPeepByResident` L541, `toRow` L550, `loadResident` L592, `requireManagedResident` L599, `requireAdmitted` L611, `readRow` L617, `updateAndRead` L623

### backend/admin/services/rota

#### rotaBoardService.js

- `async getRotaBoard({ actor, organizationId, branchId: requestedBranchId, departmentId: requestedDepartmentId, date, period: requestedPeriod, scope: requestedScope, from, to, })` L153
- Internal: `toOid` L33, `defaultScopeForRole` L39, `parseScope` L45, `parsePeriod` L59, `resolveBoardRange` L66, `buildDays` L104, `emptyCell` L121, `alignedCells` L123, `shiftChip` L125, `cellKind` L133, `putShiftOnCells` L139, `minutesBetween` L147, `emptyBoard` L406

#### shiftService.js

- `async createShift({ actor, organizationId, branchId, startsAt, endsAt, staffId, visibility, urgentCover, })` L489
- `async listShifts({ organizationId, page, limit, skip, branchId, status, staffId, from, to, actor, })` L539
- `async getShift({ shiftId, organizationId })` L616
- `async getMyShift({ userId, organizationId, shiftId })` L628
- `async updateShift({ actor, shiftId, organizationId, startsAt, endsAt, staffId, status, visibility, urgentCover, open, })` L652
- `async listStaffShiftsInRange({ staffId, organizationId, from, to, limit = 200, })` L730: Assigned shifts overlapping [from, to] — no profile lookup or branch joins.
- `async listMyShifts({ userId, organizationId, from, to, status, page, limit, skip, })` L751
- `async listOpenShifts({ userId, organizationId, from, to, claim, page, limit, skip, })` L813
- `async getActiveShiftForStaff({ staffProfile, organizationId })` L861
- `async getActiveShift({ userId, organizationId })` L893
- `async createClaim({ userId, organizationId, shiftId, note })` L898
- `async withdrawClaim({ userId, organizationId, claimId })` L928
- `async listClaims({ organizationId, page, limit, skip, status, shiftId, actor, })` L1011
- `async getClaim({ actor, organizationId, claimId })` L1069
- `async approveClaim({ actor, organizationId, claimId, decisionNote, managerStaffId = null, })` L1096
- `async rejectClaim({ actor, organizationId, claimId, decisionNote, managerStaffId = null, })` L1185
- `async createScheduledShiftFromAttendance({ organizationId, branchId, staffId, startsAt, endsAt, })` L1232
- Internal: `emptyShiftStatusCounts` L41, `shiftStatusCountFacets` L44, `shiftStatusCountsFromFacet` L47, `parseShiftStatus` L50, `emptyMyShiftStatusCounts` L65, `myShiftStatusCountFacets` L67, `myShiftStatusCountsFromFacet` L70, `roundShiftHours` L75, `myShiftHoursFacet` L77, `myShiftHoursFromFacet` L99, `parseMyShiftStatus` L108, `parseOpenShiftClaim` L188, `claimedOpenShiftIds` L199, `myClaimLookupStages` L205, `emptyShiftClaimStatusCounts` L235, `shiftClaimStatusCountFacets` L239, `shiftClaimStatusCountsFromFacet` L242, `parseShiftClaimStatus` L245, `maxShiftHoursOf` L256, `earlyClockInMinutesOf` L261, `branchTimezone` L268, `loadBranchRota` L273, `assertShiftDuration` L283, `toZoneMoment` L293, `parseQueryInstant` L303, `startsAtQueryRange` L317, `parseShiftTimes` L325, `sameInstant` L346, `findLinkedAttendance` L348, `assertNoStaffOverlap` L351, `applyShiftTimes` L368, `assertShiftNotLockedByAttendance` L401, `requireStaffProfile` L415, `branchSummary` L426, `staffSummary` L431, `attachShiftDetails` L442, `getShiftOrThrow` L483, `isOpenVisibleToStaff` L622, `openShiftMatch` L803

### backend/admin/services/settings

#### settingsOverviewService.js

- `async getAll(context)` L34
- `async updateAll(context)` L52
- `async getFamilyScreen(context)` L99
- `async updateFamilyScreen(context)` L127
- Internal: `accessOf` L23, `isObject` L88, `loadEmergencyNotifyOffsite` L91

### backend/admin/services/siteLive

#### myStatus.js

- `myStatusFromAttendance(today)` L4
- `async loadMyStatus({ userId, organizationId })` L15

#### signOutReminder.js

- `queueStaffReminder(staffId, missedSignInAt)` L37
- `queueExternalReminder(externalPersonId, missedSignInAt)` L40
- `takeStaffReminder(staffId)` L43
- `takeExternalReminder(externalPersonId)` L45
- Internal: `queue` L4, `take` L15

#### siteActivityQuery.js

- `async staffNamesById(staffIds)` L150
- `async listAttendanceEvents({ branchId, staffIds, since, includeLate = false, })` L179
- `pageEvents(events, page, limit, skip)` L221
- `async listSiteActivity({ branchId, page = 1, limit = 20, skip = 0 })` L335
- Internal: `toOid` L21, `windowStart` L23, `visitEventsPipeline` L29, `attendanceEvent` L170, `evacEventsPipeline` L231, `photoEventsPipeline` L291

#### siteLiveService.js

- `async resolveLiveBranchId({ actor, organizationId, branchId })` L54
- `async getSiteLive({ actor, organizationId, branchId, familyOn = false, })` L72
- `async getSiteLiveActivity({ actor, organizationId, branchId, page, limit, skip, })` L179
- `async listPeople({ actor, organizationId, branchId, tab, days, page, limit, skip, })` L545
- `async checkOutPerson({ actor, organizationId, personKind, recordId, checkOutAt, })` L634
- `async loadDepartments(organizationId, branchIds)` L983
- `async listSiteDepartments({ actor, organizationId, branchId })` L996
- `async listDirectory({ actor, organizationId, branchId, tab, departmentId, keyword, page, limit, skip, })` L1005
- Internal: `shapeKiosk` L62, `toId` L220, `parseTab` L222, `parseKind` L229, `parseDays` L237, `startOfToday` L246, `first` L253, `withPublicPhoto` L255, `staffOnSiteMatch` L320, `visitOnSiteMatch` L327, `residentMatch` L334, `staffOnSiteRows` L341, `visitOnSiteRows` L358, `residentRows` L374, `missedStaffRows` L400, `missedVisitRows` L427, `loadMissedSignOuts` L458, `familyCards` L472, `getHomeCards` L506, `resolvePeopleScope` L527, `parseCheckOutTime` L620, `escapeRegex` L727, `parseDirectoryTab` L729, `parseDepartment` L737, `parseKeyword` L744, `paged` L749, `staffPipeline` L789, `directoryResidentMatch` L796, `staffRows` L808, `residentDirectoryRows` L834, `contractorRows` L866, `archivedStaff` L900, `archivedResidents` L924, `archivedRows` L962

### backend/admin/services/staff

#### announcementService.js

- `async createAnnouncement({ actor, organizationId, branchId, subject, description, category, departmentIds, audience: audienceInput, })` L346
- `async listAnnouncements({ actor, organizationId, branchId, page, limit, skip, })` L435
- `async getAnnouncement({ actor, organizationId, announcementId })` L485
- `async remindAnnouncement({ actor, organizationId, announcementId, now = new Date(), })` L505
- `async listMine({ actor, organizationId, page, limit, skip })` L586
- `async getMine({ actor, organizationId, announcementId, now = new Date(), })` L691
- `async acknowledgeAnnouncement({ actor, organizationId, announcementId, acknowledge = false, now = new Date(), })` L718: Hitting this endpoint marks seen. `{ "acknowledged": true }` also marks acknowledged.
- Internal: `cleanText` L56, `cleanDepartmentIds` L63, `cleanAudience` L76, `userIdsOf` L86, `loadRecipients` L92, `createdByOf` L140, `countWhere` L170, `cardStagesOf` L240, `audienceLabelOf` L275, `cardOf` L288, `notify` L310, `mineOf` L573, `loadMine` L650, `stamp` L680

#### complianceSettings.js

- `hasComplianceFields({ supervisorStaffId, supervisionIntervalMonths, appraisalIntervalMonths, })` L36
- `async applyComplianceFields(staff, { organizationId, supervisorStaffId, supervisionIntervalMonths, appraisalIntervalMonths, })` L45
- `async updateStaffComplianceSettings({ actor, organizationId, staffProfileId, supervisorStaffId, supervisionIntervalMonths, appraisalIntervalMonths, })` L100
- Internal: `toObjectId` L19, `loadStaff` L26

#### meetingConductor.js

- `async actorConductor({ actor, organizationId })` L4

#### staffAccess.js

- `async actorStanding(actor, organizationId)` L39
- `assertMayManageStaff(standing, branchId)` L59
- `async assertMayApproveForStaff({ standing, actor, organizationId, branchId, targetStaffId, managerStaffId = null, })` L78: Owner / Site Manager: branch-scoped manage rules. Line Manager: only the staff who report to them (and same branch when scoped). Pass `managerStaffId` when `hasReports` already resolved the caller's profile so we skip a second StaffProfile lookup.
- `async assertMaySuperviseStaff({ standing, actor, organizationId, branchId, targetStaffId, managerStaffId = null, })` L130: Supervision is conducted by supervisorStaffId, not the org-chart line manager.
- `async assertBranchInOrganization(branchId, organizationId)` L181
- `scopeBranchFilter(standing, branchId)` L187
- `async resolveSubordinates({ userId, organizationId, managerStaffId = null, })` L201: Live direct reports for a manager in one org. Never cached. Resolves userId → StaffProfile, then staff where reportsToStaffId = that profile.
- `async resolveSuperviseeStaffIds({ userId, organizationId })` L230
- `async resolveSubordinateStaffIds(args)` L243: Same as resolveSubordinates, but only StaffProfile ids (for query filters).
- `async scopeStaffIdForActor({ standing, actor, organizationId, staffId })` L253: Staff may only list their own profile. Returns false when the page must be empty (no profile, or staffId is someone else). Other roles keep the staffId they passed.
- `async resolveScopedStaffIds({ standing, actor, organizationId, staffId = null, branchId = null, })` L268: Staff ids the actor may see for leave / attendance registers.
- `async resolveScopedSuperviseeIds({ standing, actor, organizationId, staffId = null, branchId = null, })` L296
- `async applyLineManagerStaffScope({ match, standing, actor, organizationId, staffId = null, staffIdField = "staffId", })` L324
- `duplicateKey(error)` L355
- `async assertOneActiveMembershipPerOrg(userId, organizationId)` L358
- `assertRoleMayHaveStaffProfile(role)` L367
- Internal: `isPlatformAdmin` L37

#### staffComplianceService.js

- `async myCompliance({ actor, organizationId })` L162
- Internal: `toOid` L29, `meetingScore` L34, `emptyRequirementScore` L42, `scoreAssignments` L48, `fireDrillScore` L70, `loadStaff` L102, `meetingsOf` L114, `assignmentRows` L125

#### staffNotify.js

- `dayOf(date)` L13
- `whenOf(date, timezone)` L15
- `notifyStaff({ staffId, ...notification })` L18
- `notifyOrgManagers({ organizationId, branchId, extraUserIds = [], ...notification })` L28

#### staffService.js

- `async validateEmploymentAssignment({ organizationId, branchId, jobTitleId, departmentIds, reportsToStaffId, startDate, employeeCode, requireJobTitle = true, })` L240: Validates job title, departments, and manager for an invite or manual profile. Returns null when no employment fields were sent; otherwise a normalised payload.
- `async insertStaffProfile({ userId, organizationId, branchId, jobTitleId, departmentIds, reportsToStaffId, startDate, employeeCode, contractedWeeklyHours, role, session, })` L301: Creates a profile row; skips quietly when this user already has one in the org.
- `async createDepartment({ actor, organizationId, name, branchId, sortOrder, })` L377
- `async listDepartments({ organizationId, page, limit, skip, keyword, branchId, active, status, })` L435
- `async getDepartment({ departmentId, organizationId })` L478
- `async updateDepartment({ actor, departmentId, organizationId, name, branchId, sortOrder, active, })` L489
- `async createJobTitle({ actor, organizationId, name, branchId, departmentId, level, })` L544
- `async listJobTitles({ actor, organizationId, page, limit, skip, keyword, branchId, departmentId, active, status, level, })` L585
- `async getJobTitle({ jobTitleId, organizationId })` L652
- `async updateJobTitle({ actor, jobTitleId, organizationId, name, level, branchId, departmentId, active, })` L663
- `async createStaffProfile({ actor, organizationId, userId, branchId, employeeCode, jobTitleId, departmentIds, reportsToStaffId, startDate, contractedWeeklyHours, phone, emergencyContactName, em…)` L890
- `async listStaffProfiles({ organizationId, page, limit, skip, keyword, branchId, departmentId, jobTitleId, status, role, actor, })` L1116
- `async listDirectReports({ actor, organizationId })` L1175: Live team list for the caller — direct reports only, never cached.
- `async getStaffProfile({ staffProfileId, organizationId })` L1191
- `async updateStaffProfile({ actor, staffProfileId, organizationId, branchId, employeeCode, jobTitleId, departmentIds, reportsToStaffId, startDate, contractedWeeklyHours, phone, emergencyContact…)` L1209
- Internal: `trimmedOrEmpty` L43, `applyEmergencyContact` L46, `organizationSummary` L55, `branchSummary` L64, `departmentSummary` L74, `formatScopedRow` L83, `attachOrgAndBranchDetails` L100, `randomToken` L150, `randomEmployeeCode` L152, `assertOrganizationExists` L163, `assertJobTitleInScope` L168, `assertDepartmentsInScope` L188, `resolveJobTitleDepartmentId` L220, `parseActiveInactiveFilter` L407, `activeInactiveCountFacets` L417, `activeInactiveCountsFromFacet` L429, `assertOwnBranchOnly` L534, `emptyStaffRoleCounts` L733, `emptyStaffList` L740, `parseStaffListRole` L745, `objectId` L754, `joinOne` L757, `joinLinkedStaff` L771, `joinStaffMembership` L816, `countsFromRoleRows` L887, `lineManagerDirectoryMatch` L1021, `buildStaffListMatch` L1054

### backend/admin/services/statistics

#### statisticsService.js

- `resolvePeriod(period, now)` L30
- `async getWorkforcePeriod(staffScope, range)` L99
- `async getStatistics({ organizationId, requestedBranchId, role, membershipBranchId, year, period = "thisQuarter", now = new Date(), })` L154
- Internal: `getPreviousPeriod` L56

### backend/admin/services/supervision

#### supervisionSchedule.js

- `inZone(value, timezone)` L5
- `supervisionStanding({ startDate, intervalMonths, meetings = [], checkDate, timezone, })` L17: One walk of due dates, one walk of meetings. Score is completed / required so far, capped at 100. Null means nothing is due yet.

#### supervisionService.js

- `updateSupervisionSettings(payload)` L108
- `async listTeamSupervision({ actor, organizationId, branchId, staffId, status, keyword, timezone, page, limit, skip, format, })` L365
- `async getSupervision({ actor, organizationId, supervisionId, timezone })` L483
- `async createSupervision({ actor, organizationId, staffId, status, scheduledAt, locationLabel, completedAt, topics, notes, actionPoints, file, })` L523
- `async updateSupervision({ actor, organizationId, supervisionId, status, scheduledAt, locationLabel, completedAt, topics, notes, actionPoints, file, })` L596
- `async signOffActionPoint({ actor, organizationId, supervisionId, actionPointId, })` L738
- `async signOffActionPoints({ actor, organizationId, supervisionId, actionPointIds, })` L760: Body `actionPointIds` is the full checked set: sent = signed off, omitted = open.
- `async mySupervision({ actor, organizationId, timezone: viewerTz, status, page, limit, skip, format, })` L803
- Internal: `toObjectId` L33, `timezoneFor` L40, `atZone` L45, `viewerTimezone` L51, `formatAt` L57, `datesForViewer` L63, `orgInterval` L75, `loadStaff` L83, `assertCanAccessStaff` L93, `emptyStatusCounts` L112, `statusCountFacets` L114, `statusCountsFromFacet` L117, `parseMeetingStatus` L120, `escapeRegex` L131, `staffIdsMatchingKeyword` L133, `emptyPage` L163, `csvCell` L181, `csvDateTime` L187, `supervisionStatusLabel` L193, `supervisionsToCsv` L200, `csvExport` L221, `parseExportFormat` L226, `assertMayViewSupervision` L458, `textList` L497, `actionPointsFrom` L507, `fileFrom` L518, `loadSupervisionForAccess` L670, `uniquePointIds` L682, `applyActionPointSignOffs` L699, `supervisorNameOf` L781

### backend/admin/services/teamLive

#### teamActivityQuery.js

- `async listTeamActivity({ staffIds, page = 1, limit = 20, skip = 0 })` L61
- Internal: `windowStart` L11, `leaveEvent` L17, `listLeaveEvents` L26

#### teamLiveService.js

- `resolvePeriod(period, tz)` L30
- `async loadTeamIds({ actor, organizationId, standing })` L59
- `async loadTimezone(standing)` L84
- `async loadTeamCounts({ teamIds, from, to, period, tz })` L101
- `async getTeamLive({ actor, organizationId, period: periodQuery })` L187
- `async getTeamLiveActivity({ actor, organizationId, page, limit, skip, })` L199
- Internal: `toOid` L28, `utcDay` L56, `emptyCounts` L92

#### teamRotaService.js

- `async getTeamRota({ actor, organizationId, date, view, departmentId, scope: requestedScope, })` L249
- Internal: `toOid` L40, `loadTimezone` L43, `resolveRange` L51, `assignedMatch` L74, `defaultScopeForRole` L79, `parseScope` L85, `rangeMeta` L99, `emptyDayWeekRota` L106, `emptyPersonRota` L111, `loadOwnProfileId` L117, `resolveScopedStaffIds` L128, `roundHours` L150, `getTeamRotaByPerson` L152

### backend/admin/services/visitors

#### externalPersonService.js

- `parsePersonType(type)` L49
- `normalizeVisitorEmail(email)` L138
- `toPersonObject(person)` L140
- `async findPersonByBranchEmail({ branchId, email, session })` L143
- `async resolveExternalPersonAtBranch({ branchId, type, name, email, phone, photoUrl, carRegistration, departmentId, categoryId, visitorCategory, session, })` L151
- `async createExternalPersonAtBranch(payload)` L212
- `async createExternalPerson({ actor, organizationId, branchId, type, name, email, phone, photoUrl, carRegistration, departmentId, categoryId, visitorCategory, })` L217
- `async listExternalPeople({ actor, organizationId, page, limit, skip, branchId, departmentId, type, siteStatus, hasAccount, keyword, format, })` L360
- `async getExternalPerson({ actor, organizationId, externalPersonId, })` L463
- `async updateExternalPerson({ actor, organizationId, externalPersonId, name, email, phone, photoUrl, carRegistration, departmentId, categoryId, visitorCategory, type, })` L502
- `async updateVisitorUserAccount({ actor, organizationId, userId })` L581
- Internal: `toOid` L42, `parseDirectoryTypes` L56, `parseSiteStatus` L69, `parseHasAccount` L79, `siteStatusCountFacets` L272, `csvCell` L329, `siteStatusLabel` L335, `peopleToCsv` L341, `presentVisitorAccount` L560

#### personCategoryService.js

- `async ensureOrgPersonCategories(organizationId)` L82
- `async listVisitCategories({ organizationId, branchId })` L101
- `async listPersonCategories({ actor, organizationId, status, keyword, appliesTo, branchId, page, limit, skip, })` L123
- `async createPersonCategory({ actor, organizationId, name, appliesTo, branchId, })` L193
- `async updatePersonCategory({ actor, organizationId, categoryId, name, appliesTo, active, })` L228
- `async deletePersonCategory({ actor, organizationId, categoryId })` L263
- Internal: `toOid` L29, `assertMayManageCategories` L36, `parseAppliesTo` L42, `activeFilterOf` L50, `shapeCategory` L58, `seedRows` L72

#### visitPresenceQuery.js

- `toObjectId(value, key = "invalid_id")` L23
- `parseBool(value)` L30
- `parseDateRange({ from, to, timezone })` L86
- `parseGroupBy(groupBy)` L96
- `parsePersonTypes(personType)` L104
- `parseStatuses(status)` L107
- `async resolveBranches({ organizationId, branchId })` L110
- `async aggregateVisitPresence(opts = {})` L221: One DB aggregation for visit presence / analytics. Dates use moment-timezone (branch timezone, or ?timezone=).
- `countVisitPresenceByType(opts = {})` L301
- Internal: `parseCsvEnum` L33, `resolveTimezone` L47, `parseBound` L60, `asInFilter` L130, `buildMatch` L133, `groupIdExpression` L163, `emptyCounts` L185, `mapBreakdownRow` L188, `formatBoundIso` L214

#### visitSessionService.js

- `async closeExpiredVisitSessions({ branchId } = {})` L43
- `parseMethod(method)` L235
- `async createVisitSession({ organizationId, branchId, externalPersonId, personType, method, purposeOfVisit, hostStaffId, hostName, kioskId, invitationId, status = VisitSessionStatus.ON_SITE, po…)` L255
- `async checkIn({ actor, organizationId, branchId, externalPersonId, method, purposeOfVisit, hostStaffId, hostName, kioskId, })` L311
- `async approveVisitSession({ actor, organizationId, visitSessionId, })` L359
- `async denyVisitSession({ actor, organizationId, visitSessionId, })` L377
- `async registerAndCheckIn({ actor, organizationId, branchId, type, name, email, phone, method, purposeOfVisit, hostStaffId, hostName, })` L397: Convenience: create ExternalPerson + check-in in one call (walk-in for drills).
- `async checkOut({ actor, organizationId, visitSessionId, })` L435
- `async listVisitSessions({ actor, organizationId, page, limit, skip, branchId, personType, status, method, from, to, externalPersonId, })` L457
- `async getVisitSession({ actor, organizationId, visitSessionId, })` L534
- `async getOnSiteCounts({ actor, organizationId, branchId, personType, })` L558: On-site counts for visitors/contractors (Figma Screen 86 style).
- `async getVisitAnalytics({ actor, organizationId, branchId, personType, status, from, to, groupBy, onSiteOnly, timezone, })` L590: Visit analytics — one parameterized aggregation (type / site / day / status).
- `async visitorCheckInsReport({ actor, organizationId, page, limit, skip, branchId, departmentId, personType, status, keyword, from, to, })` L678
- Internal: `emptyVisitSessionStatusCounts` L142, `visitSessionStatusCountFacets` L145, `visitSessionStatusCountsFromFacet` L153, `emptyVisitSessionList` L156, `shapeVisitRow` L220, `assertNoOpenVisit` L243, `loadManagedVisitSession` L339, `requireAwaitingApproval` L353, `emptyVisitorCheckInKpis` L619, `emptyVisitorCheckInsReport` L625, `resolveVisitorReportRange` L645

#### visitorAccountInvitationService.js

- `async createVisitorAccountInvitation({ actor, organizationId, branchId, email, name, type, })` L84
- `async resendVisitorAccountInvitation({ actor, organizationId, invitationId, })` L185
- `async revokeVisitorAccountInvitation({ actor, organizationId, invitationId, })` L222
- `async listVisitorAccountInvitations({ actor, organizationId, page, limit, skip, branchId, status, type, keyword, })` L292
- `async previewVisitorAccountInvitation({ token })` L357
- `async acceptVisitorAccountInvitation({ token, name, password, timezone })` L374
- Internal: `hashToken` L41, `buildAcceptUrl` L44, `stripHash` L52, `parseAccountType` L58, `sendInviteEmail` L66, `loadOrgAccountInvitation` L170, `assertPendingAccountInvite` L179, `parseAccountInvitationStatus` L244, `accountInvitationStatusCountFacets` L257, `emptyAccountInvitationStatusCounts` L260, `accountInvitationStatusCountsFromFacet` L263, `loadPendingByToken` L342

#### visitorFeedbackScreenService.js

- `async getVisitorFeedbackScreen({ actor, organizationId, branchId, page, limit, skip, now = new Date(), })` L147
- `async saveVisitorFeedbackSettings({ actor, organizationId, body = {} })` L178
- Internal: `sendByOf` L12, `notifyViaOf` L18, `presentSettings` L23, `durationLabel` L35, `dayLabel` L43, `scopeOf` L52, `monthSummary` L57, `shapeItem` L131

#### visitorInvitationService.js

- `normalizeCode(code)` L141
- `async createVisitorInvitation({ actor, organizationId, organizationName, branchId, externalPersonId, visitorName, visitorEmail, hostStaffId, arrivalAt, visitingUntil, badgeType, instructions, })` L174
- `async listVisitorInvitations({ actor, organizationId, page, limit, skip, branchId, status, })` L261
- `async resendVisitorInvitation({ actor, organizationId, organizationName, invitationId, })` L305
- `async resendVisitorInvitationByEmail({ organizationId, branchId, email, })` L335
- `async getOpenInvitationByCode({ branchId, inviteCode })` L364
- `async markInvitationCheckedIn({ invitation, visitSessionId })` L377
- Internal: `emptyVisitorInvitationStatusCounts` L43, `visitorInvitationStatusCountFacets` L46, `visitorInvitationStatusCountsFromFacet` L49, `personTypeFromBadge` L99, `badgeFromPersonType` L104, `parseVisitorInvitationStatus` L109, `randomInviteCode` L120, `uniqueInviteCode` L125, `rotateInviteCode` L135, `loadOrgName` L143, `findOpenInvite` L149, `dispatchVisitorInvite` L160

#### visitorSurveyService.js

- `async getVisitorSurveySettings({ actor, organizationId })` L164
- `async saveVisitorSurveySettings({ actor, organizationId, body })` L171
- `async listVisitorSurveyQuestions({ actor, organizationId, includeInactive, })` L218
- `async saveVisitorSurveyQuestions({ actor, organizationId, questions })` L250
- `async createVisitorSurveyResponse({ actor, organizationId, branchId, visitSessionId, externalPersonId, hostStaffId, visitorName, stayDuration, answers, source, })` L510
- `async getKioskVisitorSurvey({ organizationId, branchId, visitSessionId, })` L584
- `async createKioskVisitorSurveyResponse({ organizationId, branchId, visitSessionId, visitorName, answers, })` L619
- `async listVisitorSurveyResponses({ actor, organizationId, branchId, search, page, limit, skip, })` L890
- Internal: `defaultSettings` L79, `flag` L91, `presentSettings` L94, `parseSettings` L130, `toOid` L137, `assertSettingsRole` L144, `assertLogRole` L150, `loadOrganization` L156, `shapeQuestion` L186, `ensureQuestions` L198, `parseQuestionType` L234, `slugKey` L241, `answerValue` L356, `collectSurveyAnswers` L362, `notifyManagers` L409, `resolveHostStaffId` L484, `escapeRegex` L705, `firstFilled` L708, `feedbackRowStages` L731, `answerValueExpr` L789, `emptySurveySummary` L809, `roundOne` L820, `surveySummaryFromFacet` L822, `surveySummaryFacets` L845

### backend/app/controllers

#### announcementController.js

- `listAnnouncements(req)` L8 → `GET /app/announcements`
- `getAnnouncement(req)` L17 → `GET /app/announcements/:announcementId`
- `createAnnouncement(req)` L25 → `POST /app/announcements`
- `remindAnnouncement(req)` L39 → `POST /app/announcements/:announcementId/remind`
- `listMine(req)` L48 → `GET /app/announcements/mine`
- `getMine(req)` L56 → `GET /app/announcements/mine/:announcementId`
- `acknowledgeAnnouncement(req)` L64 → `POST /app/announcements/mine/:announcementId/acknowledge`
- Internal: `scope` L5

#### appraisalController.js

- `async myAppraisal(req, res)` L5 → `GET /app/appraisal`
- `async getAppraisal(req, res)` L40 → `GET /app/appraisal/:appraisalId`
- `async acknowledgeAppraisal(req, res)` L59 → `POST /app/appraisal/:appraisalId/acknowledge`

#### approvalsController.js

- `async listApprovals(req, res)` L11 → `GET /app/approvals`
- `async getApprovalDetail(req, res)` L39 → `GET /app/approvals/detail`
- `decideJoinRequest(req, res)` L71: built by `respondByAction` → `PUT /app/approvals/join-requests/:requestId`
- Internal: `decideJoin` L60

#### attendanceController.js

- `async getTodayAttendance(req, res)` L5 → `GET /app/attendance/today`
- `async clockIn(req, res)` L23 → `POST /app/attendance/clock-in`
- `async clockOut(req, res)` L46 → `POST /app/attendance/clock-out`
- `async startBreak(req, res)` L66 → `POST /app/attendance/break-in`
- `async endBreak(req, res)` L85 → `POST /app/attendance/break-out`
- `async listMyAttendance(req, res)` L104 → `GET /app/attendance`
- `async createChangeRequest(req, res)` L141 → `POST /app/attendance/change-requests`
- `async requestRoster(req, res)` L161 → `POST /app/attendance/:dayId/roster-request`

#### complianceController.js

- `async getMyCompliance(req, res)` L5 → `GET /app/compliance`

#### contactUsController.js

- `async createContactRequest(req, res)` L8

#### departmentController.js

- `async listDepartments(req, res)` L5 → `GET /app/departments`

#### documentController.js

- `async listDocuments(req, res)` L8 → `GET /app/documents`
- `async getDocument(req, res)` L31 → `GET /app/documents/:documentId`
- `async signDocument(req, res)` L50 → `POST /app/documents/:documentId/sign`
- `listFolders(req)` L72 → `GET /app/documents/folders`
- `async createFolder(req)` L81 → `POST /app/documents/folders`
- `bulkUpload(req)` L93 → `POST /app/documents/bulk-upload`
- `listVisitorDocuments(req)` L113 → `GET /app/documents/visitor-library`
- `createQrCode(req)` L129 → `POST /app/documents/qr-code`
- `regenerateQrLink(req)` L142 → `POST /app/documents/:documentId/qr-link/regenerate`
- `revokeQrLink(req)` L154 → `DELETE /app/documents/:documentId/qr-link`
- `async openSharedDocument(req, res)` L165 → `GET /app/documents/shared/:token`
- Internal: `publicBaseUrl` L106

#### evacuationController.js

- `async myDrills(req, res)` L6 → `GET /app/evacuations/me/drills`
- `async getActiveEvacuation(req, res)` L30: Staff: active evacuation for a branch (Alerts screens). → `GET /app/evacuations/active`
- `async markMyself(req, res)` L55: Staff self mark — Safe at assembly → safe, smoke waiting → unknown, I'm not on site → offSite. → `POST /app/evacuations/me/check`
- `async getRollcall(req, res)` L93 → `GET /app/evacuations/:evacuationEventId/rollcall`
- `alertFamilies(req, res)` L119: built by `familyMessage` → `POST /app/evacuations/:evacuationEventId/alert-families`
- `updateFamilies(req, res)` L120: built by `familyMessage` → `POST /app/evacuations/:evacuationEventId/update-families`
- `allClearFamilies(req, res)` L121: built by `familyMessage` → `POST /app/evacuations/:evacuationEventId/all-clear`
- Internal: `familyMessage` L78

#### familyController.js

- `listRelationships()` L23 → `GET /app/family/relationships`
- `getHome(req)` L27 → `GET /app/family/home`
- `listMyResidents(req)` L36 → `GET /app/family/residents`
- `getCurrentFamilyCode(req)` L42 → `GET /app/family/codes/current`
- `createFamilyCode(req)` L47 → `POST /app/family/codes`
- `previewJoinCode(req)` L55 → `GET /app/family/join/preview`
- `requestToJoin(req)` L63 → `POST /app/family/join`
- `getCurrentJoinRequest(req)` L72 → `GET /app/family/join-requests/current`
- `listJoinRequests(req)` L77 → `GET /app/family/join-requests`
- `listMembers(req)` L113 → `GET /app/family/members`
- `removeMember(req)` L121 → `DELETE /app/family/members/:memberId`
- `listHandoverCandidates(req)` L129 → `GET /app/family/handover/candidates`
- `requestHandover(req)` L137 → `POST /app/family/handover`
- `getCurrentHandover(req)` L147 → `GET /app/family/handover/current`
- `leaveFamily(req)` L175 → `POST /app/family/leave`
- `listSentInvitations(req)` L184 → `GET /app/family/member-invitations`
- `uploadPhoto(req)` L199 → `POST /app/family/media`
- `uploadPhotos(req)` L205 → `POST /app/family/media/batch`
- `createUpload(req)` L214 → `POST /app/family/uploads`
- `listMyUploads(req)` L227 → `GET /app/family/uploads`
- `deleteUpload(req)` L242 → `DELETE /app/family/uploads/:id`
- `updateUpload(req)` L252 → `PUT /app/family/uploads/:id`
- `listGallery(req)` L271 → `GET /app/family/gallery`
- `listVisits(req)` L294 → `GET /app/family/visits`
- `getNextVisit(req)` L313 → `GET /app/family/visits/next`
- `getVisitOptions(req)` L320 → `GET /app/family/visits/options`
- `requestVisit(req)` L325 → `POST /app/family/visits`
- `getVisitPass(req)` L351 → `GET /app/family/visit-pass`
- `updateVisitPass(req)` L359 → `PUT /app/family/visit-pass`
- `listTimeline(req)` L369 → `GET /app/family/timeline`
- `getNextGazette(req)` L387 → `GET /app/family/gazettes/next`
- `listGazettes(req)` L392 → `GET /app/family/gazettes`
- `getGazette(req)` L404 → `GET /app/family/gazettes/:gazetteId`
- `async downloadGazettePdf(req, res)` L411 → `GET /app/family/gazettes/:gazetteId/pdf`
- `listNewsletters(req)` L429 → `GET /app/family/newsletters`
- `getNewsletter(req)` L441 → `GET /app/family/newsletters/:newsletterId`
- `async downloadNewsletterPdf(req, res)` L448 → `GET /app/family/newsletters/:newsletterId/pdf`
- `listWall(req)` L466 → `GET /app/family/wall`
- `listPinnedPosts(req)` L481 → `GET /app/family/wall/pinned`
- `setPostPinned(req)` L495 → `PUT /app/family/wall/:postId/pin`
- `addReaction(req)` L506 → `PUT /app/family/wall/:postId/reaction`
- `markPostsSeen(req)` L516 → `PUT /app/family/wall/seen`
- `reportPost(req)` L526 → `POST /app/family/wall/:postId/report`
- `removeReaction(req)` L537 → `DELETE /app/family/wall/:postId/reaction`
- `inviteRelative(req)` L547 → `POST /app/family/member-invitations`
- `updateJoinRequest(req, res)` L100: built by `respondByAction` → `PUT /app/family/join-requests/:id`
- `updateHandover(req, res)` L159: built by `respondByAction` → `PUT /app/family/handover/:id`
- `updateVisit(req, res)` L345: built by `respondByAction` → `PUT /app/family/visits/:id`
- Internal: `decide` L89, `answerHandover` L154, `answerVisit` L334

#### familyInvitationController.js

- `async listMyInvitations(req, res)` L5 → `GET /app/family-invitations`
- `async getMyInvitation(req, res)` L27 → `GET /app/family-invitations/:invitationId`
- `async acceptMyInvitation(req, res)` L45 → `POST /app/family-invitations/:invitationId/accept`

#### familyVisitManagerController.js

- `listRequests(req)` L15 → `GET /app/family-visits`
- `getSettings(req)` L80 → `GET /app/family-visits/settings`
- `updateSettings(req)` L85 → `PUT /app/family-visits/settings`
- `updateRequest(req, res)` L49: built by `respondByAction` → `PUT /app/family-visits/:id`
- `updateVisiting(req, res)` L66: built by `respondByAction` → `PUT /app/family-visits/visiting`
- Internal: `withScope` L9, `decide` L38, `setVisiting` L55, `settingsScope` L71

#### homeController.js

- `async getHome(req, res)` L5 → `GET /app/home`

#### invitationController.js

- `async listMyInvitations(req, res)` L5 → `GET /app/invitations`
- `async getMyInvitation(req, res)` L27 → `GET /app/invitations/:invitationId`
- `async acceptMyInvitation(req, res)` L45 → `POST /app/invitations/:invitationId/accept`

#### kioskController.js

- `async searchBranches(req, res)` L10 → `GET /app/kiosk/branches/search`
- `async searchStaff(req, res)` L56 → `GET /app/kiosk/staff/search`
- `async getStaffPreview(req, res)` L104 → `GET /app/kiosk/staff/:staffId/preview`
- `async requestCheckInOtp(req, res)` L142 → `POST /app/kiosk/attendance/otp/request`
- `async verifyCheckInOtp(req, res)` L183 → `POST /app/kiosk/attendance/otp/verify`
- `async getQr(req, res)` L211 → `GET /app/kiosk/qr`
- `async getPendingPairing(req, res)` L244 → `GET /app/kiosk/pairing/pending`
- `async confirmPairing(req, res)` L274 → `POST /app/kiosk/pairing/:sessionId/confirm`
- `async cancelPairing(req, res)` L329 → `POST /app/kiosk/pairing/:sessionId/cancel`
- `async scanFromContractor(req, res)` L365 → `POST /app/kiosk/contractor/scan`
- `async scanFromPhone(req, res)` L382 → `POST /app/kiosk/scan`
- `async register(req, res)` L420 → `POST /app/kiosk/register`
- `async verifyAdminPin(req, res)` L466 → `POST /app/kiosk/session`
- `async getMe(req, res)` L485 → `GET /app/kiosk/me`
- `async listWidgets(req, res)` L519 → `GET /app/kiosk/widgets`
- `async updateMe(req, res)` L540 → `PATCH /app/kiosk/me`
- `async verifyStaffPin(req, res)` L581 → `POST /app/kiosk/attendance/verify`
- `async clockIn(req, res)` L601 → `POST /app/kiosk/attendance/clock-in`
- `async clockOut(req, res)` L641 → `POST /app/kiosk/attendance/clock-out`
- `async listOnSite(req, res)` L681 → `GET /app/kiosk/attendance/on-site`
- `async getToday(req, res)` L704 → `GET /app/kiosk/attendance/today`
- Internal: `staffBody` L561

#### kioskEvacuationController.js

- `async getOnSiteSummary(req, res)` L7: Kiosk Screen 86 — people currently on site before Start Evacuation. → `GET /app/kiosk/evacuations/on-site-summary`
- `async verifyEmergencyPin(req, res)` L26: Figma Screen 79 — site emergency PIN (not kiosk login PIN). → `POST /app/kiosk/evacuations/emergency-pin`
- `async startEvacuation(req, res)` L46: Kiosk Screen 85 type + Screen 86 Start Evacuation. → `POST /app/kiosk/evacuations`
- `async getActiveEvacuation(req, res)` L69 → `GET /app/kiosk/evacuations/active`
- `async closeEvacuation(req, res)` L89 → `POST /app/kiosk/evacuations/close`

#### kioskVisitController.js

- `async listCategories(req, res)` L6 → `GET /app/kiosk/visits/categories`
- `async searchPeople(req, res)` L23 → `GET /app/kiosk/visits/people/search`
- `async listPolicies(req, res)` L45 → `GET /app/kiosk/visits/policies`
- `async verifyInvite(req, res)` L63 → `POST /app/kiosk/visits/invite/verify`
- `async resendInvite(req, res)` L80 → `POST /app/kiosk/visits/invite/resend`
- `async checkIn(req, res)` L98 → `POST /app/kiosk/visits/check-in`
- `async checkOut(req, res)` L130 → `POST /app/kiosk/visits/check-out`
- `async submitVisitorFeedback(req, res)` L155 → `POST /app/kiosk/visits/:visitSessionId/feedback`
- `async listOnSite(req, res)` L175 → `GET /app/kiosk/visits/on-site`

#### leaveController.js

- `async reportSickness(req, res)` L5 → `POST /app/leave-requests/report-sickness`
- `async createLeaveRequest(req, res)` L26 → `POST /app/leave-requests`
- `async listMyLeaveRequests(req, res)` L51 → `GET /app/leave-requests`
- `async getMyLeaveRequest(req, res)` L76 → `GET /app/leave-requests/:requestId`
- `async cancelLeaveRequest(req, res)` L95 → `POST /app/leave-requests/:requestId/cancel`
- `async listMyEntitlements(req, res)` L114 → `GET /app/leave-requests/entitlements`
- `async listMyLeaveScores(req, res)` L133 → `GET /app/leave-requests/scores`

#### requirementListController.js

- `myTraining(req, res)` L1: built by a factory in the export → `GET /app/training`
- `myCompetencies(req, res)` L1: built by a factory in the export → `GET /app/competencies`
- Internal: `listMine` L6

#### residentController.js

- `listResidents(req)` L32 → `GET /app/residents`
- `getResident(req)` L44 → `GET /app/residents/:residentId`
- `async getResidentScreen(req)` L48 → `GET /app/residents/:residentId/screen`
- `getPeepRecord(req)` L96 → `GET /app/residents/:residentId/peep-record`
- `deactivateResident(req)` L104 → `POST /app/residents/:residentId/deactivate`
- `getFamily(req)` L112 → `GET /app/residents/:residentId/family`
- `setNextOfKin(req)` L116 → `PUT /app/residents/:residentId/family/next-of-kin`
- `removeFamilyMember(req)` L123 → `DELETE /app/residents/:residentId/family/members/:memberId`
- `createFamilyCode(req)` L130 → `POST /app/residents/:residentId/family/code`
- `getFamilyCode(req)` L134 → `GET /app/residents/:residentId/family/code`
- `async setVisitingPassword(req)` L140 → `PUT /app/residents/:residentId/family/visiting-password`
- `updateFamilyPhoto(req, res)` L159: built by `respondByAction` → `PUT /app/residents/:residentId/family/photos/:uploadId`
- Internal: `respond` L10, `scope` L26, `photoScope` L154

#### shiftController.js

- `async listMyShifts(req, res)` L5 → `GET /app/shifts/my`
- `async listOpenShifts(req, res)` L31 → `GET /app/shifts/open`
- `async getMyShift(req, res)` L57 → `GET /app/shifts/:shiftId`
- `async getActiveShift(req, res)` L76 → `GET /app/shifts/active`
- `async createClaim(req, res)` L94 → `POST /app/shifts/:shiftId/claims`
- `async withdrawClaim(req, res)` L114 → `POST /app/shift-claims/:claimId/withdraw`

#### siteLiveController.js

- `async getSiteLive(req, res)` L12 → `GET /app/site-live`, `GET /admin/organizations/:organizationId/site-live`
- `async getSiteLiveActivity(req, res)` L33 → `GET /app/site-live/activity`, `GET /admin/organizations/:organizationId/site-live/activity`
- `async listPeople(req, res)` L57 → `GET /app/site-live/people`
- `async checkOutPerson(req, res)` L83 → `POST /app/site-live/people/:personKind/:recordId/check-out`
- `async listDirectory(req, res)` L104 → `GET /app/site-live/directory`
- `async getStatistics(req, res)` L131 → `GET /app/site-live/statistics`
- `async getCompliance(req, res)` L152 → `GET /app/site-live/compliance`
- `async exportCompliance(req, res)` L176 → `GET /app/site-live/compliance/export`
- `async downloadComplianceExport(req, res)` L212 → `GET /app/site-live/compliance/download/:token`

#### staffAppDashboardController.js

- `async getDashboard(req, res)` L5 → `GET /app/staff/dashboard`

#### staffDashboardSettingsController.js

- `async getStaffDashboardSettings(req, res)` L5 → `GET /app/staff/dashboard-settings`

#### supervisionController.js

- `async mySupervision(req, res)` L5 → `GET /app/supervision`
- `async getSupervision(req, res)` L41 → `GET /app/supervision/:supervisionId`

#### supportController.js

- `async createSupportRequest(req, res)` L8 → `POST /app/support`

#### teamLiveController.js

- `async getTeamLive(req, res)` L6 → `GET /app/team-live`, `GET /admin/organizations/:organizationId/team-live`
- `async getTeamLiveActivity(req, res)` L25 → `GET /app/team-live/activity`, `GET /admin/organizations/:organizationId/team-live/activity`
- `async getTeamRota(req, res)` L48 → `GET /app/team-live/rota`, `GET /admin/organizations/:organizationId/team-live/rota`

#### userController.js

- `async blockUser(req, res)` L9 → `POST /app/users/:userIdToBlock/block`
- `async reportUser(req, res)` L31 → `POST /app/users/:userIdToReport/report`
- `async addOrUpdateSubscription(req, res)` L53 → `POST /app/users/add-update-subscription`
- `async removeSubscription(req, res)` L74 → `POST /app/users/remove-subscription/:subscriptionId`
- `async getSubscriptions(req, res)` L90 → `GET /app/users/subscriptions`
- `async getUserWithPopulatedFields(userId, fieldsToPopulate = [])` L104
- `async getUserProfile(req, res, next, fieldsToPopulate = [])` L107 → `GET /app/users/profile`
- `async getOtherUserProfile(req, res)` L125 → `GET /app/users/profile/:userId`
- `async updateUserProfile(req, res)` L141 → `PUT /app/users/profile`
- `getNotificationPreferences(req)` L183 → `GET /app/users/notification-preferences`
- `updateNotificationPreferences(req)` L188 → `PUT /app/users/notification-preferences`

#### visitorFeedbackController.js

- `getScreen(req)` L6 → `GET /app/visitor-feedback`
- `saveSettings(req)` L16 → `PUT /app/visitor-feedback/settings`

### backend/app/routes

#### residentRoutes.js

- Internal: `screenTabAccess` L43

### backend/app/services/contact

#### contactService.js

- `async createContactRequest({ name, email, phoneNumber, description, })` L5

### backend/app/services/family

#### familyAccessService.js

- `listRelationships()` L29
- `isFamilyModuleActive(organization, now = new Date())` L35
- `moduleActiveStage(now, path = "organization.moduleAccess")` L48
- `async familyModuleOrganizationIds(organizationIds)` L61: Which of these organizations currently have Family Engagement on.
- `listActiveLinks(userId)` L84: Read live on every request; links in a home with Family Engagement off are left out.
- `listFamilyMemberships(userId)` L100
- `async resolveFamilyResidents(userId, { activeResidentId } = {})` L130: activeResidentId is the resident the app is showing; if missing or not linked, the first is flagged.
- `async resolveAccessState(userId, residentCount)` L168: Why a member sees no residents: "active" (has links), "pending" (waiting for approval), "inactive" (staff paused their access), "removed" (every link ended by removal, so the app shows You no longer have access) or "none".
- `async isStaffAccount(user)` L183: One email holds one role: any staff membership, or a platform admin, makes it a staff account.
- Internal: `activeLinkStages` L72, `pickActiveResidentId` L124

#### familyCodeCrypto.js

- `normalise(code)` L32
- `hashCode(code)` L37
- `encryptCode(code)` L43
- `decryptCode(payload)` L56: Throws if the text was changed or the key is not the one it was made with.
- Internal: `keys` L15

#### familyCodeService.js

- `codePrefix(name)` L19
- `generateCode({ prefix, roomNumber })` L36: A code never contains the resident's room number, so it never gives away where they live.
- `async getCurrentCode({ link })` L65
- `async createCode({ link, userId })` L149: Voids the old code and creates the new one in one transaction; a clash is retried.
- Internal: `randomChars` L29, `shapeCode` L51, `noCode` L58, `codeInputsFor` L90, `replaceActiveCode` L108

#### familyGalleryService.js

- `async listGallery({ link, userId, tab = GalleryTab.ALL, page, limit, skip, now = new Date(), })` L72: The photos of one resident: approved family uploads and published wall posts that tag them, one tile per photo, newest first. Photo sharing is read on every request (BR-06), so a resident who switches it off has no photos here from that moment. `link` is the caller's active link, so a removed member sees nothing.
- Internal: `tileStages` L22, `tabMatch` L58

#### familyGazetteService.js

- `async nextGazette({ link, now = new Date() })` L37
- `async listGazettes({ link, page, limit, skip })` L138
- `async getGazette({ links, gazetteId })` L238
- `async getPdf({ links, gazetteId })` L309
- Internal: `cut` L26, `single` L29, `loadVisible` L214

#### familyHandoverService.js

- `async listCandidates({ userId, link })` L29: Active members can be chosen; people still waiting for approval are shown but not selectable.
- `async requestHandover({ userId, link, toMemberId, homeChooses })` L103: Ask one member to take over, or ask the home to choose. The next of kin keeps the role until it is accepted.
- `async getCurrentHandover({ userId, residentId })` L131: The open handover the caller is part of, as the one asking or the one asked.
- `declineHandover({ userId, handoverId })` L226
- `cancelHandover({ userId, handoverId })` L234
- `async acceptHandover({ userId, handoverId })` L276
- `async leaveFamily({ userId, link })` L305: The next of kin can't leave until someone has taken over. Leaving also withdraws any handover asked of them.
- Internal: `shapeHandover` L20, `findHandoverTarget` L63, `assertNoOpenHandover` L88, `loadOpenHandover` L184, `closeHandover` L214, `swapNextOfKin` L245

#### familyHomeService.js

- `async getHome({ user, residentId, tab, paging, now = new Date() })` L75: The Home Family tab in one call, for the resident being viewed (the first one when none is named).
- Internal: `feedOf` L21, `withGazette` L36, `latestGazetteOf` L52, `greetingOf` L60

#### familyImage.js

- `async prepareUpload(buffer)` L9: Re-encodes the upload, which also proves it is a real image, and keeps its longest edge within MAX_EDGE.
- `validateAreas(areas)` L34: Areas are fractions of the image (0 to 1), so the app does not need to know the stored size.
- `async blurAreas(buffer, areas)` L54
- Internal: `isFraction` L30

#### familyInviteService.js

- `async inviteRelative({ userId, link, name, email, relationship })` L24: Invite Family: the next of kin invites a relative by name, email and relationship.
- `listSentInvitations({ userId, link, status, page, limit, skip })` L58
- Internal: `findResident` L9

#### familyJoinNotifications.js

- `notifyJoinRequested({ link, requesterName })` L13
- `notifyJoinDecided({ linkId, decision, actorId })` L30: The person who asked is told how it was decided, whoever decided it.
- Internal: `about` L7

#### familyJoinService.js

- `async previewCode({ userId, code })` L110
- `async requestToJoin({ user, code: typedCode, relationship })` L196
- `async getCurrentRequest(userId)` L218
- `async cancelRequest({ userId, requestId })` L247
- Internal: `assertNotLocked` L28, `failCode` L49, `findCodeWithHome` L54, `isCodeUsable` L85, `checkCode` L90, `shapeRequest` L115, `assertValidRelationship` L123, `assertCanRequest` L130, `pendingLinkFields` L154, `saveRequest` L168

#### familyLinkActions.js

- `async inTransaction(work)` L12
- `async decidePendingRequest({ linkId, decision, actorId })` L22: The status is part of the filter, so two people deciding at once cannot both win.
- `async deactivateActiveLink({ link, actorId })` L44: Pauses access without ending the link; any handover that involved them is cancelled.
- `async reactivateLink({ link })` L65
- `async removeActiveLink({ link, actorId })` L81: Removing someone also ends any handover that involved them, and clears the next-of-kin role.
- `async assignNextOfKin({ target })` L108: Makes `target` the next of kin. The old one steps down first (only one active next of kin is allowed), and open handovers are settled: the one that led here is accepted, any other is cancelled.
- Internal: `cancelHandoversOf` L32

#### familyMemberNotifications.js

- `notifyAccessChanged({ linkId, change, actorId })` L17

#### familyMemberService.js

- `async listMembers({ userId, link })` L107: The next of kin also sees (and can act on) people who asked to join; everyone else sees active members only.
- `listJoinRequests({ link, page, limit, skip })` L143
- `async decideJoinRequest({ userId, requestId, decision })` L170
- `async removeMember({ userId, memberId })` L185: The next of kin can't be removed (they hand over first); an unapproved request is rejected, not removed.
- Internal: `callerIsNextOfKin` L21, `loadForNextOfKin` L43, `withActions` L97

#### familyMessageDelivery.js

- `chunksOf(items)` L13
- `cleanMessageText(value)` L18
- `cleanSubject(value)` L25
- `idText(value)` L32
- `async ensureThreads({ organizationId, branchId, recipientIds })` L34
- `async deliver({ items, subjectId, senderName, title, chatName, text, subject = "", now, })` L57: A failure here never undoes a message that was saved.

#### familyMessageService.js

- `async listThreads({ userId, tab = "inbox", page, limit, skip })` L75
- `async unreadTotal(userId)` L131
- `async listMessages({ userId, conversationId, page, limit, skip, now = new Date(), })` L145
- `async updateThread({ userId, conversationId, action })` L211
- Internal: `homesOf` L21, `ownThread` L35, `lastMessageOf` L55

#### familyNewsletterService.js

- `async listNewsletters({ link, page, limit, skip })` L26: Current and past issues of the home, newest first.
- `async getNewsletter({ links, newsletterId })` L93: The reader: only the sections that were switched on. What a resident's photo-sharing choice or a removed post has changed since sending is left out on every read (BR-06).
- `async getPdf({ links, newsletterId })` L159: The same PDF the home emailed: the stored copy, or drawn from what was sent when none was stored.
- Internal: `periodLabelOf` L13, `inAppSent` L16, `cut` L22, `loadVisible` L71

#### familyNotify.js

- `async managersOf({ organizationId, branchId }, preference)` L17
- `async familyOf({ organizationId, residentId, nextOfKinOnly = false })` L45
- `async nameOf(userId)` L60
- `async namesOf({ residentId, branchId })` L68
- `async notify({ receivers, ...notification })` L87: One notification per person; the person who caused it is never told about their own action.
- `quietly(work)` L100: A notification that cannot be built or saved never undoes the action it reports.

#### familyPipeline.js

- `toObjectId(value)` L3
- `isValidObjectId(value)` L5
- `joinOne({ from, localField, as, optional = false })` L11: $lookup + $unwind to attach one document by _id. With `optional`, a row whose match is missing is kept instead of dropped.
- `personFields(as = "user", prefix = "")` L31: Name and photo of the user joined as `as`, with empty strings when missing. With a `prefix` the fields are flat (fromName, fromPhotoUrl), for rows that carry two people.
- `pickPerson(row, prefix)` L40

#### familyTimelineService.js

- `async listTimeline({ link, links, userId, page, limit, skip, familyPostsOnly = false, })` L130: Approved uploads and tagged wall posts for the resident, newest first. `link` is the caller's active link, so a removed member sees nothing.
- Internal: `itemStages` L27

#### familyUploadNotifications.js

- `notifyUploadWaiting({ upload })` L10
- Internal: `describe` L4

#### familyUploadService.js

- `async uploadPhotos({ userId, files })` L60: Up to 10 photos in one request. Every file is checked before any is stored, so one bad file stores nothing.
- `async uploadPhoto({ userId, file })` L83
- `async listMyUploads({ userId, residentId, status, page, limit, skip, })` L331
- `async createUpload({ userId, link, message, mediaIds = [], includeInGazette, clientId, })` L382: Send For Approval. The same clientId returns the upload already made instead of a second one.
- `async updateUpload({ userId, links, uploadId, message, mediaIds, includeInGazette, })` L465: Edit And Resend: a Waiting or Not Approved upload goes back to Waiting. An approved one is final. `links` are the caller's active links, so a removed member can no longer edit.
- `async deleteUpload({ userId, links, uploadId })` L589: Delete my own upload. Only a Waiting or Not Approved one can go: an approved one is shared with the family and is final. Its photos are deleted with it, and so are the notifications about it.
- `rejectedDeleteAfter(from = new Date())` L634
- Internal: `isDuplicateKey` L26, `assertRoomForPhotos` L28, `storePhoto` L39, `normaliseMessage` L90, `normaliseMediaIds` L97, `assertPhotosAllowed` L106, `assertMediaUsable` L121, `effectiveUrl` L138, `gazettePlacements` L224, `withGazette` L306, `statusCountsOf` L316, `stillVisible` L327, `getMyUpload` L370, `cleanUpAfterDelete` L567

#### familyVisitInvitation.js

- `async issueInvitation({ visit, visitorName, visitorEmail, residentName, createdBy, })` L22: The ordinary invitation the kiosk already understands, so a confirmed family visit checks in at the kiosk like any other. The unique index decides code clashes, so two requests cannot take the same code.
- `async cancelInvitation({ invitationId, userId, now = new Date() })` L52: Withdraws an invitation that has not been used yet; one already checked in is left alone.
- `async cancelInvitations({ invitationIds, userId, now = new Date() })` L67: Withdraws many invitations at once, leaving any already used.
- Internal: `randomCode` L13, `isDuplicateKey` L16

#### familyVisitNotifications.js

- `notifyVisitRequested({ visit, requesterName })` L30
- `notifyVisitInvited({ visit })` L43
- `notifyVisitDecision({ visit, decision, actorId })` L56: The home answered a request, or cancelled a visit; decision is confirm, decline or cancel.
- `notifyVisitReply({ visitId, user, response })` L89
- `notifyVisitCancelledByFamily({ visit, user })` L118
- Internal: `detailsOf` L10, `about` L24

#### familyVisitPassService.js

- `async getPass({ link, userId, now = new Date() })` L49: Visit Pass: the code the kiosk reads for my next visit, with the guests and car registration I keep. The code is the visit's own invitation code, so the kiosk accepts it exactly as it accepts an emailed one. Only a visit I requested, or a home invitation I said I would attend, gives me a code.
- `async updatePass({ link, userId, body = {}, now = new Date() })` L146: Saves the guests without the app and the car registration; whatever is left out stays as it was.
- Internal: `cleanGuests` L20, `cleanRegistration` L33

#### familyVisitRules.js

- `toMinutes(clock)` L22
- `isProtected(time, rules)` L28: A start time is closed when it falls inside a protected window; times are zero-padded HH:mm, so text order is time order.
- `isText(value)` L31
- `timesOf(rules, { includeProtected = false } = {})` L33
- `async loadRules(branchId)` L44: A site's visiting rules: its own settings over the defaults, with the site's timezone.
- `visitingNotice(rules)` L77
- `visitWindow({ date, start, end, timezone })` L84: A calendar day and two clock times, read in the site's timezone; anything else is rejected.
- `assertDayInRange({ date, rules, now })` L104: The day must be today or later and no further out than the site allows.
- `cleanText(value, { field, max })` L112
- Internal: `toClock` L24

#### familyVisitService.js

- `async listVisits({ link, userId, tab = VisitTab.UPCOMING, page, limit, skip, now = new Date(), })` L165: My Visits: upcoming or past, with the home's invitations and a notice when visiting is paused.
- `async getNextVisit({ link, userId, now = new Date() })` L217: Your Next Visit on the Home tab: the soonest visit that is confirmed or that I said I would attend.
- `async getOptions({ link, now = new Date() })` L238: Book A Visit: the days and start times the site offers.
- `async requestVisit({ link, user, body = {}, now = new Date() })` L275: Asks the home for a visit. It stays a request until staff confirm it.
- `async updateVisit({ links, user, visitId, action, now = new Date(), })` L488: One route for what a person does with a visit: cancel their request, or answer the home's invitation.
- Internal: `baseMatch` L46, `stateStages` L59, `findItem` L147, `requireItem` L156, `readPartySize` L264, `cancelMine` L346, `saveReply` L381, `replyToInvitation` L411, `linkOfVisit` L475

#### familyWallPipeline.js

- `reactionStats(userId = null)` L6: reactionCount and, for the caller, reactedByMe, joined onto rows whose _id is a wall post.
- `pinnedByMe(userId = null)` L48: isPinnedByMe: whether the caller saved this post for themselves (not the staff pin, isPinned).

#### familyWallService.js

- `listWall({ link, userId, links, page, limit, skip })` L103
- `async listPinned({ userId, links, page, limit, skip })` L149: My Pinned Posts: what this person saved, across every resident they are linked to, newest post first.
- `async setPinned({ userId, links, postId, pinned })` L174: Saves or unsaves a post for the caller only. Sending the same value twice changes nothing.
- `async addReaction({ userId, links, postId })` L196: One tap. Sending it again changes nothing.
- `async removeReaction({ userId, links, postId })` L215
- `async markSeen({ userId, links, postIds })` L229: The posts the app showed on screen. Only posts the caller may see count, and sending one twice changes nothing.
- `async reportPost({ userId, links, postId, reason })` L282: Flag a post for staff. Reporting twice is the same as reporting once, and the poster is never told who.
- Internal: `isDuplicateKey` L24, `wallPostStages` L30, `reactionSummary` L117, `assertPostVisible` L137, `sameHome` L224

### backend/app/services/staff

#### staffAppDashboardService.js

- `async getStaffAppDashboard({ actor, organizationId, now = new Date() })` L384
- Internal: `hours` L40, `oid` L42, `remainingDaysOf` L44, `unpaidBreakMinutes` L54, `weekRange` L68, `shiftMinutes` L74, `loadHomeStaff` L77, `shapeBreakBands` L143, `shapeSite` L159, `overlaps` L187, `inStartRange` L190, `scheduledHours` L195, `soFarHoursOfWeek` L198, `documentsWaiting` L226, `annualLeave` L254, `nextShiftItems` L274, `slimShift` L299, `pickActiveShift` L308, `todayCard` L326, `todayAction` L367, `percentOf` L382

#### staffDocumentsService.js

- `async listStaffDocuments({ actor, organizationId, page, limit, skip, signed, })` L119
- `async getStaffDocument({ actor, organizationId, documentId })` L155
- `async signStaffDocument({ actor, organizationId, documentId, signatureUrl, ipAddress, userAgent, })` L174
- Internal: `toOid` L19, `loadStaff` L26, `visibleMatch` L39, `uploadedByOf` L57, `signatureLookup` L66, `shapeStaffDocument` L86, `parseSignedFilter` L99, `signedMatch` L106

### backend/app/services/support

#### supportService.js

- `async createSupportRequest({ name, email, subject, message })` L4

### backend/commonModules/chatModule/controllers

#### messageController.js

- `listChats(req)` L8 → `GET /chats`
- `listChatMessages(req)` L22 → `GET /chats/messages`
- `updateChat(req)` L36 → `PUT /chats/:conversationId/action`
- `sendMessage(req)` L46 → `POST /chats/message`
- `listContacts(req)` L63 → `GET /chats/contacts`
- `getContact(req)` L79 → `GET /chats/contacts/:conversationId`
- `listRecipients(req)` L94 → `GET /chats/recipients`
- `listSentMessages(req)` L110 → `GET /chats/sent`
- `getSentMessage(req)` L126 → `GET /chats/sent/:broadcastId`

### backend/commonModules/chatModule/sockets

#### chatEventEmitter.js

- `emitMessageToUsers({ ioOrNamespace, recipientIds = [], message })` L10
- Internal: `getChatNamespace` L3

#### chatPresenceEmitter.js

- `async loadAndCacheConversationPeers(userId)` L10
- `async emitStatusToConversationPeers({ io, userId, status, peerIds })` L44

#### chatPresenceRedis.js

- `async markUserOnline(userId)` L19
- `async markUserOffline(userId)` L39
- `async cacheConversationPeers(userId, peerIds = [])` L64
- `async getConversationPeers(userId)` L81
- `async clearConversationPeers(userId)` L93
- `async getUsersOnlineMap(userIds = [])` L104
- Internal: `getSocketCountKey` L10, `getPeersKey` L14

#### chatSocketHandler.js

- `chatSocketHandler(io)` L10: Push only: the room comes from the verified token, and clients cannot send events.

#### chatSocketRooms.js

- `getUserRoom(userId)` L1

### backend/commonModules/controllers

#### authController.js

- `async previewInvitation(req, res)` L15: Public but token-gated: an administrator issued the invitation, so this is not the self-registration that stays disabled on every surface. → `GET /auth/invitations/:token`
- `async acceptInvitation(req, res)` L29 → `POST /auth/invitations/:token/accept`
- `async previewVisitorAccountInvitation(req, res)` L49 → `GET /auth/visitor-account-invitations/:token`
- `async acceptVisitorAccountInvitation(req, res)` L65 → `POST /auth/visitor-account-invitations/:token/accept`
- `async previewFamilyInvitation(req, res)` L84 → `GET /auth/family-invitations/:token`
- `async acceptFamilyInvitation(req, res)` L98 → `POST /auth/family-invitations/:token/accept`
- `async register(req, res)` L118
- `async login(req, res)` L177 → `POST /auth/login`
- `async me(req, res)` L227 → `GET /auth/me`
- `async generateOtp(req, res)` L246 → `POST /auth/forgot-password`, `POST /auth/resend-otp/email`, `POST /auth/resend-otp/phone`
- `async verifyOtp(req, res)` L269 → `POST /auth/verify-otp/email`, `POST /auth/verify-otp/phone`
- `async changePassword(req, res)` L300 → `POST /auth/change-password`
- `async resetPassword(req, res)` L328 → `POST /auth/reset-password`
- `async logout(req, res)` L356 → `POST /auth/logout`
- `async deleteAccount(req, res)` L373 → `DELETE /auth/delete-account`
- `async socialAuth(req, res)` L390

#### communicationController.js

- `async sendEmailSgrid(req, res)` L8
- `async sendEmailAws(req, res)` L34
- `async sendEmailBrevo(req, res)` L59
- `async sendSmsViaPinpointAws(req, res)` L84
- `async sendNotificationControllerForTesting(req, res)` L104
- `async sendSmsViaVonage(req, res)` L131
- `async sendSMSSomalianAPI(req, res)` L155

#### languageController.js

- `async createLanguage(req, res)` L9
- `async getLanguages(req, res)` L35
- `async updateLanguage(req, res)` L52
- `async deleteLanguage(req, res)` L81
- `async updateUserLanguage(req, res)` L100

#### notificationsController.js

- `async getNotifications(req, res)` L8 → `GET /notifications`
- `async readNotification(req, res)` L30 → `PUT /notifications/:id/read`
- `async readAllNotifications(req, res)` L47 → `PUT /notifications/read-all`

#### settingsController.js

- `async getTermsAndConditions(req, res)` L9 → `GET /app/settings/terms-conditions`, `GET /admin/settings/terms-conditions`
- `async getAboutUs(req, res)` L23 → `GET /app/settings/about-us`, `GET /admin/settings/about-us`
- `async getPrivacyPolicy(req, res)` L37 → `GET /app/settings/privacy-policy`, `GET /admin/settings/privacy-policy`
- `async getFaqs(req, res)` L51 → `GET /app/settings/faqs`, `GET /admin/settings/faqs`
- `async createAdminSettings(req, res)` L73 → `POST /admin/settings/create`
- `async updateAdminSettings(req, res)` L94 → `PUT /admin/settings/update/:id`

#### uploadAWSController.js

- `uploadFiles(req, res)` L50 → `POST /upload/s3`
- `async deleteFiles(req, res)` L70 → `DELETE /upload/s3`
- Internal: `mapMulterError` L7

#### uploadController.js

- `uploadFile(req, res)` L9 → `POST /upload`
- `async getFileByName(req, res)` L34 → `GET /upload/:filename`
- `async getFileDetails(req, res)` L48 → `GET /upload/details/:filename`
- `async getAllFiles(req, res)` L71 → `GET /upload`

### backend/commonModules/services/auth

#### authService.js

- `async register({ email, phoneNumber, deviceId, deviceType, userType, profileIcon, name, password, timezone, location, adminAccessToken, body = {}, })` L44
- `async login({ email, password, deviceId, deviceType, timezone, audience, surface, adminAccessToken, })` L369
- `async generateOtp({ email, phoneNumber, type })` L467
- `async verifyOtp({ email, phoneNumber, type, otp })` L525
- `async resetPassword({ email, newPassword, resetToken })` L592
- `async changePassword({ userId, oldPassword, newPassword })` L618
- `async logout({ userId, deviceId })` L634
- `async deleteAccount({ userId, email })` L641
- `async socialAuth({ provider, socialId, email, name, deviceId, deviceType, timezone, })` L668
- `async me({ userId, audience = AuthAudience.STAFF, organizationId, })` L754: Profile plus the module menu for one organisation (x-org-id, else first membership).
- Internal: `highestRoleOf` L162, `resolveStaffAccess` L173, `slimMemberships` L236, `membershipForOrg` L253, `slimAccessForLogin` L264, `slimAccessForMe` L277, `resolveFamilyAccess` L288, `emptyStaffAccessFields` L306, `assertAudienceAccess` L314, `isLoginBlockedStatus` L366

#### surfaceAccess.js

- `normalizeSurface(value)` L39
- `surfaceFromAccess({ audience, access })` L48: Portal for this account when the client does not send `surface`.
- `assertSurfaceAccess({ surface, audience, access })` L71

### backend/commonModules/services/communication

#### communicationService.js

- `async sendEmailSgrid({ title, emails, subject, body, config })` L24
- `async sendEmailAws({ emails, subject, body, config })` L32
- `async sendEmailBrevo({ emails, subject, body, config })` L41
- `async sendSmsViaPinpointAws({ phoneNumber, otp })` L50
- `async sendNotification(recipients, payload)` L59
- `async sendNotificationForTesting({ recipients, title, body, data })` L132
- `async sendUserNotifications({ recipientIds, title, body, data = {}, sender = null, objectId = null, saveNotification = true, })` L174
- `async sendSmsViaVonage({ phoneNumber, otp })` L261
- `async sendSMSSomalianAPI({ phoneNumber, otp })` L306
- Internal: `wrapProviderError` L19

### backend/commonModules/services/home

#### homeService.js

- `async getStaffHome({ userId, organizationId, userName })` L34
- Internal: `greetingForHour` L13, `statusFromAttendance` L19

### backend/commonModules/services/language

#### languageService.js

- `async createLanguage({ title, transliteration, flag, code })` L7
- `async getLanguages({ page, limit })` L20
- `async updateLanguage({ id, title, transliteration, flag, code, active, })` L35
- `async deleteLanguage({ id })` L67
- `async updateUserLanguage({ userId, languageId })` L75

### backend/commonModules/services/notifications

#### notificationService.js

- `async getNotifications({ receiverId, page, limit, timezone })` L20
- `async readNotification({ notificationId, receiverId })` L77
- `async readAllNotifications({ receiverId })` L91
- Internal: `inboxMatch` L14

### backend/commonModules/services/settings

#### settingsService.js

- `async getTermsAndConditions()` L6
- `async getAboutUs()` L14
- `async getPrivacyPolicy()` L22
- `async getFaqs({ page, limit, keyword })` L30
- `async createAdminSettings({ terms_and_conditions, about_us, privacy_policy, faqs, })` L53
- `async updateAdminSettings({ id, body })` L74

### backend/commonModules/services/uploads

#### uploadAwsService.js

- `async uploadFiles(files)` L33
- `async putObject({ key, body, contentType })` L65
- `async getObject(key)` L77
- `async signedDownloadUrl({ key, filename, attachment = true, expiresIn = SIGNED_URL_SECONDS, contentType = "application/pdf", })` L87
- `signedPdfUrl(options)` L107
- `createShortDownloadToken({ key, filename, contentType, expiresIn = SIGNED_URL_SECONDS, })` L118
- `async signedUrlFromShortToken(token)` L131
- `async headObject(key)` L172: A file's size and type without downloading it; null when it is not in the bucket.
- `async deleteFiles(fileKey)` L188
- Internal: `getBucket` L12, `getClient` L14, `requireBucket` L26, `publicUrl` L62, `shortLinkSecret` L110, `signDownloadPayload` L115

#### uploadService.js

- `buildUploadedFileResponse(file)` L17
- `async getFilePath(filename)` L33
- `async getFileDetails({ filename, protocol, host })` L39
- `async getAllFiles({ protocol, host })` L52
- Internal: `getSafeFilePath` L6

### backend/commonModules/services/users

#### userService.js

- `async blockUser({ currentUserId, userIdToBlock })` L40
- `async reportUser({ currentUserId, userIdToReport })` L62
- `async addOrUpdateSubscription({ userId, type })` L89
- `async removeSubscription({ userId, subscriptionId })` L133
- `async getSubscriptions({ userId })` L146
- `async getUserWithPopulatedFields(userId, fieldsToPopulate = [])` L185
- `async loadStaffCardsForUser(userId, organizationId)` L248
- `async loadStaffCard(userId, organizationId)` L354
- `async getUserProfile({ userId, fieldsToPopulate = [], organizationId, })` L411
- `async getOtherUserProfile({ userId })` L436
- `async updateUserProfile({ userId, name, profileIcon, phoneNumber, location, distanceUnit, currencySymbol, currencyCode, emergencyContactName, emergencyContactPhone, allowCurrencyUpdate = fals…)` L470
- `async listAllUsers()` L576
- `async getNotificationPreferences({ userId })` L602
- `async updateNotificationPreferences({ userId, body })` L622
- Internal: `linkedStaffSummary` L201, `staffCardFromRow` L212, `loadWorkplaceNames` L362, `withStaffCard` L399, `optionalStaffText` L467, `isPlainObject` L599

### backend/config

#### cloudflareTunnel.js

- `tunnelEnabled()` L6
- `async startCloudflareTunnel({ port })` L21: Start a Cloudflare quick tunnel to the local HTTP (and Socket.IO) port. Requires the `cloudflared` npm package (binary auto-installed on first run). @param {{ port: number|string }} opts @returns {Promise&lt;string|null>} public https URL or null if skipped/failed
- `stopCloudflareTunnel()` L74

### backend/config/cron/billing

#### storageUsage.cron.js

- `runStorageUsageCron()` L3
- `runStorageUsageCatchUp()` L5

### backend/config/cron/family

#### familyGazettes.cron.js

- `runFamilyGazetteRecoveryCron()` L5: Gazettes left at Building by a server that stopped while drawing them are drawn.
- `async runFamilyGazetteSchedulerCron()` L8: Issues whose period has closed are built, and families are reminded shortly before an issue closes.

#### familyPosts.cron.js

- `runFamilyScheduledPostsCron()` L5: Scheduled Community Wall posts that are due go live and their families are told.
- `async runFamilyScheduledNewslettersCron()` L8: Scheduled newsletters that are due are sent, and any that stopped part-way through a send are finished.

### backend/config/cron

#### index.js

- `startCrons()` L52
- Internal: `envFlag` L16, `runLocked` L22, `registerJob` L34

### backend/config/cron/jobs

#### autoCheckout.cron.js

- `async runAutoCheckoutCron()` L19
- Internal: `drain` L7

#### heartbeat.cron.js

- `async runHeartbeatCron()` L1

### backend/config

#### firebaseAdmin.js

- Internal: `loadServiceAccount` L14

### backend/config/logging

#### bootstrap.js

- Internal: `ensureDirs` L8, `cleanupOldLogs` L16

#### crashLogger.js

- `logCrash({ type, error })` L29
- `fatal(type, error)` L56: Fatal logger wrapper
- Internal: `fingerprint` L6, `shouldAlert` L17

#### logger.js

- Internal: `write` L11

### backend/config/redis

#### redisCache.js

- `buildKey(namespace, params = {})` L6
- `async acquireLock(key, ttl = 5)` L47: LOCKS
- `async releaseLock(key, token)` L59
- `async cache({ namespace, params = {}, ttl = 60, fetchFn })` L72: MAIN CACHE
- `async invalidate(prefix)` L126: INVALIDATE
- Internal: `setJson` L18, `getJson` L31

#### redisConfig.js

- `getRedisClient()` L44: ------------------------------------------------------------ Application Redis Client (SINGLETON) ------------------------------------------------------------ Use this for: - Caching (SET / GET) - Locks (SET NX) - SCAN / pipeline - Invalidation DO NOT use this client for Socket.IO pub/sub.
- `createNewRedisClient()` L105: ------------------------------------------------------------ Dedicated Redis Client (INFRA / PUB-SUB ONLY) ------------------------------------------------------------ Use this ONLY for: - Socket.IO Redis adapter - Pub/Sub messaging Why this exists: - Redis connections in SUBSCRIBE mode cannot execute normal commands (SET/GET/SCAN). - Socket.IO requires dedicated pub & sub connections. DO NOT: - Cache data - Acquire locks - Run SCAN / pipelines - Share this client with app logic
- `isRedisUp()` L134: Redis availability flag Used to gracefully bypass cache when Redis is down

### backend/config/sockets/auth

#### authMeEmitter.js

- `async emitAuthMeForUser({ userId, organizationId, audience = AuthAudience.STAFF, })` L27
- `async emitAuthMeForOrganization({ organizationId, audience = AuthAudience.STAFF, })` L71
- `notifyAuthMeForUser(params)` L93
- `notifyAuthMeForOrganization(params)` L99
- Internal: `getAuthNamespace` L8, `mapLimit` L14, `connectedUserIdsForOrg` L48, `activeMemberUserIds` L62

#### authSocketHandler.js

- `authSocketHandler(io)` L11

#### authSocketRooms.js

- `getUserRoom(userId)` L1
- `getOrgRoom(organizationId)` L2

### backend/config/sockets

#### index.js

- `initializeSockets(io)` L7

### backend/config/sockets/kiosk

#### kioskSocketEmitter.js

- `emitKioskPairingReady({ kioskId, session })` L1

#### kioskSocketHandler.js

- `kioskSocketHandler(io)` L4

### backend/config/sockets/orders

#### orderSocketEmitter.js

- `emitOrderEvent({ io, eventName, orderId, organizationId, userId, data = {}, })` L1

#### orderSocketHandler.js

- `orderSocketHandler(io, role)` L3

### backend/config/sockets

#### socketRedisAdapter.js

- `attachRedisAdapter(io)` L49: Attaches Redis adapter to a Socket.IO server instance. This creates: - One Redis connection for publishing events - One Redis connection for subscribing to events These connections: - Are ephemeral - Do NOT store data - Do NOT create keys - Act purely as a message relay (pub/sub) @param {import("socket.io").Server} io

#### socketServer.js

- `createSocketServer(app, allowedOrigins)` L7

### backend/config/startupSetup

#### db.bootstrap.js

- `async runDBBootstrap()` L249
- Internal: `enforceOneMembershipPerOrg` L147, `ensureModuleCatalogue` L201, `ensureAttendanceDayIndexes` L228

### backend/config/swagger

#### buildOpenApi.js

- `buildOpenApi({ adminRouter, appRouter, commonRouter, port })` L53: OpenAPI spec = live Express routes ∪ latest Postman collection. New route files show up on server restart without exporting Postman. Postman bodies/summaries are reused when the path+method matches.
- Internal: `opKey` L5, `pathParams` L7, `stubOperation` L15, `tagFromPath` L36

#### postmanToOpenApi.js

- `newestCollectionPath()` L6
- `loadPostmanOperations()` L225
- Internal: `segmentToParam` L30, `pathFromPostmanUrl` L39, `collectionVars` L56, `applyVars` L64, `exampleFromRaw` L73, `schemaFromExample` L83, `walkItems` L105

#### requestBodies.js

- `attachBody(method, path, operation)` L167
- Internal: `jsonBody` L1, `multipartFilesBody` L11

#### walkExpressRoutes.js

- `toOpenApiPath(expressPath)` L12
- `listRouterPaths(router, prefix = "")` L82
- Internal: `joinPaths` L5, `layerMountPath` L22, `walkStack` L55

### backend/helperUtils

#### calculateDistance.js

- `calculateDistance(coords1, coords2, unit = 'km')` L8: Calculate the distance between two geographic coordinates using the Haversine formula. @param {Array&lt;number>} coords1 - Array [longitude, latitude] for the first location. @param {Array&lt;number>} coords2 - Array [longitude, latitude] for the second location. @param {string} unit - Unit of distance ('km' or 'miles'). Defaults to 'km'. @returns {number|string} - The distance in the specified unit or an error message.

#### cleanupUnusedTranslations.js

- Internal: `getTranslationKeysFromControllers` L8, `updateEnJsonFile` L35, `cleanUpTranslationKeys` L53

#### controllerResponse.js

- `respond(action, { statusCode = 200, translationKey = "data_fetched_successfully", paged = false } = {})` L10: Wraps a handler so each one only says what to call and how to answer. `paged` handlers return { data, meta } instead of plain data.
- `respondByAction(actions)` L26: One route for the actions on a record: the body's `action` picks the handler, so approve / reject / cancel share one PUT. Unknown actions are a 400. `actions` maps a name to { run(req), translationKey?, statusCode? }.

#### dataBaseBackup.js

- `async backupMongoDB()` L10
- Internal: `uploadBackupToS3` L31, `cleanUpOldBackups` L54

#### dbUtils.js

- `async bulkInsert(values, collectionName)` L5
- `async deleteCollection(collectionName)` L21
- `async fetchValuesByRefIds(Model, refIds)` L27

#### emailTemplates.js

- `registrationOtpEmailTemplate(otp)` L6
- `forgotPasswordOtpEmailTemplate(otp)` L56
- `kioskCheckInOtpEmailTemplate(otp)` L105
- `stripeEmailTemplate({ name, link })` L155
- `staffInvitationEmailTemplate({ inviteeName, organizationName, branchName, roleLabel, acceptUrl, expiresInDays, })` L244
- `familyInvitationEmailTemplate({ inviteeName, residentName, organizationName, branchName, acceptUrl, expiresInDays, })` L317
- `visitorAccountInvitationEmailTemplate({ name, organizationName, branchName, personType, acceptUrl, expiresInDays, })` L363
- `visitorInvitationEmailTemplate({ visitorName, organizationName, branchName, inviteCode, })` L403

#### emailUtil.js

- `async sendEmailViaAwsSes(emails, subject, body, config = {})` L42: Send an email using AWS SES @param {string} title - The title of the email (usually appears as the "from" name) @param {Array} emails - List of recipient email addresses @param {string} subject - Subject of the email @param {string} body - Body of the email (HTML or plain text) @param {Object} [config] - Additional configuration options (optional) @param {string} [config.fromEmail] - From email address (default is set by AWS SES) @param {Object} [config.attachments] - Attachments for the email (AWS SES supports raw email for attachments) @param {boolean} [config.isHtml] - Flag to indicate if the body is HTML @returns {Promise} - Promise resolving to AWS SES response or rejecting with an error
- `async sendSmsViaPinpoint(phoneNumber, message)` L90: Send an SMS using Amazon Pinpoint @param {string} phoneNumber - The recipient's phone number in E.164 format (+1234567890) @param {string} message - The SMS message content @returns {Promise} - A promise that resolves to the result of the Pinpoint SendMessagesCommand
- `async sendEmailViaSgrid(title, emails, subject, body, config = {})` L135: Send an email using SendGrid @param {string} title - The title of the email (usually appears as the "from" name) @param {Array} emails - List of recipient email addresses @param {string} subject - Subject of the email @param {string} body - Body of the email (HTML or plain text) @param {Object} [config] - Additional configuration options (optional) @param {string} [config.fromEmail] - From email address (default is set by SendGrid) @param {Object} [config.attachments] - Attachments for the email @param {boolean} [config.isHtml] - Flag to indicate if the body is HTML @returns {Promise} - Promise resolving to SendGrid response or rejecting with an error
- `async sendEmailViaBrevo(emails, subject, body, config = {})` L167

#### familyPdfResponse.js

- `async sendPdf({ req, res, pdf, attachment })` L8: Answers a PDF download. With ?format=url and a stored copy it returns a short-lived signed link to the file in S3; otherwise (previews drawn on demand, or no format) the PDF itself is streamed.

#### familyPostVisibility.js

- `visibleToLink(link)` L8: Which published posts one family link may see, as a database match. A post with no audience saved is a branch post, so every post made before audiences existed keeps showing exactly where it did.
- `visibleToAny(links)` L25: The posts any of the caller's links may see.
- `audienceLabelOf(audience, homeName)` L38

#### familyQuery.js

- `queryText(value)` L10: Express parses ?status[$ne]=x into an object. Anything that is not a plain string is dropped here, so a caller can never smuggle a query operator into a filter.
- `queryId(value, field = "id")` L13: A filter id: absent is fine, anything present must be a 24-character hex id. The error names the field.
- `searchText(value)` L23: Search text taken literally (no regex of the caller's choosing) and kept short.
- Internal: `escapeRegex` L20

#### frontendUrl.js

- `frontendLink(overrideName, path)` L3

#### imageHelper.js

- `getFullImageUrl(imagePath, baseUrl = s3BaseUrl())` L8
- `toPublicImageUrl(value)` L16
- Internal: `s3BaseUrl` L2

#### jwtSecret.js

- Internal: `generateJWTSecret` L11

#### mailer.js

- `async sendTransactionalEmail({ to, subject, html, previewUrl, attachments, throwOnError = false })` L11: Single exit point for transactional mail. No SMTP provider is wired up yet, so by default the message is logged and the actionable link printed to the console — enough to complete an invitation flow in development without silently dropping mail. Set `EMAIL_ENABLED=true` once a provider is configured and the same call starts delivering.

#### nameKey.js

- `nameKeyOf(value)` L8: Normalised form of a display name, used by unique-name indexes. Uniqueness has to ignore the differences a human would not notice, so "Oakfield Care Home", "oakfield care home", and "Oakfield Care Home" all collapse to one key and cannot coexist.

#### paginate.js

- `facetCount(bucket)` L3
- `allCountFacet(countMatch)` L6: Tab “All” total: same match as the other tabs, without the status/role filter.
- `statusTabCountFacets(countMatch, statuses, field = "status")` L10
- `statusTabCountsFromFacet(result, statuses)` L20
- `emptyStatusTabCounts(statuses)` L30
- `countsFromGroupRows(rows = [], keys, result)` L36: Fill tab keys from a `$group` `_id` bucket; `all` must come from `allCount` `$count`.
- `keywordOr(keyword, fields, { trim = false } = {})` L49
- `async paginateWithFacet({ model, match, page, limit, skip, sort = { createdAt: -1 }, applyLimit = true, preStages = [], extraDataStages = [], extraFacets = {}, })` L62: One round-trip list: filtered data + total, plus optional extra $facet branches. When applyLimit is false, skip/limit are omitted (same as mongoose .limit(0)).

#### queryUtil.js

- `async populateFields(model, query, fieldsToPopulate, options = {})` L22: Populates specified fields for a Mongoose model query with pagination and sorting. @param {object} model - Mongoose model to query. @param {object} query - Query conditions to filter the documents. @param {Array&lt;{path: string, select: string, alias: string}>} fieldsToPopulate - Array of fields to populate with their paths, select options, and aliases. @param {object} [options={}] - Optional parameters for pagination and sorting. @param {object} [options.sort={createdAt: -1}] - Sorting criteria for the query (default: { createdAt: -1 }). @param {number} [options.page=1] - Page number for pagination (default: 1). @param {number} [options.limit=10] - Number of documents per page for pagination (default: 10). @returns {Promise&lt;Array&lt;object>>} - A promise that resolves to an array of documents with populated fields. Example usage: const fieldsToPopulate = [ { path: 'userId', select: 'name email', alias: 'userDetails' }, { path: 'groupId', select: 'name', alias: 'groupDetails' } ]; const documents = await populateFields(ModelName, query, fieldsToPopulate, { page, limit });
- `async populateMultipleTables(populationConfigs)` L69: Populates specified fields for multiple Mongoose models with pagination and sorting. @param {Array&lt;{model: object, query: object, fieldsToPopulate: Array&lt;{path: string, select: string}>, options?: object}>} populationConfigs - Array of population configurations. @returns {Promise&lt;Array&lt;object>>} - A promise that resolves to an array of results from each model population. Example usage: const populationConfigs = [ { model: UserModel, query: { status: 'active' }, fieldsToPopulate: [{ path: 'profileId', select: 'avatar bio' }], options: { sort: { createdAt: -1 }, page: 1, limit: 5 } }, { model: PostModel, query: { isPublished: true }, fieldsToPopulate: [{ path: 'authorId', select: 'name' }], options: { sort: { createdAt: -1 }, page: 1, limit: 10 } } ]; const results = await populateMultipleTables(populationConfigs);
- `async populateNestedFields(model, query, nestedFieldsToPopulate, options = {})` L109: Populates nested fields for a Mongoose model query with pagination and sorting. @param {object} model - Mongoose model to query. @param {object} query - Query conditions to filter the documents. @param {Array&lt;{path: string, select: string, populate: Array&lt;{path: string, select: string}>}>} nestedFieldsToPopulate - Array of nested fields to populate. @param {object} [options={}] - Optional parameters for pagination and sorting. @param {object} [options.sort={createdAt: -1}] - Sorting criteria for the query (default: { createdAt: -1 }). @param {number} [options.page=1] - Page number for pagination (default: 1). @param {number} [options.limit=10] - Number of documents per page for pagination (default: 10). @returns {Promise&lt;Array&lt;object>>} - A promise that resolves to an array of documents with nested populated fields. Example usage: const nestedFieldsToPopulate = [ { path: 'authorId', select: 'name', populate: [{ path: 'profileId', select: 'avatar bio' }] } ]; const documents = await populateNestedFields(ModelName, query, nestedFieldsToPopulate, { page, limit });

#### rateLimiter.js

- `createRateLimiter(endpoint, timeWindow = 10, maxRequests = 15)` L12: Create a rate limiter middleware for Express routes. @param {string} endpoint - The name of the endpoint (for logging purposes). @param {number} [timeWindow=15] - The time window in minutes. @param {number} [maxRequests=5] - The maximum number of requests allowed. @returns {Function} Express middleware function for rate limiting.

#### responseUtil.js

- `sendResponse({ res, statusCode = 200, translationKey = "", data = null, meta = null, error = null, translateMessage = true, values = {}, // Add values parameter for dynamic transla…)` L35: Sends a JSON response with optional status code, message, data, and meta information. @param {object} res - Express response object. @param {number} [statusCode=200] - HTTP status code (default: 200). @param {string} [translationKey=''] - Base message to send in the response (default: ''). @param {object|array|null} [data=null] - Data to send in the response body (default: null). @param {object} [meta] - Additional metadata to include in the response (optional).
- `parsePaginationParams(req)` L131
- `generateMeta(page, limit, total)` L155
- `validateObjectIdsArr(res, ids, fieldNames)` L163
- `validateParams(req, res, options = {})` L208
- `isValidNanoid(id)` L505: Check if a given ID is a valid nanoid (default 21 characters, a-zA-Z0-9, _ and -)
- `exampleMiddleware(req, res, next)` L525
- `convertUtcToTimezoneAMPM(date, timezone, outputFormat = "hh:mm A", inputFormat = "YYYY-MM-DDTHH:mm:ss.SSSZ")` L548: Convert UTC date to a specific timezone and format it as AM/PM @param {string} date - The date to be converted. @param {string} timezone - The timezone to convert to. @param {string} outputFormat - The desired output format (default is AM/PM format). @param {string} inputFormat - The input format for the date (default is ISO 8601). @returns {string} The formatted date in the specified timezone and format.
- `convertUtcToTimezone(date, timezone, outputFormat = "YYYY-MM-DDTHH:mm:ss.SSSZ", inputFormat = "YYYY-MM-DDTHH:mm:ss.SSSZ")` L580: Converts a date from a specified input format to a specified user timezone. If the timezone is null or not provided, it formats the date without applying a timezone. @param {string | Date} date - The date to convert. @param {string} [timezone] - The user's timezone (e.g., "Asia/Karachi"). If null, no timezone conversion is applied. @param {string} [outputFormat="YYYY-MM-DDTHH:mm:ss.SSSZ"] - Optional output date format. Defaults to MongoDB format. @param {string | string[]} [inputFormat="YYYY-MM-DDTHH:mm:ss.SSSZ"] - Optional input date format(s). Defaults to UTC format. @returns {string} The converted date in the user's timezone or formatted date if timezone is null.
- `convertTimezoneToUtc(date, timezone, inputFormat = "YYYY-MM-DD hh:mm A", outputFormat = "YYYY-MM-DDTHH:mm:ss.SSSZ")` L607: Converts a date from a specified timezone to UTC. If the timezone is null or not provided, it formats the date without applying a timezone. @param {string | Date} date - The date to convert. @param {string} [timezone] - The user's timezone (e.g., "Asia/Karachi"). If null, no timezone conversion is applied. @param {string} [outputFormat="YYYY-MM-DDTHH:mm:ss.SSSZ"] - Optional output date format. Defaults to MongoDB format. @param {string | string[]} [inputFormat="YYYY-MM-DDTHH:mm:ss.SSSZ"] - Optional input date format(s). Defaults to UTC format. @returns {string} The converted date in UTC or formatted date if timezone is null.
- `convertToUtcDateOnly(date, timezone, inputFormat = "YYYY-MM-DD")` L616
- `convertTimezoneToUtcDateOnly(date, timezone, inputFormat = "YYYY-MM-DD hh:mm A")` L624
- `getCurrentDateInTimezone({ timezone, isDateOnly = false, format = "YYYY-MM-DDTHH:mm:ss.SSSZ", })` L645
- `getStartAndEndOfDay(date, timezone)` L664
- `getStartAndEndOfWeek(date, timezone)` L682
- `getStartAndEndOfMonth(date, timezone)` L687
- `convertDateFormat(date, outputFormat = "YYYY-MM-DDTHH:mm:ss.SSSZ", inputFormat = "YYYY-MM-DDTHH:mm:ss.SSSZ")` L701: Converts a date from a specified input format to a specified output format. If the timezone is null or not provided, it formats the date without applying a timezone. @param {string | Date} date - The date to convert. @param {string} [outputFormat="YYYY-MM-DDTHH:mm:ss.SSSZ"] - Optional output date format. Defaults to MongoDB format. @param {string | string[]} [inputFormat="YYYY-MM-DDTHH:mm:ss.SSSZ"] - Optional input date format(s). Defaults to UTC format. @returns {string} The formatted date.
- `getReadableErrorMessage(error)` L713
- `getCurrentUtcDateOnly()` L778
- `getEndDate(pricingPlan, startDate = new Date())` L806
- `fireAndForget(promise, label)` L822
- Internal: `isProfileImageField` L6, `withImageFallbacks` L10, `keyToReadableText` L124, `convertUnderscoresToSpaces` L190, `extractNestedFields` L510

#### s3Key.js

- `keyFromUrl(url, { bucket } = {})` L2: The S3 key inside a stored file's URL, or "" when the URL is not one of this bucket's.

#### server-setup.js

- `async connectToDB(retries = 5, delay = 3000)` L7

#### startupUrls.js

- `getLanAddresses()` L6: Collect non-internal IPv4 addresses for LAN "Network" URLs.
- `printStartupUrls({ port, tunnelEnabled = true })` L45: Print local + network URLs for HTTP API and Socket.IO (same port).
- `printTunnelUrls(tunnelUrl)` L92: Print Cloudflare quick-tunnel URLs once the public hostname is known.
- Internal: `httpBase` L23, `httpsBase` L27, `wsBaseFromHttp` L31, `printBlock` L35

#### userResponseUtil.js

- `formatUserResponse(userObject, token = null, includeFields = [], excludeFields = [])` L6

### backend/middlewares

#### audienceMiddleware.js

- `requireAudience(allowed = [])` L7: Login is shared across surfaces, so each route group asserts the audience its token was issued for. This stops a resident token reaching staff APIs.

#### authMiddleware.js

- `async auth(req, res, next)` L15
- Internal: `hasField` L8

#### familyMiddleware.js

- `requireFamilyAccess(options = {})` L31: Reads the caller's links live on every request, so a removed member or a module switched off loses access at once. Pass { param, from } to also require a link to the resident named in that request part (from: "params" by default, or "query" / "body").
- `requireFamilyModule(req, res, next)` L78: Staff routes: with Family Engagement off the customer sees nothing, so the answer is 404 (not the 403 of requireModule). A platform admin passes, as with every module. Run it after requireMembership.
- `requireNextOfKin(req, res, next)` L91
- `async checkFamilyFilters(req, res, next)` L107: Org-path lists take optional branchId and residentId filters. A malformed id is a 400 that names the field, and an id outside this organization is a 404 that names what is missing, rather than a list that is silently empty. Run it after requireMembership.
- `scopeToOwnBranch(req, res, next)` L136
- `branchFilter(req)` L148
- Internal: `notFound` L19, `readResidentId` L22

#### familyPhotoMiddleware.js

- `receivePhoto(req, res, next)` L26: One image from the "file" field; anything else, or a file over 10 MB, is a 400.
- `receivePhotos(req, res, next)` L38: Up to 10 images from the "files" field, 10 MB each and 50 MB together.
- Internal: `isImage` L8, `refusal` L22

#### kioskMiddleware.js

- `signKioskToken(kiosk)` L15: Kiosks authenticate as a device, not as a user, so they get their own token.
- `async requireKioskSession(req, res, next)` L25
- `requireKioskModule(moduleSlug = ModuleSlug.SIGN_IN_ATTENDANCE)` L113: Kiosk routes gate on org module access using branch.organizationId from the session.
- Internal: `isModuleEnabled` L101

#### membershipMiddleware.js

- `requireMembership(options = {})` L40: Resolves the caller's Membership for the requested org/branch scope. Scope comes from a route param, a query param, or the x-org-id / x-branch-id headers. Owners and superAdmins hold an org-wide membership (branchId null) and therefore satisfy any branch scope inside their organization.
- `requireRoles(allowedRoles = [])` L188: Requires requireMembership to have run first.
- `requirePermission(permission)` L209: Owner, platform admin, site manager, and staff inherit licensed org modules.
- `requireModule(moduleSlug)` L236: Gates sellable modules on what the organization has actually bought.
- `async hasReports(req, res, next)` L280: Line Manager gate. Reporting is driven by StaffProfile.reportsToStaffId, not by job title, so a manager with no direct reports is refused. Prefer `hasReportsIf([MembershipRole.LINE_MANAGER])` on shared approve routes so Owner / Site Manager are not forced through this check.
- `hasReportsIf(roles = [MembershipRole.LINE_MANAGER])` L340: Runs `hasReports` only when the caller's membership role is in `roles`. Scalable for shared Owner/SM/LM routes without duplicating route trees.
- Internal: `toObjectId` L17, `readScope` L31

#### roleMiddleware.js

- `roleMiddleware(allowedRoles)` L4

#### security.js

- `securityMiddleware(app, options = {})` L9

#### surfaceMiddleware.js

- `requireSurface(allowed = [])` L9: Optional gate for later: lock a route group to tokens minted for a portal. Login already enforces surface; attach this only where a portal must stay closed. Tokens issued before surface existed have req.surface null and are allowed through.

#### uploadFileMw.js

- Internal: `checkFileType` L25

#### uploadFilesAWSMw.js

- Internal: `checkFileType` L16

### backend/models

#### Devices.js

- `createOrSkipDevice(userId, deviceId, deviceType)` L36

#### ExternalPerson.js

- Internal: `dropLegacyUserIdIndex` L85

#### FamilyGazetteItem.js

- Internal: `objectId` L4

#### FamilyNewsletter.js

- Internal: `objectId` L4

#### UserModel.js

- `userSchema.methods.generateAuthToken(audience = "staff", surface)` L276
- `async userSchema.statics.findByCredentials(email, password)` L285
- `userSchema.methods.generateOtp(type = "email", timezone = "UTC")` L300
- `generateResetToken()` L365

### backend/scripts

#### backfillStaffDefaultPermissions.js

- Internal: `run` L31

### backend

#### server.js

- Internal: `shutdown` L291

### backend/services/_errors

#### AppError.js

- Internal: `AppError.constructor` L2

#### handleServiceError.js

- `handleServiceError(res, error, fallbackKey = "an_error_9")` L10
- Internal: `isInvalidObjectId` L7

### backend/services/moderation

#### textModeration.js

- `async initTextModeration()` L3
- `textModerationMiddleware(req, res, next)` L35
- Internal: `extractStrings` L11
