#!/usr/bin/env python3
"""Sinh desktop.html / mobile.html từ Index.html / IndexMobile.html của Apps Script TH true care.
Giao diện giữ NGUYÊN VĂN, chỉ chèn thêm phần đầu (PWA + shim + core) và màn đăng nhập.
Chạy lại mỗi khi sửa giao diện trong apps-script/:  python3 tools/build_pages.py"""
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEAD = '''<meta name="theme-color" content="#0B4C8C">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="{statusbar}">
  <meta name="apple-mobile-web-app-title" content="TH true care">
  {viewport}<link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" type="image/png" href="icons/favicon-96.png?v=2">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png?v=2">
  <link rel="stylesheet" href="css/auth.css">
  <!-- Thứ tự quan trọng: shim + core phải có TRƯỚC script inline của giao diện bên dưới -->
  {uiscale}<script src="js/gas-shim.js"></script>
  <script src="js/core.js"></script>
'''


def build(src, dst, desktop):
    s = open(os.path.join(root, 'apps-script', src), encoding='utf-8').read()
    s = s.replace('<base target="_top">', '')
    # Đánh dấu bản điện thoại để css/auth.css chỉ áp các chỉnh riêng cho nó (dùng chung 1 file css).
    if not desktop:
        s = s.replace('<html', '<html data-ui="mobile"', 1)
    has_vp = 'name="viewport"' in s
    head = HEAD.format(viewport='' if has_vp else
                       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n  ',
                       uiscale='<script src="js/ui-scale.js"></script>\n  ' if desktop else '',
                       # Điện thoại: thanh trạng thái iOS kiểu "default" -> nội dung nằm DƯỚI thanh trạng thái
                       # khi mở từ màn hình chính (black-translucent làm thanh tiêu đề trắng bị chui xuống dưới giờ/pin).
                       statusbar='black-translucent' if desktop else 'default')
    i = s.index('<meta charset="UTF-8">') + len('<meta charset="UTF-8">')   # charset phải nằm sớm nhất
    s = s[:i] + '\n  ' + head.rstrip() + s[i:]
    i = s.index('<body>') + len('<body>')
    s = s[:i] + '\n  <div id="tmAuth" class="is-loading"></div>' + s[i:]
    i = s.rindex('</body>')
    s = s[:i] + '  <script type="module" src="js/app.js"></script>\n' + s[i:]
    open(os.path.join(root, dst), 'w', encoding='utf-8').write(s)
    print('OK', dst)


build('Index.html', 'desktop.html', True)
build('IndexMobile.html', 'mobile.html', False)
