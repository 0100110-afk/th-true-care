/**
 * app.js — Firebase cho app TH true care: đăng nhập, kiểm tra quyền, nạp dữ liệu Firestore vào
 * core.js rồi mở cổng google.script.run (gas-shim.js) cho giao diện gốc.
 *
 * Bố cục dữ liệu (do apps-script/Sync.gs bên file GT ghi; app CHỈ ĐỌC):
 *   care_meta/data            { json: '{ updatedAt, sets: { <prefix>: { hashes: [...], count } } }' }
 *   care_chunks/<prefix>__<i> { prefix, i, hash, json: '[bản ghi...]' }
 *   care_users/<email>        { role: 'admin' | 'user', uid }   (Sync.gs bên file TM ghi từ APP USERS)
 * Mỗi mảnh có mã băm riêng -> lần mở sau chỉ tải những mảnh đã đổi, còn lại lấy từ IndexedDB.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
  EmailAuthProvider, linkWithPopup, linkWithCredential, updatePassword, unlink, getAdditionalUserInfo
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE_CONFIG, APP_TITLE } from './firebase-config.js';

const PREFIXES = ['listing_v4', 'chiphi_v3', 'thanhly_v1', 'gsbh_v1', 'dongia_bt_v1', 'dongia_xd_v1', 'dongia_snk_v1'];

const fbApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

let currentUser = null;
let currentRole = null;
let apiOpened = false;
const MOBILE = !document.querySelector('.sidebar');

// ============================== IndexedDB ==============================

const idb = (() => {
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('care-cache', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function op(mode, fn) {
    try {
      const d = await open();
      return await new Promise((res, rej) => {
        const t = d.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    } catch (e) { return undefined; }   // trình duyệt chặn IndexedDB (ẩn danh...) -> coi như không có cache
  }
  return {
    get: (k) => op('readonly', (s) => s.get(k)),
    set: (k, v) => op('readwrite', (s) => s.put(v, k)),
    del: (k) => op('readwrite', (s) => s.delete(k)),
    clear: () => op('readwrite', (s) => s.clear())
  };
})();

// ============================== MÀN ĐĂNG NHẬP ==============================

const $ = (s) => document.querySelector(s);
const authEl = $('#tmAuth');

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Logo giống giao diện app: ô TH + ngôi sao 6 cánh vàng, chữ "true" + "MILK".
const STAR_SVG = '<svg class="tm-auth-star" viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs>' +
  '<linearGradient id="tcStarGold" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#F2E7C8"/><stop offset=".45" stop-color="#C9A961"/><stop offset="1" stop-color="#8E6F35"/>' +
  '</linearGradient></defs><path fill="url(#tcStarGold)" d="M12 .5Q13.1 10.1 18.5 8.25Q14.2 12 18.5 15.75Q13.1 13.9 12 22Q10.9 13.9 5.5 15.75Q9.8 12 5.5 8.25Q10.9 10.1 12 .5Z"/></svg>';
const BRAND = '<div class="tm-auth-brand"><div class="tm-auth-mark"><span class="tm-auth-th">TH</span>' + STAR_SVG + '</div>' +
  '<div><div class="tm-auth-word"><span class="w-true">true</span><span class="w-milk">MILK</span></div>' +
  '<div class="tm-auth-sub">' + esc(APP_TITLE) + '</div></div></div>';

function showAuth(html) {
  authEl.innerHTML = '<div class="tm-auth-card">' + BRAND + html + '</div>';
  authEl.classList.remove('hidden');
}
function hideAuth() { authEl.classList.add('hidden'); }

function showLoading(msg) {
  showAuth('<div class="tm-auth-loading"><div class="tm-spin"></div><div id="tmLoadMsg">' + esc(msg) + '</div></div>');
}
function setLoadMsg(t) { const el = $('#tmLoadMsg'); if (el) el.textContent = t; }

const GOOGLE_SVG = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function showLogin(errMsg) {
  showAuth(
    '<button class="tm-btn tm-btn-google" id="tmGoogleBtn" type="button">' + GOOGLE_SVG + 'Đăng nhập bằng Google</button>' +
    '<div class="tm-or"><span>hoặc</span></div>' +
    '<form id="tmEmailForm" autocomplete="on">' +
      '<input class="tm-input" type="email" id="tmEmail" placeholder="Email" autocomplete="username" required>' +
      '<input class="tm-input" type="password" id="tmPass" placeholder="Mật khẩu" autocomplete="current-password" required>' +
      '<button class="tm-btn tm-btn-primary" type="submit" id="tmSubmit">Đăng nhập</button>' +
      '<button class="tm-link" type="button" id="tmForgot">Quên mật khẩu?</button>' +
    '</form>' +
    '<div class="tm-auth-err" id="tmAuthErr">' + esc(errMsg || '') + '</div>' +
    '<div class="tm-auth-note">Tài khoản do quản trị viên cung cấp.</div>'
  );
  $('#tmGoogleBtn').onclick = loginGoogle;
  $('#tmEmailForm').onsubmit = (e) => {
    e.preventDefault();
    const btn = $('#tmSubmit');
    btn.disabled = true; btn.textContent = 'Đang đăng nhập...'; setAuthErr('');
    signInWithEmailAndPassword(auth, $('#tmEmail').value.trim(), $('#tmPass').value)
      .catch((err) => { setAuthErr(authErrText(err)); btn.disabled = false; btn.textContent = 'Đăng nhập'; });
  };
  $('#tmForgot').onclick = () => {
    const em = $('#tmEmail').value.trim();
    if (!em) { setAuthErr('Nhập email trước rồi bấm "Quên mật khẩu".'); return; }
    sendPasswordResetEmail(auth, em)
      .then(() => setAuthErr('Đã gửi email đặt lại mật khẩu tới ' + em + '.'))
      .catch((err) => setAuthErr(authErrText(err)));
  };
}

function setAuthErr(t) { const el = $('#tmAuthErr'); if (el) el.textContent = t; }

function authErrText(err) {
  const c = (err && err.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Sai email hoặc mật khẩu.';
  if (c.includes('too-many-requests')) return 'Thử sai quá nhiều lần, đợi vài phút rồi thử lại.';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return '';
  if (c.includes('unauthorized-domain')) return 'Tên miền này chưa được thêm vào Firebase Auth → Settings → Authorized domains.';
  if (c.includes('network')) return 'Không có kết nối mạng.';
  if (c.includes('internal-error')) return 'Không mở được đăng nhập Google. Tắt trình chặn quảng cáo (AdBlock...) cho trang này rồi thử lại, hoặc đăng nhập bằng email + mật khẩu.';
  return (err && err.message) || 'Đăng nhập không thành công.';
}

function googleProvider() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

function loginGoogle() {
  const provider = googleProvider();
  signInWithPopup(auth, provider).catch((err) => {
    const c = (err && err.code) || '';
    // Trình duyệt trong Zalo/Facebook chặn popup -> chuyển sang chuyển hướng toàn trang
    if (c.includes('popup-blocked') || c.includes('operation-not-supported')) {
      signInWithRedirect(auth, provider).catch((e2) => setAuthErr(authErrText(e2)));
    } else {
      setAuthErr(authErrText(err));
    }
  });
}

function showNoAccess(email) {
  showAuth(
    '<div class="tm-auth-msg"><b>Tài khoản chưa được cấp quyền</b><br>' + esc(email) +
    '<br><br>Liên hệ quản trị viên để được cấp quyền, sau đó bấm "Thử lại".</div>' +
    '<button class="tm-btn tm-btn-primary" id="tmRetry" type="button">Thử lại</button>' +
    '<button class="tm-btn" id="tmLogout2" type="button">Đăng xuất</button>'
  );
  $('#tmRetry').onclick = () => location.reload();
  $('#tmLogout2').onclick = () => doLogout();
}

function showError(text) {
  showAuth('<div class="tm-auth-msg">' + esc(text) + '</div>' +
    '<button class="tm-btn tm-btn-primary" type="button" id="tmRetry3">Thử lại</button>' +
    '<button class="tm-btn" type="button" id="tmLogout3">Đăng xuất</button>');
  $('#tmRetry3').onclick = () => location.reload();
  $('#tmLogout3').onclick = doLogout;
}

async function doLogout() {
  await idb.clear();
  try { localStorage.removeItem('care_role'); } catch (e) { /* bỏ qua */ }
  await signOut(auth);
  location.reload();
}

