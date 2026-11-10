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

const GoogleAuth = (() => {
  const TOKEN_KEY = 'versatilo-gdoc-token';   // localStorage: token, valid ~1 hour, so reloads don't ask again
  let gisReady = null, tokenClient = null, pending = null;
  const load = () => gisReady ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gisReady = null; s.remove(); rej(new Error('Could not load Google sign-in. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  const saved = () => {
    try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); return t && t.exp > Date.now() + 60000 && t.scope === GOOGLE_SCOPE ? t.value : ''; } catch { return ''; }
  };
  const save = (value, secs) => { try { value ? localStorage.setItem(TOKEN_KEY, JSON.stringify({ value, scope: GOOGLE_SCOPE, exp: Date.now() + secs * 1000 })) : localStorage.removeItem(TOKEN_KEY); } catch {} };
  // Must be called straight from the click (before any await), or the browser blocks the Google popup
  function request() {
    return new Promise((resolve, reject) => {
      const ask = () => {
        tokenClient ||= google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPE,
          callback: r => {
            const p = pending; pending = null;
            if (r.error) return p?.reject(new Error('Google sign-in failed: ' + (r.error_description || r.error)));
            // The consent screen lets people untick a permission – then ask again next time
            if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...GOOGLE_SCOPE.split(' '))) return p?.reject(new Error('Please allow every permission on the Google sign-in screen (Docs, Sheets and Drive files), then try again.'));
            save(r.access_token, +r.expires_in || 3600); p?.resolve(r.access_token);
          },
          error_callback: e => { const p = pending; pending = null; p?.reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked the Google sign-in popup – allow popups for this site and try again.' : 'Google sign-in failed.')); },
        });
        pending = { resolve, reject };
        tokenClient.requestAccessToken({ prompt: '' });
      };
      if (window.google?.accounts?.oauth2) ask(); else load().then(ask, reject);
    });
  }
  // Saved token, or the sign-in popup. Call it synchronously inside the click handler.
  const token = () => { const t = saved(); return t ? Promise.resolve(t) : request(); };

  // fetch() a Google API with the token → parsed JSON (or the raw Response when raw = true).
  // A 401 / missing scope clears the saved token and throws an error with .expired = true.
  async function api(url, tok, what, opts = {}, raw = false) {
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + tok } }); }
    catch { throw new Error(`Could not reach Google ${what}. Check your internet connection.`); }
    if (raw && res.ok) return res;
    const d = await res.json().catch(() => ({})), msg = d.error?.message || '';
    if (res.status === 401) { save(''); const e = new Error('Google sign-in expired.'); e.expired = true; throw e; }
    if (res.status === 403 && /insufficient.*(scope|permission)/i.test(msg)) { save(''); const e = new Error('Google needs your permission again.'); e.expired = true; throw e; }
    if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error(`Google ${what} API is not enabled in the Google Cloud project.`);
    if (res.status === 403) { const e = new Error(msg || 'This Google account cannot open it.'); e.status = 403; throw e; }
    if (res.status === 404) { const e = new Error('not found'); e.status = 404; throw e; }
    if (!res.ok) throw new Error(`Google ${what} error: ` + (msg || res.statusText));
    return d;
  }

  return { load, token, api, hasToken: () => !!saved() };
})();
