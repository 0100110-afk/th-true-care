# CLAUDE.md — TH true care · Quản lý thiết bị (tủ mát)

Đọc README.md trước (kiến trúc, cài đặt, lệnh build/test, cấu trúc thư mục). File này chỉ ghi những điều README không nói.
Trao đổi, commit message, chú thích code: **tiếng Việt**.

## Không sửa trực tiếp
`desktop.html`, `mobile.html`, `js/core.js` **và `apps-script/Sync.gs`** là file sinh tự động.
- Đọc sheet / logic tra cứu → sửa `apps-script/Code.gs` (sinh ra cả `js/core.js` lẫn phần đọc sheet trong Sync.gs).
- Khung đồng bộ (đẩy Firestore, chia mảnh, menu, trigger, `doPost`) → sửa `tools/sync_template.gs`.
Build → commit cả nguồn lẫn file sinh.

## Đụng đến app khác
- Firebase `th-truemart-info` dùng chung với repo `th-truemart-info`. **Rules nằm ở repo đó**, không ở đây;
  `care_users` cũng do Sync.gs bên TM ghi. App này chỉ đọc `care_meta`, `care_chunks` — không đụng collection của TM.
- App chỉ tra cứu, không ghi. Muốn thêm tính năng ghi → hỏi trước (phải sửa rules bên TM).

## Quy tắc nghiệp vụ đã chốt
- Đơn giá đọc từ file DG (`CS_DG_FILE_ID`), không đọc tab đơn giá trong GT.
- GSBH lấy từ GSBH GT + GSBH KA (liên kết ASMSM GT / ASMSM KA); sheet "GSBH" cũ đã bỏ.
- Số điện thoại: chữ thường trên máy tính; bấm-để-gọi chỉ trên điện thoại.
- Đếm sửa chữa dùng chung `repairKey_()` để không đếm trùng.
- Màu nhận diện: navy `#123A6E`, cyan `#5BC2EC`, vàng champagne `#C9A961`.

## Cách làm việc
- Thay đổi ảnh hưởng logic hoặc dữ liệu: **trình bày phương án trước**, chờ đồng ý. Giao diện nhỏ, rõ ràng: làm luôn.
- Không rõ sửa bản máy tính, điện thoại hay cả hai → hỏi.
- Sync.gs đổi → nhắc người dùng dán lại vào Apps Script file GT (và triển khai lại Web app nếu đổi `doPost`).
- Commit message: một dòng, mở đầu bằng khu vực (`GSBH (máy tính):`, `Tổng quan:`, `Biểu đồ:`…), tả hành vi mới người dùng thấy.
- Không commit khoá service account hay dữ liệu thật (repo public).
