#!/usr/bin/env node
'use strict';

/**
 * postorizon — standalone CLI for the Postorizon public API.
 *
 * Zero dependencies: plain Node >= 18 (global fetch).
 *
 * Environment:
 *   POSTORIZON_API_KEY  API key from Postorizon Settings > Public API (required
 *                       for commands that call the API).
 *   POSTORIZON_API_URL  API base URL (default https://api.postorizon.com).
 *                       Point it at a self-hosted instance if needed; the
 *                       /public/v1 prefix is added by the CLI.
 *
 * Commands:
 *   postorizon posts:create --text "Hello" --integration <channel-id> [--date <ISO>] [--type draft|schedule|now]
 *   postorizon posts:list [--from <ISO date>] [--to <ISO date>] [--customer <id>]
 *   postorizon auth:login   (explains how to configure your API key)
 *   postorizon --help
 */

const API_BASE = (
  process.env.POSTORIZON_API_URL || 'https://api.postorizon.com'
).replace(/\/+$/, '');
const API_KEY = process.env.POSTORIZON_API_KEY || '';

const HELP = `postorizon — Postorizon public API CLI

Usage:
  postorizon posts:create --text <text> --integration <id> [--integration <id> ...]
                          [--date <ISO 8601>] [--type draft|schedule|now] [--shortlink]
  postorizon posts:list [--from <ISO 8601>] [--to <ISO 8601>] [--customer <id>]
  postorizon auth:login
  postorizon --help

Commands:
  posts:create   Create a post. --text is required, and at least one
                 --integration (a connected channel id) is required.
                 Without --date the post is saved as a draft; with --date it
                 is scheduled for that time (UTC if no offset is given).
                 --type overrides that behaviour (draft | schedule | now).
  posts:list     List posts in a date window. Defaults: from 7 days ago to
                 30 days from now.
  auth:login     Show how to configure API access (no network call).

Environment:
  POSTORIZON_API_KEY  Your API key (Settings > Public API in Postorizon).
  POSTORIZON_API_URL  API base URL. Default: https://api.postorizon.com

Examples:
  postorizon posts:create --text "Hello from Postorizon" --integration abc123
  postorizon posts:create --text "Launching tomorrow" --integration abc123 \\
      --date 2026-12-01T09:00:00Z
  postorizon posts:list --from 2026-11-01 --to 2026-11-30
`;

const BOOLEAN_FLAGS = new Set(['shortlink', 'help', 'h']);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      let value;
      if (eq !== -1) {
        value = a.slice(eq + 1);
      } else if (
        !BOOLEAN_FLAGS.has(key) &&
        i + 1 < argv.length &&
        !argv[i + 1].startsWith('-')
      ) {
        value = argv[++i];
      } else {
        value = true;
      }
      if (flags[key] === undefined) flags[key] = value;
      else if (Array.isArray(flags[key])) flags[key].push(value);
      else flags[key] = [flags[key], value];
    } else if (a.startsWith('-') && a.length > 1 && positional.length === 0) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function asArray(v) {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function takeValue(flags, name) {
  return flags[name];
}

function fail(message, code) {
  console.error('Error: ' + message);
  process.exit(code || 1);
}

function requireApiKey() {
  if (!API_KEY) {
    fail(
      'POSTORIZON_API_KEY is not set. Create an API key in Postorizon ' +
        '(Settings > Public API) and export it:\n  export POSTORIZON_API_KEY="your-key"',
      2
    );
  }
}

async function api(path, options) {
  requireApiKey();
  let res;
  try {
    res = await fetch(API_BASE + '/public/v1' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: API_KEY,
        ...(options && options.headers),
      },
    });
  } catch (err) {
    fail(`Could not reach ${API_BASE}: ${err.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    fail(
      `API returned ${res.status} ${res.statusText}: ${
        typeof body === 'string' ? body : JSON.stringify(body)
      }`
    );
  }
  return body;
}

function toIso(value, flagName) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    fail(`--${flagName} is not a valid date: ${value}`);
  }
  return d.toISOString();
}

async function postsCreate(flags) {
  const text = takeValue(flags, 'text');
  if (!text || typeof text !== 'string') {
    fail('posts:create requires --text "..."');
  }
  const integrations = asArray(takeValue(flags, 'integration')).filter(
    (v) => typeof v === 'string'
  );
  if (integrations.length === 0) {
    fail(
      'posts:create requires at least one --integration <channel-id> ' +
        '(the id of a connected channel; see Settings or the API to list them).'
    );
  }
  const date = flags.date ? toIso(flags.date, 'date') : new Date().toISOString();
  let type = takeValue(flags, 'type');
  if (type === undefined || type === true) {
    type = flags.date ? 'schedule' : 'draft';
  }
  if (!['draft', 'schedule', 'now'].includes(type)) {
    fail(`--type must be one of draft, schedule, now (got: ${type})`);
  }
  const payload = {
    type,
    shortLink: !!flags.shortlink,
    date,
    tags: [],
    posts: integrations.map((id) => ({
      integration: { id },
      value: [{ content: text, image: [] }],
    })),
  };
  const result = await api('/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  console.log(JSON.stringify(result, null, 2));
}

function summarizePost(p) {
  const integration =
    (p.integration && (p.integration.name || p.integration.id)) ||
    p.integrationId ||
    '';
  const content =
    (Array.isArray(p.value) &&
      p.value[0] &&
      (p.value[0].content || '')) ||
    p.content ||
    '';
  const when = p.publishDate || p.date || p.createdAt || '';
  const state = p.state || p.type || '';
  return { id: p.id || '', when, state, integration, content };
}

async function postsList(flags) {
  const now = Date.now();
  const from = flags.from
    ? toIso(flags.from, 'from')
    : new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const to = flags.to
    ? toIso(flags.to, 'to')
    : new Date(now + 30 * 24 * 3600 * 1000).toISOString();
  const params = new URLSearchParams({ startDate: from, endDate: to });
  if (typeof flags.customer === 'string') {
    params.set('customer', flags.customer);
  }
  const result = await api('/posts?' + params.toString(), { method: 'GET' });
  const list = Array.isArray(result)
    ? result
    : Array.isArray(result && result.posts)
    ? result.posts
    : null;
  if (!list) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (list.length === 0) {
    console.log('No posts in that window.');
    return;
  }
  for (const p of list) {
    const s = summarizePost(p);
    const preview = String(s.content).replace(/\s+/g, ' ').slice(0, 60);
    console.log(
      `${s.id}\t${s.when}\t${s.state}\t${s.integration}\t${preview}`
    );
  }
}

function authLogin() {
  console.log(`This CLI uses an API key instead of an interactive login.

1. In Postorizon, open Settings > Public API and create an API key.
2. Export it in your shell:

     export POSTORIZON_API_KEY="your-key"

3. (Self-hosted only) Point the CLI at your instance:

     export POSTORIZON_API_URL="https://your-instance.example.com"

Then run: postorizon posts:list`);
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const command = positional[0];

  if (!command || flags.help || flags.h || command === 'help') {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'posts:create':
      await postsCreate(flags);
      break;
    case 'posts:list':
      await postsList(flags);
      break;
    case 'auth:login':
      authLogin();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
