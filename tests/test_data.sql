-- ==========================================================
-- SCHEMA VÀ DỮ LIỆU TEST (GIỐNG 100% SCHEMA GỐC)
-- CHỈ DÙNG CHO MỤC ĐÍCH KIỂM THỬ TỰ ĐỘNG TRONG DOCKER / TMP
-- TUYỆT ĐỐI KHÔNG NẰM TRONG CƠ SỞ DỮ LIỆU THẬT CỦA DỰ ÁN
-- ==========================================================

-- 1. BẢNG PHÂN LOẠI CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(20) PRIMARY KEY,
    name NVARCHAR(50) NOT NULL,
    icon VARCHAR(50) NOT NULL,
    color VARCHAR(20) NOT NULL
);

INSERT OR IGNORE INTO categories (id, name, icon, color) VALUES
('personal', 'Cá nhân', 'fa-user', '#1a73e8'),
('group', 'Cả nhóm', 'fa-users', '#0f9d58');

-- 2. BẢNG THÀNH VIÊN USERS
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(100) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (id, name) VALUES
('bùi văn khang', 'Bùi Văn Khang'),
('lê hoàng anh kiệt', 'Lê Hoàng Anh Kiệt'),
('huỳnh thái khang', 'Huỳnh Thái Khang'),
('lý thị ngọc như', 'Lý Thị Ngọc Như');

-- 3. BẢNG DEADLINES (CẤU TRÚC GIỐNG 100% CSDL THẬT)
CREATE TABLE IF NOT EXISTS deadlines (
    id VARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    due_date DATETIME NOT NULL,
    session VARCHAR(10) NOT NULL CHECK(session IN ('sang', 'chieu', 'toi')),
    category_id VARCHAR(20) NOT NULL DEFAULT 'personal',
    user_id VARCHAR(100),
    user_name NVARCHAR(100),
    assignees TEXT DEFAULT 'all',
    group_name NVARCHAR(255),
    group_link VARCHAR(500),
    description TEXT,
    is_completed INTEGER DEFAULT 0 CHECK(is_completed IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_deadlines_due_date ON deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_deadlines_category ON deadlines(category_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_user_id ON deadlines(user_id);

-- 4. DỮ LIỆU MẪU ĐẶC THÙ CHO CÁC TEST CASES (TEST COLOR, SESSIONS, CATEGORIES, PASS/FAIL)
INSERT OR REPLACE INTO deadlines (id, title, due_date, session, category_id, user_id, user_name, assignees, is_completed) VALUES
('dl-test-pass', 'Đồ án cũ đã quá hạn (Kiểm thử màu xám)', '2026-10-02T09:00:00', 'sang', 'personal', 'bui-van-khang', 'Bùi Văn Khang', '["bui-van-khang"]', 0),
('dl-test-today', 'Báo cáo lab trong ngày (Kiểm thử hôm nay)', '2026-10-05T14:30:00', 'chieu', 'group', 'bui-van-khang', 'Bùi Văn Khang', 'all', 0),
('dl-test-urgent', 'Nộp bài tập gấp (Kiểm thử màu đỏ 3 ngày)', '2026-10-07T20:00:00', 'toi', 'personal', 'bui-van-khang', 'Bùi Văn Khang', '["bui-van-khang"]', 0),
('dl-test-1week', 'Tiểu luận môn học (Kiểm thử màu cam 1 tuần)', '2026-10-11T09:00:00', 'sang', 'group', 'nguyen-van-a', 'Nguyễn Văn A', 'all', 0),
('dl-test-3week', 'Đề cương nghiên cứu (Kiểm thử màu vàng 3 tuần)', '2026-10-22T15:00:00', 'chieu', 'personal', 'bui-van-khang', 'Bùi Văn Khang', '["bui-van-khang"]', 0),
('dl-test-2month', 'Kế hoạch khóa luận (Kiểm thử màu xanh 2 tháng)', '2026-11-20T10:00:00', 'sang', 'personal', 'bui-van-khang', 'Bùi Văn Khang', '["bui-van-khang"]', 0),
('dl-test-done', 'Nhiệm vụ đã hoàn thành (Kiểm thử isCompleted = 1)', '2026-10-10T16:00:00', 'chieu', 'group', 'bui-van-khang', 'Bùi Văn Khang', 'all', 1);
