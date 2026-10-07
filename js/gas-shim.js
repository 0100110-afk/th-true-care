/**
 * gas-shim.js — giả lập `google.script.run` để giao diện cũ (Index.html / IndexMobile.html) chạy
 * NGUYÊN VẸN mà không cần Apps Script.
 *
 *   google.script.run.withSuccessHandler(ok).withFailureHandler(err).tenHam(a, b)
 *
 * Mọi lời gọi được xếp hàng cho tới khi app.js đăng nhập + nạp xong dữ liệu (window.__TM_API_READY),
 * rồi chuyển sang hàm cùng tên trong bảng API. Kết quả được sao chép qua JSON giống cách Apps Script
 * tuần tự hoá dữ liệu trả về, nên giao diện không thể vô tình sửa vào dữ liệu gốc.
 *
 * File này PHẢI là script thường (không phải module) và nạp trong <head>: script inline của giao
 * diện chạy ngay khi parse xong và gọi google.script.run lập tức.
 */
(function () {
  'use strict';
  var resolveApi;
  var apiPromise = new Promise(function (r) { resolveApi = r; });
  window.__TM_API_READY = function (api) { resolveApi(api); };

  function clone(v) {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  function makeRunner(onOk, onErr) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return makeRunner(fn, onErr); };
        if (prop === 'withFailureHandler') return function (fn) { return makeRunner(onOk, fn); };
        if (prop === 'withUserObject') return function () { return makeRunner(onOk, onErr); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          apiPromise
            .then(function (api) {
              var fn = api[prop];
              if (typeof fn !== 'function') throw new Error('Chưa hỗ trợ hàm "' + String(prop) + '".');
              return fn.apply(null, args);
            })
            .then(function (res) { if (onOk) onOk(clone(res)); },
                  function (err) {
                    if (window.console) console.error('[TM] ' + String(prop), err);
                    var msg = (err && err.message) ? err.message : String(err);
                    if (onErr) onErr({ message: msg, name: err && err.name });
                  });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
