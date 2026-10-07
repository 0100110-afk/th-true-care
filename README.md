# TH true care · Quản lý thiết bị (web + app điện thoại)

Bản web/PWA của Apps Script **TH true care**. Giao diện giữ nguyên, dữ liệu vẫn sửa trên Google Sheet.

```
Google Sheet "GT" (LISTING, CHI PHI, THANH LY, GSBH)  ┐
Google Sheet "DG" (DON GIA BT / XD / SNK)             ┘ ── Sync.gs (15 phút/lần + menu) ──► Firestore th-truemart-info
                                                                                              │  care_meta, care_chunks
Google Sheet "TM" → APP USERS, cột "TH true care" ── Sync.gs bên TM ──► care_users ──────────┤
                                                                                              ▼
                                                                   th-true-care.vercel.app (máy tính + điện thoại)
```

- **Chỉ một chiều Sheet → App.** App chỉ tra cứu, không ghi gì.
- **Đơn giá** đọc từ file **DG** riêng (`CS_DG_FILE_ID` trong `apps-script/Sync.gs`), không còn đọc trong file GT.
- **Dùng chung Firebase `th-truemart-info`** với Hệ thống quản lý → cùng tài khoản đăng nhập (Google hoặc email + mật khẩu).
- **Quyền:** cột *TH true care* trong sheet **APP USERS** của file TM (`admin` / `user`, để trống = không vào được).
  Người mới được tự tạo tài khoản + gửi email đặt mật khẩu (Sync.gs bên file TM lo).

## Cài đặt (một lần)

1. **File GT → Tiện ích mở rộng → Apps Script** → tạo file `Sync.gs`, dán nội dung `apps-script/Sync.gs`.
   (Code.gs / Index.html cũ giữ hay xoá tuỳ ý — Sync.gs đứng một mình, không trùng tên.)
2. **Project Settings → Script Properties → Add**: `FIREBASE_SA` = nội dung file JSON service account của
   Firebase **th-truemart-info** (đúng file đã dán bên file TM).
3. Chọn hàm **`caiDatDongBoTrueCare`** → **Run** → cấp quyền (cần quyền mở file DG).
4. Bên **file TM**: dán `Sync.gs` + rules mới của repo `th-truemart-info` → cột **TH true care** tự xuất hiện trong APP USERS.
5. **Vercel** → Add New Project → Import repo này → Framework **Other**, không build → Deploy.
6. **Firebase th-truemart-info → Authentication → Settings → Authorized domains** → thêm `th-true-care.vercel.app`.

Menu **App TH true care** trong file GT: *Đồng bộ ngay lên app*, *Cài đặt / cài lại đồng bộ*, *Xem tình trạng đồng bộ*.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `apps-script/Code.gs`, `Index.html`, `IndexMobile.html` | Bản Apps Script gốc (nguồn để sinh code, không chạy trên web) |
| `apps-script/Sync.gs` | **SINH TỰ ĐỘNG** (`tools/build_sync.py` + `tools/sync_template.gs`): đọc sheet đúng như Code.gs → đẩy lên Firestore |
| `js/core.js` | **SINH TỰ ĐỘNG** (`tools/build_core.py`): logic tra cứu của Code.gs, nguyên văn |
| `desktop.html`, `mobile.html` | **SINH TỰ ĐỘNG** (`tools/build_pages.py`): giao diện gốc + màn đăng nhập |
| `js/gas-shim.js` | Giả lập `google.script.run` để giao diện gốc chạy không cần sửa |
| `js/app.js` | Đăng nhập, kiểm tra quyền, tải dữ liệu (chỉ tải mảnh đã đổi, lưu IndexedDB), hộp Tài khoản |
| `index.html` | Tự chọn giao diện theo màn hình; `?view=mobile` như link Apps Script cũ |

Dữ liệu trên Firestore: `care_meta/data` (mốc + mã băm từng mảnh), `care_chunks/<prefix>__<i>` (bản ghi đã dựng sẵn, < 1 MB/mảnh).
Thêm dòng cuối CHI PHI chỉ ghi lại mảnh cuối; app cũng chỉ tải lại mảnh đó.

## Sửa giao diện / logic

Sửa trong `apps-script/` rồi chạy:

```bash
python3 tools/build_core.py && python3 tools/build_sync.py && python3 tools/build_pages.py
node tools/test-sync.js                       # Sync.gs + core.js với dữ liệu giả
DUMP=/tmp/s.json node tools/test-sync.js && STORE=/tmp/s.json python3 tools/test-ui.py   # giao diện (Playwright)
```

Sau khi sửa `apps-script/Sync.gs` nhớ dán lại vào Apps Script của file GT. Đổi giao diện thì tăng `VERSION` trong `sw.js`.
