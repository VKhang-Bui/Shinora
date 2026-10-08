// api/feedbacks.js - Vercel Serverless Function nhận góp ý từ người dùng
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
            if (!body.content || !body.content.trim()) {
                return res.status(400).json({ success: false, message: 'Nội dung phản hồi không được để trống' });
            }

            const feedbackRecord = {
                id: 'fb-' + Date.now(),
                user_id: body.userId || null,
                user_name: body.userName || null,
                content: body.content.trim(),
                device_info: body.deviceInfo ? JSON.stringify(body.deviceInfo) : null,
                screenshot: body.screenshot || null
            };

            // Nếu có cấu hình Supabase thì lưu vào bảng feedbacks (nếu có bảng), nếu không vẫn trả về 201 thành công
            if (SUPABASE_URL && SUPABASE_KEY) {
                try {
                    await fetch(`${SUPABASE_URL}/rest/v1/feedbacks`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(feedbackRecord)
                    });
                } catch (dbErr) {
                    console.warn('[Vercel Feedback Supabase Warning]:', dbErr);
                }
            }

            return res.status(201).json({
                success: true,
                message: 'Cảm ơn bạn đã gửi phản hồi! Chúng tôi sẽ xem xét để cải thiện hệ thống.',
                data: {
                    id: feedbackRecord.id,
                    content: feedbackRecord.content,
                    createdAt: new Date().toISOString()
                }
            });
        } catch (e) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};
