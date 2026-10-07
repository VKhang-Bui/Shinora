const http = require('http');
const fs = require('fs');
const path = require('path');
const deadlineController = require('./controllers/deadlineController');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// MIME types phổ biến cho static files
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // Xử lý CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // ==========================================
    // 1. RESTFUL API ENDPOINTS CHO DEADLINES
    // ==========================================
    if (pathname.startsWith('/api/deadlines')) {
        const idMatch = pathname.match(/^\/api\/deadlines\/([^\/]+)$/);
        const deadlineId = idMatch ? decodeURIComponent(idMatch[1]) : null;

        try {
            // GET /api/deadlines
            if (req.method === 'GET' && !deadlineId) {
                const keyword = parsedUrl.searchParams.get('k') || '';
                const list = deadlineController.getAll(keyword);
                return sendJson(res, 200, { success: true, data: list });
            }

            // GET /api/deadlines/:id
            if (req.method === 'GET' && deadlineId) {
                const item = deadlineController.getById(deadlineId);
                if (!item) return sendJson(res, 404, { success: false, message: 'Không tìm thấy deadline' });
                return sendJson(res, 200, { success: true, data: item });
            }

            // POST /api/deadlines
            if (req.method === 'POST' && !deadlineId) {
                const body = await parseJsonBody(req);
                if (!body.title || !body.dueDate) {
                    return sendJson(res, 400, { success: false, message: 'Tiêu đề và ngày nộp là bắt buộc' });
                }
                const created = deadlineController.create(body);
                return sendJson(res, 201, { success: true, data: created });
            }

            // PUT /api/deadlines/:id
            if (req.method === 'PUT' && deadlineId) {
                const body = await parseJsonBody(req);
                const updated = deadlineController.update(deadlineId, body);
                if (!updated) return sendJson(res, 404, { success: false, message: 'Không tìm thấy deadline' });
                return sendJson(res, 200, { success: true, data: updated });
            }

            // DELETE /api/deadlines/:id
            if (req.method === 'DELETE' && deadlineId) {
                const deleted = deadlineController.delete(deadlineId);
                if (!deleted) return sendJson(res, 404, { success: false, message: 'Không tìm thấy deadline' });
                return sendJson(res, 200, { success: true, message: 'Đã xóa thành công', data: deleted });
            }

            return sendJson(res, 405, { success: false, message: 'Phương thức không được hỗ trợ' });
        } catch (err) {
            console.error('[API Error]:', err);
            return sendJson(res, 500, { success: false, message: err.message });
        }
    }

    // ==========================================
    // 2. STATIC FILES SERVER CHO FRONTEND
    // ==========================================
    let filePath = '';
    if (pathname === '/' || pathname === '/deadline' || pathname === '/deadline/') {
        filePath = path.join(FRONTEND_DIR, 'pages', 'deadline', 'index.html');
    } else if (pathname === '/deadline.js' || pathname === '/deadline/deadline.js') {
        filePath = path.join(FRONTEND_DIR, 'pages', 'deadline', 'deadline.js');
    } else if (pathname === '/deadline.css' || pathname === '/deadline/deadline.css') {
        filePath = path.join(FRONTEND_DIR, 'pages', 'deadline', 'deadline.css');
    } else if (pathname.startsWith('/shared/')) {
        filePath = path.join(FRONTEND_DIR, pathname);
    } else if (pathname.startsWith('/pages/')) {
        filePath = path.join(FRONTEND_DIR, pathname);
    } else {
        // Thử tìm trong frontend/shared hoặc frontend/pages/deadline
        const tryShared = path.join(FRONTEND_DIR, 'shared', pathname);
        const tryDeadline = path.join(FRONTEND_DIR, 'pages', 'deadline', pathname);
        if (fs.existsSync(tryShared) && fs.statSync(tryShared).isFile()) {
            filePath = tryShared;
        } else if (fs.existsSync(tryDeadline) && fs.statSync(tryDeadline).isFile()) {
            filePath = tryDeadline;
        } else {
            filePath = path.join(FRONTEND_DIR, pathname);
        }
    }

    // Kiểm tra file có tồn tại không
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // TẠO ETAG VÀ CACHE-CONTROL HEADERS TỐI ƯU HÓA TỐC ĐỘ (0ms LOAD)
        const etag = `W/"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
        const clientEtag = req.headers['if-none-match'];

        if (clientEtag && clientEtag === etag) {
            // Trình duyệt đã có sẵn file trong máy, không cần gửi lại nội dung
            res.writeHead(304, {
                'ETag': etag,
                'Cache-Control': ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=86400, stale-while-revalidate=604800'
            });
            return res.end();
        }

        const headers = {
            'Content-Type': contentType,
            'ETag': etag
        };

        // Quy định Cache-Control:
        // - File HTML: no-cache (để luôn cập nhật khung ứng dụng mới nhất)
        // - File tĩnh CSS, JS, Fonts, Ảnh: lưu cache 1 ngày (86400s) và stale-while-revalidate 7 ngày
        if (ext === '.html') {
            headers['Cache-Control'] = 'no-cache, must-revalidate';
        } else {
            headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800';
        }

        res.writeHead(200, headers);
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 [DEADLINE TRACKER SERVER] Đang chạy tại:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`👉 http://localhost:${PORT}/deadline`);
    console.log(`📁 CSDL SQL thật: backend/database/deadlines.sqlite`);
    console.log(`======================================================\n`);
});

module.exports = server;
