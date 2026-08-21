# LEDGER

A black, white, and red expense tracker, wishlist savings planner, subject-based to-do list, and PDF book library — with real accounts, so your data follows you to any device you log in from.

Built on **Cloudflare Workers** (API + hosting), **D1** (database), and **R2** (PDF file storage). No servers to manage, generous free tier.

## What's inside

| Feature | Where it lives |
|---|---|
| Login / Signup (email + password) | `sessions` + `users` tables in D1 |
| Income & expense ledger | `transactions` table |
| Wishlist savings goals | `wishlist` table |
| To-do list, grouped by subject you define | `subjects` + `todos` tables |
| Book PDFs, uploaded once, opened anywhere | `books` table (metadata) + R2 (actual files) |

Every request is scoped to the logged-in user — nobody else can see your transactions, goals, tasks, or books.

---

## 1. Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Node.js](https://nodejs.org) installed (v18+)
- The Wrangler CLI (Cloudflare's deploy tool) — installed automatically via `npm install`

```bash
cd ledger-cloudflare
npm install
npx wrangler login    # opens a browser to connect your Cloudflare account
```

## 2. Create the database (D1)

```bash
npx wrangler d1 create ledger-db
```

This prints something like:

```
[[d1_databases]]
binding = "DB"
database_name = "ledger-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy that `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Then create the tables:

```bash
npm run db:migrate:remote
```

(Use `npm run db:migrate:local` too if you want to test locally first — see step 5.)

## 3. Create the file storage bucket (R2)

```bash
npx wrangler r2 bucket create ledger-books
```

`wrangler.toml` is already set up to bind this bucket as `BOOKS` — nothing else to configure.

> Note: R2 requires you to enable it once on your Cloudflare account (Dashboard → R2 → "Purchase" — the free tier is generous and no card is charged unless you exceed it).

## 4. Deploy

```bash
npm run deploy
```

Wrangler will print your live URL, something like:

```
https://ledger.YOUR-SUBDOMAIN.workers.dev
```

Open it — you should see the login screen. Sign up, and you're in.

## 5. Test locally first (optional but recommended)

```bash
npm run db:migrate:local
npm run dev
```

This runs the whole app (frontend + API + a local copy of the database) at `http://localhost:8787` without touching your real Cloudflare data.

## 6. Put it on your own domain (the "héberger" part)

If you already have a domain in Cloudflare (or transfer/add one — free):

1. Cloudflare Dashboard → **Workers & Pages** → click on your `ledger` worker.
2. Go to **Settings → Domains & Routes → Add → Custom Domain**.
3. Enter something like `ledger.yourdomain.com` and confirm.

Cloudflare handles the DNS and SSL certificate automatically. Within a minute or two, your app is live at your own URL.

If you don't have a domain yet, `https://ledger.YOUR-SUBDOMAIN.workers.dev` from step 4 already works permanently and for free — a custom domain is optional polish.

---

## How your data is protected

- Passwords are never stored directly — they're hashed with PBKDF2 (100,000 iterations, unique salt per user) before touching the database.
- Sessions use a random token in an `HttpOnly`, `Secure` cookie — not readable by JavaScript, not sent over plain HTTP.
- Every API route checks the session and filters every database query by your `user_id` — there's no route that can see another user's data.
- PDF files in R2 are stored under a per-user key (`user_<id>/...`) and the download route re-checks ownership before streaming a file back.

## Project structure

```
ledger-cloudflare/
├── wrangler.toml       # Cloudflare config: bindings for D1, R2, static assets
├── package.json        # npm scripts (dev, deploy, migrate)
├── schema.sql           # database tables
├── src/
│   └── worker.js        # the entire backend API
└── public/
    └── index.html        # the entire frontend (login + app)
```

## Making changes later

- **Frontend look/behavior** → edit `public/index.html`, then `npm run deploy`.
- **API / business logic** → edit `src/worker.js`, then `npm run deploy`.
- **Database structure** → edit `schema.sql`, then re-run the migrate command. (For an existing live database, write a small additive migration file instead of re-running the whole schema, so you don't wipe existing tables — ask if you'd like help with that when the time comes.)

## Costs

Cloudflare's free tier covers this comfortably for personal use:
- Workers: 100,000 requests/day free
- D1: 5GB storage, 5 million reads/day free
- R2: 10GB storage free, no egress fees

You're very unlikely to pay anything running this solo.
