/* =====================================================================
   Google sign-in shared by "⬇ Fetch Google Doc" (gdocs.js) and
   the Drive copies of downloads (drive.js) and the History page (history.js).
   One token covers all three scopes, so the user signs in once.
   ===================================================================== */
// One OAuth Client ID for the whole team (public – it is not a secret).
// Allowed origin in Google Cloud Console: https://mostafizurmaruf.github.io
const GOOGLE_CLIENT_ID = '975024824259-ls19abs6381348d0n3ddf6tkb8r0picp.apps.googleusercontent.com';
// drive.file = only the files this app creates (the saved report PDFs) – nothing else in the user's Drive
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/documents.readonly https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file';
// Client secret of the same OAuth client (Google Cloud Console → Credentials → the Web client → "GOCSPX-…").
// When set, sign-in uses the code flow and keeps a refresh token, so the user signs in ONCE and new
// 1-hour access tokens are fetched silently.
// NOT stored in the repo: the deploy workflow (.github/workflows/pages.yml) swaps the placeholder below
// for the GOOGLE_CLIENT_SECRET repository secret. Locally it stays a placeholder → old behaviour (popup every hour).
const GOOGLE_CLIENT_SECRET = (s => s.startsWith('__') ? '' : s)('__GOOGLE_CLIENT_SECRET__');

