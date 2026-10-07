/* node tools/test-sync.js — chạy apps-script/Sync.gs với Google Sheet + Firestore GIẢ LẬP, rồi nạp kết quả
   vào js/core.js đúng cách js/app.js làm (ghép các mảnh theo mã băm) và gọi thử mọi hàm API. */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const R = (p) => path.join(__dirname, '..', p);
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fails++; };

function mkSheet(name, values) {
  const v = values.map((r) => r.slice());
  return { getName: () => name, getDataRange: () => ({ getValues: () => v.map((r) => r.slice()) }), _v: v };
}
const N = 9000;   // CHI PHI đủ lớn để cắt nhiều mảnh
const gt = {
  LISTING: mkSheet('LISTING', [
    ['code_tu', 'ten_cua_hang', 'dia_chi', 'phuong_xa', 'tinh_thanh_pho', 'so_dien_thoai_cua_hang', 'loai_tu', 'ngay_lap_dat', 'nhan_hieu', 'vung', 'ma_npp'],
    ['TC001', 'Cửa hàng A', 'Số 1 Lê Lợi', 'Phường 1', 'Hà Nội', '0901', 'Tủ đứng', new Date(2024, 0, 15), 'Sanaky', 'Miền Bắc', 'NPP01'],
    ['TC002', 'Cửa hàng B', 'Số 2', '', 'Nghệ An', '0902', 'Tủ nằm', 'ngày lạ', 'Alaska', 'Miền Trung', 'NPP02']
  ]),
  'CHI PHI': mkSheet('CHI PHI', [['code_tu', 'ngay_thuc_hien', 'ncc', 'dien_giai', 'thanh_tien', 'mien'],
    ...Array.from({ length: N }, (_, i) => [i % 2 ? 'TC001' : 'TC002', new Date(2025, i % 12, 1 + (i % 27)), 'NCC ' + (i % 5), 'Thay block lần ' + i + ' — sửa chữa thiết bị lạnh', 150000 + i, i % 2 ? 'Miền Bắc' : 'Miền Trung'])]),
  'THANH LY': mkSheet('THANH LY', [['code_tu', 'thanh_ly', 'dien_giai'], ['TC002', new Date(2026, 1, 3), 'Thanh lý']]),
  GSBH: mkSheet('GSBH', [['ma_npp', 'ten_npp', 'ho_ten_gsbh', 'dia_chi_mail', 'so_dien_thoai', 'P&C'], ['NPP01', 'NPP Một', 'Nguyễn A', 'a@th.vn', '0911', 'PC1']])
};
const dg = {
  'DON GIA BT': mkSheet('DON GIA BT', [['ma_imc', 'noi_dung', 'dvt', 'vat_tu', 'nhan_cong', 'tong_cong'], ['I', 'PHẦN ĐIỀU HÒA', '', '', '', ''], ['3-SC', 'Thay tụ block', 'Cái', 441000, 163000, 604000]]),
  'DON GIA XD': mkSheet('DON GIA XD', [['imc', 'noi_dung_cong_viec', 'yeu_cau_ky_thuat_va_vat_lieu', 'dvt', 'don_gia'], ['I', 'XÂY DỰNG', '', '', ''], [1, 'PHÁ DỠ', '', '', ''], ['1_XD', 'Phá dỡ móng', '', 'm3', 960000]]),
  'DON GIA SNK': mkSheet('DON GIA SNK', [['imc', 'noi_dung', 'dvt', 'vat_tu', 'gas_+_phin_loc', 'nhan_cong', 'phu_phi_(van_chuyen/_di_lai)', 'don_gia'], ['I', 'KIỂM TRA', '', '', '', '', '', ''], ['6-SNK', 'Máy nén ETA130L', 'Bộ', 1210000, 300000, 500000, 600000, 2610000]])
};
const DG_ID = '1RFVctqPlPvLodhscIMxIMLrRgIEjSLLUlFUsqI2anSQ';
let openedId = null;

// ---- Firestore giả (REST) ----
const store = {};
const PFX = 'projects/p1/databases/(default)/documents/';
let commits = 0, writtenChunks = 0;
function resp(code, obj) { return { getResponseCode: () => code, getContentText: () => (obj === undefined ? '' : JSON.stringify(obj)) }; }
const UrlFetchApp = { fetch(url, opt) {
  if (url.includes('oauth2')) return resp(200, { access_token: 't' });
  const m = url.match(/documents(.*)$/);
  if (url.endsWith(':commit')) {
    const body = JSON.parse(opt.payload);
    commits++;
    if (body.writes.length > 8) throw new Error('commit quá 8 ghi');
    const bytes = Buffer.byteLength(opt.payload);
    if (bytes > 10 * 1024 * 1024) throw new Error('commit quá 10MiB');
    body.writes.forEach((w) => {
      if (w.delete) delete store[w.delete.replace(PFX, '')];
      else {
        const id = w.update.name.replace(PFX, '');
        const size = Buffer.byteLength(JSON.stringify(w.update.fields));
        if (size > 1048000) throw new Error('tài liệu quá 1MiB: ' + id + ' ' + size);
        if (id.startsWith('care_chunks/')) writtenChunks++;
        store[id] = { name: w.update.name, fields: w.update.fields };
      }
    });
    return resp(200, {});
  }
  const id = m[1].replace(/^\//, '');
  return store[id] ? resp(200, store[id]) : resp(404, {});
} };
const ctx = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: (n) => gt[n] || null }),
    openById: (id) => { openedId = id; if (id !== DG_ID) throw new Error('sai ID'); return { getSheetByName: (n) => dg[n] || null }; },
    getUi: () => { throw new Error('no ui'); }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'FIREBASE_SA' ? JSON.stringify({ client_email: 'x@y', private_key: 'k', project_id: 'p1' }) : null) }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
  Utilities: {
    base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'),
    computeRsaSha256Signature: () => [1, 2, 3],
    computeDigest: (_a, s) => Array.from(crypto.createHash('md5').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' }
  },
  UrlFetchApp,
  Date,          // cùng Date với dữ liệu giả ở trên (vm có realm riêng -> instanceof Date sẽ sai)
  console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(R('apps-script/Sync.gs'), 'utf8'), ctx);

