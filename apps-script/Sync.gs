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
 * Admin bấm "Đồng bộ từ Google Sheet" trên app (doPost); quét dự phòng 1 giờ/lần (7h–19h); menu "Đồng bộ ngay" vẫn giữ. Chỉ ghi những MẢNH dữ liệu thật
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
var CS_TICK_HOURS = [7, 19];   // quét dự phòng 1 giờ/lần, chỉ trong khung giờ này (giờ VN)
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
  ScriptApp.newTrigger('csTick').timeBased().everyHours(1).create();
  var r = csSyncAll_(true);
  var msg = 'Đã cài đồng bộ TH true care.\n' + r.lines.join('\n') +
    '\n- Admin bấm "Đồng bộ từ Google Sheet" trên app sau khi cập nhật sheet.' +
    '\n- Quét dự phòng 1 giờ/lần (' + CS_TICK_HOURS[0] + 'h–' + CS_TICK_HOURS[1] + 'h).';
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
  var h = Number(Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'H'));
  if (h < CS_TICK_HOURS[0] || h >= CS_TICK_HOURS[1]) return;   // ngoài giờ làm việc: không quét
  try { csSyncAll_(false); } catch (e) { console.error('csTick: ' + e.message); }
}

// ============================== WEB APP: NÚT "ĐỒNG BỘ TỪ GOOGLE SHEET" TRÊN APP ==============================
/**
 * App (admin) gọi POST { action:'sync', idToken }. Kiểm tra token đăng nhập Firebase -> email ->
 * phải là admin TH true care (care_users/<email>.role = 'admin', do Sync.gs file TM ghi từ APP USERS).
 * Triển khai: Apps Script -> Triển khai -> Tùy chọn triển khai mới -> Ứng dụng web
 *   (Thực thi với tư cách: Tôi · Ai có quyền truy cập: Bất kỳ ai). Dán link vào js/firebase-config.js (SYNC_URL).
 */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var email = csVerifyIdToken_(body.idToken);
    var u = csFetch_('get', csBaseUrl_() + '/care_users/' + encodeURIComponent(email));
    var role = u && u.fields && u.fields.role ? u.fields.role.stringValue : '';
    if (role !== 'admin') throw new Error('Tài khoản ' + email + ' không có quyền đồng bộ dữ liệu.');
    var r = csSyncAll_(false, 120000);
    if (r.busy) throw new Error('Đang có lượt đồng bộ khác chạy, thử lại sau ít phút.');
    out = { ok: true, changed: r.changed, details: r.details, at: new Date().toISOString() };
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function csVerifyIdToken_(idToken) {
  if (!idToken) throw new Error('Chưa đăng nhập.');
  var url = 'https://identitytoolkit.googleapis.com/v1/projects/' + csSa_().project_id + '/accounts:lookup';
  var r;
  try { r = csFetch_('post', url, { idToken: idToken }); }
  catch (err) { throw new Error('Phiên đăng nhập hết hạn — tải lại trang rồi thử lại.'); }
  var u = r && r.users && r.users[0];
  if (!u || !u.email) throw new Error('Phiên đăng nhập không hợp lệ.');
  return String(u.email).toLowerCase();
}

var CS_LABELS = { listing_v4: 'LISTING', chiphi_v3: 'CHI PHI', thanhly_v1: 'THANH LY', gsbh_v1: 'GSBH',
  dongia_bt_v1: 'Đơn giá BT', dongia_xd_v1: 'Đơn giá XD', dongia_snk_v1: 'Đơn giá SNK' };

// ============================== ĐỒNG BỘ ==============================

