// Cấu hình web của Firebase th-truemart-info (dùng CHUNG với Hệ thống quản lý: cùng tài khoản đăng nhập).
// Đây là thông tin công khai của ứng dụng web, không phải mật khẩu — quyền đọc do firestore.rules quyết định.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDC7uYhXaaIIWQ9c9awYoEkBR2T3MdCbl0',
  authDomain: 'th-truemart-info.firebaseapp.com',
  projectId: 'th-truemart-info',
  storageBucket: 'th-truemart-info.firebasestorage.app',
  messagingSenderId: '689058170024',
  appId: '1:689058170024:web:f10719c9acd92b639f2e9d'
};
export const APP_TITLE = 'Quản lý thiết bị';

/** Link Web app của Sync.gs (file GT) — Apps Script -> Triển khai -> Ứng dụng web. Để trống thì nút
 *  "Đồng bộ từ Google Sheet" quay về chức năng cũ (chỉ tải lại dữ liệu đã có trên app). */
export const SYNC_URL = '';