// ---- Lần 1: cài đặt (ghi tất cả) ----
const msg = ctx.caiDatDongBoTrueCare();
console.log(msg);
ok(openedId === DG_ID, 'Đơn giá đọc từ file DG riêng');
const meta = JSON.parse(store['care_meta/data'].fields.json.stringValue);
ok(meta.sets.chiphi_v3.hashes.length >= 3, 'CHI PHI cắt thành ' + meta.sets.chiphi_v3.hashes.length + ' mảnh');
ok(meta.sets.chiphi_v3.count === N, 'CHI PHI đủ ' + N + ' bản ghi');

// ---- Lần 2: không đổi gì -> không ghi mảnh nào ----
writtenChunks = 0;
ctx.dongBoTrueCareNgay();
ok(writtenChunks === 0, 'Không đổi gì thì không ghi lại mảnh nào (' + writtenChunks + ')');

// ---- Lần 3: thêm 1 dòng cuối CHI PHI -> chỉ mảnh cuối ----
gt['CHI PHI']._v.push(['TC001', new Date(2026, 5, 1), 'NCC mới', 'Dòng mới', 999000, 'Miền Bắc']);
writtenChunks = 0;
ctx.dongBoTrueCareNgay();
ok(writtenChunks === 1, 'Thêm 1 dòng cuối chỉ ghi lại 1 mảnh (' + writtenChunks + ')');

// ---- Nạp vào core.js như app.js ----
const CareCore = require(R('js/core.js'));
const meta2 = JSON.parse(store['care_meta/data'].fields.json.stringValue);
Object.keys(meta2.sets).forEach((p) => {
  let rows = [];
  meta2.sets[p].hashes.forEach((h, i) => {
    const d = store['care_chunks/' + p + '__' + i].fields;
    ok(d.hash.stringValue === h, 'mảnh ' + p + '__' + i + ' khớp mã băm');
    rows = rows.concat(JSON.parse(d.json.stringValue));
  });
  CareCore.setData(p, rows);
});
CareCore.setUpdated(Date.parse(meta2.updatedAt));
const A = CareCore.API;

const s1 = A.searchDevice('TC001');
console.log('searchDevice:', JSON.stringify(s1).slice(0, 400));
ok(s1 && s1.success !== false && JSON.stringify(s1).includes('Cửa hàng A'), 'searchDevice tìm thấy TC001');
ok(JSON.stringify(s1).includes('15/01/2024') || JSON.stringify(s1).includes('2024-01-15'), 'ngày lắp đặt đúng');
const s2 = A.searchDevice('TC002');
ok(JSON.stringify(s2).includes('ngày lạ'), 'ngày lắp đặt sai định dạng giữ nguyên văn');
const b = A.batchSearchDevices('TC001\nTC002\nKHONGCO');
console.log('batch:', JSON.stringify(b).slice(0, 300));
ok(b && JSON.stringify(b).includes('KHONGCO'), 'batchSearchDevices');
const cp = A.getChiPhiPageData({ page: 1, pageSize: 20 });
console.log('chiphi page keys:', Object.keys(cp || {}));
ok(cp && JSON.stringify(cp).includes('NCC'), 'getChiPhiPageData');
['bt', 'xd', 'snk'].forEach((c) => {
  const d = A.getDonGiaData(c);
  ok(d && JSON.stringify(d).length > 50, 'getDonGiaData(' + c + ') ' + JSON.stringify(d).slice(0, 120));
});
const fo = A.getFilterOptions({});
ok(fo && fo.success && fo.nccList.length === 6, 'getFilterOptions (' + (fo.nccList || []).length + ' NCC)');
const dash = A.getDashboardData({});
console.log('dashboard:', JSON.stringify(dash).slice(0, 300));
ok(dash && dash.success !== false, 'getDashboardData');
ok(A.getDanhSachThietBiFilterOptions({}) != null, 'getDanhSachThietBiFilterOptions');
const ds = A.getDanhSachThietBiPageData({ page: 1, pageSize: 20 });
ok(ds && JSON.stringify(ds).includes('TC001'), 'getDanhSachThietBiPageData');
const fr = CareCore.freshness();
ok(fr && /\d\d:\d\d \d\d\/\d\d\/\d{4}/.test(fr.text), 'freshness ' + fr.text);

if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(store));
console.log(fails ? '\n' + fails + ' LỖI' : '\nTẤT CẢ OK');
process.exit(fails ? 1 : 0);
