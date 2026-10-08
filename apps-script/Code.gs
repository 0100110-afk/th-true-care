/**
 * ỨNG DỤNG QUẢN LÝ & TRA CỨU TỦ MÁT
 * -------------------------------------------------------------------------
 * Sheet "LISTING": code_tu | vung | ma_npp | ten_cua_hang | dia_chi | phuong_xa | tinh_thanh_pho
 *                  | so_dien_thoai_cua_hang | loai_tu | ngay_lap_dat | nhan_hieu
 * Sheet "CHI PHI": code_tu | ngay_thuc_hien | ncc | dien_giai | thanh_tien | mien
 * Sheet "THANH LY": code_tu | thanh_ly | dien_giai
 * Sheet "GSBH": ma_npp | ten_npp | ho_ten_gsbh | dia_chi_mail | so_dien_thoai | P&C
 *   - 3 cột ho_ten_gsbh / dia_chi_mail / so_dien_thoai có thể chứa NHIỀU dòng trong 1 ô khi NPP
 *     có 2 GSBH -> tách theo dòng rồi ghép cặp tên/mail/số điện thoại.
 * Sheet "DON GIA BT": ma_imc | noi_dung | dvt | vat_tu | nhan_cong | tong_cong
 * Sheet "DON GIA SNK": imc | noi_dung | dvt | vat_tu | gas_+_phin_loc | nhan_cong
 *                      | phu_phi_(van_chuyen/_di_lai) | don_gia
 *   - Dòng "đầu mục" (ma_imc là số La Mã I, II, III...) chỉ có tên nhóm, các cột giá để trống.
 * Sheet "DON GIA XD": imc | noi_dung_cong_viec | yeu_cau_ky_thuat_va_vat_lieu | dvt | don_gia
 *   - Riêng sheet này có 2 CẤP đầu mục: cấp lớn (I, II, III...) và cấp nhỏ lồng bên trong
 *     (1, 2, 3...). Dòng đơn giá thật có imc dạng "12_XD", "3_XD".
 *
 * ĐỌC DỮ LIỆU: mỗi sheet đọc trọn getDataRange 1 lần, tra cột theo TÊN HEADER nên không phụ
 * thuộc thứ tự cột. Kết quả cache qua CacheService; trigger silentRefreshCache dựng lại mỗi
 * 30 phút để cache luôn nóng.
 *
 * QUY TẮC NGHIỆP VỤ:
 *  - Bảo hành MỖI LƯỢT SỬA: (hôm nay - ngày sửa) <= 180 ngày.
 *  - Bảo hành THIẾT BỊ:     (hôm nay - ngày lắp đặt) <= 730 ngày.
 *  - MỘT LƯỢT SỬA CHỮA = mã thiết bị + ngày thực hiện + nhà cung cấp (xem repairKey_).
 *    Dashboard và Lịch sử thiết bị BẮT BUỘC dùng chung định nghĩa này.
 *  - Chi phí di chuyển = nội dung chứa "km", "đi lại", "chi phí đi/di...". Còn lại là sửa chữa.
 *  - GỘP NHÃN: loại thiết bị / nhãn hiệu / nhà cung cấp / nhà phân phối chỉ khác nhau về định
 *    dạng (hoa-thường, dấu tiếng Việt, khoảng trắng) được coi là MỘT (xem labelKey_).
 *
 * Lịch sử sửa lỗi các phiên bản trước: xem CHANGELOG.md
 */

var SHEET_LISTING = 'LISTING';
var SHEET_CHIPHI = 'CHI PHI';
var SHEET_THANHLY = 'THANH LY';
var SHEET_GSBH = 'GSBH';
var SHEET_DONGIA_BT = 'DON GIA BT';
var SHEET_DONGIA_XD = 'DON GIA XD';
var SHEET_DONGIA_SNK = 'DON GIA SNK';

var WARRANTY_DAYS_REPAIR = 180; // Tình trạng bảo hành cho từng lần sửa chữa
var WARRANTY_DAYS_DEVICE = 730; // Tình trạng bảo hành tổng thể của thiết bị (theo ngày lắp đặt)

/**
 * TTL cache tách theo mức độ biến động của dữ liệu:
 *  - CACHE_TTL_SECONDS (35 phút): dữ liệu thay đổi hằng ngày. Con số này CỐ Ý lớn hơn chu kỳ
 *    trigger 30 phút để trigger kịp nạp lại TRƯỚC KHI cache hết hạn -> người dùng gần như không
 *    bao giờ gặp cache rỗng.
 *  - CACHE_TTL_DONGIA (6 tiếng): đơn giá gần như không đổi. 21600 giây cũng chính là TRẦN TỐI ĐA
 *    mà CacheService cho phép, không đặt cao hơn được.
 */
var CACHE_TTL_SECONDS = 2100;
var CACHE_TTL_DONGIA = 21600;

/**
 * CacheService chặn cứng 100KB MỖI KEY (tính theo byte) và dọn FIFO quanh mốc ~1000 key.
 * Vượt 100KB thì putAll ném lỗi, bị try/catch trong writeCacheRecords nuốt im lặng, và cache
 * KHÔNG BAO GIỜ ghi được mà không ai hay.
 *
 * 30.000 ký tự là mức an toàn cho cả trường hợp xấu nhất (3 byte/ký tự = 88KB). Dữ liệu thật
 * chỉ ~1,17 byte/ký tự nên chunk nặng nhất đo được là 34KB, tức mới dùng 34% trần.
 *
 * Ràng buộc thực sự là SỐ LƯỢNG key, không phải kích thước key: giảm hằng số này sẽ nhân số key
 * lên và đẩy tới mốc bị dọn FIFO. Chạy kiemTraCache() để xem số đo hiện tại trước khi đổi.
 */
var CACHE_CHUNK_SIZE = 30000;

// Vị trí trường trong mảng bản ghi rút gọn (dùng mảng thay vì object để giảm dung lượng cache)
// NGAYRAW / NGAYLAPRAW: chỉ có giá trị khi ô ngày gốc KHÔNG phân tích được, dùng để hiển thị
// nguyên văn kèm badge cảnh báo thay vì để trống.
var CP = { CODE: 0, NGAY: 1, NCC: 2, NOIDUNG: 3, TIEN: 4, MIEN: 5, ROW: 6, NGAYRAW: 7 };
var LS = { CODE: 0, TEN: 1, DIACHI: 2, SDT: 3, LOAITU: 4, NGAYLAP: 5, NHANHIEU: 6, VUNG: 7, MANPP: 8, ROW: 9, NGAYLAPRAW: 10 };
var TL = { CODE: 0, THANHLY: 1, DIENGIAI: 2, ROW: 3 };
var GS = { MANPP: 0, TENNPP: 1, HOTEN: 2, EMAIL: 3, SDT: 4, PC: 5, ROW: 6 };

