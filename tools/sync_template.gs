/**
 * Sync.gs — ĐỒNG BỘ GOOGLE SHEET "GT" -> FIRESTORE cho app TH true care (web/PWA trên Vercel).
 *
 * DÁN FILE NÀY VÀO PROJECT APPS SCRIPT GẮN VỚI FILE "GT" (Tiện ích mở rộng -> Apps Script).
 * File ĐỨNG MỘT MÌNH: không cần Code.gs / Index.html (giữ hay xoá tuỳ ý, không trùng tên).
 * Phần đọc sheet bên dưới được SINH TỰ ĐỘNG từ Code.gs (tools/build_sync.py) nên dựng ra ĐÚNG
 * định dạng bản ghi mà app cũ dùng — app web chỉ việc tra cứu trên đó.
 *
 * CHỈ MỘT CHIỀU Sheet -> App (app chỉ tra cứu, không ghi gì):
 *   LISTING, CHI PHI, THANH LY, GSBH  (file GT)
 *   DON GIA BT / XD / SNK              (file DG riêng — FS_DG_FILE_ID)
 * Quét 15 phút/lần + menu "App TH true care" -> "Đồng bộ ngay". Chỉ ghi những MẢNH dữ liệu thật
 * sự đổi (thêm dòng cuối CHI PHI thì chỉ mảnh cuối được ghi lại).
 *
 * Quyền vào app: cột "TH true care" trong sheet APP USERS của file TM (Sync.gs bên file TM lo).
 *
 * CÀI ĐẶT (1 lần):
 *   1. Script Properties -> Add:  FIREBASE_SA = nội dung file JSON service account của Firebase
 *      th-truemart-info (CÙNG file đã dán bên file TM).
 *   2. Chạy hàm caiDatDongBoTrueCare -> cấp quyền.
 */

// ============================== CẤU HÌNH ==============================
var CS_DG_FILE_ID = '1RFVctqPlPvLodhscIMxIMLrRgIEjSLLUlFUsqI2anSQ';   // file "DG"
var CS_PROP_SA = 'FIREBASE_SA';
var CS_TICK_MINUTES = 15;
var CS_CHUNK_BYTES = 650000;          // < 1 MiB/tài liệu Firestore, chừa biên
var CS_CHUNK_ROWS = 4000;             // ranh giới mảnh cố định theo số bản ghi -> thêm dòng cuối chỉ đổi mảnh cuối

/** Các bộ dữ liệu đẩy lên: tên prefix GIỮ ĐÚNG như cache cũ (core.js đọc theo tên này). */
function csSets_() {
  return [
    { prefix: 'listing_v4', build: csRebuildListingRecords },
    { prefix: 'chiphi_v3', build: csRebuildChiPhiRecords },
    { prefix: 'thanhly_v1', build: csRebuildThanhLyRecords },
    { prefix: 'gsbh_v1', build: csRebuildGsbhRecords },
    { prefix: 'dongia_bt_v1', build: csRebuildDonGiaBtRecords },
    { prefix: 'dongia_xd_v1', build: csRebuildDonGiaXdRecords },
    { prefix: 'dongia_snk_v1', build: csRebuildDonGiaSnkRecords }
  ];
}

var csDgCache_ = null;
function csDgSs_() {
  if (!csDgCache_) {
    try { csDgCache_ = SpreadsheetApp.openById(CS_DG_FILE_ID); }
    catch (e) { throw new Error('Không mở được file Đơn giá (CS_DG_FILE_ID = ' + CS_DG_FILE_ID + '): ' + e.message); }
  }
  return csDgCache_;
}

// ============================== MENU + CÀI ĐẶT ==============================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('App TH true care')
    .addItem('Đồng bộ ngay lên app', 'dongBoTrueCareNgay')
    .addItem('Cài đặt / cài lại đồng bộ', 'caiDatDongBoTrueCare')
    .addItem('Xem tình trạng đồng bộ', 'xemTinhTrangTrueCare')
    .addToUi();
}

function caiDatDongBoTrueCare() {
  csSa_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'csTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('csTick').timeBased().everyMinutes(CS_TICK_MINUTES).create();
  var r = csSyncAll_(true);
  var msg = 'Đã cài đồng bộ TH true care.\n' + r.lines.join('\n') +
    '\n- Tự quét lại mỗi ' + CS_TICK_MINUTES + ' phút.';
  csAlert_(msg);
  return msg;
}

function dongBoTrueCareNgay() {
  var r = csSyncAll_(false);
  csAlert_('Đã đồng bộ.\n' + r.lines.join('\n'));
}

function xemTinhTrangTrueCare() {
  var meta = csReadMeta_();
  var lines = ['Cập nhật lần cuối: ' + (meta.updatedAt || '(chưa có)')];
  Object.keys(meta.sets || {}).forEach(function (p) {
    var m = meta.sets[p];
    lines.push('- ' + p + ': ' + m.count + ' bản ghi, ' + m.hashes.length + ' mảnh');
  });
  csAlert_(lines.join('\n'));
}

function csTick() {
  try { csSyncAll_(false); } catch (e) { console.error('csTick: ' + e.message); }
}

// ============================== ĐỒNG BỘ ==============================