// ============================== NẠP DỮ LIỆU ==============================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readMeta() {
  const snap = await getDoc(doc(db, 'care_meta', 'data'));
  if (!snap.exists()) return null;
  try { return JSON.parse(snap.data().json || 'null'); } catch (e) { return null; }
}

/** Lấy 1 mảnh: có sẵn trong IndexedDB đúng mã băm thì dùng luôn, không thì tải từ Firestore. */
async function loadChunk(prefix, i, hash) {
  const key = 'chunk:' + prefix + '__' + i;
  const cached = await idb.get(key);
  if (cached && cached.hash === hash) return { rows: cached.rows, fetched: false };
  const snap = await getDoc(doc(db, 'care_chunks', prefix + '__' + i));
  const d = snap.exists() ? snap.data() : null;
  if (!d || d.hash !== hash) return null;           // Sync.gs đang ghi dở -> gọi lại sau
  const rows = JSON.parse(d.json || '[]');
  await idb.set(key, { hash, rows });
  return { rows, fetched: true };
}

/** Nạp toàn bộ. Trả { offline, fetched } — fetched = số mảnh phải tải mới. */
async function loadAll(onProgress) {
  let meta = null;
  let offline = false;
  try {
    meta = await readMeta();
    if (meta) await idb.set('meta', meta);
  } catch (e) {
    if (e && e.code === 'permission-denied') throw new Error('Tài khoản chưa được cấp quyền đọc dữ liệu TH true care.');
    meta = await idb.get('meta');
    offline = true;
    if (!meta) throw new Error('Không tải được dữ liệu (mất mạng?). Kiểm tra kết nối rồi thử lại.');
  }
  if (!meta || !meta.sets) {
    throw new Error('Chưa có dữ liệu trên máy chủ. Mở Google Sheet GT -> menu "App TH true care" -> "Cài đặt / cài lại đồng bộ".');
  }

  let fetched = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const results = {};
    let missing = false;
    const total = PREFIXES.reduce((n, p) => n + ((meta.sets[p] && meta.sets[p].hashes.length) || 0), 0);
    let done = 0;
    await Promise.all(PREFIXES.map(async (p) => {
      const m = meta.sets[p];
      if (!m) { results[p] = []; return; }
      const parts = await Promise.all(m.hashes.map(async (h, i) => {
        let r = null;
        if (offline) {
          const c = await idb.get('chunk:' + p + '__' + i);
          r = c ? { rows: c.rows, fetched: false } : { rows: [], fetched: false };
        } else {
          r = await loadChunk(p, i, h);
        }
        done++;
        if (onProgress) onProgress(done, total);
        return r;
      }));
      if (parts.some((x) => !x)) { missing = true; return; }
      parts.forEach((x) => { if (x.fetched) fetched++; });
      results[p] = [].concat(...parts.map((x) => x.rows));
    }));
    if (!missing) {
      PREFIXES.forEach((p) => CareCore.setData(p, results[p]));
      CareCore.setUpdated(Date.parse(meta.updatedAt) || 0);
      if (!offline) cleanupChunks(meta);
      return { offline, fetched };
    }
    await sleep(2000);
    meta = await readMeta();
    if (meta) await idb.set('meta', meta);
  }
  throw new Error('Dữ liệu đang được đồng bộ từ Google Sheet, đợi ít giây rồi bấm "Làm mới dữ liệu".');
}