function doGet(e) {
  var isMobile = e && e.parameter && e.parameter.view === 'mobile';
  var page = isMobile ? 'IndexMobile' : 'Index';

  return HtmlService.createHtmlOutputFromFile(page)
    .setTitle('TH true care · Quản lý thiết bị')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ============================= HELPERS CHUNG ============================= */

function normalizeCode(code) {
  if (code === null || code === undefined) return '';
  return String(code).trim();
}

function removeDiacritics(str) {
  str = String(str || '');
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/* ============================= GỘP NHÃN TRÙNG ĐỊNH DẠNG ============================= */

/**
 * KHOÁ GỘP NHÃN — NGUỒN CHUẨN DUY NHẤT cho việc coi hai chuỗi là "cùng một thứ".
 *
 * Bỏ dấu tiếng Việt, gộp mọi cụm khoảng trắng (kể cả tab, xuống dòng, khoảng trắng không ngắt
 * U+00A0 mà Sheets hay sinh ra khi dán từ Excel) về một dấu cách, cắt hai đầu, hạ về chữ thường:
 *      "Sanaky" / "SANAKY" / " sanaky "        -> "sanaky"
 *      "Tủ Kem 210L" / "Tủ  Kem 210L"          -> "tu kem 210l"
 *      "Tủ Mát 1 Cánh" / "Tu Mat 1 Canh"       -> "tu mat 1 canh"
 *
 * CỐ Ý bỏ luôn dấu: dữ liệu nhập tay thường xuyên thiếu dấu, nếu chỉ gộp hoa-thường thì
 * "Tu Mat 1 Canh" vẫn tách thành nhóm riêng. Đổi ý thì gỡ removeDiacritics ở đây, một chỗ duy
 * nhất, mọi nơi gọi tới đều đổi theo.
 */
function labelKey_(s) {
  return removeDiacritics(String(s || ''))
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Cộng dồn một giá trị vào nhóm nhãn tương ứng trong "store".
 *
 * store[key] = {
 *   total:  tổng trọng số của cả nhóm (số thiết bị, hoặc tổng chi phí)
 *   order:  thứ tự gặp lần đầu — dùng để phá hoà khi sắp xếp
 *   best:   BIẾN THỂ ĐƯỢC CHỌN LÀM TÊN HIỂN THỊ
 *   bestW:  trọng số của biến thể đang giữ ngôi best
 *   variants: { "<nguyên văn>": trọng số cộng dồn }
 * }
 *
 * Tên hiển thị lấy theo biến thể có TRỌNG SỐ LỚN NHẤT ("Sanaky" 5.803 thắng "SANAKY" 13). So
 * sánh dùng > chứ không >=, nên khi hoà thì biến thể GẶP TRƯỚC trong Sheet giữ ngôi — kết quả
 * ổn định, chạy lại nhiều lần vẫn ra một tên.
 */
function tallyLabel_(store, rawLabel, weight, order) {
  var key = labelKey_(rawLabel);
  if (!key) return null;

  var label = String(rawLabel).replace(/\s+/g, ' ').trim();
  var e = store[key];
  if (!e) {
    e = store[key] = { total: 0, order: order, best: label, bestW: -Infinity, variants: {} };
  }

  e.total += weight;
  var vw = (e.variants[label] || 0) + weight;
  e.variants[label] = vw;
  if (vw > e.bestW) { e.bestW = vw; e.best = label; }
  return e;
}

/** Danh sách tên hiển thị của mọi nhóm trong store, sắp xếp theo bảng chữ cái */
function storeLabels_(store) {
  return Object.keys(store).map(function (k) { return store[k].best; }).sort();
}

function buildHeaderIndex(headers) {
  var idx = {};
  headers.forEach(function (h, i) {
    var key = removeDiacritics(String(h).trim()).replace(/\s+/g, '_');
    idx[key] = i;
  });
  return idx;
}

function cellStr(row, idx, key) {
  if (idx[key] === undefined) return '';
  var v = row[idx[key]];
  return (v === null || v === undefined) ? '' : String(v);
}

/**
 * Một số cột (như "thanh_ly") có thể được Google Sheets tự nhận là kiểu Date dù bản chất là
 * text mô tả trạng thái. Nếu là Date thật thì hiển thị dd/mm/yyyy; nếu là text thì giữ nguyên.
 */
function cellFlexible(row, idx, key) {
  if (idx[key] === undefined) return '';
  var v = row[idx[key]];
  if (v === null || v === undefined) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return formatDateDisplay(v);
  return String(v).trim();
}

/**
 * Dựng đối tượng Date từ 3 số năm/tháng/ngày, có KIỂM TRA NGƯỢC.
 *
 * Đây là điểm mấu chốt để bắt ngày không hợp lệ: `new Date(2026, 1, 31)` KHÔNG trả NaN mà tự
 * CUỘN TRÀN sang 03/03/2026. Vì vậy chỉ kiểm tra isNaN là không đủ — phải dựng xong rồi so lại
 * đủ cả 3 thành phần, lệch bất kỳ thành phần nào tức là ngày gốc không tồn tại (31/02, 31/04,
 * 29/02 của năm không nhuận...).
 */
function buildDateStrict_(y, month, day) {
  if (!(y >= 1000 && y <= 9999)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;

  var d = new Date(y, month - 1, day);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() !== y || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Phân tích giá trị ngày (Date hoặc chuỗi). Trả null nếu không phân tích được hoặc ngày không
 * hợp lệ — người gọi PHẢI tự xử lý null.
 *
 * Dạng số/số/năm: số nào > 12 thì chắc chắn là NGÀY. Cả hai <= 12 thì không phân biệt được,
 * mặc định M/D/yyyy (xem cảnh báo tại nhánh đó).
 *
 * KHÔNG dùng `new Date(str)` làm dự phòng: nó nhận đủ loại chuỗi rác rồi tự suy diễn ra một ngày,
 * khiến dữ liệu sai lọt qua mà không ai biết.
 */
function parseDateSafe(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;

  var str = value.trim();
  if (!str) return null;

  // ISO: yyyy-mm-dd (có thể kèm giờ phía sau, bỏ qua giờ)
  var isoM = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (isoM) return buildDateStrict_(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));

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
    return buildDateStrict_(y, month, day);
  }

  return null;
}

/** true nếu ô có dữ liệu nhưng KHÔNG phân tích được thành ngày hợp lệ */
function isBadDate_(value) {
  if (value === null || value === undefined) return false;
  if (String(value).trim() === '') return false;
  return parseDateSafe(value) === null;
}

/** Trả về nguyên văn ô ngày khi nó không hợp lệ, ngược lại trả chuỗi rỗng */
function rawDateText_(value) {
  return isBadDate_(value) ? String(value).trim() : '';
}

function formatDateDisplay(value) {
  var d = parseDateSafe(value);
  if (!d) return '';
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + d.getFullYear();
}

function dateToIso(value) {
  var d = parseDateSafe(value);
  if (!d) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Chuẩn hoá số điện thoại VN. Bóc tiền tố quốc gia (+84 / 0084 / 84) TRƯỚC, rồi bù số "0" mà
 * Google Sheets làm rụng khi ô lưu dạng SỐ:
 *      "+84 901 234 567" -> "0901234567"     (di động, 9 chữ số)
 *      "2437917943"      -> "02437917943"    (cố định, 10 chữ số bắt đầu bằng 2)
 *
 * Không ra được số hợp lệ (10 hoặc 11 chữ số) thì TRẢ NGUYÊN CHUỖI GỐC — thà hiện đúng thứ đã
 * nhập còn hơn bịa ra số sai trông có vẻ hợp lệ. Điều này xử lý luôn ô chứa 2 số.
 */
function formatPhone(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';

  // Giữ lại dấu "+" để nhận diện tiền tố quốc tế, chỉ bỏ các ký tự trang trí
  var cleaned = s.replace(/[\s.\-()]/g, '');
  var hasPlus = cleaned.charAt(0) === '+';
  var digits = hasPlus ? cleaned.substring(1) : cleaned;

  // Còn ký tự lạ (vd "/" ngăn 2 số, chữ "N/A"...) -> không đụng vào, trả nguyên gốc
  if (!/^\d+$/.test(digits)) return s;

  // Bóc tiền tố quốc gia
  if (hasPlus && digits.indexOf('84') === 0) {
    digits = digits.substring(2);
  } else if (digits.indexOf('0084') === 0) {
    digits = digits.substring(4);
  } else if (digits.indexOf('84') === 0 && digits.length === 11) {
    // "84901234567" -> bỏ "84" còn đúng 9 số. Chỉ áp khi tổng đúng 11 để không cắt nhầm các số
    // nội địa bắt đầu bằng 84 (vd "0084..." đã xử lý ở trên, "8412345" thì giữ nguyên).
    digits = digits.substring(2);
  }

  if (digits.charAt(0) !== '0') {
    /* Sheets làm rụng số 0 đầu khi ô lưu dạng SỐ. Hai ca hợp lệ:
         9 chữ số            -> di động  ("912345678"  -> "0912345678")
         10 chữ số, đầu là 2 -> cố định  ("2437917943" -> "02437917943")
       Sau quy hoạch 2017, MỌI mã vùng cố định VN đều bắt đầu bằng 2 và tổng luôn 11 chữ số kể cả
       số 0 đầu (024 + 8 số, 0296 + 7 số...). Di động rụng 0 chỉ còn 9 số nên hai điều kiện không
       thể chồng lấn. Bản cũ thiếu nhánh thứ hai -> mọi số cố định rơi vào `return s` và hiển thị
       thiếu hẳn số 0; kéo theo cả ô tìm kiếm ở getDanhSachThietBiPageData không khớp khi người
       dùng gõ số có số 0 đầu. */
    if (digits.length === 9) digits = '0' + digits;
    else if (digits.length === 10 && digits.charAt(0) === '2') digits = '0' + digits;
    else return s;
  }

  // Số VN hợp lệ: 10 chữ số (di động) hoặc 11 (cố định, và một số đầu số di động cũ)
  if (digits.length !== 10 && digits.length !== 11) return s;
  return digits;
}

function isTravelCost(dienGiai) {
  var s = removeDiacritics(String(dienGiai || '')).toLowerCase();
  return s.indexOf('km') !== -1 ||
         s.indexOf('di lai') !== -1 ||
         s.indexOf('chi phi di') !== -1;
}

/**
 * KHOÁ XÁC ĐỊNH "MỘT LƯỢT SỬA CHỮA" — NGUỒN CHUẨN DUY NHẤT.
 * Một lượt = mã thiết bị + ngày thực hiện + nhà cung cấp.
 *
 * getDashboardData() và buildRepairHistory() đều PHẢI gọi hàm này, nếu không hai con số sẽ lệch
 * nhau mà không ai phát hiện. Nhờ dùng chung, "Số lượt sửa chữa" trên Dashboard đúng bằng tổng
 * "Số lần sửa chữa" của mọi thiết bị -> kiểm chứng được bằng tay.
 *
 * Dữ liệu thiếu:  không mã -> "(không mã)" (vẫn đếm);  ngày sai -> gộp theo nguyên văn ô ngày;
 * không có ngày -> mỗi dòng 1 lượt riêng (không có cơ sở để khẳng định chúng cùng một lần sửa).
 *
 * CỐ Ý KHÔNG dùng labelKey_ cho phần NCC ở đây. Chuẩn hoá NCC sẽ gộp thêm một số cặp dòng lại
 * và làm "Số lượt sửa chữa" GIẢM so với các báo cáo đã phát hành. Việc gộp nhãn chỉ áp cho bộ
 * lọc và các bảng thống kê, không đụng tới con số đếm lượt.
 */
function repairKey_(code, ngayIso, ngayRaw, ncc, rowIdx) {
  var codePart = code ? String(code).trim() : '(không mã)';
  var nccPart = ncc ? String(ncc).trim() : '(không NCC)';

  var datePart;
  if (ngayIso) datePart = ngayIso;
  else if (ngayRaw) datePart = 'loi:' + String(ngayRaw).trim();
  else datePart = 'dong:' + rowIdx;

  return codePart + '|' + datePart + '|' + nccPart;
}

function regionKey(mienRaw) {
  var s = removeDiacritics(String(mienRaw || '')).toLowerCase();
  if (s.indexOf('bac') !== -1) return 'bac';
  if (s.indexOf('trung') !== -1) return 'trung';
  if (s.indexOf('nam') !== -1) return 'nam';
  return 'khac';
}

function regionKeyFromVung(vungRaw) {
  var s = removeDiacritics(String(vungRaw || '')).toUpperCase().trim();
  if (s.indexOf('MTR') === 0) return 'trung';
  if (s.indexOf('MB') === 0) return 'bac';
  if (s.indexOf('MN') === 0) return 'nam';
  return 'khac';
}

function regionLabel(key) {
  return { bac: 'Miền Bắc', trung: 'Miền Trung', nam: 'Miền Nam', khac: 'Khác' }[key] || 'Khác';
}

function parseInputDate(str) {
  var m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return buildDateStrict_(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Tách 1 ô có thể chứa nhiều dòng (xuống dòng) thành mảng các giá trị không rỗng */
function splitMultiLine(str) {
  return String(str || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
}

/* ============================= LỚP CACHE ============================= */

function getCache() { return CacheService.getScriptCache(); }

function readCachedRecords(prefix, rebuildFn) {
  var cache = getCache();
  var metaStr = cache.get(prefix + '_meta');
  if (metaStr) {
    try {
      var meta = JSON.parse(metaStr);
      var keys = [];
      for (var i = 0; i < meta.chunks; i++) keys.push(prefix + '_chunk_' + i);
      var chunkMap = cache.getAll(keys);
      if (Object.keys(chunkMap).length === meta.chunks) {
        var jsonStr = '';
        for (var j = 0; j < meta.chunks; j++) jsonStr += chunkMap[prefix + '_chunk_' + j];
        return JSON.parse(jsonStr);
      }
    } catch (e) {
      // Cache lỗi/hỏng -> đọc lại từ sheet bên dưới
    }
  }
  return rebuildFn();
}

function writeCacheRecords(prefix, records, ttlSeconds) {
  ttlSeconds = ttlSeconds || CACHE_TTL_SECONDS;
  try {
    var jsonStr = JSON.stringify(records);
    var chunks = [];
    for (var i = 0; i < jsonStr.length; i += CACHE_CHUNK_SIZE) {
      chunks.push(jsonStr.substring(i, i + CACHE_CHUNK_SIZE));
    }
    var payload = {};
    chunks.forEach(function (c, idx) { payload[prefix + '_chunk_' + idx] = c; });
    var cache = getCache();
    cache.putAll(payload, ttlSeconds);
    cache.put(prefix + '_meta', JSON.stringify({ chunks: chunks.length, ts: Date.now() }), ttlSeconds);
  } catch (e) {
    // Dữ liệu quá lớn để cache hết -> bỏ qua, lần sau vẫn đọc trực tiếp từ sheet
  }
}

function clearCachePrefix(prefix) {
  var cache = getCache();
  var metaStr = cache.get(prefix + '_meta');
  var keys = [prefix + '_meta'];
  if (metaStr) {
    try {
      var meta = JSON.parse(metaStr);
      for (var i = 0; i < meta.chunks; i++) keys.push(prefix + '_chunk_' + i);
    } catch (e) { /* ignore */ }
  }
  cache.removeAll(keys);
}

/** true nếu cache của prefix này còn sống */
function isCacheWarm_(prefix) {
  return !!getCache().get(prefix + '_meta');
}

// LƯU Ý: listing_v4 / chiphi_v3 là phiên bản MỚI (thêm trường NGAYRAW / NGAYLAPRAW). Bất cứ khi
// nào đổi cấu trúc bản ghi đều PHẢI tăng số version, nếu không cache cũ vẫn sống tới hết TTL và
// thiếu trường mới.
// Việc gộp nhãn (labelKey_) KHÔNG đổi cấu trúc bản ghi — nó chạy lúc tổng hợp, sau khi đọc cache
// — nên KHÔNG cần tăng version, cache đang có vẫn dùng lại được nguyên vẹn.
var VOLATILE_PREFIXES = ['listing_v4', 'chiphi_v3', 'thanhly_v1', 'gsbh_v1'];
var DONGIA_PREFIXES = ['dongia_bt_v1', 'dongia_xd_v1', 'dongia_snk_v1'];
var CACHE_PREFIXES = VOLATILE_PREFIXES.concat(DONGIA_PREFIXES);

var PROP_LAST_OK = 'cache_last_success';
var PROP_LAST_ERR = 'cache_last_error';

/** Ghi lại mốc làm mới cache gần nhất để phát hiện trigger chết (xem getRefreshStatus) */
function recordRefreshStatus_(ok, message) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (ok) {
      props.setProperty(PROP_LAST_OK, new Date().toISOString());
      props.deleteProperty(PROP_LAST_ERR);
    } else {
      props.setProperty(PROP_LAST_ERR, new Date().toISOString() + ' — ' + message);
    }
  } catch (e) { /* ignore */ }
}

function rebuildVolatileData_() {
  rebuildListingRecords();
  rebuildChiPhiRecords();
  rebuildThanhLyRecords();
  rebuildGsbhRecords();
}

function rebuildDonGiaData_() {
  rebuildDonGiaBtRecords();
  rebuildDonGiaXdRecords();
  rebuildDonGiaSnkRecords();
}

/**
 * Nút "Làm mới dữ liệu" trên giao diện.
 * Nạp lại NGAY toàn bộ thay vì chỉ xoá cache: người dùng chờ một lần dưới overlay "Đang làm mới
 * dữ liệu...", sau đó mọi trang đều nhanh. Nếu chỉ xoá, chi phí đọc Sheet sẽ bị dời sang các cú
 * click tiếp theo và trang nào mở lần đầu cũng khựng một nhịp.
 */
function refreshCache() {
  try {
    rebuildVolatileData_();
    rebuildDonGiaData_();
    recordRefreshStatus_(true, '');
    return { success: true, message: 'Đã tải lại toàn bộ dữ liệu mới nhất.' };
  } catch (err) {
    recordRefreshStatus_(false, err.message);
    return { success: false, message: 'Không tải lại được dữ liệu: ' + err.message };
  }
}

/** Xoá sạch cache mà không đọc lại — dùng khi cần xử lý sự cố, không gọi từ giao diện. */
function clearAllCache() {
  CACHE_PREFIXES.forEach(function (p) { clearCachePrefix(p); });
  return { success: true, message: 'Đã xoá toàn bộ cache.' };
}

/**
 * Chạy nền theo trigger 30 phút để cache luôn "nóng".
 * Đơn giá có TTL 6 tiếng nên chỉ dựng lại khi cache của nó đã hết hạn, tránh đọc thừa 3 sheet
 * đơn giá 48 lần/ngày.
 */
function silentRefreshCache() {
  try {
    rebuildVolatileData_();

    var needDonGia = DONGIA_PREFIXES.some(function (p) { return !isCacheWarm_(p); });
    if (needDonGia) rebuildDonGiaData_();

    recordRefreshStatus_(true, '');
  } catch (e) {
    recordRefreshStatus_(false, e.message);
    Logger.log('Lỗi khi tự động làm mới cache: ' + e.message);
  }
}

/**
 * Kiểm tra "sức khoẻ" của trigger làm mới nền. Chạy thủ công trong trình soạn thảo Apps Script
 * (chọn getRefreshStatus rồi bấm Run, xem kết quả ở Execution log).
 *
 * Nếu lastSuccess đã quá cũ (> 2 tiếng) tức là trigger nhiều khả năng đã chết — app vẫn chạy
 * nhưng cache hết hạn mỗi 35 phút mà không ai nạp lại, nên sẽ chậm dần mà không báo lỗi gì.
 */
function getRefreshStatus() {
  var props = PropertiesService.getScriptProperties();
  var lastOk = props.getProperty(PROP_LAST_OK);
  var lastErr = props.getProperty(PROP_LAST_ERR);

  var stale = true;
  var ageMinutes = null;
  if (lastOk) {
    ageMinutes = Math.round((Date.now() - new Date(lastOk).getTime()) / 60000);
    stale = ageMinutes > 120;
  }

  var triggerCount = 0;
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'silentRefreshCache') triggerCount++;
    });
  } catch (e) { /* ignore */ }

  var status = {
    lastSuccess: lastOk || '(chưa lần nào)',
    minutesSinceLastSuccess: ageMinutes,
    lastError: lastErr || '(không có)',
    triggerInstalled: triggerCount > 0,
    stale: stale,
    warmPrefixes: CACHE_PREFIXES.filter(isCacheWarm_)
  };
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

/* ============================= MỐC THỜI GIAN DỮ LIỆU ============================= */

var TZ_VN = 'Asia/Ho_Chi_Minh';

/**
 * Đọc mốc thời gian mà writeCacheRecords() đã đóng dấu sẵn vào meta của một prefix cache.
 * Trả null nếu cache đã nguội (meta hết hạn hoặc chưa từng được ghi).
 */
function cacheStamp_(prefix) {
  var metaStr = getCache().get(prefix + '_meta');
  if (!metaStr) return null;
  try {
    var meta = JSON.parse(metaStr);
    return (meta && meta.ts) ? Number(meta.ts) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Mốc thời gian dữ liệu ĐANG HIỂN THỊ được đọc từ Sheet. KHÔNG tự nạp dữ liệu, chỉ đọc meta.
 *
 * Dùng meta.ts chứ KHÔNG dùng PROP_LAST_OK: PROP_LAST_OK chỉ được ghi bởi refreshCache() và
 * silentRefreshCache(), nên khi cache được nạp lười nó vẫn đứng ở lần trigger trước -> nói dối.
 * Lấy mốc CŨ HƠN giữa LISTING và CHI PHI vì hai sheet nạp độc lập, màn hình trộn cả hai.
 * Múi giờ ghi cứng để không phụ thuộc cài đặt của dự án Apps Script.
 */
function freshnessPayload_() {
  var stamps = ['listing_v4', 'chiphi_v3'].map(cacheStamp_).filter(function (t) { return t; });
  var ts = stamps.length ? Math.min.apply(null, stamps) : null;

  return {
    ts: ts,
    text: ts ? Utilities.formatDate(new Date(ts), TZ_VN, 'HH:mm dd/MM/yyyy') : ''
  };
}

/**
 * Bản cho giao diện gọi trực tiếp sau khi bấm "Làm mới dữ liệu". Nạp dữ liệu trước rồi mới đọc
 * mốc, vì lúc đó cache có thể đang nguội.
 */
function getDataFreshness() {
  getListingRecords();
  getChiPhiRecords();
  return freshnessPayload_();
}

/* ============================= CHẨN ĐOÁN CACHE ============================= */

// CacheService chặn CỨNG ở 100 KB mỗi khoá (vượt là ném lỗi), và bắt đầu dọn theo kiểu FIFO
// quanh mốc ~1000 khoá — mỗi lần dọn xoá khoảng 10% số mục. Đây mới là trần thực sự nguy hiểm
// với app này, vì CHI PHI một mình đã chiếm hàng trăm khoá.
var CACHE_LIMIT_BYTES = 102400;   // 100 KB — trần cứng mỗi khoá
var CACHE_WARN_BYTES = 92160;     // 90 KB — còn 10% biên thì cảnh báo
var CACHE_KEY_LIMIT = 1000;       // mốc bắt đầu bị dọn FIFO
var CACHE_KEY_WARN = 800;

/**
 * Đếm byte UTF-8 bằng vòng lặp thuần. Không dùng Utilities.newBlob().getBytes().length vì đó là
 * lời gọi dịch vụ, nhân với hàng trăm chunk sẽ rất chậm. Surrogate pair tính 4 byte, bỏ nửa sau.
 */
function utf8Len_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/**
 * ĐO TẢI CACHE THỰC TẾ. Chạy thủ công trong trình soạn thảo: chọn kiemTraCache -> Run ->
 * xem Execution log. Hàm CHỈ ĐỌC nên phải chạy NGAY SAU khi mở app hoặc bấm "Làm mới dữ liệu";
 * chạy lúc cache nguội thì mọi prefix đều báo NGUỘI và báo cáo vô nghĩa.
 *
 * Nhìn 3 thứ: (1) có prefix nào THIẾU chunk không — thiếu nghĩa là đang đọc thẳng Sheet ở mọi
 * lượt, chậm hẳn mà không báo lỗi; (2) chunk nặng nhất so với trần 100KB; (3) tổng số khoá so
 * với mốc ~1000.
 */
function kiemTraCache() {
  var cache = getCache();
  var dong = [];
  var tongKhoa = 0, tongByte = 0, coCanhBao = false, soNguoi = 0;

  dong.push('===== TẢI CACHE THỰC TẾ — ' + Utilities.formatDate(new Date(), TZ_VN, 'HH:mm dd/MM/yyyy') + ' =====');
  dong.push('');

  CACHE_PREFIXES.forEach(function (prefix) {
    var metaStr = cache.get(prefix + '_meta');
    if (!metaStr) {
      soNguoi++;
      dong.push('· ' + prefix + ': NGUỘI (chưa ghi được, hoặc đã hết hạn)');
      return;
    }

    var meta;
    try {
      meta = JSON.parse(metaStr);
    } catch (e) {
      coCanhBao = true;
      dong.push('· ' + prefix + ': META HỎNG — ' + e.message);
      return;
    }

    var soChunk = meta.chunks || 0;
    var byteCua = 0, chunkNang = 0, soThieu = 0;

    // Đọc theo lô 50 khoá để không kéo cả chục MB vào bộ nhớ cùng một lúc
    for (var i = 0; i < soChunk; i += 50) {
      var lo = [];
      for (var j = i; j < Math.min(i + 50, soChunk); j++) lo.push(prefix + '_chunk_' + j);

      var map = cache.getAll(lo);
      soThieu += lo.length - Object.keys(map).length;

      Object.keys(map).forEach(function (k) {
        var b = utf8Len_(map[k]);
        byteCua += b;
        if (b > chunkNang) chunkNang = b;
      });
    }

    tongKhoa += soChunk + 1; // +1 cho chính khoá _meta
    tongByte += byteCua;

    dong.push('· ' + prefix + ': ' + soChunk + ' chunk | ' +
      (byteCua / 1048576).toFixed(2) + ' MB | nặng nhất ' +
      (chunkNang / 1024).toFixed(1) + ' KB (' +
      Math.round(chunkNang / CACHE_LIMIT_BYTES * 100) + '% trần)');

    if (soThieu > 0) {
      coCanhBao = true;
      dong.push('    ✘ THIẾU ' + soThieu + '/' + soChunk + ' chunk (đã bị dọn) — prefix này đang' +
        ' bị đọc thẳng từ Sheet ở MỌI lượt truy cập');
    }
    if (chunkNang > CACHE_WARN_BYTES) {
      coCanhBao = true;
      dong.push('    ⚠ chunk nặng nhất đã vượt 90 KB, sát trần 100 KB — cần GIẢM CACHE_CHUNK_SIZE');
    }
  });

  dong.push('');
  dong.push('TỔNG: ' + tongKhoa + ' khoá | ' + (tongByte / 1048576).toFixed(2) + ' MB' +
    (soNguoi ? ' (' + soNguoi + ' prefix đang nguội, chưa tính vào)' : ''));

  if (tongKhoa >= CACHE_KEY_LIMIT) {
    coCanhBao = true;
    dong.push('  ✘ ĐÃ VƯỢT mốc ~' + CACHE_KEY_LIMIT + ' khoá — cache đang bị dọn FIFO liên tục');
  } else if (tongKhoa >= CACHE_KEY_WARN) {
    coCanhBao = true;
    dong.push('  ⚠ Sát mốc ~' + CACHE_KEY_LIMIT + ' khoá — nên TĂNG CACHE_CHUNK_SIZE để giảm số khoá');
  } else {
    dong.push('  ✔ Còn cách mốc ~' + CACHE_KEY_LIMIT + ' khoá: ' + (CACHE_KEY_LIMIT - tongKhoa) + ' khoá');
  }

  if (tongByte > 0) {
    dong.push('  Tham chiếu: nếu cắt theo BYTE (95 KB/khoá) thì tổng chỉ còn khoảng ' +
      (Math.ceil(tongByte / (95 * 1024)) + CACHE_PREFIXES.length) + ' khoá');
  }

  dong.push('');
  dong.push('CACHE_CHUNK_SIZE hiện tại: ' + CACHE_CHUNK_SIZE + ' ký tự');
  dong.push(coCanhBao ? '=> CÓ CẢNH BÁO — xem các dòng ✘ / ⚠ ở trên.' : '=> Không phát hiện vấn đề.');

  var ketQua = dong.join('\n');
  Logger.log(ketQua);
  return ketQua;
}

/**
 * LIỆT KÊ CÁC NHÃN BỊ GỘP. Chạy thủ công trong trình soạn thảo (chọn kiemTraGopNhan -> Run ->
 * xem Execution log) để đối chiếu xem labelKey_ có gộp nhầm thứ gì không, và biết chính xác
 * những ô nào trên Sheet cần sửa lại cho thống nhất.
 *
 * Chỉ in ra nhóm có TỪ 2 BIẾN THỂ TRỞ LÊN, kèm số lượng của từng biến thể và tên đã được chọn
 * làm nhãn hiển thị.
 */
function kiemTraGopNhan() {
  var listing = getListingRecords();
  var chiPhi = getChiPhiRecords();
  var nppMap = getNppNameMap();

  var stores = {
    'Loại thiết bị': {},
    'Nhãn hiệu': {},
    'Nhà phân phối': {},
    'Nhà cung cấp': {}
  };

  listing.forEach(function (r, i) {
    tallyLabel_(stores['Loại thiết bị'], r[LS.LOAITU] || 'Khác', 1, i);
    tallyLabel_(stores['Nhãn hiệu'], r[LS.NHANHIEU] || 'Khác', 1, i);
    tallyLabel_(stores['Nhà phân phối'], resolveNppDisplay(r[LS.MANPP], nppMap), 1, i);
  });
  chiPhi.forEach(function (r, i) {
    tallyLabel_(stores['Nhà cung cấp'], r[CP.NCC], 1, i);
  });

  var dong = ['===== NHÃN ĐƯỢC GỘP — ' + Utilities.formatDate(new Date(), TZ_VN, 'HH:mm dd/MM/yyyy') + ' ====='];
  var tongNhom = 0;

  Object.keys(stores).forEach(function (ten) {
    var store = stores[ten];
    var nhomGop = Object.keys(store).filter(function (k) {
      return Object.keys(store[k].variants).length > 1;
    });

    dong.push('');
    dong.push('--- ' + ten + ': ' + Object.keys(store).length + ' nhóm, ' +
      nhomGop.length + ' nhóm có nhiều biến thể ---');

    if (!nhomGop.length) { dong.push('  (không có nhãn nào bị gộp)'); return; }
    tongNhom += nhomGop.length;

    nhomGop.forEach(function (k) {
      var e = store[k];
      var mo = Object.keys(e.variants).map(function (v) {
        return '"' + v + '" (' + e.variants[v] + ')' + (v === e.best ? ' <- hiển thị' : '');
      });
      dong.push('  · tổng ' + e.total + ': ' + mo.join('  |  '));
    });
  });

  dong.push('');
  dong.push(tongNhom ? '=> ' + tongNhom + ' nhóm đang được gộp. Nên sửa lại trên Sheet cho thống nhất.'
                     : '=> Dữ liệu đã thống nhất, không có gì bị gộp.');

  var ketQua = dong.join('\n');
  Logger.log(ketQua);
  return ketQua;
}

/**
 * CHẠY HÀM NÀY 1 LẦN DUY NHẤT (chọn "setupAutoRefreshTrigger" trong dropdown Apps Script rồi
 * bấm Run) để bật trigger tự động, cứ 30 phút chạy 1 lần (Apps Script chỉ hỗ trợ 1/5/10/15/30 phút).
 */
function setupAutoRefreshTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'silentRefreshCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('silentRefreshCache').timeBased().everyMinutes(30).create();
}

/* ============================= XÂY DỰNG DỮ LIỆU (đọc toàn bộ vùng dữ liệu 1 lần) ============================= */

function rebuildListingRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LISTING);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = normalizeCode(row[idx['code_tu']]);
    if (!code) continue;

    var diaChiParts = [cellStr(row, idx, 'dia_chi'), cellStr(row, idx, 'phuong_xa'), cellStr(row, idx, 'tinh_thanh_pho')]
      .filter(function (p) { return p.trim() !== ''; });

    var ngayLapVal = row[idx['ngay_lap_dat']];

    records.push([
      code,
      cellStr(row, idx, 'ten_cua_hang'),
      diaChiParts.join(', '),
      cellStr(row, idx, 'so_dien_thoai_cua_hang'),
      cellStr(row, idx, 'loai_tu'),
      dateToIso(ngayLapVal),
      cellStr(row, idx, 'nhan_hieu'),
      cellStr(row, idx, 'vung'),
      cellStr(row, idx, 'ma_npp'),
      i + 1,
      rawDateText_(ngayLapVal) // giữ nguyên văn khi ngày lắp đặt không hợp lệ
    ]);
  }

  writeCacheRecords('listing_v4', records, CACHE_TTL_SECONDS);
  return records;
}

function rebuildChiPhiRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CHIPHI);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = normalizeCode(row[idx['code_tu']]);
    if (!code) continue;

    var ngayVal = row[idx['ngay_thuc_hien']];

    records.push([
      code,
      dateToIso(ngayVal),
      cellStr(row, idx, 'ncc'),
      cellStr(row, idx, 'dien_giai'),
      Number(row[idx['thanh_tien']]) || 0,
      cellStr(row, idx, 'mien'),
      i + 1,
      rawDateText_(ngayVal) // giữ nguyên văn khi ngày thực hiện không hợp lệ
    ]);
  }

  writeCacheRecords('chiphi_v3', records, CACHE_TTL_SECONDS);
  return records;
}

function rebuildThanhLyRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_THANHLY);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = normalizeCode(row[idx['code_tu']]);
    if (!code) continue;

    records.push([
      code,
      cellFlexible(row, idx, 'thanh_ly'),
      cellStr(row, idx, 'dien_giai'),
      i + 1
    ]);
  }

  writeCacheRecords('thanhly_v1', records, CACHE_TTL_SECONDS);
  return records;
}

function rebuildGsbhRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_GSBH);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maNpp = normalizeCode(row[idx['ma_npp']]);
    if (!maNpp) continue;

    records.push([
      maNpp,
      cellStr(row, idx, 'ten_npp'),
      cellStr(row, idx, 'ho_ten_gsbh'),
      cellStr(row, idx, 'dia_chi_mail'),
      cellStr(row, idx, 'so_dien_thoai'),
      cellStr(row, idx, 'P&C'),
      i + 1
    ]);
  }

  writeCacheRecords('gsbh_v1', records, CACHE_TTL_SECONDS);
  return records;
}

