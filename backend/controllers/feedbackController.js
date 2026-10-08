const db = require('../db');
const { sendFeedbackEmail } = require('../utils/mailer');

function createFeedback(data) {
    if (!data.content || !data.content.trim()) {
        throw new Error('Nội dung góp ý không được để trống');
    }

    const id = 'fb-' + Date.now();
    const userId = data.userId || null;
    const userName = data.userName || null;
    const content = data.content.trim();
    const deviceInfo = data.deviceInfo ? (typeof data.deviceInfo === 'string' ? data.deviceInfo : JSON.stringify(data.deviceInfo)) : null;
    const screenshot = data.screenshot || null;

    const stmt = db.prepare(`
        INSERT INTO feedbacks (id, user_id, user_name, content, device_info, screenshot)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, userId, userName, content, deviceInfo, screenshot);

    // Kích hoạt gửi email thông báo ngầm về Gmail mà không làm chậm request của người dùng
    sendFeedbackEmail({
        id,
        userId,
        userName,
        content,
        deviceInfo,
        screenshot
    }).catch(err => {
        console.error('[Feedback Mailer Error]:', err.message);
    });

    return {
        id,
        userId,
        userName,
        content,
        createdAt: new Date().toISOString()
    };
}

function getAllFeedbacks() {
    const rows = db.prepare('SELECT id, user_id, user_name, content, device_info, created_at FROM feedbacks ORDER BY created_at DESC').all();
    return rows.map(r => {
        let devInfo = r.device_info;
        if (devInfo) {
            try {
                devInfo = JSON.parse(devInfo);
            } catch {
                // Giữ nguyên chuỗi string nếu không phải định dạng JSON
            }
        }
        return {
            id: r.id,
            userId: r.user_id,
            userName: r.user_name,
            content: r.content,
            deviceInfo: devInfo,
            createdAt: r.created_at
        };
    });
}

module.exports = {
    create: createFeedback,
    getAll: getAllFeedbacks
};
