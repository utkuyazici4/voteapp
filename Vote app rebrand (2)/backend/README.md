# Vote — Backend API

Secure REST + WebSocket API for **Vote**, the real-time binary-choice platform.
Node.js · Express · Prisma · PostgreSQL · JWT.

The frontend (the HTML app in `../vote/`) talks to this API by setting
`VOTE_CONFIG.apiBase` to the deployed URL. Until then it runs on in-memory mock data.

---

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 18 (ES modules) |
| Framework | Express |
| DB / ORM | PostgreSQL + Prisma (parameterised queries → no SQL injection) |
| Auth | JWT access token (15 min) + rotating refresh token (httpOnly cookie) |
| Passwords | bcrypt (12 rounds) |
| Realtime | WebSocket (`/ws`) for live vote tallies |
| Validation | zod on every request body/query/param |

---

## Local setup

```bash
cd backend
cp .env.example .env          # fill DATABASE_URL + generate JWT secrets
npm install
npx prisma db push             # create tables from the schema
npm run seed                  # optional demo data (login: ece@vote.dev / Passw0rd!)
npm run dev                   # http://localhost:4000
```

Generate strong secrets: `openssl rand -hex 64` (one per JWT secret).

---

## Deploy on Railway (fastest path)

1. Push this `backend/` folder to a GitHub repo.
2. Railway → **New Project → Deploy from GitHub repo**.
3. Add **+ New → Database → PostgreSQL** in the same project.
4. In the API service **Variables**, set:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` → random 64-hex each
   - `CORS_ORIGINS` → your frontend origin(s)
   - `NODE_ENV=production`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN=<your-domain>`
5. Deploy. `npm install` runs `prisma generate`; `npm start` runs `prisma db push`
   (creates the tables from the schema) then boots the server. Railway assigns a public URL.
6. Point the frontend at it: `VOTE_CONFIG.apiBase = "https://<your>.up.railway.app"`.

> Uploads: the built-in disk store is fine for Railway with a volume. For scale,
> switch `uploads.routes.js` to S3/Cloudflare R2 signed uploads.

## Deploy on AWS (when you scale)

- **API:** ECS Fargate (or Elastic Beanstalk) behind an ALB with TLS.
- **DB:** RDS PostgreSQL (Multi-AZ), private subnet, security group locked to the API.
- **Uploads:** S3 + CloudFront; issue pre-signed PUT URLs instead of proxying files.
- **Secrets:** AWS Secrets Manager / SSM Parameter Store (not env files).
- Same code — only the deploy target changes.

---

## Security checklist (implemented)

- ✅ Passwords hashed with **bcrypt**; never returned by any endpoint (`publicUser` select).
- ✅ **JWT** access tokens short-lived; **refresh tokens rotated**, stored **hashed** (sha256), revocable → real logout.
- ✅ Refresh token in an **httpOnly, Secure, SameSite=Strict** cookie (XSS + CSRF mitigation).
- ✅ **zod** validation on all input; body size capped (1 MB); **hpp** against param pollution.
- ✅ **helmet** security headers; **CORS** strict allowlist with credentials.
- ✅ **Rate limiting**: global + tighter on auth (brute-force), voting, commenting, uploads.
- ✅ **Prisma** parameterised queries → no SQL injection.
- ✅ **Authorization** enforced server-side: decision visibility (close-friends = mutuals only),
  one vote per user, voters-only comments, author-only delete.
- ✅ Login uses a **constant generic error** + always-run hash compare → no user enumeration / timing leak.
- ✅ Upload **mime + size validation**, random filenames, images served with a safe CORP header.
- ✅ Errors never leak stack traces in production.

Before going live also: enable HTTPS everywhere, set real `CORS_ORIGINS`, rotate secrets,
add DB backups, and consider a password-reset email flow + 2FA.

---

## API surface

Auth (`/api/auth`): `POST /register` · `POST /login` · `POST /refresh` · `POST /logout` · `GET /me`

Decisions (`/api/decisions`): `GET /?tab=foryou|following&cursor&limit` · `POST /` (create, both images required) ·
`GET /:id` · `DELETE /:id` · `POST /:id/votes` · `GET /:id/results`

Comments (`/api`): `GET /decisions/:id/comments` · `POST /decisions/:id/comments` (voters-only)

Users (`/api/users`): `GET /leaderboard?scope=all|friends` · `GET /me/close-friends` ·
`GET /me/notifications` · `POST /me/notifications/read` · `GET /me/streak` ·
`POST /:id/follow` · `DELETE /:id/follow` · `GET /:id` · `GET /:id/decisions`

Uploads (`/api/uploads`): `POST /` (multipart `image`, returns `{ url }`)

Realtime: `ws://<host>/ws?token=<accessToken>` → `{type:'subscribe',decisionId}` → receives `{type:'tally',...}`