/**
 * Đọc toàn bộ sheet "DON GIA BT" (Bảo trì). Các dòng "đầu mục" (I, II, III...) chỉ chứa số La
 * Mã ở cột ma_imc và tên nhóm ở cột noi_dung (các cột đơn giá còn lại để trống) -> dùng để chia
 * nhóm cho các dòng đơn giá phía dưới cho tới khi gặp đầu mục tiếp theo.
 */
function rebuildDonGiaBtRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DONGIA_BT);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];
  var currentGroup = '';

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maImc = cellStr(row, idx, 'ma_imc').trim();
    var noiDung = cellStr(row, idx, 'noi_dung').trim();
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
        dvt: cellStr(row, idx, 'dvt'),
        vatTu: Number(row[idx['vat_tu']]) || 0,
        nhanCong: Number(row[idx['nhan_cong']]) || 0,
        tongCong: Number(row[idx['tong_cong']]) || 0,
        group: currentGroup
      });
    }
  }

  writeCacheRecords('dongia_bt_v1', records, CACHE_TTL_DONGIA);
  return records;
}

/**
 * Đọc toàn bộ sheet "DON GIA XD" (Xây dựng). Có 2 CẤP đầu mục:
 *  - Đầu mục LỚN: imc là số La Mã (I, II, III... hoặc X) -> chia nhóm lớn.
 *  - Đầu mục NHỎ: imc chỉ là số thường (1, 2, 3...) không có hậu tố "_XD" -> chia nhóm nhỏ, lồng
 *    bên trong đầu mục lớn hiện tại. Đầu mục nhỏ được reset về rỗng mỗi khi gặp đầu mục lớn mới.
 *  - Dòng đơn giá thật sự có imc dạng "12_XD", "3_XD"... (khác hẳn 2 dạng trên).
 */
function rebuildDonGiaXdRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DONGIA_XD);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];
  var currentGroup = '';
  var currentSubGroup = '';

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maImc = cellStr(row, idx, 'imc').trim();
    var noiDung = cellStr(row, idx, 'noi_dung_cong_viec').trim();
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
        yeuCau: cellStr(row, idx, 'yeu_cau_ky_thuat_va_vat_lieu'),
        dvt: cellStr(row, idx, 'dvt'),
        donGia: Number(row[idx['don_gia']]) || 0,
        group: currentGroup,
        subGroup: currentSubGroup
      });
    }
  }

  writeCacheRecords('dongia_xd_v1', records, CACHE_TTL_DONGIA);
  return records;
}

/**
 * Đọc toàn bộ sheet "DON GIA SNK" (Sanaky). Cùng kiểu đầu mục lớn (I, II, III...) như Bảo trì,
 * không có đầu mục nhỏ. Có thêm cột "gas + phin lọc" và "phụ phí (vận chuyển/ đi lại)" so với
 * Bảo trì.
 */
function rebuildDonGiaSnkRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DONGIA_SNK);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var idx = buildHeaderIndex(data[0]);
  var records = [];
  var currentGroup = '';

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var maImc = cellStr(row, idx, 'imc').trim();
    var noiDung = cellStr(row, idx, 'noi_dung').trim();
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
        dvt: cellStr(row, idx, 'dvt'),
        vatTu: Number(row[idx['vat_tu']]) || 0,
        gasPhinLoc: Number(row[idx['gas_+_phin_loc']]) || 0,
        nhanCong: Number(row[idx['nhan_cong']]) || 0,
        phuPhi: Number(row[idx['phu_phi_(van_chuyen/_di_lai)']]) || 0,
        donGia: Number(row[idx['don_gia']]) || 0,
        group: currentGroup
      });
    }
  }

  writeCacheRecords('dongia_snk_v1', records, CACHE_TTL_DONGIA);
  return records;
}

function getListingRecords() { return readCachedRecords('listing_v4', rebuildListingRecords); }
function getChiPhiRecords() { return readCachedRecords('chiphi_v3', rebuildChiPhiRecords); }
function getThanhLyRecords() { return readCachedRecords('thanhly_v1', rebuildThanhLyRecords); }
function getGsbhRecords() { return readCachedRecords('gsbh_v1', rebuildGsbhRecords); }
function getDonGiaBtRecords() { return readCachedRecords('dongia_bt_v1', rebuildDonGiaBtRecords); }
function getDonGiaXdRecords() { return readCachedRecords('dongia_xd_v1', rebuildDonGiaXdRecords); }
function getDonGiaSnkRecords() { return readCachedRecords('dongia_snk_v1', rebuildDonGiaSnkRecords); }

/**
 * Trả 1 TRANG dữ liệu thô sheet "CHI PHI", lọc được theo mã thiết bị / khu vực / NCC / khoảng
 * ngày. Luôn phân trang ở server vì dữ liệu tới hàng chục nghìn dòng.
 *
 * Dòng có ngày KHÔNG HỢP LỆ bị loại khi đang lọc khoảng ngày (không có cơ sở xếp nó vào trong hay
 * ngoài khoảng), nhưng vẫn hiện bình thường khi không lọc — kèm cờ ngayLoi để UI gắn badge.
 *
 * Bộ lọc NCC so khớp qua labelKey_ nên chọn "Sanaky" trong dropdown sẽ ra CẢ các dòng ghi
 * "SANAKY". Cột hiển thị vẫn giữ NGUYÊN VĂN từng dòng để đối chiếu được với Sheet.
 */
