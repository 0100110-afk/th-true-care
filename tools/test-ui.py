"""Kiểm thử giao diện trong Chromium headless với Firebase GIẢ (thay 3 module gstatic bằng bản giả):
js/app.js THẬT chạy trọn: màn đăng nhập -> kiểm tra quyền care_users -> nạp care_meta + care_chunks
(dữ liệu do tools/test-sync.js dựng bằng Sync.gs thật) -> mở giao diện -> bấm qua mọi trang,
Làm mới dữ liệu, hộp Tài khoản. Bắt mọi lỗi JS.
Chạy: DUMP=/tmp/care-store.json node tools/test-sync.js && STORE=/tmp/care-store.json python3 tools/test-ui.py [thư-mục-ảnh]
(cần: pip install playwright; CHARTJS=đường-dẫn/chart.umd.js nếu muốn vẽ biểu đồ)"""
import os, sys, json, threading, http.server, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = json.load(open(os.environ.get('STORE', '/tmp/care-store.json')))

FAKE_APP = "export function initializeApp(c){ return { c }; }"
FAKE_AUTH = r"""
const S = window.__FAKE;
let cbs = [];
const mkUser = (email) => ({ email, uid: 'u1', providerData: [{ providerId: 'password' }],
  reload: async () => {}, getIdTokenResult: async () => ({ claims: { email_verified: true } }) });
const auth = { get currentUser() { return S.user; } };
export function getAuth(){ return auth; }
export function onAuthStateChanged(a, cb){ cbs.push(cb); setTimeout(() => cb(S.user), 50); }
export class GoogleAuthProvider { setCustomParameters(){} }
export async function signInWithPopup(){ S.user = mkUser(S.loginAs); cbs.forEach((c) => c(S.user)); }
export async function signInWithRedirect(){}
export async function getRedirectResult(){ return null; }
export async function signInWithEmailAndPassword(a, email, pw){
  if (pw !== '123456') { const e = new Error('x'); e.code = 'auth/invalid-credential'; throw e; }
  S.user = mkUser(email); cbs.forEach((c) => c(S.user));
}
export async function sendPasswordResetEmail(){}
export async function signOut(){ S.user = null; }
export const EmailAuthProvider = { credential: () => ({}) };
export async function linkWithPopup(){ return {}; }
export async function linkWithCredential(){}
export async function updatePassword(){}
export async function unlink(){}
export function getAdditionalUserInfo(){ return null; }
"""
FAKE_FS = r"""
const S = window.__FAKE;
export function getFirestore(){ return {}; }
export function doc(db, col, id){ return { path: col + '/' + id }; }
function val(v){ if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue); return null; }
export async function getDoc(ref){
  S.reads.push(ref.path);
  if (ref.path.startsWith('care_users/')) {
    const role = S.users[ref.path.slice(11)];
    return { exists: () => !!role, data: () => ({ role, uid: 'u1' }) };
  }
  const d = S.store[ref.path];
  return { exists: () => !!d, data: () => { const o = {}; Object.keys(d.fields).forEach((k) => { o[k] = val(d.fields[k]); }); return o; } };
}
"""

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
def watch(page, tag):
    page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'[{tag}] console.{m.type}: {m.text}') if m.type == 'error' and 'net::' not in m.text and 'Failed to load resource' not in m.text else None)

def setup(page, user=None, login_as='kt@thmilk.vn'):
    init = 'window.__FAKE = { store: %s, users: %s, user: %s, loginAs: %s, reads: [] };' % (
        json.dumps(STORE), json.dumps({'kt@thmilk.vn': 'user', 'ad@thmilk.vn': 'admin'}),
        'null' if not user else "{ email: '%s', uid: 'u1', providerData: [{ providerId: 'password' }], reload: async () => {}, getIdTokenResult: async () => ({ claims: { email_verified: true } }) }" % user,
        json.dumps(login_as))
    page.add_init_script(init)
    js = lambda body: (lambda r: r.fulfill(status=200, content_type='application/javascript', body=body))
    page.route('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js', js(FAKE_APP))
    page.route('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js', js(FAKE_AUTH))
    page.route('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js', js(FAKE_FS))
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    chart = os.environ.get('CHARTJS')
    page.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=open(chart).read() if chart else ''))

