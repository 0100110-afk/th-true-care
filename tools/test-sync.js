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
    ['TC002', 'Cửa hàng B', 'Số 2', '', 'Nghệ An', '0902', 'Tủ nằm', 'ngày lạ', 'Alaska', 'Miền Trung', 10003250]
  ]),
  'CHI PHI': mkSheet('CHI PHI', [['code_tu', 'ngay_thuc_hien', 'ncc', 'dien_giai', 'thanh_tien', 'mien'],
    ...Array.from({ length: N }, (_, i) => [i % 2 ? 'TC001' : 'TC002', new Date(2025, i % 12, 1 + (i % 27)), 'NCC ' + (i % 5), 'Thay block lần ' + i + ' — sửa chữa thiết bị lạnh', 150000 + i, i % 2 ? 'Miền Bắc' : 'Miền Trung'])]),
  'THANH LY': mkSheet('THANH LY', [['code_tu', 'thanh_ly', 'dien_giai'], ['TC002', new Date(2026, 1, 3), 'Thanh lý']]),
  // Bộ 4 sheet GSBH mới (cùng cấu trúc file GT thật): GT nhóm theo Khu vực, KA có dòng nối tiếp + NPP ở 2 miền
  'GSBH GT': mkSheet('GSBH GT', [['Miền', 'Khu vực', 'Mã NPP', 'Tên NPP', 'Tên rút gọn', 'Tỉnh/TP', 'Địa chỉ kho NPP', 'Vị trí', 'Họ & Tên', 'Địa chỉ mail', 'Số Điện thoại', 'P&C phụ trách'],
    ['MB1', 'HN1', 'NPP01', 'CÔNG TY NPP MỘT', 'NPP Một', 'Hà Nội', 'Kho 1', 'GSBH', ' Nguyễn A\n Trần B ', 'a@th.vn\nb@th.vn', '0911222333\n0911444555', 'PC1'],
    ['MB1', 'HN1', 10005207, 'CÔNG TY HƯƠNG HÀ', 'Hương Hà', 'Hà Nội', 'Kho 2', 'GSBH', 'Nguyễn Cung Linh', 'l@th.vn', 394464316, 'PC1']]),
  'ASMSM GT': mkSheet('ASMSM GT', [['Miền', 'Khu vực', 'Mã NPP', 'Tên NPP', 'Tên rút gọn', 'Tỉnh/TP', 'Địa chỉ kho NPP', 'Vị trí', 'Họ & Tên', 'Địa chỉ mail', 'Số Điện thoại', 'P&C phụ trách'],
    ['', 'HN1', '', '', '', '', '', 'ASM', 'Nguyễn Như Long', 'n@th.vn', 913831555, ''],
    ['MB1', '', '', '', '', '', '', 'SM', 'Trần Thế Dũng', 'd@th.vn', 912329429, '']]),
  'GSBH KA': mkSheet('GSBH KA', [['Miền', 'Khu vực', 'Mã NPP', 'Tên NPP', 'Tên rút gọn', 'Tỉnh/TP', 'Địa chỉ kho NPP', 'Vị trí', 'Họ & Tên', 'Địa chỉ mail', 'Số Điện thoại', 'P&C phụ trách'],
    ['MB1', '', 10003250, 'CÔNG TY TNL', 'TNL Hà Nội', 'Hà Nội', '', 'KAE', 'Nguyễn Thị Xoan', 'x@th.vn', 853656789, 'PC2'],
    ['', '', '', '', '', '', '', 'KAE', 'Nguyễn Hà Phương', 'p@th.vn', 889714876, ''],
    ['MB2', '', 10003250, 'CÔNG TY TNL', 'TNL Hà Nội', 'Hà Nội', '', 'KASUP', 'Trần Tuấn Linh', 'tl@th.vn', 912351111, 'PC2']]),
  'ASMSM KA': mkSheet('ASMSM KA', [['Miền', 'Khu vực', 'Mã NPP', 'Tên NPP', 'Tên rút gọn', 'Tỉnh/TP', 'Địa chỉ kho NPP', 'Vị trí', 'Họ & Tên', 'Địa chỉ mail', 'Số Điện thoại', 'P&C phụ trách'],
    ['MB1', '', '', '', '', '', '', 'KAM', 'Nguyễn Thị Kim Anh', 'k@th.vn', 902219983, ''],
    ['MB2', '', '', '', '', '', '', 'KAM', 'Vũ Việt Cường', 'c@th.vn', 916616586, ''],
    ['TQ', '', '', '', '', '', '', 'NKAM', 'Phạm Thị Ngọc Lan', 'l2@th.vn', 932248089, '']])
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
  if (url.includes('identitytoolkit')) return resp(200, { users: [{ email: JSON.parse(opt.payload).idToken.replace('tok:', '') }] });
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
  const id = decodeURIComponent(m[1].replace(/^\//, ''));
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
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType() { return this; }, getContent: () => t }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }), everyHours: () => ({ create: () => {} }) }) }) },
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

