-- ==========================================================
-- SCHEMA CƠ SỞ DỮ LIỆU SQL THẬT CHO HỆ THỐNG DEADLINE TRACKER
-- (KHÔNG CÓ DỮ LIỆU MẪU - DATABASE KHỞI TẠO HOÀN TOÀN TRẮNG TINH)
-- ==========================================================

-- 1. BẢNG PHÂN LOẠI (CATEGORIES): Cá nhân hoặc Cả nhóm
CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(20) PRIMARY KEY,
    name NVARCHAR(50) NOT NULL,
    icon VARCHAR(50) NOT NULL,
    color VARCHAR(20) NOT NULL
);

-- Khởi tạo 2 loại danh mục mặc định của hệ thống
INSERT OR IGNORE INTO categories (id, name, icon, color) VALUES
('personal', 'Cá nhân', 'fa-user', '#1a73e8'),
('group', 'Cả nhóm', 'fa-users', '#0f9d58');

-- 2. BẢNG THÀNH VIÊN (USERS)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(100) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Khởi tạo danh sách các tài khoản thành viên được cấp phép
INSERT OR IGNORE INTO users (id, name) VALUES
('bùi văn khang', 'Bùi Văn Khang'),
('lê hoàng anh kiệt', 'Lê Hoàng Anh Kiệt'),
('huỳnh thái khang', 'Huỳnh Thái Khang'),
('lý thị ngọc như', 'Lý Thị Ngọc Như');

-- 3. BẢNG DEADLINE (DEADLINES) - RỖNG HOÀN TOÀN 100%
CREATE TABLE IF NOT EXISTS deadlines (
    id VARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    due_date DATETIME NOT NULL,
    session VARCHAR(10) NOT NULL CHECK(session IN ('sang', 'chieu', 'toi')),
    category_id VARCHAR(20) NOT NULL DEFAULT 'personal',
    user_id VARCHAR(100),
    user_name NVARCHAR(100),
    assignees TEXT DEFAULT 'all',
    is_completed INTEGER DEFAULT 0 CHECK(is_completed IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

-- CHỈ MỤC (INDEX) TỐI ƯU HÓA TRUY VẤN TÌM KIẾM THEO NGÀY VÀ DANH MỤC
CREATE INDEX IF NOT EXISTS idx_deadlines_due_date ON deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_deadlines_category ON deadlines(category_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_user_id ON deadlines(user_id);
