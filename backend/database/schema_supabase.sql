-- ==========================================================
-- SCHEMA POSTGRESQL CHUẨN CHO SUPABASE (DATABASE CLOUD)
-- BẬT SUPABASE SQL EDITOR VÀ DÁN TOÀN BỘ NỘI DUNG NÀY VÀO CHẠY
-- ==========================================================

-- 1. BẢNG PHÂN LOẠI (CATEGORIES)
CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(50) NOT NULL,
    color VARCHAR(20) NOT NULL
);

-- Khởi tạo 2 danh mục mặc định
INSERT INTO categories (id, name, icon, color) VALUES
('personal', 'Cá nhân', 'fa-user', '#1a73e8'),
('group', 'Cả nhóm', 'fa-users', '#0f9d58')
ON CONFLICT (id) DO NOTHING;

-- 2. BẢNG THÀNH VIÊN (USERS) CHO HỆ THỐNG WHITELIST
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nạp 4 tài khoản thành viên ban đầu
INSERT INTO users (id, name) VALUES
('bùi văn khang', 'Bùi Văn Khang'),
('lê hoàng anh kiệt', 'Lê Hoàng Anh Kiệt'),
('huỳnh thái khang', 'Huỳnh Thái Khang'),
('lý thị ngọc như', 'Lý Thị Ngọc Như')
ON CONFLICT (id) DO NOTHING;

-- 3. BẢNG DEADLINES (KHỞI TẠO TRẮNG TINH - 0 BẢN GHI)
CREATE TABLE IF NOT EXISTS deadlines (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    session VARCHAR(10) NOT NULL CHECK(session IN ('sang', 'chieu', 'toi')),
    category_id VARCHAR(20) NOT NULL DEFAULT 'personal' REFERENCES categories(id) ON DELETE RESTRICT,
    user_id VARCHAR(100),
    user_name VARCHAR(100),
    assignees TEXT DEFAULT 'all',
    is_completed SMALLINT DEFAULT 0 CHECK(is_completed IN (0, 1)),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cập nhật cột mới nếu bảng deadlines đã tồn tại từ trước
ALTER TABLE deadlines ADD COLUMN IF NOT EXISTS user_id VARCHAR(100);
ALTER TABLE deadlines ADD COLUMN IF NOT EXISTS user_name VARCHAR(100);
ALTER TABLE deadlines ADD COLUMN IF NOT EXISTS assignees TEXT DEFAULT 'all';

-- CHỈ MỤC TỐI ƯU TỐC ĐỘ TRUY VẤN
CREATE INDEX IF NOT EXISTS idx_deadlines_due_date ON deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_deadlines_category ON deadlines(category_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_user_id ON deadlines(user_id);

-- CẤU HÌNH QUYỀN TRUY CẬP (ROW LEVEL SECURITY CHO PHÉP WEB ĐỌC/GHI)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Tạo chính sách cho phép đọc categories và users
DROP POLICY IF EXISTS "Public Read Categories" ON categories;
CREATE POLICY "Public Read Categories" ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Read Users" ON users;
CREATE POLICY "Public Read Users" ON users FOR SELECT USING (true);

-- Tạo chính sách cho phép người dùng thêm/sửa/xóa deadlines
DROP POLICY IF EXISTS "Public All Deadlines" ON deadlines;
CREATE POLICY "Public All Deadlines" ON deadlines FOR ALL USING (true) WITH CHECK (true);

