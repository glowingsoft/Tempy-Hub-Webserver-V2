# Tempy Hub Backend

SaaS system for care homes — Node/Express/Mongo API scaffolded from the Glowingsoft MERN boilerplate.

## Author

Zawar Ahmad

## Setup

1. `npm install`
2. Ensure `.env` exists (created from `.env.example`)
3. Generate JWT secrets if needed: `node ./backend/helperUtils/jwtSecret.js`
4. Run MongoDB as a replica set — transactions require it (see Notes below)
5. Add Firebase `serviceAccountKey.json` when push notifications are required
6. `npm run dev` — console shows Local, Network, and Cloudflare tunnel URLs for the API and Socket.IO

## Environments

- Dev: `npm run dev` (`NODE_ENV=dev`, ports `6060` / `6061`)
- Prod: `npm run prod`
- PM2: `npm run pm2:dev:start` / `npm run pm2:prod:start`

## Notes

- MongoDB: `mongodb://localhost:27017/tempy-hub-local?replicaSet=rs0`. A **replica set is required**, not optional: auth (OTP, login) and organization creation use multi-document transactions, which a standalone `mongod` rejects with `Transaction numbers are only allowed on a replica set member or mongos`. On Windows the bundled standalone service holds port 27017 on boot — run `scripts/setup-mongo-replica-set.ps1` once from an elevated shell to free it, then `mongod --dbpath "C:\data\db" --replSet rs0` and, the first time only, `mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"`
- CORS prod origins include `http://localhost:3030` (admin panel)
- Leave AWS/SendGrid/S3 placeholders until real credentials are available
- Set `CLOUDFLARE_TUNNEL=false` to skip the quick tunnel; details in [`docs/modules/startup-urls.md`](./docs/modules/startup-urls.md)

## Postman

Import [`postman_collection/Tempy Hub API_13_10_2026.postman_collection.json`](./postman_collection/Tempy%20Hub%20API_13_10_2026.postman_collection.json) only (or download `GET /api/v1/postman`). Collection `organizationId` defaults to `6ac72d4be20e26c247a731b3`. Details: [`docs/api.md`](./docs/api.md).

## Documentation

Project docs live under [`docs/`](./docs/README.md).
