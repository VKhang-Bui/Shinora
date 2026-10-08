/**
 * MAILER UTILITY - SHINORA DEADLINE
 * Tự động gửi email thông báo góp ý qua Gmail SMTP
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Tự động nạp file .env nếu có
function loadEnv() {
    const envPath = path.resolve(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const idx = trimmed.indexOf('=');
                    const key = trimmed.substring(0, idx).trim();
                    const val = trimmed.substring(idx + 1).trim();
                    process.env[key] = val;
                }
            });
        } catch (e) {
            console.error('[Mailer] Không thể đọc file .env:', e.message);
        }
    }
}
loadEnv();

/**
 * Gửi email thông báo góp ý mới
 * @param {Object} feedbackData - { id, userName, userId, content, deviceInfo, screenshot }
 */
async function sendFeedbackEmail(feedbackData) {
    loadEnv(); // Đảm bảo luôn lấy mật khẩu mới nhất nếu vừa chỉnh sửa .env

    const gmailUser = process.env.GMAIL_USER || 'vkhg.bui@gmail.com';
    const appPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    const receiverEmail = process.env.RECEIVER_EMAIL || 'vkhg.bui@gmail.com';

    if (!appPassword || appPassword === 'dien_mat_khau_16_chu_cai_o_day') {
        console.log('[Mailer] GMAIL_APP_PASSWORD chưa được cấu hình trong file .env. Bỏ qua bước gửi email.');
        return { success: false, reason: 'missing_password' };
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailUser,
                pass: appPassword
            }
        });

        const attachments = [];
        let screenshotHtml = '';

        if (feedbackData.screenshot && typeof feedbackData.screenshot === 'string') {
            const matches = feedbackData.screenshot.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
            if (matches) {
                const ext = matches[1];
                const base64Data = matches[2];
                const filename = `screenshot_${Date.now()}.${ext === 'png' ? 'png' : 'jpg'}`;
                
                attachments.push({
                    filename: filename,
                    content: Buffer.from(base64Data, 'base64'),
                    contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
                    cid: 'feedback_screenshot' // để hiển thị inline trong body mail
                });

                screenshotHtml = `
                    <div style="margin-top: 15px;">
                        <p style="font-weight: 600; color: #202124; margin-bottom: 6px;">📷 Ảnh chụp màn hình kèm theo:</p>
                        <img src="cid:feedback_screenshot" style="max-width: 100%; border: 1px solid #dadce0; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);" alt="Ảnh chụp màn hình" />
                    </div>
                `;
            }
        }

        const htmlContent = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; color: #202124;">
                <div style="background: #1a73e8; color: #ffffff; padding: 16px 20px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: 700;">[Shinora Deadline] Phản hồi / Góp ý mới</h2>
                    <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.9;">Nhận từ hệ thống quản lý deadline của sinh viên</p>
                </div>
                
                <div style="padding: 20px;">
                    <div style="background: #f8f9fa; border-left: 4px solid #1a73e8; padding: 10px 14px; margin-bottom: 16px; border-radius: 0 4px 4px 0;">
                        <p style="margin: 0 0 4px 0; font-size: 13px;"><strong>👤 Người gửi:</strong> ${escapeHtml(feedbackData.userName || 'Khách vãng lai')} (${escapeHtml(feedbackData.userId || 'guest')})</p>
                        <p style="margin: 0; font-size: 12px; color: #5f6368;"><strong>⏰ Thời gian:</strong> ${new Date().toLocaleString('vi-VN')}</p>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <p style="font-weight: 600; font-size: 13px; color: #202124; margin-bottom: 6px;">💬 Nội dung góp ý / Báo lỗi:</p>
                        <div style="background: #ffffff; border: 1px solid #e8eaed; border-radius: 6px; padding: 12px; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; color: #1f1f1f;">${escapeHtml(feedbackData.content || '')}</div>
                    </div>

                    ${feedbackData.deviceInfo ? `
                    <div style="margin-bottom: 16px; font-size: 11.5px; color: #70757a; background: #fafafa; padding: 8px 12px; border-radius: 4px; border: 1px solid #f1f3f4;">
                        <strong>💻 Thông tin thiết bị:</strong><br>${escapeHtml(feedbackData.deviceInfo)}
                    </div>
                    ` : ''}

                    ${screenshotHtml}
                </div>

                <div style="background: #f8f9fa; border-top: 1px solid #f1f3f4; padding: 12px 20px; text-align: center; font-size: 11px; color: #70757a;">
                    © 2026 Shinora &middot; Hệ thống theo dõi Deadline cho Sinh viên & Nhóm
                </div>
            </div>
        `;

        const mailOptions = {
            from: `"Shinora Feedback Bot" <${gmailUser}>`,
            to: receiverEmail,
            subject: `[Shinora Deadline] Góp ý mới từ: ${feedbackData.userName || 'Người dùng'}`,
            html: htmlContent,
            attachments: attachments
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[Mailer] Đã gửi email thông báo thành công tới ${receiverEmail}! MessageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('[Mailer] Lỗi khi gửi email:', error.message);
        return { success: false, error: error.message };
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    sendFeedbackEmail
};