/** Xoá các mảnh cũ thừa trong IndexedDB (khi số mảnh giảm). Không cần chờ. */
async function cleanupChunks(meta) {
  for (const p of PREFIXES) {
    const n = (meta.sets[p] && meta.sets[p].hashes.length) || 0;
    for (let i = n; i < n + 20; i++) {
      const k = 'chunk:' + p + '__' + i;
      if (!(await idb.get(k))) break;
      await idb.del(k);
    }
  }
}

// ============================== API CHO GIAO DIỆN ==============================

function buildApi() {
  const api = Object.assign({}, CareCore.API);
  api.getDataFreshness = () => CareCore.freshness();
  // "Làm mới dữ liệu": đọc lại mốc trên Firestore, chỉ tải các mảnh đã đổi.
  api.refreshCache = async () => {
    try {
      const r = await loadAll();
      if (r.offline) return { success: false, message: 'Đang mất mạng — vẫn hiển thị dữ liệu đã lưu lần trước.' };
      const f = CareCore.freshness();
      return { success: true, message: 'Đã làm mới dữ liệu' + (f && f.text ? ' (Sheet đồng bộ lúc ' + f.text + ')' : '') + '.' };
    } catch (e) {
      return { success: false, message: e.message || String(e) };
    }
  };
  return api;
}

