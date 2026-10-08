// api/users.js - Vercel Serverless Function lấy danh sách thành viên kết nối Supabase REST API
module.exports = async (req, res) => {
    // Cho phép CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
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
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,name,created_at&order=name.asc`, { headers });
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.message || 'Lỗi truy vấn Supabase');
        }

        const users = await resp.json();
        return res.status(200).json({
            success: true,
            data: users || []
        });
    } catch (err) {
        console.error('[Vercel Users API Error]:', err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi máy chủ' });
    }
};
