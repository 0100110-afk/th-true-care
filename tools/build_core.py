#!/usr/bin/env python3
"""Sinh js/core.js từ apps-script/Code.gs của TH true care.

Giữ NGUYÊN VĂN toàn bộ logic tra cứu / tổng hợp (searchDevice, Dashboard, danh sách thiết bị,
dữ liệu chi phí, đơn giá...). Chỉ thay lớp dữ liệu:
  - readCachedRecords(prefix) -> bản ghi Sync.gs đã dựng sẵn và đẩy lên Firestore (CARE_DATA).
  - Các hàm đọc Sheet / CacheService / trigger / chẩn đoán cache -> bỏ (chạy ở Sync.gs).
  - freshnessPayload_ -> mốc "cập nhật lần cuối" của lần đồng bộ.

Chạy:  python3 tools/build_core.py
"""
import os, re, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'apps-script', 'Code.gs'), encoding='utf-8').read()
lines = src.split('\n')


def func_range(name):
    pat = re.compile(r'^function ' + re.escape(name) + r'\(')
    for i, l in enumerate(lines):
        if pat.match(l):
            if l.rstrip().endswith('}') and l.count('{') == l.count('}'):
                return i, i
            for j in range(i + 1, len(lines)):
                if lines[j].rstrip() == '}':
                    # kèm khối chú thích /** ... */ ngay trên
                    k = i - 1
                    if k >= 0 and lines[k].strip() == '*/':
                        while k >= 0 and not lines[k].lstrip().startswith('/*'):
                            k -= 1
                        if k >= 0 and lines[k].startswith('/*'):
                            i = k
                    return i, j
    sys.exit('Không thấy hàm ' + name)


repl = {}


def replace_func(name, text):
    s, e = func_range(name)
    repl[s] = (e, text)


DROP = ['doGet', 'getCache', 'writeCacheRecords', 'clearCachePrefix', 'isCacheWarm_',
        'recordRefreshStatus_', 'rebuildVolatileData_', 'rebuildDonGiaData_', 'refreshCache',
        'clearAllCache', 'silentRefreshCache', 'getRefreshStatus', 'cacheStamp_', 'getDataFreshness',
        'utf8Len_', 'kiemTraCache', 'kiemTraGopNhan', 'setupAutoRefreshTrigger',
        'rebuildListingRecords', 'rebuildChiPhiRecords', 'rebuildThanhLyRecords', 'rebuildGsbhRecords',
        'rebuildDonGiaBtRecords', 'rebuildDonGiaXdRecords', 'rebuildDonGiaSnkRecords']
for n in DROP:
    replace_func(n, None)

replace_func('readCachedRecords', '''/** Bản web: bản ghi đã được Sync.gs dựng sẵn (cùng định dạng mảng như cache cũ). */
function readCachedRecords(prefix) {
  return CARE_DATA[prefix] || [];
}''')
replace_func('freshnessPayload_', '''/** Bản web: mốc của lần đồng bộ gần nhất từ Google Sheet. */
function freshnessPayload_() {
  var ts = CARE_UPDATED_TS || null;
  if (!ts) return { ts: null, text: '' };
  var d = new Date(ts);
  var p = function (n) { return ('0' + n).slice(-2); };
  return { ts: ts, text: p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() };
}''')

out, i = [], 0
while i < len(lines):
    if i in repl:
        e, t = repl[i]
        if t is not None:
            out.append(t)
        i = e + 1
        continue
    out.append(lines[i])
    i += 1
body = '\n'.join(out)
# getXxxRecords() truyền hàm rebuild làm tham số thứ 2 -> bỏ (hàm rebuild không còn trong core)
body, nsub = re.subn(r"readCachedRecords\('([a-z_0-9]+)', rebuild\w+\)", r"readCachedRecords('\1')", body)
if nsub != 7:
    sys.exit('Cần bỏ 7 tham số rebuild, thấy ' + str(nsub))
if re.search(r'\brebuild\w+Records\b', body):
    sys.exit('core.js vẫn còn tham chiếu hàm rebuild*Records')
# gỡ các khai báo hằng chỉ dùng cho chẩn đoán cache (không còn hàm dùng tới)
body = re.sub(r'\nvar CACHE_LIMIT_BYTES[^\n]*\nvar CACHE_WARN_BYTES[^\n]*\nvar CACHE_KEY_LIMIT[^\n]*\nvar CACHE_KEY_WARN[^\n]*', '\n', body)

API = ['searchDevice', 'batchSearchDevices', 'getChiPhiPageData', 'getDonGiaData', 'getFilterOptions',
       'getDashboardData', 'getDanhSachThietBiFilterOptions', 'getDanhSachThietBiPageData']
for n in API:
    if not re.search(r'^function ' + n + r'\(', body, re.M):
        sys.exit('Thiếu hàm API ' + n)

pre = '''/**
 * core.js — SINH TỰ ĐỘNG từ apps-script/Code.gs (python3 tools/build_core.py). Đừng sửa tay:
 * sửa Code.gs rồi chạy lại. Logic tra cứu giữ nguyên văn; dữ liệu lấy từ CARE_DATA (Firestore).
 */
var CareCore = (function () {
  'use strict';
  var CARE_DATA = {};          // prefix -> mảng bản ghi (listing_v4, chiphi_v3, ...)
  var CARE_UPDATED_TS = 0;
  var Logger = { log: function (m) { if (typeof console !== 'undefined') console.log(m); } };

'''
post = '''
  return {
    API: { ''' + ', '.join(n + ': ' + n for n in API) + ''' },
    setData: function (prefix, records) { CARE_DATA[prefix] = records || []; },
    setUpdated: function (ts) { CARE_UPDATED_TS = ts || 0; },
    freshness: function () { return freshnessPayload_(); }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CareCore;
'''
ind = '\n'.join(('  ' + l) if l.strip() else '' for l in body.split('\n'))
open(os.path.join(root, 'js', 'core.js'), 'w', encoding='utf-8').write(pre + ind + post)
print('OK js/core.js')
