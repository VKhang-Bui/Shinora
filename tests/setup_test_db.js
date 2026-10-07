/**
 * Khởi tạo CSDL Test độc lập từ file schema test_data.sql
 * File CSDL test được lưu riêng biệt tại /tmp/test_deadlines.sqlite
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const testDbPath = process.env.DB_PATH || '/tmp/test_deadlines.sqlite';
const testSqlPath = path.join(__dirname, 'test_data.sql');

// Xóa file test cũ nếu có để đảm bảo môi trường sạch
if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
}

// Khởi tạo CSDL test
const db = new DatabaseSync(testDbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const sqlContent = fs.readFileSync(testSqlPath, 'utf8');
db.exec(sqlContent);

const count = db.prepare('SELECT count(*) as c FROM deadlines').get();
console.log(`[Test DB Setup] Đã khởi tạo thành công CSDL test tại: ${testDbPath}`);
console.log(`[Test DB Setup] Đã nạp ${count.c} bản ghi mẫu phục vụ kiểm thử.`);
