#!/usr/bin/env python3
"""Sinh apps-script/Sync.gs = tools/sync_template.gs + phần ĐỌC SHEET chép từ Code.gs.

Các hàm đọc sheet (rebuild*Records) và hàm phụ được chép nguyên văn rồi đổi tên sang tiền tố
"cs" để Sync.gs đứng một mình và không đụng tên với Code.gs nếu hai file cùng nằm trong project.
Hai chỗ được sửa:
  - bỏ dòng writeCacheRecords(...)  (không dùng CacheService nữa)
  - đơn giá đọc từ file DG riêng: getActiveSpreadsheet() -> csDgSs_() cho 3 sheet DON GIA.
Chạy:  python3 tools/build_sync.py
"""
import os, re, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'apps-script', 'Code.gs'), encoding='utf-8').read()
lines = src.split('\n')

FUNCS = ['normalizeCode', 'removeDiacritics', 'buildHeaderIndex', 'cellStr', 'cellFlexible',
         'buildDateStrict_', 'parseDateSafe', 'isBadDate_', 'rawDateText_', 'formatDateDisplay', 'dateToIso',
         'rebuildListingRecords', 'rebuildChiPhiRecords', 'rebuildThanhLyRecords', 'rebuildGsbhRecords',
         'rebuildDonGiaBtRecords', 'rebuildDonGiaXdRecords', 'rebuildDonGiaSnkRecords']
VARS = ['SHEET_LISTING', 'SHEET_CHIPHI', 'SHEET_THANHLY', 'SHEET_GSBH', 'SHEET_DONGIA_BT', 'SHEET_DONGIA_XD', 'SHEET_DONGIA_SNK']


def grab(name):
    pat = re.compile(r'^function ' + re.escape(name) + r'\(')
    for i, l in enumerate(lines):
        if pat.match(l):
            for j in range(i, len(lines)):
                if lines[j].rstrip() == '}' or (j == i and l.rstrip().endswith('}')):
                    return '\n'.join(lines[i:j + 1])
    sys.exit('Không thấy hàm ' + name)


parts = []
for v in VARS:
    m = re.search(r'^var ' + v + r" = '[^']*';", src, re.M)
    if not m:
        sys.exit('Không thấy ' + v)
    parts.append(m.group(0))
parts.append('')
for f in FUNCS:
    parts.append(grab(f))
    parts.append('')
code = '\n'.join(parts)

code = re.sub(r'\n\s*writeCacheRecords\([^\n]*\);', '', code)
code = re.sub(r"SpreadsheetApp\.getActiveSpreadsheet\(\)\.getSheetByName\((SHEET_DONGIA_(?:BT|XD|SNK))\)",
              r'csDgSs_().getSheetByName(\1)', code)
if code.count('csDgSs_()') != 3:
    sys.exit('Không đổi được nơi đọc đơn giá (cần 3 chỗ)')

def cs_name(n):
    return 'cs' + n[0].upper() + n[1:]
for n in sorted(FUNCS + VARS, key=len, reverse=True):
    code = re.sub(r'(?<![\w.])' + re.escape(n) + r'\b', cs_name(n), code)

tpl = open(os.path.join(root, 'tools', 'sync_template.gs'), encoding='utf-8').read()
open(os.path.join(root, 'apps-script', 'Sync.gs'), 'w', encoding='utf-8').write(tpl.replace('//@@GENERATED@@', code))
print('OK apps-script/Sync.gs')
