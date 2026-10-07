/**
 * ui-scale.js — tự co giãn giao diện MÁY TÍNH theo kích thước màn hình.
 *
 * Giao diện vừa vặn nhất trên màn rộng ~1520px. Màn 1366px (laptop phổ biến) trước đây phải chỉnh
 * trình duyệt về 90% mới vừa -> nay tự thu nhỏ 90% ngay ở mức 100% của trình duyệt.
 *   - Màn < 1520px : thu nhỏ theo tỉ lệ (thấp nhất 80%)
 *   - Màn 1520–1920 : giữ nguyên 100%
 *   - Màn > 1920px  : phóng to dần (tối đa 125%) cho chữ khỏi quá nhỏ trên màn 2K/4K
 * Đo theo screen.width (không đổi khi người dùng Ctrl +/-), nên phím phóng to/thu nhỏ của trình
 * duyệt vẫn dùng được như bình thường. Không áp dụng cho màn cảm ứng (điện thoại, máy tính bảng)
 * và cửa sổ hẹp (≤ 900px) — các trường hợp đó đã có bố cục riêng.
 * File script thường, nạp sớm trong <head> để trang không bị "giật" kích thước khi hiện ra.
 */
(function () {
  'use strict';
  var DESIGN = 1520, MIN = 0.8, MAX = 1.25, BIG = 1920;
  var root = document.documentElement;
  function calc() {
    var fine = !window.matchMedia || window.matchMedia('(pointer: fine)').matches;
    var sw = (window.screen && window.screen.width) || window.innerWidth;
    var z = 1;
    if (fine && window.innerWidth > 900) {
      if (sw < DESIGN) z = Math.max(MIN, sw / DESIGN);
      else if (sw > BIG) z = Math.min(MAX, sw / BIG);
    }
    return Math.round(z * 100) / 100;
  }
  function apply() {
    var z = calc();
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--uiz', String(z));
    root.classList.toggle('uiz', z !== 1);
  }
  apply();
  window.addEventListener('resize', apply);
})();