const GoogleAuth = (() => {
  const TOKEN_KEY = 'versatilo-gdoc-token';     // localStorage: access token, valid ~1 hour, so reloads don't ask again
  const REFRESH_KEY = 'versatilo-gdoc-refresh'; // localStorage: refresh token (only with GOOGLE_CLIENT_SECRET) – lasts until revoked
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  let gisReady = null, tokenClient = null, codeClient = null, pending = null, refreshing = null;
  const load = () => gisReady ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gisReady = null; s.remove(); rej(new Error('Could not load Google sign-in. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  const read = k => { try { const t = JSON.parse(localStorage.getItem(k) || 'null'); return t && t.scope === GOOGLE_SCOPE ? t : null; } catch { return null; } };
  const saved = () => { const t = read(TOKEN_KEY); return t && t.exp > Date.now() + 60000 ? t.value : ''; };
  const save = (value, secs) => { try { value ? localStorage.setItem(TOKEN_KEY, JSON.stringify({ value, scope: GOOGLE_SCOPE, exp: Date.now() + secs * 1000 })) : localStorage.removeItem(TOKEN_KEY); } catch {} };
  const savedRefresh = () => GOOGLE_CLIENT_SECRET ? read(REFRESH_KEY)?.value || '' : '';
  const saveRefresh = value => { try { value ? localStorage.setItem(REFRESH_KEY, JSON.stringify({ value, scope: GOOGLE_SCOPE })) : localStorage.removeItem(REFRESH_KEY); } catch {} };
  const expiredErr = msg => { const e = new Error(msg); e.expired = true; return e; };

  // POST to Google's token endpoint (code → tokens, or refresh token → new access token)
  async function tokenCall(params) {
    let res;
    try { res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, ...params }) }); }
    catch { throw new Error('Could not reach Google sign-in. Check your internet connection.'); }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error('Google sign-in failed: ' + (d.error_description || d.error || res.statusText)); e.code = d.error; throw e; }
    return d;
  }
  // Silent renewal – no popup, so it may run after an await
  const refresh = () => refreshing ||= tokenCall({ grant_type: 'refresh_token', refresh_token: savedRefresh() })
    .then(d => { save(d.access_token, +d.expires_in || 3600); return d.access_token; })
    .catch(e => {
      if (e.code === 'invalid_grant' || e.code === 'unauthorized_client') { saveRefresh(''); throw expiredErr('Google sign-in expired.'); }
      throw e;
    })
    .finally(() => { refreshing = null; });

  const popupError = e => new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked the Google sign-in popup – allow popups for this site and try again.' : 'Google sign-in failed.');
  const settle = (fn, v) => { const p = pending; pending = null; p?.[fn](v); };
  const allScopes = r => google.accounts.oauth2.hasGrantedAllScopes(r, ...GOOGLE_SCOPE.split(' '));
  const SCOPE_MSG = 'Please allow every permission on the Google sign-in screen (Docs, Sheets and Drive files), then try again.';

  // Code flow: one popup → access token + refresh token
  async function onCode(r) {
    if (r.error) return settle('reject', new Error('Google sign-in failed: ' + (r.error_description || r.error)));
    if (!allScopes(r)) return settle('reject', new Error(SCOPE_MSG));
    try {
      const d = await tokenCall({ grant_type: 'authorization_code', code: r.code, redirect_uri: 'postmessage' });
      save(d.access_token, +d.expires_in || 3600);
      if (d.refresh_token) { saveRefresh(d.refresh_token); return settle('resolve', d.access_token); }
      // Google only hands out a refresh token on a fresh consent. Earlier sign-ins (the hourly flow)
      // already consented, so revoke once and let the next click show the consent screen again.
      const RETRY_KEY = 'versatilo-gdoc-reconsent';
      let tried = false; try { tried = localStorage.getItem(RETRY_KEY) === '1'; localStorage.setItem(RETRY_KEY, '1'); } catch {}
      if (tried) return settle('resolve', d.access_token);   // still none – just use this 1-hour token
      save('');
      google.accounts.oauth2.revoke(d.access_token, () => settle('reject', expiredErr('Setting up permanent Google sign-in.')));
    } catch (e) { settle('reject', e); }
  }

  // Must be called straight from the click (before any await), or the browser blocks the Google popup
  function request() {
    return new Promise((resolve, reject) => {
      const ask = () => {
        pending = { resolve, reject };
        if (GOOGLE_CLIENT_SECRET) {
          codeClient ||= google.accounts.oauth2.initCodeClient({
            client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPE, ux_mode: 'popup',
            callback: onCode, error_callback: e => settle('reject', popupError(e)),
          });
          return codeClient.requestCode();
        }
        tokenClient ||= google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPE,
          callback: r => {
            if (r.error) return settle('reject', new Error('Google sign-in failed: ' + (r.error_description || r.error)));
            // The consent screen lets people untick a permission – then ask again next time
            if (!allScopes(r)) return settle('reject', new Error(SCOPE_MSG));
            save(r.access_token, +r.expires_in || 3600); settle('resolve', r.access_token);
          },
          error_callback: e => settle('reject', popupError(e)),
        });
        tokenClient.requestAccessToken({ prompt: '' });
      };
      if (window.google?.accounts?.oauth2) ask(); else load().then(ask, reject);
    });
  }
  // Saved token, silent refresh, or the sign-in popup. Call it synchronously inside the click handler.
  const token = () => { const t = saved(); return t ? Promise.resolve(t) : savedRefresh() ? refresh() : request(); };

  // fetch() a Google API with the token → parsed JSON (or the raw Response when raw = true).
  // A 401 / missing scope clears the saved token and throws an error with .expired = true.
  async function api(url, tok, what, opts = {}, raw = false) {
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + tok } }); }
    catch { throw new Error(`Could not reach Google ${what}. Check your internet connection.`); }
    if (raw && res.ok) return res;
    const d = await res.json().catch(() => ({})), msg = d.error?.message || '';
    if (res.status === 401) { save(''); throw expiredErr('Google sign-in expired.'); }   // a refresh token (if any) renews it on the next click
    if (res.status === 403 && /insufficient.*(scope|permission)/i.test(msg)) { save(''); saveRefresh(''); throw expiredErr('Google needs your permission again.'); }
    if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error(`Google ${what} API is not enabled in the Google Cloud project.`);
    if (res.status === 403) { const e = new Error(msg || 'This Google account cannot open it.'); e.status = 403; throw e; }
    if (res.status === 404) { const e = new Error('not found'); e.status = 404; throw e; }
    if (!res.ok) throw new Error(`Google ${what} error: ` + (msg || res.statusText));
    return d;
  }

  return { load, token, api, hasToken: () => !!(saved() || savedRefresh()) };
})();
