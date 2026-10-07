const db = require('../db');

/**
 * Controller xử lý các nghiệp vụ truy vấn SQL cho Deadlines
 */
const deadlineController = {
    // 1. Lấy tất cả deadline (hỗ trợ tìm kiếm từ khóa SQL)
    getAll: (keyword) => {
        if (keyword && keyword.trim()) {
            const query = db.prepare(`
                SELECT 
                    id, 
                    title, 
                    due_date as dueDate, 
                    session, 
                    category_id as category, 
                    is_completed as isCompleted, 
                    created_at, 
                    updated_at
                FROM deadlines
                WHERE title LIKE ?
                ORDER BY due_date ASC
            `);
            return query.all(`%${keyword.trim()}%`);
        } else {
            const query = db.prepare(`
                SELECT 
                    id, 
                    title, 
                    due_date as dueDate, 
                    session, 
                    category_id as category, 
                    is_completed as isCompleted, 
                    created_at, 
                    updated_at
                FROM deadlines
                ORDER BY due_date ASC
            `);
            return query.all();
        }
    },

    // 2. Lấy chi tiết deadline theo ID
    getById: (id) => {
        const query = db.prepare(`
            SELECT 
                id, 
                title, 
                due_date as dueDate, 
                session, 
                category_id as category, 
                is_completed as isCompleted, 
                created_at, 
                updated_at
            FROM deadlines
            WHERE id = ?
        `);
        return query.get(id);
    },

    // 3. Thêm mới deadline vào SQL
    create: ({ id, title, dueDate, session, category, isCompleted }) => {
        const dlId = id || ('dl-' + Date.now());
        const cat = category || 'personal';
        const completed = isCompleted ? 1 : 0;

        const insert = db.prepare(`
            INSERT INTO deadlines (id, title, due_date, session, category_id, is_completed)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insert.run(dlId, title, dueDate, session, cat, completed);

        return deadlineController.getById(dlId);
    },

    // 4. Cập nhật deadline trong SQL
    update: (id, { title, dueDate, session, category, isCompleted }) => {
        const current = deadlineController.getById(id);
        if (!current) return null;

        const newTitle = title !== undefined ? title : current.title;
        const newDueDate = dueDate !== undefined ? dueDate : current.dueDate;
        const newSession = session !== undefined ? session : current.session;
        const newCategory = category !== undefined ? category : current.category;
        const newCompleted = isCompleted !== undefined ? (isCompleted ? 1 : 0) : current.isCompleted;

        const update = db.prepare(`
            UPDATE deadlines
            SET title = ?, 
                due_date = ?, 
                session = ?, 
                category_id = ?, 
                is_completed = ?, 
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        update.run(newTitle, newDueDate, newSession, newCategory, newCompleted, id);

        return deadlineController.getById(id);
    },

    // 5. Xóa deadline khỏi SQL
    delete: (id) => {
        const item = deadlineController.getById(id);
        if (!item) return null;

        const del = db.prepare('DELETE FROM deadlines WHERE id = ?');
        del.run(id);

        return item;
    }
};

module.exports = deadlineController;
