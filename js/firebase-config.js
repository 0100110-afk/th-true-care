// Cấu hình web của Firebase th-truemart-info (dùng CHUNG với Hệ thống quản lý: cùng tài khoản đăng nhập).
// Đây là thông tin công khai của ứng dụng web, không phải mật khẩu — quyền đọc do firestore.rules quyết định.
/* Đăng nhập Google chạy qua CHÍNH tên miền của app (Vercel chuyển tiếp /__/auth/* về Firebase —
   xem vercel.json). Nếu để authDomain = …firebaseapp.com (khác tên miền app), Safari/iPhone tách bộ
   nhớ giữa 2 tên miền nên Firebase mất trạng thái giữa chừng -> trang trắng "missing initial state".
   Chỉ tên miền có cấu hình chuyển tiếp mới dùng cách này (và phải có trong Google Cloud → OAuth
   client → Authorized redirect URIs: https://<tên miền>/__/auth/handler); nơi khác giữ như cũ. */
const PROXIED_AUTH_HOSTS = ['th-true-care.vercel.app'];
const AUTH_DOMAIN = (typeof location !== 'undefined' && PROXIED_AUTH_HOSTS.indexOf(location.host) > -1)
  ? location.host : 'th-truemart-info.firebaseapp.com';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDC7uYhXaaIIWQ9c9awYoEkBR2T3MdCbl0',
  authDomain: AUTH_DOMAIN,
  projectId: 'th-truemart-info',
  storageBucket: 'th-truemart-info.firebasestorage.app',
  messagingSenderId: '689058170024',
  appId: '1:689058170024:web:f10719c9acd92b639f2e9d'
};
export const APP_TITLE = 'Quản lý thiết bị';

/** Link Web app của Sync.gs (file GT) — Apps Script -> Triển khai -> Ứng dụng web. Để trống thì nút
 *  "Đồng bộ từ Google Sheet" quay về chức năng cũ (chỉ tải lại dữ liệu đã có trên app). */
export const SYNC_URL = 'https://script.google.com/macros/s/AKfycbzYime3muZtOB_ZnZZVRcRNrZ1M9kV_OHTiqR_vZNbBYzLCVQaVwwGqNphdVbiv8a4n/exec';