// ============================== HỘP TÀI KHOẢN ==============================

function accountErrText(err) {
  const c = (err && err.code) || '';
  if (c === 'app/google-email-mismatch') return err.message;
  if (c.includes('weak-password')) return 'Mật khẩu quá ngắn — cần ít nhất 6 ký tự.';
  if (c.includes('requires-recent-login')) return 'Để đổi mật khẩu, hãy đăng xuất rồi đăng nhập lại, sau đó thử lại ngay.';
  if (c.includes('credential-already-in-use') || c.includes('email-already-in-use')) return 'Tài khoản Google này đã gắn với một tài khoản khác.';
  if (c.includes('provider-already-linked')) return 'Tài khoản đã liên kết Google rồi.';
  return authErrText(err) || 'Không thực hiện được, vui lòng thử lại.';
}

const ROLE_TEXT = (r) => (r === 'admin' ? 'Quản trị' : 'Người dùng');

/** Khung hộp: bản điện thoại dùng đúng bottom sheet của app (.sheet + #sheetBackdrop);
 *  bản máy tính (app gốc không có hộp thoại) dùng khung .tc-modal trong css/auth.css. */
function accountShell() {
  let wrap = document.getElementById('tcAccWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'tcAccWrap';
    if (MOBILE) {
      wrap.innerHTML = '<div class="sheet tc-acc-sheet" id="tcAccSheet" role="dialog" aria-modal="true" aria-label="Tài khoản">' +
        '<div class="sheet-handle"></div><div class="sheet-title">Tài khoản</div><div id="tcAccBody"></div></div>';
    } else {
      wrap.innerHTML = '<div class="tc-modal-overlay" id="tcAccOverlay"><div class="tc-modal" role="dialog" aria-modal="true" aria-label="Tài khoản">' +
        '<div class="tc-modal-head"><h3>Tài khoản</h3><button class="tc-modal-close" type="button" id="tcAccClose" aria-label="Đóng">✕</button></div>' +
        '<div class="tc-modal-body" id="tcAccBody"></div></div></div>';
    }
    document.body.appendChild(wrap);
    if (!MOBILE) {
      document.getElementById('tcAccClose').onclick = () => document.getElementById('tcAccOverlay').classList.remove('show');
      document.getElementById('tcAccOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'tcAccOverlay') e.target.classList.remove('show');
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.getElementById('tcAccOverlay').classList.remove('show');
      });
    }
  }
  return {
    body: document.getElementById('tcAccBody'),
    open() {
      if (MOBILE) {
        $('#sheetBackdrop').classList.add('show');
        document.getElementById('tcAccSheet').classList.add('show');
      } else {
        document.getElementById('tcAccOverlay').classList.add('show');
      }
    },
    close() {
      if (MOBILE) {
        $('#sheetBackdrop').classList.remove('show');
        document.getElementById('tcAccSheet').classList.remove('show');
      } else {
        document.getElementById('tcAccOverlay').classList.remove('show');
      }
    }
  };
}

