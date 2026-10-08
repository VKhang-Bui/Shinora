const db = require('../db');

/**
 * Controller xử lý quản lý thành viên & đăng nhập đơn giản
 */
const userController = {
    getAll: () => {
        try {
            const query = db.prepare('SELECT id, name, created_at FROM users ORDER BY name ASC');
            return query.all();
        } catch (e) {
            return [];
        }
    },

    login: ({ name, password }) => {
        if (!name || !name.trim()) {
            throw new Error('Vui lòng nhập họ và tên');
        }
        if (password !== 'Vkhang@84752006') {
            throw new Error('Mật khẩu không chính xác! Mật khẩu mặc định là Vkhang@84752006');
        }
        const trimmedName = name.trim();
        const userId = trimmedName.toLowerCase().replace(/\s+/g, ' ');

        // Kiểm tra xem tài khoản có tồn tại trong danh sách do Quản trị viên cấp phép hay không
        const query = db.prepare('SELECT id, name FROM users WHERE id = ?');
        const user = query.get(userId);

        if (!user) {
            throw new Error('Tài khoản không tồn tại trong hệ thống. Vui lòng liên hệ Quản trị viên để được cấp tài khoản!');
        }

        return {
            id: user.id,
            name: user.name
        };
    }
};

module.exports = userController;