function getChiPhiPageData(params) {
  try {
    params = params || {};
    var page = Math.max(1, parseInt(params.page, 10) || 1);
    var pageSize = Math.max(1, Math.min(200, parseInt(params.pageSize, 10) || 50));

    var chiPhi = getChiPhiRecords();

    var tuNgayDate = params.tuNgay ? parseInputDate(params.tuNgay) : null;
    var denNgayDate = params.denNgay ? parseInputDate(params.denNgay) : null;
    if (denNgayDate) denNgayDate.setHours(23, 59, 59, 999);

    var codeFilter = params.maThietBi ? normalizeCode(params.maThietBi).toLowerCase() : '';
    var nccFilterKey = params.ncc ? labelKey_(params.ncc) : '';
    var mienFilter = params.mien && params.mien !== 'toanquoc' ? params.mien : '';

    var filtered = [];
    for (var i = 0; i < chiPhi.length; i++) {
      var r = chiPhi[i];
      var code = r[CP.CODE];
      var ngayIso = r[CP.NGAY];
      var ncc = r[CP.NCC];
      var mien = r[CP.MIEN];

      if (codeFilter && code.toLowerCase().indexOf(codeFilter) === -1) continue;
      if (nccFilterKey && labelKey_(ncc) !== nccFilterKey) continue;
      if (mienFilter) {
        var rKey = regionKey(mien);
        if (rKey !== mienFilter) continue;
      }

      var d = ngayIso ? parseDateSafe(ngayIso) : null;
      if (tuNgayDate && (!d || d.getTime() < tuNgayDate.getTime())) continue;
      if (denNgayDate && (!d || d.getTime() > denNgayDate.getTime())) continue;

      filtered.push(r);
    }

    // Mới nhất lên trước; dòng không có ngày hợp lệ dồn xuống cuối
    filtered.sort(function (a, b) {
      var da = a[CP.NGAY], db = b[CP.NGAY];
      if (!da !== !db) return da ? -1 : 1;
      if (da !== db) return da < db ? 1 : -1;
      return b[CP.ROW] - a[CP.ROW];
    });

    var totalRecords = filtered.length;
    // Nút "Xuất Excel": lấy TẤT CẢ dòng theo bộ lọc hiện tại trong một lần (không phân trang).
    if (params.all) { pageSize = Math.max(1, totalRecords); page = 1; }
    var totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    if (page > totalPages) page = totalPages;
    var startIdx = (page - 1) * pageSize;
    var pageItems = filtered.slice(startIdx, startIdx + pageSize);

    var records = pageItems.map(function (r) {
      var ngayRaw = r[CP.NGAYRAW] || '';
      return {
        code: r[CP.CODE],
        ngay: r[CP.NGAY] ? formatDateDisplay(r[CP.NGAY]) : ngayRaw,
        ngayLoi: !r[CP.NGAY] && !!ngayRaw,
        ncc: r[CP.NCC],
        noiDung: r[CP.NOIDUNG],
        chiPhi: r[CP.TIEN],
        khuVuc: r[CP.MIEN]
      };
    });

    return {
      success: true,
      records: records,
      totalRecords: totalRecords,
      totalPages: totalPages,
      page: page,
      pageSize: pageSize
    };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

/**
 * Hàm gọi từ client để lấy toàn bộ bảng đơn giá của 1 LOẠI (category) 1 lần duy nhất; việc lọc/
 * tìm kiếm được thực hiện ngay trên trình duyệt (client) để phản hồi tức thời khi người dùng gõ.
 *
 * category: 'bt' (Bảo trì, mặc định) | 'xd' (Xây dựng) | 'snk' (Sanaky)
 */
function getDonGiaData(category) {
  try {
    var records;
    if (category === 'xd') {
      records = getDonGiaXdRecords();
    } else if (category === 'snk') {
      records = getDonGiaSnkRecords();
    } else {
      category = 'bt';
      records = getDonGiaBtRecords();
    }
    return { success: true, records: records, category: category };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

/* ============================= TRA CỨU 1 MÃ ============================= */

function searchDevice(code) {
  try {
    code = normalizeCode(code);
    if (!code) return { success: false, message: 'Vui lòng nhập mã thiết bị.' };

    var listing = getListingRecords();
    var device = null;
    for (var i = 0; i < listing.length; i++) {
      if (listing[i][LS.CODE] === code) { device = listing[i]; break; }
    }

    var chiPhi = getChiPhiRecords();
    var matched = [];
    for (var j = 0; j < chiPhi.length; j++) {
      if (chiPhi[j][CP.CODE] === code) matched.push(chiPhi[j]);
    }

    if (!device && matched.length === 0) {
      return { success: false, message: 'Không tìm thấy thiết bị với mã: ' + code };
    }

    var repairResult = buildRepairHistory(matched);

    // Tình trạng bảo hành thiết bị (theo ngày lắp đặt, ngưỡng 730 ngày)
    var tinhTrangBaoHanhThietBi = 'Không xác định';
    var ngayLapRaw = device ? (device[LS.NGAYLAPRAW] || '') : '';
    if (device) {
      var dLapDat = parseDateSafe(device[LS.NGAYLAP]);
      if (dLapDat) {
        var today0 = new Date(); today0.setHours(0, 0, 0, 0);
        tinhTrangBaoHanhThietBi = daysBetween(dLapDat, today0) <= WARRANTY_DAYS_DEVICE ? 'Còn bảo hành' : 'Hết bảo hành';
      }
    }

    // Tình trạng thanh lý
    var thanhLyInfo = findThanhLy(code);

    // Thông tin GSBH + P&C (theo ma_npp của thiết bị)
    var gsbhInfo = { gsbhList: [], pcList: [] };
    if (device && device[LS.MANPP]) {
      gsbhInfo = findGsbhByMaNpp(device[LS.MANPP]);
    }

    return {
      success: true,
      device: {
        code_tu: code,
        ten_cua_hang: device ? device[LS.TEN] : '',
        so_dien_thoai: device ? formatPhone(device[LS.SDT]) : '',
        dia_chi: device ? device[LS.DIACHI] : '',
        loai_tu: device ? device[LS.LOAITU] : '',
        nhan_hieu: device ? device[LS.NHANHIEU] : '',
        ngay_lap_dat: device ? (device[LS.NGAYLAP] ? formatDateDisplay(device[LS.NGAYLAP]) : ngayLapRaw) : '',
        ngay_lap_dat_loi: !!(device && !device[LS.NGAYLAP] && ngayLapRaw)
      },
      tong_chi_phi: repairResult.tongChiPhi,
      chi_phi_di_chuyen: repairResult.chiPhiDiChuyen,
      chi_phi_sua_chua: repairResult.chiPhiSuaChua,
      so_lan_sua: repairResult.list.length,
      lich_su: repairResult.list,
      tinh_trang_bao_hanh_thiet_bi: tinhTrangBaoHanhThietBi,
      tinh_trang_thanh_ly: thanhLyInfo,
      gsbh_list: gsbhInfo.gsbhList,
      pc_list: gsbhInfo.pcList
    };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

/** Tìm thông tin thanh lý theo mã thiết bị. Nếu có nhiều dòng trùng mã, lấy dòng cuối (dòng sheet lớn nhất). */
function findThanhLy(code) {
  var records = getThanhLyRecords();
  var found = null;
  for (var i = 0; i < records.length; i++) {
    if (records[i][TL.CODE] === code) {
      if (!found || records[i][TL.ROW] > found[TL.ROW]) found = records[i];
    }
  }
  if (!found) return null;
  return { thanhLy: found[TL.THANHLY], dienGiai: found[TL.DIENGIAI] };
}

/**
 * Tìm thông tin GSBH + P&C theo mã NPP. Cột ho_ten_gsbh/so_dien_thoai có thể chứa nhiều dòng
 * (1 NPP có 2 GSBH) -> tách theo dòng và ghép cặp tên với số điện thoại theo đúng thứ tự.
 *
 * Tra theo MÃ NPP (không phải tên) nên không dính lỗi khác định dạng -> không dùng labelKey_.
 */
function findGsbhByMaNpp(maNpp) {
  var records = getGsbhRecords();
  var gsbhList = [];
  var pcSet = {};

  records.forEach(function (r) {
    if (r[GS.MANPP] !== maNpp) return;

    var names = splitMultiLine(r[GS.HOTEN]);
    var phones = splitMultiLine(r[GS.SDT]);
    var maxLen = Math.max(names.length, phones.length);

    for (var i = 0; i < maxLen; i++) {
      gsbhList.push({
        tenNpp: r[GS.TENNPP],
        hoTen: names[i] || '',
        soDienThoai: phones[i] ? formatPhone(phones[i]) : ''
      });
    }

    splitMultiLine(r[GS.PC]).forEach(function (pc) { pcSet[pc] = true; });
  });

  return { gsbhList: gsbhList, pcList: Object.keys(pcSet) };
}

/**
 * Gộp các dòng CHI PHÍ thành "lượt sửa chữa" theo repairKey_. Nội dung & chi phí từng dòng gốc
 * giữ riêng trong items[].
 *
 * Hàm chỉ nhận các dòng của CÙNG 1 mã thiết bị nên phần "mã" trong khoá là hằng số -> thực chất
 * gộp theo (ngày + NCC). Vẫn phải qua repairKey_ để không lệch với Dashboard.
 */
function buildRepairHistory(records) {
  var result = { tongChiPhi: 0, chiPhiDiChuyen: 0, chiPhiSuaChua: 0, list: [] };
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var groups = {};
  var order = [];

  records.forEach(function (r) {
    var ngayIso = r[CP.NGAY];
    var ngayRaw = r[CP.NGAYRAW] || '';
    var chiPhi = r[CP.TIEN];
    var dienGiai = r[CP.NOIDUNG];
    var ncc = r[CP.NCC];
    var rowIdx = r[CP.ROW];

    result.tongChiPhi += chiPhi;
    if (isTravelCost(dienGiai)) result.chiPhiDiChuyen += chiPhi; else result.chiPhiSuaChua += chiPhi;

    var groupKey = repairKey_(r[CP.CODE], ngayIso, ngayRaw, ncc, rowIdx);

    if (!groups[groupKey]) {
      groups[groupKey] = { dateIso: ngayIso, dateRaw: ngayRaw, ncc: ncc, rowIndex: rowIdx, items: [] };
      order.push(groupKey);
    }
    var g = groups[groupKey];
    g.rowIndex = Math.max(g.rowIndex, rowIdx);
    g.items.push({ noiDung: dienGiai, chiPhi: chiPhi });
  });

  var groupList = order.map(function (key) {
    var g = groups[key];
    var dParsed = g.dateIso ? parseDateSafe(g.dateIso) : null;

    // Ngày không hợp lệ -> KHÔNG suy diễn tình trạng bảo hành
    var tinhTrang = 'Không xác định';
    if (dParsed) {
      tinhTrang = daysBetween(dParsed, today) <= WARRANTY_DAYS_REPAIR ? 'Còn bảo hành' : 'Hết bảo hành';
    }

    return {
      sortTime: dParsed ? dParsed.getTime() : null,
      rowIndex: g.rowIndex,
      ngaySuaChua: dParsed ? formatDateDisplay(g.dateIso) : g.dateRaw,
      ngayLoi: !dParsed && !!g.dateRaw,
      ncc: g.ncc || '',
      tinhTrang: tinhTrang,
      items: g.items
    };
  });

  // Comparator NHẤT QUÁN: nhóm có ngày lên trước (mới -> cũ), nhóm không có ngày dồn xuống cuối.
  // Phải xét aHas/bHas TRƯỚC; rơi xuống so rowIndex thì thứ tự không xác định và kết quả sắp
  // xếp có thể khác nhau giữa các lần chạy.
  groupList.sort(function (a, b) {
    var aHas = a.sortTime !== null, bHas = b.sortTime !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && a.sortTime !== b.sortTime) return b.sortTime - a.sortTime;
    return b.rowIndex - a.rowIndex;
  });

  result.list = groupList.map(function (it) {
    return {
      ngaySuaChua: it.ngaySuaChua,
      ngayLoi: it.ngayLoi,
      ncc: it.ncc,
      tinhTrang: it.tinhTrang,
      items: it.items
    };
  });

  return result;
}

/* ============================= TRA CỨU HÀNG LOẠT ============================= */

function batchSearchDevices(codesText) {
  try {
    var rawCodes = String(codesText || '').split(/[\r\n,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; });

    var seen = {};
    var codes = [];
    rawCodes.forEach(function (c) { if (!seen[c]) { seen[c] = true; codes.push(c); } });

    if (codes.length === 0) return { success: false, message: 'Vui lòng nhập ít nhất 1 mã thiết bị.' };

    var listing = getListingRecords();
    var listingMap = {};
    listing.forEach(function (r) { listingMap[r[LS.CODE]] = r; });

    var chiPhi = getChiPhiRecords();
    var costMap = {};
    chiPhi.forEach(function (r) {
      var code = r[CP.CODE];
      costMap[code] = (costMap[code] || 0) + r[CP.TIEN];
    });

    var thanhLy = getThanhLyRecords();
    var thanhLyMap = {};
    thanhLy.forEach(function (r) {
      var code = r[TL.CODE];
      if (!thanhLyMap[code] || r[TL.ROW] > thanhLyMap[code][TL.ROW]) thanhLyMap[code] = r;
    });

    var today0 = new Date(); today0.setHours(0, 0, 0, 0);

    var results = codes.map(function (code) {
      var info = listingMap[code];
      var tl = thanhLyMap[code];
      var hasCost = costMap.hasOwnProperty(code);
      var found = !!info || hasCost || !!tl;

      // Tình trạng bảo hành thiết bị: (hôm nay - ngày lắp đặt) <= 730 ngày -> Còn bảo hành
      var tinhTrangBaoHanh = 'Không xác định';
      var ngayLapRaw = info ? (info[LS.NGAYLAPRAW] || '') : '';
      if (info) {
        var dLapDat = parseDateSafe(info[LS.NGAYLAP]);
        if (dLapDat) {
          tinhTrangBaoHanh = daysBetween(dLapDat, today0) <= WARRANTY_DAYS_DEVICE ? 'Còn bảo hành' : 'Hết bảo hành';
        }
      }

      return {
        code_tu: code,
        found: found,
        chi_phi: costMap[code] || 0,
        ngay_lap_dat: info ? (info[LS.NGAYLAP] ? formatDateDisplay(info[LS.NGAYLAP]) : ngayLapRaw) : '',
        ngay_lap_dat_loi: !!(info && !info[LS.NGAYLAP] && ngayLapRaw),
        tinh_trang_bao_hanh: tinhTrangBaoHanh,
        nhan_hieu: info ? info[LS.NHANHIEU] : '',
        loai_tu: info ? info[LS.LOAITU] : '',
        tinh_trang_thanh_ly: tl ? (tl[TL.THANHLY] + (tl[TL.DIENGIAI] ? ' — ' + tl[TL.DIENGIAI] : '')) : ''
      };
    });

    return { success: true, results: results };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

/* ============================= DANH SÁCH THIẾT BỊ ============================= */

/** true nếu chuỗi chỉ gồm chữ số (mã NPP dạng số, vd "10001299") */
function isNumericMaNpp(s) {
  return /^\d+$/.test(String(s || '').trim());
}

/** Bảng tra ma_npp -> ten_npp dựng từ sheet GSBH (lấy bản ghi đầu tiên khớp mã) */
function getNppNameMap() {
  var gsbh = getGsbhRecords();
  var map = {};
  gsbh.forEach(function (r) {
    var ma = r[GS.MANPP];
    if (ma && !map[ma]) map[ma] = r[GS.TENNPP];
  });
  return map;
}

/**
 * Chuyển ma_npp thành tên hiển thị:
 *  - Nếu ma_npp là DẠNG SỐ: tra tên NPP theo GSBH, không tìm thấy thì để trống.
 *  - Nếu ma_npp là DẠNG CHỮ (text): giữ nguyên như dữ liệu gốc.
 */
function resolveNppDisplay(maNpp, nppMap) {
  var maStr = String(maNpp || '').trim();
  if (!maStr) return '';
  if (isNumericMaNpp(maStr)) {
    return nppMap[maStr] || '';
  }
  return maStr;
}

/**
 * Danh sách giá trị đổ vào bộ lọc (NPP / Loại thiết bị / Nhãn hiệu) của trang Danh sách thiết bị,
 * phụ thuộc khu vực đang chọn.
 *
 * Các giá trị chỉ khác nhau về định dạng được GỘP thành một mục duy nhất, tên hiển thị lấy theo
 * biến thể phổ biến nhất -> dropdown không còn hai dòng "Sanaky" và "SANAKY" cạnh nhau.
 */
function getDanhSachThietBiFilterOptions(filters) {
  try {
    filters = filters || {};
    var mienFilter = filters.mien && filters.mien !== 'toanquoc' ? filters.mien : '';

    var listing = getListingRecords();
    var nppMap = getNppNameMap();

    var nppStore = {}, loaiStore = {}, nhanHieuStore = {};
    listing.forEach(function (r, i) {
      if (mienFilter && regionKeyFromVung(r[LS.VUNG]) !== mienFilter) return;
      tallyLabel_(nppStore, resolveNppDisplay(r[LS.MANPP], nppMap), 1, i);
      tallyLabel_(loaiStore, r[LS.LOAITU], 1, i);
      tallyLabel_(nhanHieuStore, r[LS.NHANHIEU], 1, i);
    });

    return {
      success: true,
      nppList: storeLabels_(nppStore),
      loaiList: storeLabels_(loaiStore),
      nhanHieuList: storeLabels_(nhanHieuStore)
    };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

/**
 * Trả về 1 TRANG dữ liệu Danh sách thiết bị (LISTING), có hỗ trợ:
 *  - Tìm kiếm tự do theo: mã thiết bị, tên khách hàng, số điện thoại khách hàng.
 *  - Lọc theo: vùng (miền), tên NPP, loại thiết bị, nhãn hiệu, tình trạng bảo hành.
 *
 * NPP / loại / nhãn hiệu so khớp qua labelKey_ nên bấm vào một thanh trên biểu đồ Dashboard sẽ ra
 * ĐÚNG con số mà biểu đồ hiển thị. So khớp tuyệt đối như bản cũ sẽ khiến biểu đồ báo 5.816 nhưng
 * danh sách chỉ ra 5.803 — hai màn hình tự mâu thuẫn.
 * Cột hiển thị trong bảng vẫn là giá trị NGUYÊN VĂN của từng dòng.
 */
function getDanhSachThietBiPageData(params) {
  try {
    params = params || {};
    var page = Math.max(1, parseInt(params.page, 10) || 1);
    var pageSize = Math.max(1, Math.min(200, parseInt(params.pageSize, 10) || 50));

    var listing = getListingRecords();
    var nppMap = getNppNameMap();

    var searchQ = removeDiacritics(String(params.search || '').trim()).toLowerCase();
    var nppFilterKey = params.npp ? labelKey_(params.npp) : '';
    var mienFilter = params.mien && params.mien !== 'toanquoc' ? params.mien : '';
    var loaiFilterKey = params.loai ? labelKey_(params.loai) : '';
    var nhanHieuFilterKey = params.nhanHieu ? labelKey_(params.nhanHieu) : '';
    var baoHanhFilter = params.baoHanh || ''; // '', 'con', 'het'

    var today0 = new Date(); today0.setHours(0, 0, 0, 0);

    var filtered = [];
    for (var i = 0; i < listing.length; i++) {
      var r = listing[i];
      var npp = resolveNppDisplay(r[LS.MANPP], nppMap);

      if (mienFilter && regionKeyFromVung(r[LS.VUNG]) !== mienFilter) continue;
      if (nppFilterKey && labelKey_(npp) !== nppFilterKey) continue;
      if (loaiFilterKey && labelKey_(r[LS.LOAITU]) !== loaiFilterKey) continue;
      if (nhanHieuFilterKey && labelKey_(r[LS.NHANHIEU]) !== nhanHieuFilterKey) continue;

      var tinhTrangBaoHanh = 'Không xác định';
      var dLapDat = parseDateSafe(r[LS.NGAYLAP]);
      if (dLapDat) {
        tinhTrangBaoHanh = daysBetween(dLapDat, today0) <= WARRANTY_DAYS_DEVICE ? 'Còn bảo hành' : 'Hết bảo hành';
      }
      if (baoHanhFilter === 'con' && tinhTrangBaoHanh !== 'Còn bảo hành') continue;
      if (baoHanhFilter === 'het' && tinhTrangBaoHanh !== 'Hết bảo hành') continue;

      if (searchQ) {
        // So khớp cả số điện thoại GỐC lẫn số điện thoại đã CHUẨN HÓA (thêm số 0 đầu) để luôn
        // tìm ra dù người dùng gõ có/không có số 0 ở đầu.
        var phoneFormatted = formatPhone(r[LS.SDT]);
        var haystack = removeDiacritics(
          r[LS.CODE] + ' ' + r[LS.TEN] + ' ' + r[LS.SDT] + ' ' + phoneFormatted
        ).toLowerCase();
        if (haystack.indexOf(searchQ) === -1) continue;
      }

      filtered.push({ rec: r, npp: npp, tinhTrangBaoHanh: tinhTrangBaoHanh });
    }

    // Mới thêm (dòng sheet lớn hơn) lên trước
    filtered.sort(function (a, b) { return b.rec[LS.ROW] - a.rec[LS.ROW]; });

    var totalRecords = filtered.length;
    // Nút "Xuất Excel": lấy TẤT CẢ dòng theo bộ lọc hiện tại trong một lần (không phân trang).
    if (params.all) { pageSize = Math.max(1, totalRecords); page = 1; }
    var totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    if (page > totalPages) page = totalPages;
    var startIdx = (page - 1) * pageSize;
    var pageItems = filtered.slice(startIdx, startIdx + pageSize);

    var records = pageItems.map(function (it) {
      var r = it.rec;
      var ngayLapRaw = r[LS.NGAYLAPRAW] || '';
      return {
        code: r[LS.CODE],
        tenCuaHang: r[LS.TEN],
        diaChi: r[LS.DIACHI],
        soDienThoai: formatPhone(r[LS.SDT]),
        npp: it.npp,
        vung: regionLabel(regionKeyFromVung(r[LS.VUNG])),
        loaiTu: r[LS.LOAITU],
        nhanHieu: r[LS.NHANHIEU],
        ngayLapDat: r[LS.NGAYLAP] ? formatDateDisplay(r[LS.NGAYLAP]) : ngayLapRaw,
        ngayLapDatLoi: !r[LS.NGAYLAP] && !!ngayLapRaw,
        tinhTrangBaoHanh: it.tinhTrangBaoHanh
      };
    });

    return {
      success: true,
      records: records,
      totalRecords: totalRecords,
      totalPages: totalPages,
      page: page,
      pageSize: pageSize
    };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}

/* ============================= DASHBOARD ============================= */

/**
 * Danh sách NCC đổ vào dropdown, đã gộp các tên chỉ khác định dạng.
 * Trọng số 1 mỗi dòng (không phải số tiền): ở đây chỉ cần chọn tên phổ biến nhất theo SỐ DÒNG.
 */
function getFilterOptions(filters) {
  try {
    filters = filters || {};
    var chiPhi = getChiPhiRecords();

    var tuNgayDate = filters.tuNgay ? parseInputDate(filters.tuNgay) : null;
    var denNgayDate = filters.denNgay ? parseInputDate(filters.denNgay) : null;
    if (denNgayDate) denNgayDate.setHours(23, 59, 59, 999);

    var nccStore = {};
    chiPhi.forEach(function (r, i) {
      var ncc = r[CP.NCC];
      if (!ncc) return;

      if (filters.mien && filters.mien !== 'toanquoc') {
        var rKey = regionKey(r[CP.MIEN]);
        if (rKey !== filters.mien) return;
      }

      var ngayIso = r[CP.NGAY];
      var d = ngayIso ? parseDateSafe(ngayIso) : null;
      if (tuNgayDate && (!d || d.getTime() < tuNgayDate.getTime())) return;
      if (denNgayDate && (!d || d.getTime() > denNgayDate.getTime())) return;

      tallyLabel_(nccStore, ncc, 1, i);
    });
    return { success: true, nccList: storeLabels_(nccStore) };
  } catch (err) {
    return { success: false, message: err.message, nccList: [] };
  }
}

function getDashboardData(filters) {
  try {
    filters = filters || {};
    var listing = getListingRecords();

    // Loại thiết bị & nhãn hiệu: gộp các tên chỉ khác định dạng, trọng số = số thiết bị
    var totalDevices = 0;
    var deviceTypeStore = {};
    var deviceBrandStore = {};
    listing.forEach(function (l, i) {
      var vKey = regionKeyFromVung(l[LS.VUNG]);
      if (!filters.mien || filters.mien === 'toanquoc' || vKey === filters.mien) {
        totalDevices++;
        tallyLabel_(deviceTypeStore, l[LS.LOAITU] || 'Khác', 1, i);
        tallyLabel_(deviceBrandStore, l[LS.NHANHIEU] || 'Khác', 1, i);
      }
    });

    // Nhiều nhất lên trước; bằng nhau thì giữ thứ tự gặp trong Sheet cho ổn định giữa các lần chạy
    var deviceTypeChart = Object.keys(deviceTypeStore).map(function (k) {
      return { loai: deviceTypeStore[k].best, soLuong: deviceTypeStore[k].total, _o: deviceTypeStore[k].order };
    }).sort(function (a, b) { return b.soLuong - a.soLuong || a._o - b._o; })
      .map(function (x) { return { loai: x.loai, soLuong: x.soLuong }; });

    var deviceBrandChart = Object.keys(deviceBrandStore).map(function (k) {
      return { nhanHieu: deviceBrandStore[k].best, soLuong: deviceBrandStore[k].total, _o: deviceBrandStore[k].order };
    }).sort(function (a, b) { return b.soLuong - a.soLuong || a._o - b._o; })
      .map(function (x) { return { nhanHieu: x.nhanHieu, soLuong: x.soLuong }; });

    var chiPhi = getChiPhiRecords();

    var tuNgayDate = filters.tuNgay ? parseInputDate(filters.tuNgay) : null;
    var denNgayDate = filters.denNgay ? parseInputDate(filters.denNgay) : null;
    if (denNgayDate) denNgayDate.setHours(23, 59, 59, 999);

    // Bộ lọc NCC so qua labelKey_ để khớp với danh sách đã gộp mà getFilterOptions trả về
    var nccFilterKey = filters.ncc ? labelKey_(filters.ncc) : '';

    var tongChiPhi = 0, chiPhiDiChuyen = 0, chiPhiSuaChua = 0;
    var regionCost = { bac: 0, trung: 0, nam: 0, khac: 0 };
    var regionCount = { bac: 0, trung: 0, nam: 0, khac: 0 };
    var nccStore = {};
    var monthCostByRegion = { bac: {}, trung: {}, nam: {} };
    var repairSet = {};
    var deviceSet = {};

    chiPhi.forEach(function (r, i) {
      var code = r[CP.CODE];
      var ngayIso = r[CP.NGAY];
      var ngayRaw = r[CP.NGAYRAW] || '';
      var ncc = r[CP.NCC];
      var mien = r[CP.MIEN];
      var dienGiai = r[CP.NOIDUNG];
      var amount = r[CP.TIEN];
      var d = ngayIso ? parseDateSafe(ngayIso) : null;
      var rKey = regionKey(mien);

      if (tuNgayDate && (!d || d.getTime() < tuNgayDate.getTime())) return;
      if (denNgayDate && (!d || d.getTime() > denNgayDate.getTime())) return;
      if (nccFilterKey && labelKey_(ncc) !== nccFilterKey) return;
      if (filters.mien && filters.mien !== 'toanquoc' && rKey !== filters.mien) return;

      tongChiPhi += amount;
      if (isTravelCost(dienGiai)) chiPhiDiChuyen += amount; else chiPhiSuaChua += amount;
      regionCost[rKey] = (regionCost[rKey] || 0) + amount;

      // Trọng số = SỐ TIỀN: tên hiển thị của nhóm lấy theo biến thể đóng góp nhiều tiền nhất,
      // đúng với ý nghĩa của bảng "Chi phí theo nhà cung cấp".
      if (ncc) tallyLabel_(nccStore, ncc, amount, i);

      if (rKey === 'bac' || rKey === 'trung' || rKey === 'nam') {
        var mKey = ngayIso ? ngayIso.substring(0, 7) : null;
        if (mKey) monthCostByRegion[rKey][mKey] = (monthCostByRegion[rKey][mKey] || 0) + amount;
      }

      if (code) deviceSet[code] = true;

      // DÙNG CHUNG repairKey_ với buildRepairHistory -> "Số lượt sửa chữa" ở đây đúng bằng tổng
      // "Số lần sửa chữa" của mọi thiết bị. Dòng không có mã vẫn được đếm.
      var comboKey = repairKey_(code, ngayIso, ngayRaw, ncc, r[CP.ROW]);
      if (!repairSet[comboKey]) {
        repairSet[comboKey] = true;
        regionCount[rKey] = (regionCount[rKey] || 0) + 1;
      }
    });

    var soLuotSuaChua = Object.keys(repairSet).length;
    var soThietBiSuaChua = Object.keys(deviceSet).length;

    var regionChart = ['bac', 'trung', 'nam'].map(function (k) {
      return { key: k, label: regionLabel(k), chiPhi: regionCost[k] || 0, soLuot: regionCount[k] || 0 };
    });

    var allMonthKeys = {};
    ['bac', 'trung', 'nam'].forEach(function (rk) {
      Object.keys(monthCostByRegion[rk]).forEach(function (mk) { allMonthKeys[mk] = true; });
    });
    var monthKeys = Object.keys(allMonthKeys).sort();
    var trendChart = monthKeys.map(function (k) {
      var parts = k.split('-');
      return {
        thang: parts[1] + '/' + parts[0],
        bac: monthCostByRegion.bac[k] || 0,
        trung: monthCostByRegion.trung[k] || 0,
        nam: monthCostByRegion.nam[k] || 0
      };
    });

    var topNcc = Object.keys(nccStore).map(function (k) {
      return { ncc: nccStore[k].best, chiPhi: nccStore[k].total, _o: nccStore[k].order };
    }).sort(function (a, b) { return b.chiPhi - a.chiPhi || a._o - b._o; })
      .slice(0, 8)
      .map(function (x) { return { ncc: x.ncc, chiPhi: x.chiPhi }; });

    return {
      success: true,
      tongSoThietBi: totalDevices,
      soThietBiSuaChua: soThietBiSuaChua,
      soLuotSuaChua: soLuotSuaChua,
      tongChiPhi: tongChiPhi,
      chiPhiDiChuyen: chiPhiDiChuyen,
      chiPhiSuaChua: chiPhiSuaChua,
      regionChart: regionChart,
      trendChart: trendChart,
      deviceTypeChart: deviceTypeChart,
      deviceBrandChart: deviceBrandChart,
      topNcc: topNcc,
      // Đi ké sẵn trong phản hồi Dashboard để giao diện không phải gọi server thêm một vòng nữa.
      // Dùng freshnessPayload_() (không phải getDataFreshness()) vì tới đây dữ liệu đã nạp xong.
      capNhat: freshnessPayload_()
    };
  } catch (err) {
    return { success: false, message: 'Đã xảy ra lỗi: ' + err.message };
  }
}