function csSyncAll_(force, waitMs) {
  var lines = [], changedSets = [], details = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 25000)) return { lines: ['Đồng bộ khác đang chạy, bỏ qua lần này.'], busy: true, changed: [], details: [] };
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
      var sameHashes = old.hashes.length === hashes.length && hashes.every(function (h, i) { return old.hashes[i] === h; });
      if (!sameHashes) {
        changedSets.push(s.prefix);
        var lb = CS_LABELS[s.prefix] || s.prefix, o = old.count, n = records.length;
        details.push(o === undefined ? lb + ' ' + n + ' dòng' : (n !== o ? lb + ' ' + (n > o ? '+' : '−') + Math.abs(n - o) + ' dòng' : lb + ' sửa nội dung'));
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
  return { lines: lines, changed: changedSets, details: details };
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
  var hit = cache.get('cs_token2');
  if (hit) return hit;
  var sa = csSa_();
  var now = Math.floor(Date.now() / 1000);
  var enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  var unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  if (res.getResponseCode() !== 200) throw new Error('Không lấy được token Firebase: ' + res.getContentText());
  var tok = JSON.parse(res.getContentText()).access_token;
  cache.put('cs_token2', tok, 3000);
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
var csSHEET_LISTING = 'LISTING';
var csSHEET_CHIPHI = 'CHI PHI';
var csSHEET_THANHLY = 'THANH LY';
var csSHEET_GSBH = 'GSBH';
var csSHEET_DONGIA_BT = 'DON GIA BT';
var csSHEET_DONGIA_XD = 'DON GIA XD';
var csSHEET_DONGIA_SNK = 'DON GIA SNK';

function csNormalizeCode(code) {
  if (code === null || code === undefined) return '';
  return String(code).trim();
}

function csRemoveDiacritics(str) {
  str = String(str || '');
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function csBuildHeaderIndex(headers) {
  var idx = {};
  headers.forEach(function (h, i) {
    var key = csRemoveDiacritics(String(h).trim()).replace(/\s+/g, '_');
    idx[key] = i;
  });
  return idx;
}

function csCellStr(row, idx, key) {
  if (idx[key] === undefined) return '';
  var v = row[idx[key]];
  return (v === null || v === undefined) ? '' : String(v);
}

function csCellFlexible(row, idx, key) {
  if (idx[key] === undefined) return '';
  var v = row[idx[key]];
  if (v === null || v === undefined) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return csFormatDateDisplay(v);
  return String(v).trim();
}

function csBuildDateStrict_(y, month, day) {
  if (!(y >= 1000 && y <= 9999)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;

  var d = new Date(y, month - 1, day);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() !== y || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function csParseDateSafe(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;

  var str = value.trim();
  if (!str) return null;

  // ISO: yyyy-mm-dd (có thể kèm giờ phía sau, bỏ qua giờ)
  var isoM = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (isoM) return csBuildDateStrict_(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));

  // Dạng A/B/yyyy, có thể kèm giờ phía sau (bỏ qua giờ)
  var m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/);
  if (m) {
    var a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    if (a > 12 && b > 12) return null; // cả 2 số đều > 12 -> không thể là ngày nào cả

    var day, month;
    if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    // Cả 2 số <= 12 thì không thể biết đâu là ngày đâu là tháng -> mặc định M/D/yyyy.
    // CẢNH BÁO: nhánh này ĐỌC NGƯỢC nếu ô thực chất là dd/mm ("06/07" -> 7 tháng 6).
    // Chỉ ô kiểu TEXT mới đi qua đây; ô kiểu Date thật đã được trả về từ đầu hàm nên luôn đúng.
    else { month = a; day = b; }
    return csBuildDateStrict_(y, month, day);
  }

  return null;
}

function csIsBadDate_(value) {
  if (value === null || value === undefined) return false;
  if (String(value).trim() === '') return false;
  return csParseDateSafe(value) === null;
}

function csRawDateText_(value) {
  return csIsBadDate_(value) ? String(value).trim() : '';
}

function csFormatDateDisplay(value) {
  var d = csParseDateSafe(value);
  if (!d) return '';
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + d.getFullYear();
}

function csDateToIso(value) {
  var d = csParseDateSafe(value);
  if (!d) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function csRebuildListingRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(csSHEET_LISTING);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = csNormalizeCode(row[idx['code_tu']]);
    if (!code) continue;

    var diaChiParts = [csCellStr(row, idx, 'dia_chi'), csCellStr(row, idx, 'phuong_xa'), csCellStr(row, idx, 'tinh_thanh_pho')]
      .filter(function (p) { return p.trim() !== ''; });

    var ngayLapVal = row[idx['ngay_lap_dat']];

    records.push([
      code,
      csCellStr(row, idx, 'ten_cua_hang'),
      diaChiParts.join(', '),
      csCellStr(row, idx, 'so_dien_thoai_cua_hang'),
      csCellStr(row, idx, 'loai_tu'),
      csDateToIso(ngayLapVal),
      csCellStr(row, idx, 'nhan_hieu'),
      csCellStr(row, idx, 'vung'),
      csCellStr(row, idx, 'ma_npp'),
      i + 1,
      csRawDateText_(ngayLapVal) // giữ nguyên văn khi ngày lắp đặt không hợp lệ
    ]);
  }
  return records;
}

function csRebuildChiPhiRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(csSHEET_CHIPHI);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = csNormalizeCode(row[idx['code_tu']]);
    if (!code) continue;

    var ngayVal = row[idx['ngay_thuc_hien']];

    records.push([
      code,
      csDateToIso(ngayVal),
      csCellStr(row, idx, 'ncc'),
      csCellStr(row, idx, 'dien_giai'),
      Number(row[idx['thanh_tien']]) || 0,
      csCellStr(row, idx, 'mien'),
      i + 1,
      csRawDateText_(ngayVal) // giữ nguyên văn khi ngày thực hiện không hợp lệ
    ]);
  }
  return records;
}

function csRebuildThanhLyRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(csSHEET_THANHLY);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = csNormalizeCode(row[idx['code_tu']]);
    if (!code) continue;

    records.push([
      code,
      csCellFlexible(row, idx, 'thanh_ly'),
      csCellStr(row, idx, 'dien_giai'),
      i + 1
    ]);
  }
  return records;
}

function csRebuildGsbhRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(csSHEET_GSBH);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maNpp = csNormalizeCode(row[idx['ma_npp']]);
    if (!maNpp) continue;

    records.push([
      maNpp,
      csCellStr(row, idx, 'ten_npp'),
      csCellStr(row, idx, 'ho_ten_gsbh'),
      csCellStr(row, idx, 'dia_chi_mail'),
      csCellStr(row, idx, 'so_dien_thoai'),
      csCellStr(row, idx, 'P&C'),
      i + 1
    ]);
  }
  return records;
}

function csRebuildDonGiaBtRecords() {
  var sheet = csDgSs_().getSheetByName(csSHEET_DONGIA_BT);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];
  var currentGroup = '';

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maImc = csCellStr(row, idx, 'ma_imc').trim();
    var noiDung = csCellStr(row, idx, 'noi_dung').trim();
    if (!maImc && !noiDung) continue;

    // Dòng đầu mục: ma_imc chỉ gồm chữ số La Mã (I, II, III, IV...), không có dấu gạch ngang
    var isHeader = /^[IVXLCDM]+$/i.test(maImc);

    if (isHeader) {
      currentGroup = noiDung;
      records.push({ isHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup });
    } else {
      records.push({
        isHeader: false,
        maImc: maImc,
        noiDung: noiDung,
        dvt: csCellStr(row, idx, 'dvt'),
        vatTu: Number(row[idx['vat_tu']]) || 0,
        nhanCong: Number(row[idx['nhan_cong']]) || 0,
        tongCong: Number(row[idx['tong_cong']]) || 0,
        group: currentGroup
      });
    }
  }
  return records;
}

function csRebuildDonGiaXdRecords() {
  var sheet = csDgSs_().getSheetByName(csSHEET_DONGIA_XD);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];
  var currentGroup = '';
  var currentSubGroup = '';

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maImc = csCellStr(row, idx, 'imc').trim();
    var noiDung = csCellStr(row, idx, 'noi_dung_cong_viec').trim();
    if (!maImc && !noiDung) continue;

    var isHeader = /^[IVXLCDM]+$/i.test(maImc);
    var isSubHeader = !isHeader && /^\d+$/.test(maImc);

    if (isHeader) {
      currentGroup = noiDung;
      currentSubGroup = '';
      records.push({ isHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup });
    } else if (isSubHeader) {
      currentSubGroup = noiDung;
      records.push({ isSubHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup, subGroup: currentSubGroup });
    } else {
      records.push({
        isHeader: false,
        maImc: maImc,
        noiDung: noiDung,
        yeuCau: csCellStr(row, idx, 'yeu_cau_ky_thuat_va_vat_lieu'),
        dvt: csCellStr(row, idx, 'dvt'),
        donGia: Number(row[idx['don_gia']]) || 0,
        group: currentGroup,
        subGroup: currentSubGroup
      });
    }
  }
  return records;
}

function csRebuildDonGiaSnkRecords() {
  var sheet = csDgSs_().getSheetByName(csSHEET_DONGIA_SNK);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = csBuildHeaderIndex(data[0]);
  var records = [];
  var currentGroup = '';

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maImc = csCellStr(row, idx, 'imc').trim();
    var noiDung = csCellStr(row, idx, 'noi_dung').trim();
    if (!maImc && !noiDung) continue;

    var isHeader = /^[IVXLCDM]+$/i.test(maImc);

    if (isHeader) {
      currentGroup = noiDung;
      records.push({ isHeader: true, maImc: maImc, noiDung: noiDung, group: currentGroup });
    } else {
      records.push({
        isHeader: false,
        maImc: maImc,
        noiDung: noiDung,
        dvt: csCellStr(row, idx, 'dvt'),
        vatTu: Number(row[idx['vat_tu']]) || 0,
        gasPhinLoc: Number(row[idx['gas_+_phin_loc']]) || 0,
        nhanCong: Number(row[idx['nhan_cong']]) || 0,
        phuPhi: Number(row[idx['phu_phi_(van_chuyen/_di_lai)']]) || 0,
        donGia: Number(row[idx['don_gia']]) || 0,
        group: currentGroup
      });
    }
  }
  return records;
}