function csSyncAll_(force) {
  var lines = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { lines: ['Đồng bộ khác đang chạy, bỏ qua lần này.'] };
  try {
    var meta = csReadMeta_();
    meta.sets = meta.sets || {};
    var writes = [];
    csSets_().forEach(function (s) {
      var records;
      try { records = s.build(); }
      catch (e) { lines.push('- ' + s.prefix + ': LỖI ' + e.message); return; }
      var old = meta.sets[s.prefix] || { hashes: [] };
      var chunks = csChunk_(records);
      var hashes = chunks.map(function (c) { return csMd5_(c); });
      var changed = 0;
      hashes.forEach(function (h, i) {
        if (!force && old.hashes[i] === h) return;
        writes.push({ update: { name: csDocName_('care_chunks/' + s.prefix + '__' + i), fields: {
          prefix: { stringValue: s.prefix }, i: { integerValue: String(i) }, hash: { stringValue: h },
          json: { stringValue: chunks[i] } } } });
        changed++;
      });
      for (var i = hashes.length; i < old.hashes.length; i++) {
        writes.push({ delete: csDocName_('care_chunks/' + s.prefix + '__' + i) });
      }
      meta.sets[s.prefix] = { hashes: hashes, count: records.length };
      lines.push('- ' + s.prefix + ': ' + records.length + ' bản ghi, ghi ' + changed + '/' + hashes.length + ' mảnh');
    });
    meta.updatedAt = new Date().toISOString();
    writes.push({ update: { name: csDocName_('care_meta/data'), fields: { json: { stringValue: JSON.stringify(meta) } } } });
    // Mảnh trước, meta SAU CÙNG: app chỉ thấy danh sách mảnh mới khi mọi mảnh đã có trên máy chủ.
    var metaWrite = writes.pop();
    csCommit_(writes);
    csCommit_([metaWrite]);
  } finally {
    lock.releaseLock();
  }
  return { lines: lines };
}

/** Cắt bản ghi thành mảnh JSON: ranh giới theo SỐ BẢN GHI cố định (ổn định khi thêm dòng cuối),
 *  mảnh nào vượt trần byte thì chia nhỏ tiếp. */
function csChunk_(records) {
  var out = [];
  for (var i = 0; i < records.length; i += CS_CHUNK_ROWS) {
    var part = records.slice(i, i + CS_CHUNK_ROWS);
    var json = JSON.stringify(part);
    if (csUtf8Len_(json) <= CS_CHUNK_BYTES) { out.push(json); continue; }
    var step = Math.ceil(part.length / Math.ceil(csUtf8Len_(json) / CS_CHUNK_BYTES));
    for (var j = 0; j < part.length; j += step) out.push(JSON.stringify(part.slice(j, j + step)));
  }
  if (!out.length) out.push('[]');
  return out;
}

function csReadMeta_() {
  var d = csFetch_('get', csBaseUrl_() + '/care_meta/data');
  if (!d || !d.fields || !d.fields.json) return { sets: {} };
  try { return JSON.parse(d.fields.json.stringValue) || { sets: {} }; } catch (e) { return { sets: {} }; }
}

// ============================== FIRESTORE REST ==============================

function csSa_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CS_PROP_SA);
  if (!raw) throw new Error('Chưa cấu hình: thêm Script Property "' + CS_PROP_SA + '" = nội dung file JSON service account của Firebase th-truemart-info.');
  var sa;
  try { sa = JSON.parse(raw); }
  catch (e) { throw new Error(CS_PROP_SA + ' phải là NỘI DUNG file .json (bắt đầu bằng dấu { ), không phải tên file.'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error(CS_PROP_SA + ' không đúng định dạng file JSON service account.');
  return sa;
}

function csToken_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('cs_token');
  if (hit) return hit;
  var sa = csSa_();
  var now = Math.floor(Date.now() / 1000);
  var enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  var unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  if (res.getResponseCode() !== 200) throw new Error('Không lấy được token Firebase: ' + res.getContentText());
  var tok = JSON.parse(res.getContentText()).access_token;
  cache.put('cs_token', tok, 3000);
  return tok;
}

function csBaseUrl_() {
  return 'https://firestore.googleapis.com/v1/projects/' + csSa_().project_id + '/databases/(default)/documents';
}
function csDocName_(path) {
  return 'projects/' + csSa_().project_id + '/databases/(default)/documents/' + path;
}

function csFetch_(method, url, body) {
  var opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + csToken_() } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(url, opt);
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 500));
  var txt = res.getContentText();
  return txt ? JSON.parse(txt) : {};
}

/** Ghi theo lô nhỏ: mỗi mảnh tới ~650KB, một lần commit giới hạn 10 MiB -> 8 mảnh/lần. */
function csCommit_(writes) {
  for (var i = 0; i < writes.length; i += 8) {
    csFetch_('post', csBaseUrl_() + ':commit', { writes: writes.slice(i, i + 8) });
  }
}

function csMd5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function csUtf8Len_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } else n += 3;
  }
  return n;
}

function csAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

// ============================== ĐỌC SHEET (SINH TỪ Code.gs) ==============================
//@@GENERATED@@
