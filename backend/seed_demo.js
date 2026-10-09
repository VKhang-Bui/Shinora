/**
 * DỮ LIỆU DEMO - CHỈ NẠP KHI SEED_DEMO=1 (Docker demo / chạy thử). Production KHÔNG bật biến này.
 * - Ngày tính TƯƠNG ĐỐI so với hôm nay nên luôn nằm trong khung nhìn.
 * - Mỗi lần khởi động xóa các bản ghi có id bắt đầu bằng "demo-" rồi nạp lại (không đụng dữ liệu thật).
 * - Đăng nhập bằng "Bùi Văn Khang" để thấy cả deadline cá nhân; chế độ khách chỉ thấy deadline nhóm chung.
 */
const db = require('./db');

const KHANG = ['bùi văn khang', 'Bùi Văn Khang'];

function dateStr(offsetDays, hhmm) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hhmm}:00`;
}

function sessionOf(hhmm) {
    const h = parseInt(hhmm.split(':')[0], 10);
    return h >= 18 ? 'toi' : (h >= 12 ? 'chieu' : 'sang');
}

// [id, tiêu đề, ngày(+offset), giờ bắt đầu, category, taskType, giờ kết thúc, completed, chủ sở hữu]
const SAMPLES = [
    // ---- THỰC HÀNH (khối kéo dài trên lịch tuần; có ca xuyên qua ranh giới hàng) ----
    ['demo-p1', 'Thực hành Wireshark - bắt gói tin',      0, '13:00', 'group',    'practice', '19:30', 0, KHANG],
    ['demo-p2', 'Thực hành Nmap quét cổng (Sáng→Chiều)',   1, '08:30', 'group',    'practice', '13:00', 0, KHANG],
    ['demo-p3', 'Lab Metasploit cả buổi',                  3, '10:00', 'group',    'practice', '15:00', 0, KHANG],
    ['demo-p4', 'Thực hành cá nhân: cấu hình firewall',    4, '14:00', 'personal', 'practice', '17:00', 0, KHANG],
    ['demo-p5', 'Thực hành SQL Injection (Chiều→Tối)',     5, '16:00', 'group',    'practice', '21:00', 0, KHANG],
    ['demo-p6', 'Thực hành đã hoàn thành',                -1, '09:00', 'group',    'practice', '11:30', 1, KHANG],
    // ---- CÁC TRƯỜNG HỢP GIỜ SÁT NHAU / CHẠM MÉP (không xung đột, hiển thị chia làn) ----
    ['demo-p7', 'Thực hành sát giờ nộp (9h05)',            2, '09:05', 'group',    'practice', '11:00', 0, KHANG],
    ['demo-p8', 'Thực hành 13h-17h',                       7, '13:00', 'group',    'practice', '17:00', 0, KHANG],
    ['demo-s9', 'Nộp bài đúng 17h (chạm mép)',             7, '17:00', 'group',    'submit',   null,    0, KHANG],
    // ---- XUNG ĐỘT THẬT (hiện ⚠ + cảnh báo khi lưu) ----
    ['demo-p9', 'Thực hành A 13h-17h',                     8, '13:00', 'group',    'practice', '17:00', 0, KHANG],
    ['demo-p10','Thực hành B 16h-19h (chồng A)',           8, '16:00', 'group',    'practice', '19:00', 0, KHANG],
    ['demo-s10','Nộp bài 15h (nằm trong thực hành A)',     8, '15:00', 'group',    'submit',   null,    0, KHANG],
    // ---- NỘP BÀI (đủ các mốc màu) ----
    ['demo-s1', 'Nộp report tuần 5 (quá hạn)',            -2, '23:00', 'group',    'submit',   null,    0, KHANG],
    ['demo-s2', 'Nộp báo cáo nhóm - hôm nay',              0, '17:00', 'group',    'submit',   null,    0, KHANG],
    ['demo-s3', 'Nộp slide thuyết trình',                  2, '09:00', 'group',    'submit',   null,    0, KHANG],
    ['demo-s4', 'Nộp bài tập cá nhân môn ATTT',            3, '20:00', 'personal', 'submit',   null,    0, KHANG],
    ['demo-s5', 'Nộp report lab 3',                        6, '15:00', 'group',    'submit',   null,    0, KHANG],
    ['demo-s6', 'Nộp đồ án giữa kỳ',                      14, '23:59', 'group',    'submit',   null,    0, KHANG],
    ['demo-s7', 'Nộp báo cáo cuối kỳ',                    45, '12:00', 'group',    'submit',   null,    0, KHANG],
    ['demo-s8', 'Nộp bài đã xong',                         1, '10:00', 'personal', 'submit',   null,    1, KHANG]
];

function seedDemo() {
    db.prepare("DELETE FROM deadlines WHERE id LIKE 'demo-%'").run();
    const ins = db.prepare(`
        INSERT INTO deadlines (id, title, due_date, session, category_id, user_id, user_name, assignees, task_type, end_time, is_completed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'all', ?, ?, ?)
    `);
    for (const [id, title, off, start, cat, type, end, done, owner] of SAMPLES) {
        ins.run(id, title, dateStr(off, start), sessionOf(start), cat, owner[0], owner[1], type, end, done);
    }
    console.log(`[Seed Demo] Đã nạp ${SAMPLES.length} deadline demo (SEED_DEMO=1). Đăng nhập "${KHANG[1]}" để xem đủ.`);
}

module.exports = seedDemo;
