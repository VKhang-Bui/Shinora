# TÀI LIỆU DỰ ÁN: PORTAL DEADLINE THEO TUẦN VÀ THÁNG

> **Trạng thái**: Đã chuẩn hóa bố cục theo đúng yêu cầu & hình minh họa: 3 dòng phân tách rõ ràng; Ô chọn ngày có kích thước vừa vặn (140px) và tiếp nối liền kề là các nút điều hướng.

---

## 1. Bố Cục Giao Diện Đã Chuẩn Hóa

1. **Thanh điều khiển bên trái (Sidebar trái)**:
   * `TRANG CHỦ`
   * `DEADLINE`:
     * `[📅 Deadline theo tuần]`
     * `[📆 Deadline theo tháng]`
     *(Đã xóa 2 khối "Deadline cá nhân" và "Deadline cả nhóm")*
   * `DỰ ÁN & TIẾN ĐỘ` (Đồ án tốt nghiệp, Nghiên cứu Lab...)

2. **Khu Vực Bảng Theo Dõi (Portlet)**:
   * **DÒNG 1**:
     `[Bảng theo dõi Deadline theo tuần/tháng]` + `[ 🔍 Ô Tìm kiếm deadline, môn học, dự án... ]` (kéo dài `flex: 1` chạm hết mép phải khối, bằng với mép phải của bảng table).
   * **DÒNG 2 (Enter xuống dưới - Một khung riêng)**:
     `[Dữ liệu mẫu (BẬT) / Khung rỗng]` (khung riêng biệt, sẵn sàng mở rộng các công cụ lọc).
   * **DÒNG 3 (Enter xuống dưới - Chuẩn theo hình minh họa)**:
     `[ 05/10/2026 📅 ]` (vừa vặn 140px, không kéo dài) tiếp nối ngay sau đó là:
     `[📅 Hiện tại]` ➔ `[🖨 In lịch]` ➔ `[< Trở về]` ➔ `[Tiếp >]` ➔ `[ ⛶ Phóng to]`.

3. **Header trên cùng**:
   * Tinh gọn chỉ còn **Logo bên trái** và **Tài khoản người dùng bên phải** (không còn thanh tìm kiếm vướng ở giữa).

---

## 2. Hệ Thống Dữ Liệu & Chú Thích Màu Sắc Đã Rút Gọn

* Thanh chú thích màu (cuối bảng) đã bỏ dòng tiêu đề "Quy định màu sắc..." và rút gọn thành 5 mốc chính:
  * ⬛ **[xám]**: `pass` (Quá hạn)
  * 🟥 **[đỏ]**: `3 ngày` (≤ 3 ngày - Cực gấp)
  * 🟧 **[cam]**: `1 tuần` (4 – 7 ngày)
  * 🟨 **[vàng]**: `3 tuần` (8 – 21 ngày)
  * 🟩 **[xanh]**: `2 tháng` (22 – 60 ngày)

---

## 3. Thiết Kế Thẻ Deadline (Phương Án C - Task Card)

* **Dòng Header thẻ**:
  * Bên trái: `🕒 Giờ chót` (ví dụ `09:00`, `15:00`) - Lược bỏ ngày vì ngày đã hiển thị rõ ràng trên tiêu đề cột.
  * Bên phải: Badge trạng thái đếm ngược `[Còn 1 ngày]`, `[Còn 3 ngày]`, `[Hôm nay]`, `[Quá hạn X ngày]`.
* **Đường phân cách**: Nét đứt tinh tế (`border-bottom: 1px dashed rgba(0,0,0,0.18)`).
* **Dòng Body thẻ**: Tiêu đề công việc/môn học in đậm, rõ ràng, không bị ngắt quãng hay gãy dòng.
* **Tooltip**: Rê chuột hiển thị đầy đủ ngày giờ nộp chi tiết.

---

## 4. Chức Năng Tạo Deadline (Phỏng Theo Google Calendar)

* **Vị trí nút Tạo**: Nằm bên trái dòng điều khiển toolbar (`[ + Tạo ▼ ]`), phong cách Google Calendar với menu con:
  * `👤 Cá nhân`
  * `👥 Cả nhóm`
* **Modal thêm Deadline**:
  * Tiêu đề có gạch chân xanh hiện đại.
  * Hai tab `[ Cá nhân ]` và `[ Cả nhóm ]` chuyển đổi nhanh.
  * Mặc định thời điểm: ngày hiện tại của **tuần sau** (ví dụ `12/10/2026`) lúc `09:00`.
  * Nhấn vào ngày sẽ mở popup mini calendar để chọn ngày trực quan (chuẩn theo Hình 5).
  * Nhấn vào giờ để nhập trực tiếp hoặc chọn từ danh sách gợi ý.
  * Đã loại bỏ các trường không cần thiết: Thêm khách, Google Meet, vị trí, múi giờ, lặp lại, môn học/dự án.
  * Tự động xác định ca (Sáng / Chiều / Tối) dựa vào giờ nộp và áp màu theo thời gian còn lại.

---

## 5. Chức Năng Quick View, Chỉnh Sửa, Xóa, In & Sao Chép Prompt AI (Google Calendar Style)

* **Khi nhấn vào thẻ Deadline (tuần hoặc tháng)**:
  * **Hiển thị Popover ngay BÊN CẠNH thẻ deadline** (Neo theo vị trí thẻ, ưu tiên bên phải, tự động đổi sang bên trái nếu sát mép màn hình).
  * **KHÔNG PHẢI CỬA SỔ & KHÔNG CÓ MÀN ĐEN OVERLAY**: Bảng lịch và giao diện bên dưới vẫn sáng rõ 100%. Click ra ngoài vùng popover sẽ tự động đóng lại.
  * **Thanh công cụ trên đầu popover**:
    * ✏️ **Cây bút (Chỉnh sửa)**: Nhấn vào **mới MỞ CỬA SỔ MODAL** ở giữa màn hình (có overlay làm mờ). Điền sẵn toàn bộ Tiêu đề, Phân loại, Ngày, Giờ; nút chuyển thành "Cập nhật". Khi lưu sẽ cập nhật ngay thẻ deadline trên bảng.
    * 🗑️ **Thùng rác (Xóa)**: Hỏi xác nhận xóa, xóa item khỏi danh sách và render lại bảng kèm thông báo toastr.
    * ❌ **Biểu tượng Email**: Đã loại bỏ hoàn toàn theo yêu cầu.
    * ⋮ **3 chấm (Tùy chọn khác)**: Menu thả xuống gồm:
      * `🖨 In`: Mở cửa sổ in phiếu thông tin deadline chuẩn đẹp.
      * `📋 Sao chép thông tin`: Tự động copy thông tin deadline + prompt AI gợi ý vào Clipboard để đưa vào ChatGPT/Claude/Gemini lập kế hoạch.
    * ✕ **Nút đóng**: Đóng popover.
  * **Nội dung popover**:
    * Khối vuông màu hiển thị mức độ gấp.
    * Tiêu đề công việc.
    * Thời gian nộp (Thứ, ngày tháng · Giờ) kèm badge trạng thái đếm ngược.
    * Phân loại: `👤 Cá nhân` hoặc `👥 Cả nhóm`.
    * *(Đã loại bỏ hoàn toàn trường môn học/dự án theo yêu cầu)*.
