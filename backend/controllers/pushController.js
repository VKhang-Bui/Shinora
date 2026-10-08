/**
 * PUSH CONTROLLER - SHINORA DEADLINE
 * Xử lý lưu subscription, điều phối gửi Web Push và kiểm tra hạn chót tự động
 */

const db = require('../db');
const pushManager = require('../utils/pushManager');

function getVapidPublicKey() {
    const key = pushManager.getPublicKey();
    return { success: true, publicKey: key };
}

function subscribe(data) {
    const sub = data.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        throw new Error('Dữ liệu subscription không hợp lệ hoặc thiếu thông tin khóa bảo mật');
    }

    const endpoint = sub.endpoint;
    const p256dh = sub.keys.p256dh;
    const auth = sub.keys.auth;
    const userId = data.userId || null;
    const id = 'sub-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    const stmt = db.prepare(`
        INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            created_at = CURRENT_TIMESTAMP
    `);

    stmt.run(id, userId, endpoint, p256dh, auth);

    return { success: true, message: 'Đăng ký nhận thông báo đẩy thành công!' };
}

function unsubscribe(data) {
    const endpoint = data.endpoint;
    if (!endpoint) {
        throw new Error('Thiếu endpoint cần hủy đăng ký');
    }

    const stmt = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
    stmt.run(endpoint);

    return { success: true, message: 'Đã hủy đăng ký nhận thông báo đẩy' };
}

async function sendTestPush(data) {
    let subscription = null;

    if (data.subscription && data.subscription.endpoint && data.subscription.keys) {
        subscription = data.subscription;
        try {
            subscribe({ subscription: data.subscription, userId: data.userId || null });
        } catch (e) {
            console.warn('[WebPush] Lỗi tự động lưu subscription:', e.message);
        }
    } else if (data.endpoint) {
        const subRow = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?').get(data.endpoint);
        if (subRow) {
            subscription = { endpoint: subRow.endpoint, keys: { p256dh: subRow.p256dh, auth: subRow.auth } };
        }
    } else if (data.userId) {
        const subRow = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(data.userId);
        if (subRow) {
            subscription = { endpoint: subRow.endpoint, keys: { p256dh: subRow.p256dh, auth: subRow.auth } };
        }
    } else {
        const subRow = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at DESC LIMIT 1').get();
        if (subRow) {
            subscription = { endpoint: subRow.endpoint, keys: { p256dh: subRow.p256dh, auth: subRow.auth } };
        }
    }

    if (!subscription) {
        throw new Error('Chưa tìm thấy đăng ký thông báo nào trên trình duyệt này. Vui lòng bấm Cho phép thông báo khi được hỏi!');
    }

    const delayMs = typeof data.delaySeconds === 'number' ? Math.max(0, data.delaySeconds * 1000) : 10000;

    const doSend = async () => {
        try {
            console.log('[WebPush] Đang gửi thông báo đẩy tới hệ điều hành / thiết bị qua:', subscription.endpoint.slice(0, 45) + '...');
            await pushManager.sendPush(subscription, {
                title: '🔔 Shinora Deadline: Kiểm tra thành công!',
                message: 'Thông báo trên máy tính hoạt động hoàn hảo ngay cả khi bạn đã đóng web!',
                url: '/deadline',
                type: 'urgent'
            });
            console.log('[WebPush] ✅ ĐÃ BẮN THÀNH CÔNG THÔNG BÁO HỆ THỐNG TỚI THIẾT BỊ!');
        } catch (err) {
            console.error('[WebPush Test Error]:', err.message);
        }
    };

    if (delayMs > 0) {
        console.log(`[WebPush] Đã lên lịch hẹn giờ gửi thông báo hệ thống sau ${Math.round(delayMs / 1000)} giây...`);
        setTimeout(doSend, delayMs);
        return {
            success: true,
            delaySeconds: Math.round(delayMs / 1000),
            message: `Hệ thống sẽ gửi thông báo sau ${Math.round(delayMs / 1000)} giây. Bạn hãy thử chuyển tab hoặc đóng hẳn web để kiểm tra nhé!`
        };
    } else {
        await doSend();
        return {
            success: true,
            delaySeconds: 0,
            message: 'Đã gửi thông báo thử nghiệm ngay lập tức!'
        };
    }
}

// Quét toàn bộ CSDL và gửi thông báo nếu có deadline sắp đến hạn
async function checkAndSendDeadlineReminders() {
    try {
        const now = new Date();
        const incompleteDeadlines = db.prepare(`
            SELECT id, title, due_date, category_id, user_id, assignees
            FROM deadlines
            WHERE is_completed = 0
        `).all();

        for (const dl of incompleteDeadlines) {
            const dueObj = new Date(dl.due_date);
            const diffMs = dueObj.getTime() - now.getTime();

            if (diffMs <= 0) continue; // Đã quá hạn thì không gửi push

            let stage = null;
            let title = '';
            let type = 'info';

            // 1. Mốc gấp: Còn <= 30 phút
            if (diffMs <= 30 * 60 * 1000) {
                stage = '30m';
                const minsLeft = Math.max(1, Math.round(diffMs / 60000));
                title = `🚨 GẤP: Chỉ còn ${minsLeft} phút!`;
                type = 'urgent';
            } 
            // 2. Mốc sắp đến hạn: Còn <= 3 ngày (và > 30 phút)
            else if (diffMs <= 3 * 24 * 60 * 60 * 1000) {
                stage = '3d';
                const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                title = `⏰ Sắp đến hạn: Còn ${daysLeft} ngày`;
                type = 'warning';
            }

            if (!stage) continue;

            // Kiểm tra xem mốc này của deadline đã từng được gửi push chưa
            const alreadySent = db.prepare('SELECT id FROM push_logs WHERE deadline_id = ? AND stage = ?').get(dl.id, stage);
            if (alreadySent) continue;

            // Lấy danh sách subscriptions phù hợp
            let subs = [];
            if (dl.category_id === 'personal' && dl.user_id) {
                subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? OR user_id IS NULL').all(dl.user_id);
            } else {
                subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
            }

            if (subs.length === 0) continue;

            // Đánh dấu log trước để tránh gửi lặp
            const logId = 'plog-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
            try {
                db.prepare('INSERT INTO push_logs (id, deadline_id, stage) VALUES (?, ?, ?)').run(logId, dl.id, stage);
            } catch (e) {
                // Đã bị race condition ghi log thì bỏ qua
                continue;
            }

            // Gửi push tới từng subscription
            for (const sub of subs) {
                try {
                    await pushManager.sendPush({
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth }
                    }, {
                        title: title,
                        message: dl.title,
                        url: `/deadline`,
                        deadlineId: dl.id,
                        type: type
                    });
                } catch (pushErr) {
                    // Nếu subscription đã hết hạn hoặc bị người dùng thu hồi quyền (410 hoặc 404), xóa khỏi DB
                    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                        try {
                            db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
                        } catch (_) {}
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Push Scheduler Error]:', err.message);
    }
}

module.exports = {
    getVapidPublicKey,
    subscribe,
    unsubscribe,
    sendTestPush,
    checkAndSendDeadlineReminders
};
