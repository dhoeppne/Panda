// Panda settings store: one SQLite table of settings per user, served over
// HTTP behind the web container's nginx (/api/settings). Zero npm
// dependencies: node:http and node:sqlite only. See server/README.md.

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_KEYS_PER_USER = 64;
const PREFIX = '/api/settings';

/**
 * The user a request acts for. Every request is the user 'default' for now:
 * this function reads no header. A later change maps the reverse proxy's
 * authenticated user to this value; every query takes its user from here.
 */
function userOf(_request) {
  return 'default';
}

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function sendJson(response, status, body, headers = {}) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(text);
}

function sendError(response, status, message, headers = {}) {
  sendJson(response, status, { error: message }, headers);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, `body is larger than ${MAX_BODY_BYTES} bytes`));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, `body is larger than ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

function parsePutBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'body must be a JSON object');
  }
  if (!Object.hasOwn(body, 'value')) {
    throw new HttpError(400, 'body needs a "value" field (null removes the key)');
  }
  const { baseRev } = body;
  if (!Number.isSafeInteger(baseRev) || baseRev < 0) {
    throw new HttpError(400, '"baseRev" must be an integer of 0 or more');
  }
  return { value: body.value, baseRev };
}

/** Opens the database file and returns the queries the routes use. */
function openStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    user TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    rev INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user, key)
  )`);
  const selectAll = db.prepare('SELECT key, value, rev FROM settings WHERE user = ? ORDER BY key');
  const selectMaxRev = db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM settings WHERE user = ?');
  const selectOne = db.prepare('SELECT value, rev FROM settings WHERE user = ? AND key = ?');
  const countKeys = db.prepare('SELECT COUNT(*) AS n FROM settings WHERE user = ?');
  const upsert = db.prepare(`INSERT INTO settings (user, key, value, rev, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user, key) DO UPDATE SET
      value = excluded.value, rev = excluded.rev, updated_at = excluded.updated_at`);

  return {
    read(user) {
      const rows = selectAll.all(user);
      const entries = {};
      let rev = 0;
      for (const row of rows) {
        entries[row.key] = {
          value: row.value === null ? null : JSON.parse(row.value),
          rev: row.rev,
        };
        if (row.rev > rev) rev = row.rev;
      }
      return { rev, entries };
    },
    /** Returns {ok: true, rev} or {ok: false, rev, value} for a conflict. */
    write(user, key, value, baseRev) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = selectOne.get(user, key);
        const storedRev = current === undefined ? 0 : current.rev;
        if (storedRev !== baseRev) {
          db.exec('ROLLBACK');
          const storedValue = current === undefined || current.value === null
            ? null
            : JSON.parse(current.value);
          return { ok: false, rev: storedRev, value: storedValue };
        }
        if (current === undefined && countKeys.get(user).n >= MAX_KEYS_PER_USER) {
          throw new HttpError(400, `a user can store at most ${MAX_KEYS_PER_USER} keys`);
        }
        const nextRev = selectMaxRev.get(user).rev + 1;
        upsert.run(user, key, value === null ? null : JSON.stringify(value), nextRev, Date.now());
        db.exec('COMMIT');
        return { ok: true, rev: nextRev };
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}

function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((candidate) => candidate.trim() === etag || candidate.trim() === '*');
}

async function handle(store, request, response) {
  const { pathname } = new URL(request.url ?? '/', 'http://settings.invalid');
  const method = request.method ?? 'GET';

  if (pathname === `${PREFIX}/healthz`) {
    if (method !== 'GET') throw new HttpError(405, 'use GET', { Allow: 'GET' });
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('ok\n');
    return;
  }

  if (pathname === PREFIX) {
    if (method !== 'GET') throw new HttpError(405, 'use GET', { Allow: 'GET' });
    const user = userOf(request);
    const { rev, entries } = store.read(user);
    const etag = `"${rev}"`;
    if (etagMatches(request.headers['if-none-match'], etag)) {
      response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    sendJson(response, 200, { user, rev, entries }, { ETag: etag });
    return;
  }

  if (pathname.startsWith(`${PREFIX}/`)) {
    const key = pathname.slice(PREFIX.length + 1);
    if (key.includes('/')) throw new HttpError(404, 'unknown path');
    if (method !== 'PUT') throw new HttpError(405, 'use PUT', { Allow: 'PUT' });
    if (!KEY_PATTERN.test(key)) {
      throw new HttpError(400, 'the key must match ^[A-Za-z0-9._-]{1,128}$');
    }
    const { value, baseRev } = parsePutBody(await readBody(request));
    const result = store.write(userOf(request), key, value, baseRev);
    if (result.ok) sendJson(response, 200, { rev: result.rev });
    else sendJson(response, 409, { rev: result.rev, value: result.value });
    return;
  }

  throw new HttpError(404, 'unknown path');
}

/**
 * Builds the settings server on the SQLite file at dbPath. listen() resolves
 * with the bound address; close() stops the server and closes the database.
 */
export function createSettingsServer({ dbPath }) {
  const store = openStore(dbPath);
  const server = createServer((request, response) => {
    handle(store, request, response).catch((error) => {
      if (error instanceof HttpError) {
        // Discard the rest of an unread body, so the client can finish
        // sending and reads the answer instead of a connection reset.
        request.resume();
        sendError(response, error.status, error.message, error.headers);
        return;
      }
      console.error('[panda-settings] request failed', error);
      if (!response.headersSent) sendError(response, 500, 'internal error');
      else response.destroy();
    });
  });

  return {
    server,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          store.close();
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const dbPath = process.env.PANDA_SETTINGS_DB || '/data/settings.sqlite';
  const port = Number(process.env.PANDA_SETTINGS_PORT || 8531);
  const host = process.env.PANDA_SETTINGS_BIND || '0.0.0.0';
  const settings = createSettingsServer({ dbPath });
  const address = await settings.listen(port, host);
  console.log(`[panda-settings] listening on ${address.address}:${address.port}, database ${dbPath}`);
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[panda-settings] ${signal}: closing`);
    settings.close().then(
      () => process.exit(0),
      (error) => {
        console.error('[panda-settings] close failed', error);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