function showAccountDialog(okMsg) {
  if (typeof okMsg !== 'string') okMsg = '';   // gọi từ sự kiện click thì tham số là Event
  const shell = accountShell();
  const u = auth.currentUser;
  if (!u) { shell.close(); return; }
  const ids = (u.providerData || []).map((p) => p.providerId);
  const hasPw = ids.includes('password'), hasG = ids.includes('google.com');
  const method = (name, on) => '<div class="tm-acc-method' + (on ? ' on' : '') + '"><span>' + name + '</span><b>' + (on ? 'Đang dùng' : 'Chưa có') + '</b></div>';
  shell.body.innerHTML = '<div class="tm-acc">' +
    '<div class="tm-acc-row"><span>Email</span><b>' + esc(u.email) + '</b></div>' +
    '<div class="tm-acc-row"><span>Quyền</span><b>' + ROLE_TEXT(currentRole) + '</b></div>' +
    '<div class="tm-acc-title">Cách đăng nhập</div>' + method('Email + mật khẩu', hasPw) + method('Google', hasG) +
    '<div class="tm-acc-msg" id="tmAccMsg"></div>' +
    '<div class="tm-acc-actions" id="tmAccActions">' +
      (hasG ? '' : '<button type="button" class="btn secondary" id="tmAccLinkG">Liên kết Google</button>') +
      '<button type="button" class="btn secondary" id="tmAccPwBtn">' + (hasPw ? 'Đổi mật khẩu' : 'Đặt mật khẩu') + '</button>' +
    '</div>' +
    '<form id="tmAccPwForm" class="tm-acc-pw" hidden>' +
      '<div class="field-group"><label>' + (hasPw ? 'Mật khẩu mới' : 'Mật khẩu') + '</label><input type="password" id="tmAccPw1" autocomplete="new-password" placeholder="Ít nhất 6 ký tự"></div>' +
      '<div class="field-group"><label>Nhập lại mật khẩu</label><input type="password" id="tmAccPw2" autocomplete="new-password"></div>' +
      '<div class="tm-acc-actions"><button type="submit" class="btn" id="tmAccSave">Lưu mật khẩu</button>' +
      '<button type="button" class="btn secondary" id="tmAccCancel">Huỷ</button></div>' +
    '</form>' +
    '<div class="tm-acc-actions tm-acc-bottom">' +
      '<button type="button" class="btn secondary tm-acc-logout" id="tmAccLogout">Đăng xuất</button>' +
      '<button type="button" class="btn secondary" id="tmAccDone">Đóng</button>' +
    '</div>' +
  '</div>';
  shell.open();
  const msg = (t, ok) => { const m = document.getElementById('tmAccMsg'); if (!m) return; m.textContent = t; m.className = 'tm-acc-msg' + (ok ? ' ok' : ''); };
  if (okMsg) msg(okMsg, true);

  const afterChange = async (okText) => {
    try { await u.reload(); } catch (e) { /* phiên bị thu hồi -> xử lý bên dưới */ }
    if (!auth.currentUser) { shell.close(); showLogin(okText + ' Vui lòng đăng nhập lại.'); return; }
    showAccountDialog(okText);
  };

  document.getElementById('tmAccDone').onclick = () => shell.close();
  document.getElementById('tmAccLogout').onclick = doLogout;
  const linkBtn = document.getElementById('tmAccLinkG');
  if (linkBtn) linkBtn.onclick = async () => {
    linkBtn.disabled = true; msg('');
    try {
      const r = await linkWithPopup(u, googleProvider());
      const info = getAdditionalUserInfo(r);
      const gEmail = String((info && info.profile && info.profile.email) || '').toLowerCase();
      if (gEmail && gEmail !== String(u.email).toLowerCase()) {
        await unlink(u, 'google.com');
        const e = new Error('Tài khoản Google ' + gEmail + ' không trùng email ' + u.email + '. Hãy chọn đúng Gmail ' + u.email + '.');
        e.code = 'app/google-email-mismatch'; throw e;
      }
      await afterChange('Đã liên kết Google. Từ giờ đăng nhập được bằng cả Google lẫn mật khẩu.');
    } catch (err) { msg(accountErrText(err)); linkBtn.disabled = false; }
  };
  document.getElementById('tmAccPwBtn').onclick = () => {
    document.getElementById('tmAccPwForm').hidden = false;
    document.getElementById('tmAccActions').hidden = true;
    msg('');
    document.getElementById('tmAccPw1').focus();
  };
  document.getElementById('tmAccCancel').onclick = () => {
    document.getElementById('tmAccPwForm').hidden = true;
    document.getElementById('tmAccActions').hidden = false;
  };
  document.getElementById('tmAccPwForm').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('tmAccPw1').value, p2 = document.getElementById('tmAccPw2').value;
    if (p1.length < 6) { msg('Mật khẩu cần ít nhất 6 ký tự.'); return; }
    if (p1 !== p2) { msg('Hai lần nhập mật khẩu không khớp.'); return; }
    const save = document.getElementById('tmAccSave');
    save.disabled = true; save.textContent = 'Đang lưu...';
    try {
      if (hasPw) await updatePassword(u, p1);
      else await linkWithCredential(u, EmailAuthProvider.credential(u.email, p1));
      await afterChange(hasPw ? 'Đã đổi mật khẩu.' : 'Đã đặt mật khẩu. Từ giờ đăng nhập được bằng email ' + u.email + ' và mật khẩu này.');
    } catch (err) {
      msg(accountErrText(err));
      save.disabled = false; save.textContent = 'Lưu mật khẩu';
    }
  };
}

