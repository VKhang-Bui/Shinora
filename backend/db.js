const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database', 'deadlines.sqlite');
const schemaPath = path.join(__dirname, 'database', 'schema.sql');

// Đảm bảo thư mục database tồn tại
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Khởi tạo kết nối SQLite native
const db = new DatabaseSync(dbPath);

// Bật kiểm tra khóa ngoại và chế độ WAL để tăng tốc độ ghi
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Tự động khởi tạo schema bảng nếu chưa có
if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
}

console.log(`[SQL Database] Kết nối thành công tới file CSDL thật: ${dbPath}`);

module.exports = db;
