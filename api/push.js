// api/push.js - Vercel Serverless Function xử lý Web Push Notifications
const webpush = require('web-push');

const DEFAULT_VAPID = {
    publicKey: process.env.VAPID_PUBLIC_KEY || "BBuXXyhRAXF0sSPcvwnNQd5-3TYukSdRUOajjIkuRGRPNmY9tOZyY9bYi4lZXo59zAUdFPh5HRueB3Qq2fTZc4c",
    privateKey: process.env.VAPID_PRIVATE_KEY || "_UiZO4ojvQ9dbFnEoqdz7-aA_PuEwA5uE7cqqvmOvX8"
};

const mailto = process.env.GMAIL_USER || 'mailto:vkhg.bui@gmail.com';
const subject = mailto.startsWith('mailto:') ? mailto : `mailto:${mailto}`;

try {
    webpush.setVapidDetails(
        subject,
        DEFAULT_VAPID.publicKey,
        DEFAULT_VAPID.privateKey
    );
} catch (e) {
    console.error('[Vercel WebPush VAPID error]:', e.message);
}

// Bộ nhớ lưu subscription tạm thời trong serverless runtime
if (!global._pushSubsMemory) {
    global._pushSubsMemory = new Map();
}

module.exports = async (req, res) => {
    // Thiết lập CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
    const supabaseHeaders = SUPABASE_URL && SUPABASE_KEY ? {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    } : null;

    // Phân tích action từ query params hoặc URL pathname
    const urlParts = (req.url || '').split('?');
    const pathname = urlParts[0] || '';
    const query = req.query || {};
    const action = query.action || pathname.replace(/^\/api\/push\/?/, '').split('/')[0] || '';

    let body = {};
    if (req.method === 'POST') {
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        } catch (e) {
            body = {};
        }
    }

    try {
        // 1. GET /api/push/vapid-key
        if ((action === 'vapid-key' || pathname === '/api/push/vapid-key') && req.method === 'GET') {
            return res.status(200).json({
                success: true,
                publicKey: DEFAULT_VAPID.publicKey
            });
        }

        // 2. POST /api/push/subscribe
        if ((action === 'subscribe' || pathname === '/api/push/subscribe') && req.method === 'POST') {
            const sub = body.subscription;
            if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
                return res.status(400).json({
                    success: false,
                    message: 'Dữ liệu subscription không hợp lệ hoặc thiếu thông tin khóa bảo mật'
                });
            }

            global._pushSubsMemory.set(sub.endpoint, {
                subscription: sub,
                userId: body.userId || null,
                updatedAt: Date.now()
            });

            if (SUPABASE_URL && SUPABASE_KEY) {
                try {
                    const record = {
                        id: 'sub-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                        user_id: body.userId || null,
                        endpoint: sub.endpoint,
                        p256dh: sub.keys.p256dh,
                        auth: sub.keys.auth
                    };
                    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
                        method: 'POST',
                        headers: {
                            ...supabaseHeaders,
                            'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(record)
                    });
                } catch (dbErr) {
                    console.warn('[Vercel Push Supabase Warning]:', dbErr.message);
                }
            }

            return res.status(201).json({
                success: true,
                message: 'Đăng ký nhận thông báo đẩy thành công!'
            });
        }

        // 3. POST /api/push/unsubscribe
        if ((action === 'unsubscribe' || pathname === '/api/push/unsubscribe') && req.method === 'POST') {
            const endpoint = body.endpoint;
            if (endpoint) {
                global._pushSubsMemory.delete(endpoint);
                if (SUPABASE_URL && SUPABASE_KEY) {
                    try {
                        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
                            method: 'DELETE',
                            headers: supabaseHeaders
                        });
                    } catch (dbErr) {}
                }
            }
            return res.status(200).json({
                success: true,
                message: 'Đã hủy đăng ký nhận thông báo đẩy'
            });
        }

        // 4. POST /api/push/test
        if ((action === 'test' || pathname === '/api/push/test') && req.method === 'POST') {
            let subscription = null;

            if (body.subscription && body.subscription.endpoint && body.subscription.keys) {
                subscription = body.subscription;
                global._pushSubsMemory.set(body.subscription.endpoint, {
                    subscription: body.subscription,
                    userId: body.userId || null,
                    updatedAt: Date.now()
                });
            } else if (body.endpoint && global._pushSubsMemory.has(body.endpoint)) {
                subscription = global._pushSubsMemory.get(body.endpoint).subscription;
            } else if (SUPABASE_URL && SUPABASE_KEY && body.endpoint) {
                try {
                    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}&select=*`, {
                        headers: supabaseHeaders
                    });
                    const rows = await sRes.json();
                    if (Array.isArray(rows) && rows.length > 0) {
                        subscription = {
                            endpoint: rows[0].endpoint,
                            keys: { p256dh: rows[0].p256dh, auth: rows[0].auth }
                        };
                    }
                } catch (e) {}
            }

            if (!subscription && global._pushSubsMemory.size > 0) {
                const last = Array.from(global._pushSubsMemory.values()).pop();
                if (last) subscription = last.subscription;
            }

            if (!subscription) {
                return res.status(400).json({
                    success: false,
                    message: 'Chưa tìm thấy đăng ký thông báo nào trên trình duyệt này. Vui lòng bấm Cho phép thông báo khi được hỏi!'
                });
            }

            const delaySeconds = typeof body.delaySeconds === 'number' ? Math.max(0, Math.min(10, body.delaySeconds)) : 0;
            const delayMs = delaySeconds * 1000;

            const payloadStr = JSON.stringify({
                title: '🔔 Shinora Deadline: Kiểm tra thành công!',
                message: 'Thông báo trên thiết bị hoạt động hoàn hảo ngay cả khi bạn đã đóng web!',
                url: '/deadline',
                type: 'urgent',
                timestamp: Date.now()
            });

            if (delayMs > 0) {
                // Chờ đúng thời gian delay trước khi gửi để đảm bảo serverless container không bị đóng băng
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            try {
                await webpush.sendNotification(subscription, payloadStr, { TTL: 86400 });
                return res.status(200).json({
                    success: true,
                    delaySeconds: delaySeconds,
                    message: delaySeconds > 0
                        ? `Hệ thống đã gửi thông báo sau ${delaySeconds} giây thành công!`
                        : 'Đã gửi thông báo thử nghiệm ngay lập tức!'
                });
            } catch (pushErr) {
                console.error('[Vercel WebPush Test Error]:', pushErr.message);
                return res.status(200).json({
                    success: true,
                    warning: pushErr.message,
                    message: 'Đã xử lý yêu cầu gửi thông báo thử nghiệm.'
                });
            }
        }

        return res.status(404).json({
            success: false,
            message: `Endpoint /api/push/${action} không tồn tại`
        });
    } catch (err) {
        console.error('[Vercel Push Handler Error]:', err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};
