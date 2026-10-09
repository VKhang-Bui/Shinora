const db = require('../db');
const TaskTypes = require('../../frontend/shared/js/task-types');

// Lấy 'HH:MM' từ chuỗi due_date để so sánh với giờ kết thúc
function startHHMM(dueDate) {
    const m = /[T ](\d{2}:\d{2})/.exec(String(dueDate || ''));
    return m ? m[1] : null;
}

/**
 * Controller xử lý các nghiệp vụ truy vấn SQL cho Deadlines
 */
const deadlineController = {
    // 1. Lấy tất cả deadline (hỗ trợ tìm kiếm từ khóa SQL và lọc theo userId)
    getAll: (keyword, userId) => {
        let sql = `
            SELECT 
                id, 
                title, 
                due_date as dueDate, 
                session, 
                category_id as category, 
                user_id as userId,
                user_name as userName,
                assignees,
                group_name as groupName,
                group_link as groupLink,
                description,
                task_type as taskType,
                end_time as endTime,
                is_completed as isCompleted, 
                created_at, 
                updated_at
            FROM deadlines
            WHERE 1=1
        `;
        const params = [];

        if (keyword && keyword.trim()) {
            sql += ` AND title LIKE ?`;
            params.push(`%${keyword.trim()}%`);
        }

        if (userId && userId.trim()) {
            const u = userId.trim().toLowerCase();
            // Lọc: Cá nhân của chính user HOẶC Cả nhóm (all) HOẶC assignees chứa user HOẶC user là người tạo deadline nhóm
            sql += ` AND (
                (category_id = 'personal' AND user_id = ?)
                OR
                (category_id = 'group' AND (assignees = 'all' OR assignees IS NULL OR assignees LIKE ? OR user_id = ?))
            )`;
            params.push(u, `%${u}%`, u);
        }

        sql += ` ORDER BY due_date ASC`;
        const query = db.prepare(sql);
        return query.all(...params);
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
                user_id as userId,
                user_name as userName,
                assignees,
                group_name as groupName,
                group_link as groupLink,
                description,
                task_type as taskType,
                end_time as endTime,
                is_completed as isCompleted, 
                created_at, 
                updated_at
            FROM deadlines
            WHERE id = ?
        `);
        return query.get(id);
    },

    // 3. Thêm mới deadline vào SQL
    create: (data) => {
        const { id, title, dueDate, session, category, userId, userName, assignees, groupName, group_name, groupLink, group_link, description, isCompleted, taskType, endTime } = data;
        const dlId = id || ('dl-' + Date.now());
        const cat = category || 'personal';
        const uId = userId || null;
        const uName = userName || null;
        const asg = typeof assignees === 'object' ? JSON.stringify(assignees) : (assignees || 'all');
        const gName = (groupName !== undefined ? groupName : group_name) || null;
        const gLink = (groupLink !== undefined ? groupLink : group_link) || null;
        const desc = description || null;
        const completed = isCompleted ? 1 : 0;
        const tType = TaskTypes.normalize(taskType);
        const tEnd = TaskTypes.normalizeEndTime(tType, endTime, startHHMM(dueDate));

        const insert = db.prepare(`
            INSERT INTO deadlines (id, title, due_date, session, category_id, user_id, user_name, assignees, group_name, group_link, description, task_type, end_time, is_completed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insert.run(dlId, title, dueDate, session, cat, uId, uName, asg, gName, gLink, desc, tType, tEnd, completed);

        return deadlineController.getById(dlId);
    },

    // 4. Cập nhật deadline trong SQL
    update: (id, data) => {
        const current = deadlineController.getById(id);
        if (!current) return null;

        const { title, dueDate, session, category, userId, userName, assignees, groupName, group_name, groupLink, group_link, description, isCompleted, taskType, endTime } = data;

        const newTitle = title !== undefined ? title : current.title;
        const newDueDate = dueDate !== undefined ? dueDate : current.dueDate;
        const newSession = session !== undefined ? session : current.session;
        const newCategory = category !== undefined ? category : current.category;
        const newUserId = userId !== undefined ? userId : current.userId;
        const newUserName = userName !== undefined ? userName : current.userName;
        const newAssignees = assignees !== undefined ? (typeof assignees === 'object' ? JSON.stringify(assignees) : assignees) : current.assignees;
        const inputGName = groupName !== undefined ? groupName : group_name;
        const newGroupName = inputGName !== undefined ? inputGName : current.groupName;
        const inputGLink = groupLink !== undefined ? groupLink : group_link;
        const newGroupLink = inputGLink !== undefined ? inputGLink : current.groupLink;
        const newDescription = description !== undefined ? description : current.description;
        const newCompleted = isCompleted !== undefined ? (isCompleted ? 1 : 0) : current.isCompleted;
        const newTaskType = TaskTypes.normalize(taskType !== undefined ? taskType : current.taskType);
        const newEndTime = TaskTypes.normalizeEndTime(newTaskType, endTime !== undefined ? endTime : current.endTime, startHHMM(newDueDate));

        const update = db.prepare(`
            UPDATE deadlines
            SET title = ?, 
                due_date = ?, 
                session = ?, 
                category_id = ?, 
                user_id = ?,
                user_name = ?,
                assignees = ?,
                group_name = ?,
                group_link = ?,
                description = ?,
                task_type = ?,
                end_time = ?,
                is_completed = ?, 
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        update.run(newTitle, newDueDate, newSession, newCategory, newUserId, newUserName, newAssignees, newGroupName, newGroupLink, newDescription, newTaskType, newEndTime, newCompleted, id);

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
