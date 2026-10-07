# HỆ THỐNG QUẢN LÝ DEADLINE THEO TUẦN & THÁNG (DEADLINE TRACKER)

Dự án được xây dựng theo kiến trúc Module hóa chuyên nghiệp, kết nối **Cơ Sở Dữ Liệu SQL Thật (SQLite Native & Supabase Cloud PostgreSQL)**, tối ưu hóa tốc độ tải với **HTTP Cache + Optimistic UI 2 Phân khu Local Cache**, không có dữ liệu mẫu, lưu trữ bền vững trực tiếp trên đĩa cứng và đám mây.

---

## 1. Cấu Trúc Dự Án Đã Tái Cấu Trúc

```text
security/
├── api/                                 # [SERVERLESS FUNCTIONS CHO VERCEL]
│   └── deadlines.js                     # Serverless API kết nối Supabase Cloud PostgreSQL
│
├── backend/                             # [TẦNG CƠ SỞ DỮ LIỆU CỤC BỘ & REST API]
│   ├── database/
│   │   ├── schema.sql                   # Định nghĩa bảng SQLite cục bộ
│   │   ├── schema_supabase.sql          # Định nghĩa bảng PostgreSQL cho Supabase Cloud
│   │   └── deadlines.sqlite             # File CSDL SQL thật trên máy (TRẮNG TINH 0 bản ghi)
│   ├── controllers/
│   │   └── deadlineController.js        # Controller thực thi SQL (SELECT, INSERT, UPDATE, DELETE)
│   ├── db.js                            # Kết nối SQLite native (node:sqlite)
│   └── server.js                        # HTTP Server phục vụ API & HTTP Cache (0ms load)
│
├── frontend/                            # [TẦNG GIAO DIỆN & TÀI NGUYÊN]
│   ├── pages/
│   │   └── deadline/                    # [MODULE QUẢN LÝ DEADLINE]
│   │       ├── index.html               # Trang giao diện chính
│   │       ├── deadline.css             # CSS riêng của module deadline
│   │       └── deadline.js              # JS logic Optimistic UI 2 phân khu, auto live ticker
│   │
│   └── shared/                          # [TÀI NGUYÊN DÙNG CHUNG CỦA HỆ THỐNG PORTAL]
│       ├── css/                         # CSS chung (layout, bootstrap, kendo, fonts)
│       ├── js/                          # Thư viện dùng chung (jQuery, toastr, kendo, bootstrap)
│       └── fonts/                       # Web fonts (FontAwesome, Glyphicons)
│
├── package.json                         # Cấu hình dự án & script khởi chạy
├── vercel.json                          # Cấu hình định tuyến và triển khai Vercel
├── index.html                           # Entry point tự động điều hướng vào module deadline
└── README.md                            # Hướng dẫn chi tiết
```

---

## 2. Cách Khởi Động Dự Án Cục Bộ (Local Machine)

Chỉ cần chạy lệnh sau tại thư mục gốc của dự án:
```bash
npm start
# hoặc: node backend/server.js
```

Truy cập trình duyệt tại địa chỉ:
* 👉 **http://localhost:3000**
* 👉 **http://localhost:3000/deadline**

---

## 3. Kiến Trúc Tối Ưu Tốc Độ: Optimistic UI 2 Phân Khu & Cache 2 Tầng

1. **Tầng 1: HTTP Cache-Control & ETag (Tải giao diện trong 0ms)**:
   * CSS, JS, Fonts được cấu hình header `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.
   * Trình duyệt tự lưu vào Disk Cache, lần sau F5 chỉ đọc từ ổ cứng máy người dùng (0ms).
   * Hỗ trợ chuẩn `ETag` trả về `304 Not Modified` khi không có thay đổi.

2. **Tầng 2: Optimistic UI với 2 Phân Khu Local Cache**:
   * **Khu A (Không biến động - `deadlines_synced`)**: Lưu dữ liệu đã ghi thành công vào CSDL. F5 là lấy ra vẽ ngay lập tức.
   * **Khu B (Biến động - `deadlines_pending`)**: Vùng đệm tạm thời chứa thao tác đang chờ hoặc lỗi.
   * **Bấm [Lưu]**: Thẻ hiện lên lịch ngay lập tức (0.01s) với icon ⏳. Khi server lưu xong -> chuyển sang Khu A. Nếu mất kết nối -> giữ lại trên máy và hiện nút `[Thử lại]` (không làm mất dữ liệu của người dùng).
   * **Bộ đếm thời gian thực (Live Ticker)**: Tự động chạy mỗi 60 giây, cập nhật số ngày còn lại và tự chuyển màu (`xám, đỏ, cam, vàng, xanh`) mà không cần F5.

---

## 4. Hướng Dẫn Triển Khai Lên Supabase & Vercel (Deploy Production)

### BƯỚC 1: Khởi tạo Cơ Sở Dữ Liệu trên Supabase (Cloud PostgreSQL)
1. Truy cập [https://supabase.com](https://supabase.com) và đăng nhập (bằng GitHub hoặc Email).
2. Nhấn **"New project"** -> Đặt tên dự án (ví dụ: `portal-deadline`) và tạo mật khẩu CSDL -> Chọn Region gần bạn nhất (ví dụ: `Singapore`).
3. Sau khi dự án khởi tạo xong, ở menu bên trái chọn **"SQL Editor"** -> **"New query"**.
4. Mở file `backend/database/schema_supabase.sql` trong dự án của bạn, copy toàn bộ nội dung và dán vào SQL Editor -> Nhấn **"Run"** (Ctrl + Enter).
   *(Bảng `deadlines` và `categories` sẽ được tạo ngay lập tức, trắng tinh 0 bản ghi).*
5. Vào **Project Settings** (biểu tượng bánh răng góc dưới bên trái) -> Chọn mục **API**:
   * Copy **Project URL** (ví dụ: `https://xyzabc.supabase.co`).
   * Copy **anon public key** (chuỗi ký tự dài bắt đầu bằng `eyJh...`).

---

### BƯỚC 2: Triển khai Website lên Vercel
1. Đẩy mã nguồn dự án lên GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: complete deadline tracker with optimistic ui and supabase support"
   git branch -M main
   git remote add origin <URL-GITHUB-REPO-CUA-BAN>
   git push -u origin main
   ```
2. Truy cập [https://vercel.com](https://vercel.com) -> Đăng nhập -> Nhấn **"Add New..."** -> **"Project"**.
3. Chọn kho lưu trữ GitHub bạn vừa đẩy lên và nhấn **"Import"**.
4. Tại phần **Environment Variables** (Biến môi trường), thêm 2 biến đã lấy từ Supabase:
   * **`SUPABASE_URL`**: `<Dán Project URL từ Supabase>`
   * **`SUPABASE_ANON_KEY`**: `<Dán anon public key từ Supabase>`
5. Nhấn **"Deploy"**. Vercel sẽ tự động build và cấp phát tên miền miễn phí (ví dụ: `https://portal-deadline.vercel.app`).
# Shinora
