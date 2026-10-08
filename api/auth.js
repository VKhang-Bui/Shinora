// api/auth.js - Vercel Serverless Function xử lý đăng nhập kết nối Supabase REST API
module.exports = async (req, res) => {
    // Cho phép CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Phương thức không được hỗ trợ' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({
            success: false,
            message: 'Chưa cấu hình biến môi trường SUPABASE_URL hoặc SUPABASE_ANON_KEY trên Vercel!'
        });
    }

    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { name, password } = body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập họ và tên' });
        }

        if (password !== 'Vkhang@84752006') {
            return res.status(400).json({
                success: false,
                message: 'Mật khẩu không chính xác! Mật khẩu mặc định là Vkhang@84752006'
            });
        }

        const trimmedName = name.trim();
        const userId = trimmedName.toLowerCase().replace(/\s+/g, ' ');

        // Truy vấn kiểm tra whitelist trong bảng users trên Supabase
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=*`, { headers });
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.message || 'Lỗi truy vấn CSDL Supabase');
        }

        const users = await resp.json();
        if (!users || users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tài khoản không tồn tại trong hệ thống. Vui lòng liên hệ Quản trị viên để được cấp tài khoản!'
            });
        }

        const user = users[0];
        return res.status(200).json({
            success: true,
            user: {
                id: user.id,
                name: user.name
            }
        });
    } catch (err) {
        console.error('[Vercel Auth API Error]:', err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi máy chủ' });
    }
};
