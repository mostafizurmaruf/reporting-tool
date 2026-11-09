/* ===== GitHub: commits of the Reporting Date ===== */
const GH_KEY = 'versatilo-github';
const ghStore = {
  get() { try { return JSON.parse(localStorage.getItem(GH_KEY) || '{}'); } catch { return {}; } },
  set(v) { try { v.token || v.user ? localStorage.setItem(GH_KEY, JSON.stringify(v)) : localStorage.removeItem(GH_KEY); } catch {} },
};
{ const g = ghStore.get(); $('ghUser').value = g.user || ''; $('ghToken').value = g.token || ''; }

async function gh(path, token) {
  let res;
  try {
    res = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  } catch { throw new Error('Could not reach GitHub. Check your internet connection.'); }
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('GitHub rejected the token. Check it and save again.');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached' + (token ? '' : ' – add a token') + '. Try again in a minute.');
  if (!res.ok) throw new Error('GitHub error: ' + (d.message || res.statusText));
  return d;
}
// Run fn over items, at most `limit` at a time
async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
async function ghql(query, token) {
  let res;
  try {
    res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  } catch { throw new Error('Could not reach GitHub. Check your internet connection.'); }
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('GitHub rejected the token. Check it and save again.');
  if (!res.ok || !d.data) throw new Error('GitHub GraphQL error: ' + (d.errors?.[0]?.message || d.message || res.statusText));
  if (d.errors?.some(e => e.type === 'RATE_LIMITED')) throw new Error('GitHub rate limit reached. Try again in a minute.');
  return d.data;   // repos without access come back as null (with a NOT_FOUND / FORBIDDEN error) – skipped
}
// Up to 100 most recently updated branches of one repo, each with its commits since `from`
const ghqlRepo = (full, i, from) => {
  const [owner, name] = full.split('/');
  return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    refs(refPrefix: "refs/heads/", first: 100, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) { nodes { name target { ... on Commit {
      history(first: 100, since: ${JSON.stringify(from)}) { pageInfo { hasNextPage } nodes { oid message url authoredDate author { email name user { login } } committer { user { login } } } }
    } } } } }`;
};
// Same day + account fetched again within 3 minutes (e.g. Fetch, then Copy) → reuse the result
let ghCache = null;
async function fetchCommits(live) {
  const key = () => [$('ghUser').value.trim(), $('ghToken').value.trim(), $('repDate').value || today()].join('\n');
  if (!live && ghCache && ghCache.keys.includes(key()) && Date.now() - ghCache.at < 180000) return ghCache.result;
  const before = key(), result = await fetchCommitsLive();
  ghCache = { keys: [before, key()], at: Date.now(), result };   // username may have been filled in from the token
  return result;
}
async function fetchCommitsLive() {
  const token = $('ghToken').value.trim();
  let user = $('ghUser').value.trim();
  if (!user && !token) throw new Error('Enter your GitHub username or token in ⚙ Settings first.');
  if (!user) { user = (await gh('/user', token)).login; $('ghUser').value = user; }
  // Whole Reporting Date in this computer's time zone
  const day = $('repDate').value || today();
  const off = -new Date(day + 'T12:00').getTimezoneOffset(), sg = off < 0 ? '-' : '+', a = Math.abs(off);
  const tz = sg + String(a / 60 | 0).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  const from = `${day}T00:00:00${tz}`, to = `${day}T23:59:59${tz}`;
  const t0 = Date.parse(from), t1 = Date.parse(to);
  const found = [];   // { sha, msg, repo, url, date }

  // Everything below that doesn't depend on each other runs at the same time
  $('status').textContent = 'Fetching commits from GitHub… (checking all branches)';
  const repos = new Map();        // full_name -> name
  const branchesOf = new Map();   // full_name -> Set of branch names from push events
  const addBr = (full, br) => { if (!branchesOf.has(full)) branchesOf.set(full, new Set()); if (br) branchesOf.get(full).add(br); };
  const me = user.toLowerCase(), emails = new Set(), names = new Set();
  const items = [];

  // 1) Commit search – fast, but GitHub only indexes each repo's default branch
  const search = async () => {
    const q = `author:${user} author-date:${from}..${to}`;
    for (let page = 1; page <= 5; page++) {
      const d = await gh(`/search/commits?q=${encodeURIComponent(q)}&sort=author-date&order=asc&per_page=100&page=${page}`, token);
      items.push(...(d.items || []));
      if (items.length >= d.total_count || !(d.items || []).length) break;
    }
  };
  // Who counts as "me": GitHub login, plus commit e-mails / name (for commits whose e-mail isn't linked to the account)
  const who = async () => {
    try {
      const u = await gh(`/users/${encodeURIComponent(user)}`, token);
      if (u.name) names.add(u.name.toLowerCase());
      if (u.email) emails.add(u.email.toLowerCase());
      emails.add(`${u.id}+${me}@users.noreply.github.com`); emails.add(`${me}@users.noreply.github.com`);
    } catch {}
    if (token) try { for (const e of await gh('/user/emails', token)) emails.add(e.email.toLowerCase()); } catch {}   // needs user:email scope – optional
  };
  // 2) Repos + branches to scan: from the activity feed (every branch pushed to, also without a token) …
  const feed = async () => {
    for (let page = 1; page <= 3; page++) {
      let ev;
      try { ev = await gh(`/users/${encodeURIComponent(user)}/events?per_page=100&page=${page}`, token); } catch { break; }
      let older = false;
      for (const e of ev) {
        if (Date.parse(e.created_at) < t0) { older = true; break; }
        const full = e.repo?.name; if (!full) continue;
        repos.set(full, full.split('/').pop());
        if (e.type === 'PushEvent' && e.payload?.ref?.startsWith('refs/heads/')) addBr(full, e.payload.ref.slice(11));
        if (e.type === 'CreateEvent' && e.payload?.ref_type === 'branch') addBr(full, e.payload.ref);
        if (e.type === 'PullRequestEvent' && e.payload?.pull_request?.head?.repo) { const h = e.payload.pull_request.head; repos.set(h.repo.full_name, h.repo.name); addBr(h.repo.full_name, h.ref); }
      }
      if (older || ev.length < 100) break;
    }
  };
  // … and, with a token, every repo the token can see that was pushed to since that day
  const ownRepos = async () => {
    if (!token) return;
    for (let page = 1; page <= 5; page++) {
      const list = await gh(`/user/repos?sort=pushed&direction=desc&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`, token);
      let older = false;
      for (const r of list) { if (Date.parse(r.pushed_at) < t0) { older = true; break; } repos.set(r.full_name, r.name); }
      if (older || list.length < 100) break;
    }
  };
  await Promise.all([search(), who(), feed(), ownRepos()]);
  for (const it of items) {
    found.push({ sha: it.sha, msg: it.commit?.message || '', repo: it.repository?.name || '', url: it.html_url, date: it.commit?.author?.date });
    if (it.repository?.full_name) repos.set(it.repository.full_name, it.repository.name);
    if (it.author?.login?.toLowerCase() === me && it.commit?.author?.email) emails.add(it.commit.author.email.toLowerCase());
  }
  const mine = c => c.author?.login?.toLowerCase() === me || c.committer?.login?.toLowerCase() === me ||
    emails.has((c.commit?.author?.email || '').toLowerCase()) || names.has((c.commit?.author?.name || '').toLowerCase());

  // 3) Scan the branches. REST: one request per branch (slow, used without a token or as a fallback).
  let failed = 0;
  const restRepo = async ([full, name], only) => {
    let branches = only || [...(branchesOf.get(full) || [])];
    if (token && !only) try {   // all branches (with a token there is enough rate limit for this)
      const all = [];
      for (let page = 1; page <= 3; page++) {
        const b = await gh(`/repos/${full}/branches?per_page=100&page=${page}`, token);
        all.push(...b.map(x => x.name)); if (b.length < 100) break;
      }
      branches = [...new Set([...branches, ...all])];
    } catch { if (!branches.length) { failed++; return; } }   // no access / empty repo
    if (!branches.length) branches = [undefined];   // default branch
    await pool(branches, 6, async br => {
      try {
        // no author / until filter on purpose: commits under an unlinked e-mail, or rebased later, are matched below
        for (let page = 1; page <= 3; page++) {
          const cs = await gh(`/repos/${full}/commits?${br ? 'sha=' + encodeURIComponent(br) + '&' : ''}since=${encodeURIComponent(from)}&per_page=100&page=${page}`, token);
          for (const c of cs) if (mine(c)) found.push({ sha: c.sha, msg: c.commit?.message || '', repo: name, url: c.html_url, date: c.commit?.author?.date });
          if (cs.length < 100) break;
        }
      } catch (e) { if (/rate limit/i.test(e.message)) failed++; }
    });
  };
  let rest = [...repos];
  if (token && rest.length) {
    // GraphQL: the commits of all branches of 5 repos in ONE request (fast)
    const batches = []; for (let i = 0; i < rest.length; i += 5) batches.push(rest.slice(i, i + 5));
    rest = [];
    const again = [];   // branches with more than 100 commits since that day → finish with REST
    await pool(batches, 4, async batch => {
      let d;
      try { d = await ghql(`{${batch.map(([full], i) => ghqlRepo(full, i, from)).join('\n')}}`, token); }
      catch (e) { if (/rejected the token/.test(e.message)) throw e; rest.push(...batch); return; }   // GraphQL failed → REST for this batch
      batch.forEach(([full, name], i) => {
        const r = d[`r${i}`]; if (!r) return;   // no access / deleted
        const cut = [];
        for (const ref of r.refs?.nodes || []) {
          const h = ref.target?.history; if (!h) continue;
          for (const n of h.nodes || []) {
            const c = { author: { login: n.author?.user?.login }, committer: { login: n.committer?.user?.login }, commit: { author: { email: n.author?.email, name: n.author?.name } } };
            if (mine(c)) found.push({ sha: n.oid, msg: n.message || '', repo: name, url: n.url, date: n.authoredDate });
          }
          if (h.pageInfo?.hasNextPage) cut.push(ref.name);
        }
        if (cut.length) again.push([[full, name], cut]);
      });
    });
    await pool(again, 4, ([r, br]) => restRepo(r, br));
  }
  await pool(rest, 6, r => restRepo(r));
  // Oldest first; keep only commits authored on that day
  found.sort((x, y) => Date.parse(x.date || 0) - Date.parse(y.date || 0));
  const seen = new Set(), out = [];
  for (const c of found) {
    const t = Date.parse(c.date || '');
    if (t && (t < t0 || t > t1 + 999)) continue;
    const msg = c.msg.split('\n')[0].trim();
    if (!msg || /^Merge (pull request|branch|remote-tracking)/i.test(msg)) continue;
    const k = c.repo + '\n' + msg.toLowerCase();
    if (seen.has(k) || seen.has(c.sha)) continue;   // same commit on several branches / in a fork, or repeated message
    seen.add(k); seen.add(c.sha);
    out.push({ task: msg, repo: c.repo, url: c.url });
  }
  return { day, user, commits: out, failed };
}
function commitsText(commits) {
  const byRepo = new Map();
  commits.forEach(c => { if (!byRepo.has(c.repo)) byRepo.set(c.repo, []); byRepo.get(c.repo).push(c); });
  return [...byRepo].map(([repo, list]) =>
    `Project : ${repo}\n\nCommit Name :\n${list.map((c, i) => `${i + 1}. ${c.task}`).join('\n')}\n\nCommit Link :\n${list.map((c, i) => `${i + 1}. ${c.url}`).join('\n')}`
  ).join('\n\n');
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove();
  if (!ok) throw new Error('Copy was blocked by the browser.');
}
const warn = n => n ? ` (${n} repo/branch checks skipped – GitHub rate limit${$('ghToken').value.trim() ? '' : '; add a token in ⚙ Settings'})` : '';
