// LEDGER — Cloudflare Worker API
// Handles auth (email + password), transactions, wishlist, todo subjects/items,
// and PDF book storage in R2. Serves the static frontend for everything else.

const SESSION_DAYS = 30;

// ---------- small helpers ----------

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function badRequest(msg) {
  return json({ error: msg }, 400);
}

function unauthorized() {
  return json({ error: "Not authenticated" }, 401);
}

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionCookie(token, maxAgeSeconds) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie() {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const saltBytes = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function randomSaltB64() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

async function getUserFromRequest(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.session;
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.token, s.expires_at, u.id as user_id, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  )
    .bind(token)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.user_id, email: row.email, token };
}

// ---------- router ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) {
      // static frontend
      return env.ASSETS.fetch(request);
    }

    try {
      // ----- AUTH -----
      if (path === "/api/auth/signup" && request.method === "POST") {
        const { email, password } = await request.json();
        if (!email || !password || password.length < 6) {
          return badRequest("Email and a password of at least 6 characters are required.");
        }
        const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
          .bind(email.toLowerCase().trim())
          .first();
        if (existing) return badRequest("An account with that email already exists.");

        const salt = randomSaltB64();
        const hash = await hashPassword(password, salt);
        const id = uuid();
        await env.DB.prepare(
          `INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(id, email.toLowerCase().trim(), hash, salt, nowIso())
          .run();

        const token = uuid();
        const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
        )
          .bind(token, id, expires)
          .run();

        return json(
          { id, email: email.toLowerCase().trim() },
          200,
          { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) }
        );
      }

      if (path === "/api/auth/login" && request.method === "POST") {
        const { email, password } = await request.json();
        if (!email || !password) return badRequest("Email and password required.");
        const user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
          .bind(email.toLowerCase().trim())
          .first();
        if (!user) return badRequest("No account found with that email.");
        const hash = await hashPassword(password, user.salt);
        if (hash !== user.password_hash) return badRequest("Incorrect password.");

        const token = uuid();
        const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
        )
          .bind(token, user.id, expires)
          .run();

        return json(
          { id: user.id, email: user.email },
          200,
          { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) }
        );
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const cookies = parseCookies(request);
        if (cookies.session) {
          await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`)
            .bind(cookies.session)
            .run();
        }
        return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        const user = await getUserFromRequest(request, env);
        if (!user) return unauthorized();
        return json({ id: user.id, email: user.email });
      }

      // Everything below requires auth
      const user = await getUserFromRequest(request, env);
      if (!user) return unauthorized();

      // ----- TRANSACTIONS -----
      if (path === "/api/transactions" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC`
        )
          .bind(user.id)
          .all();
        return json(results);
      }

      if (path === "/api/transactions" && request.method === "POST") {
        const b = await request.json();
        if (!b.amount || b.amount <= 0 || !b.type || !b.category || !b.date) {
          return badRequest("amount, type, category, and date are required.");
        }
        const id = uuid();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, category, note, date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, user.id, b.type, b.amount, b.category, b.note || "", b.date, nowIso())
          .run();
        return json({ id });
      }

      let m = path.match(/^\/api\/transactions\/([^/]+)$/);
      if (m && request.method === "DELETE") {
        await env.DB.prepare(`DELETE FROM transactions WHERE id = ? AND user_id = ?`)
          .bind(m[1], user.id)
          .run();
        return json({ ok: true });
      }

      // ----- WISHLIST -----
      if (path === "/api/wishlist" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM wishlist WHERE user_id = ? ORDER BY created_at DESC`
        )
          .bind(user.id)
          .all();
        return json(results);
      }

      if (path === "/api/wishlist" && request.method === "POST") {
        const b = await request.json();
        if (!b.name || !b.target || b.target <= 0) {
          return badRequest("name and target are required.");
        }
        const id = uuid();
        await env.DB.prepare(
          `INSERT INTO wishlist (id, user_id, name, target, saved, icon, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`
        )
          .bind(id, user.id, b.name, b.target, b.icon || "🎁", nowIso())
          .run();
        return json({ id });
      }

      m = path.match(/^\/api\/wishlist\/([^/]+)\/(allocate|withdraw)$/);
      if (m && request.method === "POST") {
        const [, wishId, action] = m;
        const b = await request.json();
        const amount = parseFloat(b.amount);
        if (!amount || amount <= 0) return badRequest("A positive amount is required.");

        const wish = await env.DB.prepare(
          `SELECT * FROM wishlist WHERE id = ? AND user_id = ?`
        )
          .bind(wishId, user.id)
          .first();
        if (!wish) return json({ error: "Wishlist item not found." }, 404);

        if (action === "allocate") {
          const incomeRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) as net
             FROM transactions WHERE user_id = ?`
          )
            .bind(user.id)
            .first();
          const savedRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(saved),0) as total FROM wishlist WHERE user_id = ?`
          )
            .bind(user.id)
            .first();
          const available = incomeRow.net - savedRow.total;
          if (amount > available) return badRequest("That's more than your available balance.");
          await env.DB.prepare(`UPDATE wishlist SET saved = saved + ? WHERE id = ?`)
            .bind(amount, wishId)
            .run();
        } else {
          if (amount > wish.saved) return badRequest("Can't withdraw more than what's saved.");
          await env.DB.prepare(`UPDATE wishlist SET saved = saved - ? WHERE id = ?`)
            .bind(amount, wishId)
            .run();
        }
        return json({ ok: true });
      }

      m = path.match(/^\/api\/wishlist\/([^/]+)$/);
      if (m && request.method === "DELETE") {
        await env.DB.prepare(`DELETE FROM wishlist WHERE id = ? AND user_id = ?`)
          .bind(m[1], user.id)
          .run();
        return json({ ok: true });
      }

      // ----- SUBJECTS (todo categories) -----
      if (path === "/api/subjects" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM subjects WHERE user_id = ? ORDER BY created_at ASC`
        )
          .bind(user.id)
          .all();
        return json(results);
      }

      if (path === "/api/subjects" && request.method === "POST") {
        const b = await request.json();
        if (!b.name || !b.name.trim()) return badRequest("Subject name is required.");
        const id = uuid();
        await env.DB.prepare(
          `INSERT INTO subjects (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`
        )
          .bind(id, user.id, b.name.trim(), nowIso())
          .run();
        return json({ id, name: b.name.trim() });
      }

      m = path.match(/^\/api\/subjects\/([^/]+)$/);
      if (m && request.method === "DELETE") {
        await env.DB.prepare(`DELETE FROM todos WHERE subject_id = ? AND user_id = ?`)
          .bind(m[1], user.id)
          .run();
        await env.DB.prepare(`DELETE FROM subjects WHERE id = ? AND user_id = ?`)
          .bind(m[1], user.id)
          .run();
        return json({ ok: true });
      }

      // ----- TODOS -----
      if (path === "/api/todos" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC`
        )
          .bind(user.id)
          .all();
        return json(results);
      }

      if (path === "/api/todos" && request.method === "POST") {
        const b = await request.json();
        if (!b.subject_id || !b.text || !b.text.trim()) {
          return badRequest("subject_id and text are required.");
        }
        const id = uuid();
        await env.DB.prepare(
          `INSERT INTO todos (id, user_id, subject_id, text, done, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`
        )
          .bind(id, user.id, b.subject_id, b.text.trim(), nowIso())
          .run();
        return json({ id });
      }

      m = path.match(/^\/api\/todos\/([^/]+)$/);
      if (m && request.method === "PATCH") {
        const b = await request.json();
        if (typeof b.done === "boolean") {
          await env.DB.prepare(`UPDATE todos SET done = ? WHERE id = ? AND user_id = ?`)
            .bind(b.done ? 1 : 0, m[1], user.id)
            .run();
        }
        if (typeof b.text === "string" && b.text.trim()) {
          await env.DB.prepare(`UPDATE todos SET text = ? WHERE id = ? AND user_id = ?`)
            .bind(b.text.trim(), m[1], user.id)
            .run();
        }
        return json({ ok: true });
      }

      if (m && request.method === "DELETE") {
        await env.DB.prepare(`DELETE FROM todos WHERE id = ? AND user_id = ?`)
          .bind(m[1], user.id)
          .run();
        return json({ ok: true });
      }

      // ----- BOOKS (PDF storage in R2) -----
      if (path === "/api/books" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT id, filename, size, uploaded_at FROM books WHERE user_id = ? ORDER BY uploaded_at DESC`
        )
          .bind(user.id)
          .all();
        return json(results);
      }

      if (path === "/api/books" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") return badRequest("No file uploaded.");
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          return badRequest("Only PDF files are accepted.");
        }
        const MAX_SIZE = 50 * 1024 * 1024; // 50MB
        if (file.size > MAX_SIZE) return badRequest("File is too large (50MB max).");

        const id = uuid();
        const r2Key = `user_${user.id}/${id}-${file.name}`;
        await env.BOOKS.put(r2Key, await file.arrayBuffer(), {
          httpMetadata: { contentType: "application/pdf" },
        });
        await env.DB.prepare(
          `INSERT INTO books (id, user_id, filename, r2_key, size, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(id, user.id, file.name, r2Key, file.size, nowIso())
          .run();
        return json({ id, filename: file.name, size: file.size });
      }

      m = path.match(/^\/api\/books\/([^/]+)\/file$/);
      if (m && request.method === "GET") {
        const book = await env.DB.prepare(
          `SELECT * FROM books WHERE id = ? AND user_id = ?`
        )
          .bind(m[1], user.id)
          .first();
        if (!book) return json({ error: "Not found" }, 404);
        const obj = await env.BOOKS.get(book.r2_key);
        if (!obj) return json({ error: "File missing in storage" }, 404);
        return new Response(obj.body, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${book.filename}"`,
          },
        });
      }

      m = path.match(/^\/api\/books\/([^/]+)$/);
      if (m && request.method === "DELETE") {
        const book = await env.DB.prepare(
          `SELECT * FROM books WHERE id = ? AND user_id = ?`
        )
          .bind(m[1], user.id)
          .first();
        if (book) {
          await env.BOOKS.delete(book.r2_key);
          await env.DB.prepare(`DELETE FROM books WHERE id = ? AND user_id = ?`)
            .bind(m[1], user.id)
            .run();
        }
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: "Server error: " + err.message }, 500);
    }
  },
};
