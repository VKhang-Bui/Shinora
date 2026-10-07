// api/deadlines.js - Vercel Serverless Function kết nối Supabase REST API
module.exports = async (req, res) => {
    // Cho phép CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
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

    // Lấy query ID và keyword k từ request
    const { id, k } = req.query || {};

    try {
        // 1. GET ALL hoặc GET THEO ID
        if (req.method === 'GET') {
            if (id) {
                const resp = await fetch(`${SUPABASE_URL}/rest/v1/deadlines?id=eq.${encodeURIComponent(id)}&select=*`, { headers });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.message || 'Lỗi Supabase');
                if (!data || data.length === 0) {
                    return res.status(404).json({ success: false, message: 'Không tìm thấy deadline' });
                }
                const item = data[0];
                return res.status(200).json({
                    success: true,
                    data: {
                        id: item.id,
                        title: item.title,
                        dueDate: item.due_date,
                        session: item.session,
                        category: item.category_id,
                        isCompleted: item.is_completed ? 1 : 0
                    }
                });
            } else {
                let url = `${SUPABASE_URL}/rest/v1/deadlines?select=*&order=due_date.asc`;
                if (k && k.trim()) {
                    url += `&title=ilike.*${encodeURIComponent(k.trim())}*`;
                }
                const resp = await fetch(url, { headers });
                const list = await resp.json();
                if (!resp.ok) throw new Error(list.message || 'Lỗi Supabase');
                const formatted = list.map(item => ({
                    id: item.id,
                    title: item.title,
                    dueDate: item.due_date,
                    session: item.session,
                    category: item.category_id,
                    isCompleted: item.is_completed ? 1 : 0
                }));
                return res.status(200).json({ success: true, data: formatted });
            }
        }

        // 2. POST (TẠO MỚI)
        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
            const payload = {
                id: body.id || ('dl-' + Date.now()),
                title: body.title,
                due_date: body.dueDate,
                session: body.session || 'sang',
                category_id: body.category || 'personal',
                is_completed: body.isCompleted ? 1 : 0
            };
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/deadlines`, {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'Lỗi Supabase khi tạo bản ghi');
            const created = data[0] || payload;
            return res.status(201).json({
                success: true,
                data: {
                    id: created.id,
                    title: created.title,
                    dueDate: created.due_date,
                    session: created.session,
                    category: created.category_id,
                    isCompleted: created.is_completed ? 1 : 0
                }
            });
        }

        // 3. PUT (CẬP NHẬT)
        if (req.method === 'PUT') {
            if (!id) return res.status(400).json({ success: false, message: 'Thiếu ID deadline' });
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
            const payload = {};
            if (body.title !== undefined) payload.title = body.title;
            if (body.dueDate !== undefined) payload.due_date = body.dueDate;
            if (body.session !== undefined) payload.session = body.session;
            if (body.category !== undefined) payload.category_id = body.category;
            if (body.isCompleted !== undefined) payload.is_completed = body.isCompleted ? 1 : 0;
            payload.updated_at = new Date().toISOString();

            const resp = await fetch(`${SUPABASE_URL}/rest/v1/deadlines?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'Lỗi Supabase khi cập nhật');
            const updated = data[0];
            return res.status(200).json({
                success: true,
                data: {
                    id: updated.id,
                    title: updated.title,
                    dueDate: updated.due_date,
                    session: updated.session,
                    category: updated.category_id,
                    isCompleted: updated.is_completed ? 1 : 0
                }
            });
        }

        // 4. DELETE (XÓA)
        if (req.method === 'DELETE') {
            if (!id) return res.status(400).json({ success: false, message: 'Thiếu ID deadline' });
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/deadlines?id=eq.${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { ...headers, 'Prefer': 'return=representation' }
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'Lỗi Supabase khi xóa');
            return res.status(200).json({ success: true, message: 'Đã xóa thành công', data: data[0] });
        }

        return res.status(405).json({ success: false, message: 'Phương thức không được hỗ trợ' });
    } catch (err) {
        console.error('[Vercel Supabase API Error]:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
};
