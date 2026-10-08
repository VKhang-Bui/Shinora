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
    try {
        db.exec(schemaSql);
    } catch (e) {
        // Nếu lỗi do bảng cũ thiếu cột, sẽ được xử lý ở bước migration bên dưới
    }
}

// Migration an toàn cho các cột mới và index nếu bảng deadlines đã tồn tại từ phiên bản trước
try {
    const cols = db.prepare("PRAGMA table_info(deadlines)").all();
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('user_id')) db.exec("ALTER TABLE deadlines ADD COLUMN user_id VARCHAR(100);");
    if (!colNames.includes('user_name')) db.exec("ALTER TABLE deadlines ADD COLUMN user_name NVARCHAR(100);");
    if (!colNames.includes('assignees')) db.exec("ALTER TABLE deadlines ADD COLUMN assignees TEXT DEFAULT 'all';");
    if (!colNames.includes('group_name')) db.exec("ALTER TABLE deadlines ADD COLUMN group_name NVARCHAR(255);");
    if (!colNames.includes('group_link')) db.exec("ALTER TABLE deadlines ADD COLUMN group_link VARCHAR(500);");
    if (!colNames.includes('description')) db.exec("ALTER TABLE deadlines ADD COLUMN description TEXT;");
    db.exec("CREATE INDEX IF NOT EXISTS idx_deadlines_user_id ON deadlines(user_id);");

    // Tạo bảng feedbacks nếu chưa có
    db.exec(`
        CREATE TABLE IF NOT EXISTS feedbacks (
            id VARCHAR(50) PRIMARY KEY,
            user_id VARCHAR(100),
            user_name NVARCHAR(100),
            content TEXT NOT NULL,
            device_info TEXT,
            screenshot TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks(created_at);
    `);
} catch (e) {
    // Bỏ qua nếu bảng chưa được tạo
}

// Khởi tạo danh sách 4 tài khoản thành viên ban đầu nếu chưa có
try {
    const seedUsers = [
        ['bùi văn khang', 'Bùi Văn Khang'],
        ['lê hoàng anh kiệt', 'Lê Hoàng Anh Kiệt'],
        ['huỳnh thái khang', 'Huỳnh Thái Khang'],
        ['lý thị ngọc như', 'Lý Thị Ngọc Như']
    ];
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)');
    for (const [id, name] of seedUsers) {
        insertUser.run(id, name);
    }
} catch (e) {
    // Bỏ qua nếu có lỗi
}

console.log(`[SQL Database] Kết nối thành công tới file CSDL thật: ${dbPath}`);

module.exports = db;