const USER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';

function injectUserBox() {
  if (document.getElementById('tcUserBox') || document.getElementById('tcAccIconBtn')) return;
  const email = currentUser.email || '';
  const foot = document.querySelector('.sidebar-foot');                 // bản máy tính
  if (foot) {
    const box = document.createElement('div');
    box.className = 'tm-userbox';
    box.id = 'tcUserBox';
    box.innerHTML = '<div class="tm-userbox-mail" title="' + esc(email) + '">' + esc(email) + '</div>' +
      '<div class="tm-userbox-row"><button type="button" id="tmAccountBtn">Tài khoản</button><button type="button" id="tmLogoutBtn">Đăng xuất</button></div>';
    foot.insertBefore(box, foot.firstChild);
    document.getElementById('tmAccountBtn').addEventListener('click', () => showAccountDialog());
    document.getElementById('tmLogoutBtn').addEventListener('click', doLogout);
  }
  const actions = document.querySelector('.topbar-actions');            // bản điện thoại
  if (actions && MOBILE) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.id = 'tcAccIconBtn';
    b.type = 'button';
    b.title = 'Tài khoản';
    b.setAttribute('aria-label', 'Tài khoản');
    b.innerHTML = '<span class="icon">' + USER_ICON + '</span>';
    b.addEventListener('click', () => showAccountDialog());
    actions.appendChild(b);
  }
}

// ============================== KHỞI ĐỘNG ==============================

async function emailVerifiedClaim(u) {
  try {
    let t = await u.getIdTokenResult();
    if (t.claims.email_verified !== true) t = await u.getIdTokenResult(true);
    return t.claims.email_verified === true;
  } catch (e) { return null; }
}

async function checkRole(user) {
  const email = String(user.email || '').toLowerCase();
  try {
    const snap = await getDoc(doc(db, 'care_users', email));
    let role = snap.exists() ? String(snap.data().role || 'user') : null;
    // Khớp rules: đúng uid Sync.gs đã ghi, HOẶC email đã xác minh.
    const uid = snap.exists() ? snap.data().uid : '';
    if (role && uid && uid !== user.uid && await emailVerifiedClaim(user) === false) role = null;
    try { localStorage.setItem('care_role', JSON.stringify({ email, role })); } catch (e) { /* bỏ qua */ }
    return role;
  } catch (e) {
    try {
      const c = JSON.parse(localStorage.getItem('care_role') || 'null');
      if (c && c.email === email) return c.role;
    } catch (e2) { /* bỏ qua */ }
    if (e && e.code === 'permission-denied') return null;
    throw e;
  }
}

function toast(text, type) {
  if (typeof window.showToast === 'function') { window.showToast(text, type); return; }
  const el = document.getElementById('toastNotice'), tx = document.getElementById('toastText');
  if (!el || !tx) return;
  tx.textContent = text;
  el.className = 'toast show' + (type === 'error' ? ' error' : '');
  setTimeout(() => el.classList.remove('show'), 4000);
}

async function start(user) {
  currentUser = user;
  showLoading('Đang kiểm tra quyền truy cập…');
  try {
    currentRole = await checkRole(user);
  } catch (e) {
    showError('Không kết nối được máy chủ. ' + (e.message || ''));
    return;
  }
  if (!currentRole) { showNoAccess(user.email); return; }

  showLoading('Đang tải dữ liệu…');
  let r;
  try {
    r = await loadAll((done, total) => { if (total > 3) setLoadMsg('Đang tải dữ liệu… ' + Math.round(done * 100 / total) + '%'); });
  } catch (e) {
    showError(e.message || String(e));
    return;
  }
  injectUserBox();
  hideAuth();
  if (!apiOpened) { apiOpened = true; window.__TM_API_READY(buildApi()); }
  if (r.offline) setTimeout(() => toast('Đang mất mạng — hiển thị dữ liệu đã lưu lần trước.', 'error'), 600);
}

showLoading('Đang kiểm tra đăng nhập…');
getRedirectResult(auth).catch((err) => { if (err && err.code) setAuthErr(authErrText(err)); });
onAuthStateChanged(auth, (user) => {
  if (user) { if (!currentUser) start(user); }
  else { currentUser = null; showLogin(); }
});

// PWA: cài lên màn hình chính + mở được khi mất mạng
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* bỏ qua */ }));
}