shots = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None)

    # ---- Máy tính: đăng nhập bằng mật khẩu ----
    pg = b.new_page(viewport={'width': 1366, 'height': 900}); watch(pg, 'desktop'); setup(pg)
    pg.goto('http://127.0.0.1:8766/desktop.html')
    pg.wait_for_selector('#tmEmail', timeout=8000)
    pg.screenshot(path=f'{shots}/care-login.png')
    pg.fill('#tmEmail', 'kt@thmilk.vn'); pg.fill('#tmPass', 'sai'); pg.click('#tmSubmit'); pg.wait_for_timeout(300)
    print('sai mật khẩu ->', pg.inner_text('#tmAuthErr'))
    pg.fill('#tmPass', '123456'); pg.click('#tmSubmit')
    pg.wait_for_selector('#tmAuth.hidden', state='attached', timeout=8000)
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{shots}/care-desktop-dashboard.png')
    print('mốc dữ liệu:', pg.inner_text('#dataFreshnessText'))
    for v in ['search', 'batch', 'devicelist', 'rawdata', 'dongia', 'dashboard']:
        pg.click(f'.nav-item[data-page="{v}"]'); pg.wait_for_timeout(600)
    pg.click('.nav-item[data-page="search"]'); pg.fill('#codeInput', 'TC001'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
    pg.screenshot(path=f'{shots}/care-desktop-search.png')
    print('tra cứu có "Cửa hàng A":', 'Cửa hàng A' in pg.inner_text('body'))
    pg.click('.nav-item[data-page="dongia"]'); pg.wait_for_timeout(800)
    pg.screenshot(path=f'{shots}/care-desktop-dongia.png')
    print('đơn giá có "Thay tụ block":', 'Thay tụ block' in pg.inner_text('body'))
    n0 = len(pg.evaluate('window.__FAKE.reads'))
    pg.click('#refreshDataBtn'); pg.wait_for_timeout(1200)
    reads = pg.evaluate('window.__FAKE.reads')[n0:]
    print('Làm mới: đọc', reads, '| toast:', pg.inner_text('#toastText'))
    pg.click('#tmAccountBtn'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{shots}/care-desktop-account.png')
    pg.click('#tmAccPwBtn'); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{shots}/care-desktop-account-pw.png')
    pg.click('#tcAccClose')

    # ---- Điện thoại: đã đăng nhập sẵn, cache IndexedDB ----
    m = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); watch(m, 'mobile'); setup(m, user='ad@thmilk.vn')
    m.goto('http://127.0.0.1:8766/mobile.html')
    m.wait_for_selector('#tmAuth.hidden', state='attached', timeout=8000); m.wait_for_timeout(1500)
    m.screenshot(path=f'{shots}/care-mobile-dashboard.png')
    for t in ['search', 'batch', 'devicelist', 'dongia', 'rawdata', 'dashboard']:
        m.click(f'.nav-btn[data-page="{t}"]'); m.wait_for_timeout(500)
    m.click('#tcAccIconBtn'); m.wait_for_timeout(500)
    m.screenshot(path=f'{shots}/care-mobile-account.png')
    m.click('#tmAccDone'); m.wait_for_timeout(300)
    # mở lại trang: lần này phải lấy mảnh từ IndexedDB, chỉ đọc meta
    m.evaluate('window.__FAKE.reads = []')
    m.reload(); m.wait_for_selector('#tmAuth.hidden', state='attached', timeout=8000); m.wait_for_timeout(800)
    print('mở lại (đọc từ máy chủ):', m.evaluate('window.__FAKE.reads'))

    # ---- Chưa được cấp quyền ----
    n = b.new_page(viewport={'width': 390, 'height': 844}); watch(n, 'noaccess'); setup(n, user='la@gmail.com')
    n.goto('http://127.0.0.1:8766/mobile.html'); n.wait_for_selector('#tmRetry', timeout=8000)
    n.screenshot(path=f'{shots}/care-noaccess.png')

    # ---- Trang chọn giao diện ----
    r = b.new_page(viewport={'width': 1366, 'height': 800}); setup(r)
    r.goto('http://127.0.0.1:8766/index.html?view=mobile'); r.wait_for_timeout(500); print('router ?view=mobile ->', r.url.split('/')[-1])
    b.close()
srv.shutdown()
print('\n'.join(errors) if errors else 'KHÔNG CÓ LỖI JS')
sys.exit(1 if errors else 0)
