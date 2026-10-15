/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
 * Text-contrast audit of the running app, in headless Chrome.
 *
 * Start the dev server (yarn dev), then:
 *     node scripts/contrast-audit.cjs                  # every /wallet page
 *     node scripts/contrast-audit.cjs out.json /wallet/xbridge /wallet/swap
 *     NO_LOGIN=1 node scripts/contrast-audit.cjs out.json / /access /create
 *
 * For each page it finds every visible element with text and computes the
 * contrast of its text colour against its effective background (walking up
 * through transparent parents), and lists everything under 3:1 — the
 * "dark text on a dark background" class of bug. Exits 1 if anything is found.
 *
 * Signs in with a freshly generated, throwaway private key (never a real
 * wallet), and answers the Moats burn check inside this headless browser only,
 * so premium-gated pages render their results. Nothing is signed or sent.
 * Env: AUDIT_BASE (default http://localhost:5000), CHROME (path to Chrome),
 * AUDIT_ACTION (JavaScript run in each page before measuring, to open UI
 * that only appears after a click, e.g. a tab or a toggle).
 */
const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BASE = process.env.AUDIT_BASE || 'http://localhost:5000'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const OUT = process.argv[2] || path.join(__dirname, '..', 'tmp', 'contrast-report.json')
const DEFAULT_PAGES = [
    '/wallet', '/wallet/transfer', '/wallet/cross_chain', '/wallet/earn', '/wallet/advanced', '/wallet/activity',
    '/wallet/addresses', '/wallet/broadcast', '/wallet/quickdelegate', '/wallet/restake', '/wallet/phar/dashboard',
    '/wallet/phar/swap', '/wallet/wizard', '/wallet/unifychains', '/wallet/launcher', '/wallet/swap', '/wallet/moats/burn',
    '/wallet/moats/stake', '/wallet/moats/lock', '/wallet/moats/dashboard', '/wallet/config', '/wallet/iceberg',
    '/wallet/limit', '/wallet/avxto', '/wallet/xbridge', '/wallet/scripts', '/wallet/btcswap', '/wallet/psat',
    '/wallet/log', '/wallet/soladdr', '/wallet/btcderive', '/wallet/keys',
    '/wallet/xexplorer?q=2iuPX79DMihinfRMuwU2JMZBsFZa7TF4gEPn6JJDjab5VrEq7E',
    '/wallet/xexplorer?q=X-avax102hddvy5ml8efjhjrfkev08m94g0tyqnntcf83',
]
const PAGES = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_PAGES

const MOATS = '0xebe5fbacb882fd313d05684bef591c31f83b0524'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Runs in the page: every visible element with its own text, below 3:1.
const AUDIT = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return [0,0,0,0]; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p.length>3?p[3]:1] }
  const lum = ([r,g,b]) => { const f = (v) => { v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4) }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b) }
  const over = (top, bottom) => { const a = top[3]; return [top[0]*a+bottom[0]*(1-a), top[1]*a+bottom[1]*(1-a), top[2]*a+bottom[2]*(1-a), 1] }
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('linear-gradient')) return null; const c = parse(s.backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break } } let acc = [255,255,255,1]; for (let i = layers.length-1; i>=0; i--) acc = over(layers[i], acc); return acc }
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT','STYLE','NOSCRIPT','svg','path','OPTION'].includes(el.tagName)) continue
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim()
    const isField = (el.tagName === 'INPUT' && !['checkbox','radio','hidden','range','color'].includes(el.type)) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    const text = isField ? (el.value || el.placeholder || '') : own
    if (!text) continue
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el)
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue
    let hidden = false; for (let e = el; e; e = e.parentElement) { const st = getComputedStyle(e); if (st.display === 'none' || Number(st.opacity) === 0 || st.visibility === 'hidden') { hidden = true; break } } if (hidden) continue
    const bg = bgOf(el); if (!bg) continue
    // Faded ancestors (opacity < 1) fade the text into what is behind it.
    let fade = 1; for (let e = el; e; e = e.parentElement) fade *= Number(getComputedStyle(e).opacity)
    const raw = parse(isField && !el.value ? (getComputedStyle(el, '::placeholder').color || s.color) : s.color)
    const fg = over([raw[0], raw[1], raw[2], raw[3] * fade], bg)
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05)
    if (ratio < 3) {
      const cls = (el.getAttribute('class') || '').split(/\\s+/).filter(c => c && !c.startsWith('data-v')).slice(0,4).join('.')
      let pth = []; for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) { const c = (e.getAttribute('class')||'').split(/\\s+/).filter(Boolean)[0]; pth.unshift(e.tagName.toLowerCase() + (c ? '.' + c : '')) }
      out.push({ tag: el.tagName.toLowerCase(), cls, path: pth.join(' > '), text: text.slice(0, 60), color: s.color, bg: 'rgb(' + bg.slice(0,3).map(Math.round).join(',') + ')', ratio: Math.round(ratio*100)/100 })
    }
  }
  return out
})()`

;(async () => {
    const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'contrast-audit-chrome-'))
    const chrome = spawn(CHROME, [
        '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,900',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--renderer-process-limit=2',
    ], { stdio: 'ignore' })
    let ws
    try {
        let target
        for (let i = 0; i < 40 && !target; i++) {
            await sleep(250)
            try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json() } catch {}
        }
        ws = new WebSocket(target.webSocketDebuggerUrl)
        await new Promise((r) => ws.on('open', r))
        let id = 0
        const pending = new Map()
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw)
            if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
            if (msg.method === 'Fetch.requestPaused') onPaused(msg.params)
        })
        const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
        const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

        // Answer the Moats userInfo() call: 2,000,000 AVXTO burned.
        const word = (n) => BigInt(n).toString(16).padStart(64, '0')
        const fakeUserInfo = '0x' + word(0) + word(2000000n * 10n ** 18n) + word(0) + word(0) + word(0)
        function onPaused({ requestId, request }) {
            const body = request.postData || ''
            if (body.toLowerCase().includes(MOATS) && body.includes('eth_call')) {
                let reqs
                try { reqs = JSON.parse(body) } catch { reqs = null }
                const one = (q) => ({ jsonrpc: '2.0', id: q.id, result: fakeUserInfo })
                if (reqs) {
                    const resp = Array.isArray(reqs) ? reqs.map(one) : one(reqs)
                    return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(resp)).toString('base64') })
                }
            }
            send('Fetch.continueRequest', { requestId })
        }

        await send('Page.enable')
        await send('Runtime.enable')
        await send('Fetch.enable', { patterns: [{ urlPattern: '*/ext/bc/C/rpc*', requestStage: 'Request' }, { urlPattern: '*rpc*', requestStage: 'Request' }] })
        const go = async (url, wait = 4000) => { await send('Page.navigate', { url }); await sleep(wait) }

        // Sign in with a throwaway key.
        let signedIn = process.env.NO_LOGIN ? '/wallet' : ''
        for (let attempt = 1; attempt <= 3 && signedIn !== '/wallet'; attempt++) {
        await go(`${BASE}/access/privatekey`, 3000)
        const hex = crypto.randomBytes(32).toString('hex')
        signedIn = await evaluate(`(async () => {
            for (let i = 0; i < 60 && document.querySelectorAll('input[type=password]').length < 2; i++) await new Promise(r => setTimeout(r, 500));
            const inputs = Array.from(document.querySelectorAll('input'));
            const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) };
            const pw = inputs.filter(i => i.type === 'password');
            const keyIn = inputs.find(i => i.type !== 'password') || pw[0];
            set(keyIn, '${hex}');
            pw.filter(i => i !== keyIn).forEach(i => set(i, 'audit-password-123'));
            await new Promise(r => setTimeout(r, 300));
            const btn = Array.from(document.querySelectorAll('button')).find(b => /access|unlock|open/i.test(b.textContent));
            btn && btn.click();
            for (let i = 0; i < 40 && location.pathname !== '/wallet'; i++) await new Promise(r => setTimeout(r, 500));
            return location.pathname;
        })()`)
        console.log(`sign-in attempt ${attempt} →`, signedIn)
        }
        if (signedIn !== '/wallet') throw new Error('Could not sign in; audit aborted.')

        const report = {}
        for (const p of PAGES) {
            // In-app navigation keeps the session (a full reload would sign out).
            if (process.env.NO_LOGIN) await go(BASE + p, 6000)
            else {
                await evaluate(`(() => { const app = document.querySelector('#app').__vue_app__; app.config.globalProperties.$router.push(${JSON.stringify(p)}); })()`)
                await sleep(p.includes('xexplorer') ? 9000 : 3500)
            }
            if (process.env.AUDIT_ACTION) {
                await evaluate(`(async () => { ${process.env.AUDIT_ACTION} })()`)
                await sleep(2500)
            }
            const where = await evaluate('location.pathname + location.search')
            const issues = (await evaluate(AUDIT)) || []
            report[p] = { where, issues }
            console.log(`${issues.length.toString().padStart(3)}  ${p}${where !== p ? `  (landed on ${where})` : ''}`)
        }
        fs.mkdirSync(path.dirname(OUT), { recursive: true })
        fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
        const total = Object.values(report).reduce((n, r) => n + r.issues.length, 0)
        for (const [p, r] of Object.entries(report)) for (const i of r.issues) console.log(`  ${p}  ${i.ratio}:1  ${i.path}  "${i.text}"  ${i.color} on ${i.bg}`)
        console.log(total ? `${total} low-contrast element(s). Report: ${OUT}` : `No low-contrast text on ${Object.keys(report).length} page(s).`)
        process.exitCode = total ? 1 : 0
    } finally {
        try { ws && ws.close() } catch {}
        chrome.kill()
        await sleep(500)
        fs.rmSync(profile, { recursive: true, force: true })
    }
})().catch((e) => { console.error(e); process.exit(1) })