// ---- Nút "Đồng bộ từ Google Sheet" trên app -> doPost ----
store['care_users/ad@thmilk.vn'] = { fields: { role: { stringValue: 'admin' } } };
store['care_users/kt@thmilk.vn'] = { fields: { role: { stringValue: 'user' } } };
const call = (e) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'sync', idToken: 'tok:' + e }) } }).getContent());
const rU = call('kt@thmilk.vn');
ok(!rU.ok && /không có quyền/.test(rU.error), 'người dùng thường gọi đồng bộ -> bị từ chối');
gt['CHI PHI']._v.push(['TC002', new Date(2026, 5, 2), 'NCC mới', 'Dòng mới 2', 1000, 'Miền Bắc']);
const rA = call('ad@thmilk.vn'); if (!rA.ok) console.log('rA', rA);
ok(rA.ok && rA.changed.join() === 'chiphi_v3' && /CHI PHI \+1 dòng/.test(rA.details[0]), 'admin bấm đồng bộ -> CHI PHI +1 dòng: ' + JSON.stringify(rA.details));
ok(call('ad@thmilk.vn').changed.length === 0, 'bấm lại -> Không có thay đổi');
// LISTING đổi 1 ô -> thông báo ghi rõ mã + cột + giá trị cũ/mới
gt.LISTING._v[1][8] = 'Sanden';
const rL = call('ad@thmilk.vn');
ok(rL.ok && /LISTING: TC001 đổi Nhãn hiệu \(Sanaky → Sanden\)/.test(rL.details.join()), 'LISTING đổi nhãn hiệu -> báo đúng mã/cột: ' + JSON.stringify(rL.details));
const metaL = JSON.parse(store['care_meta/data'].fields.json.stringValue);
ok(/TC001 đổi Nhãn hiệu/.test(metaL.sets.listing_v4.change.text), 'mô tả thay đổi lưu trong meta cho app đọc');
// Chỉ đổi thứ tự dòng -> báo "chỉ đổi vị trí"
const tmp = gt.LISTING._v[1]; gt.LISTING._v[1] = gt.LISTING._v[2]; gt.LISTING._v[2] = tmp;
const rM = call('ad@thmilk.vn');
ok(/2 dòng chỉ đổi vị trí/.test(rM.details.join()), 'sắp xếp lại dòng -> báo đổi vị trí: ' + JSON.stringify(rM.details));
gt.LISTING._v[2] = gt.LISTING._v[1]; gt.LISTING._v[1] = tmp; tmp[8] = 'Sanaky'; call('ad@thmilk.vn');

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
const gl = (s1.gsbh_list || []).map((g) => g.hoTen + ':' + g.soDienThoai).join(',');
ok(gl === 'Nguyễn A:0911222333,Trần B:0911444555', 'GSBH của thiết bị: tách 2 người, SĐT không khoảng trắng (' + gl + ')');
ok((s1.pc_list || []).join() === 'PC1', 'P&C phụ trách theo NPP');
const s2 = A.searchDevice('TC002');
const g2 = (s2.gsbh_list || []).map((g) => g.viTri + ' ' + g.hoTen).join(',');
ok(g2 === 'KAE Nguyễn Thị Xoan,KAE Nguyễn Hà Phương,KASUP Trần Tuấn Linh', 'KA: dòng nối tiếp + NPP ở 2 miền gom đúng (' + g2 + ')');
ok(/TNL Hà Nội/.test(JSON.stringify(A.getDanhSachThietBiPageData({ all: true }))), 'tên NPP lấy từ cột Tên rút gọn');
const dir = A.getGsbhDirectory();
const gs = dir.groups.map((g) => g.kenh + '/' + g.mien + '/' + g.khuVuc + ':' + g.quanLy.map((q) => q.role + ' ' + q.ten + ' ' + q.sdt).join('+') + ' [' + g.npps.map((n) => n.tenNpp + '=' + n.nguoi.map((x) => x.role + ' ' + x.ten).join('/')).join('; ') + ']');
console.log(gs.join('\n'));
ok(dir.groups.length === 3, 'danh bạ: 3 nhóm (GT HN1, KA MB1, KA MB2)');
ok(gs[0] === 'GT/MB1/HN1:ASM Nguyễn Như Long 0913831555+SM Trần Thế Dũng 0912329429 [NPP Một=GSBH Nguyễn A/GSBH Trần B; Hương Hà=GSBH Nguyễn Cung Linh]', 'nhóm GT: ASM + SM 1 lần ở đầu khu vực');
ok(gs[1] === 'KA/MB1/:KAM Nguyễn Thị Kim Anh 0902219983+NKAM Phạm Thị Ngọc Lan 0932248089 [TNL Hà Nội=KAE Nguyễn Thị Xoan/KAE Nguyễn Hà Phương]', 'nhóm KA MB1');
ok(gs[2] === 'KA/MB2/:KAM Vũ Việt Cường 0916616586+NKAM Phạm Thị Ngọc Lan 0932248089 [TNL Hà Nội=KASUP Trần Tuấn Linh]', 'nhóm KA MB2 (cùng NPP, người khác)');
ok(dir.mienList.join() === 'MB1,MB2' && dir.pcList.join() === 'PC1,PC2', 'danh sách Miền / P&C cho bộ lọc');
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
