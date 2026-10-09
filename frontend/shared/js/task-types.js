/**
 * CẤU HÌNH LOẠI TASK (task_type) - DÙNG CHUNG CHO FRONTEND & BACKEND
 *
 * Muốn thêm loại mới: chỉ cần thêm MỘT dòng vào TASK_TYPES bên dưới.
 * Cột task_type trong CSDL là TEXT tự do (không ENUM/CHECK) nên KHÔNG cần sửa Supabase.
 *
 *  - label      : tên hiển thị
 *  - icon       : class Font Awesome
 *  - hasEndTime : true => form hiện ô "giờ kết thúc", lịch tuần vẽ khối kéo dài theo khoảng giờ
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TaskTypes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const DEFAULT_TYPE = 'submit';

    const TASK_TYPES = {
        submit:   { label: 'Nộp bài',   icon: 'fa-upload', hasEndTime: false },
        practice: { label: 'Thực hành', icon: 'fa-flask',  hasEndTime: true  }
    };

    // Giá trị lạ/rỗng luôn rơi về loại mặc định để thẻ cũ không bao giờ bị lỗi
    function normalize(type) {
        return Object.prototype.hasOwnProperty.call(TASK_TYPES, type) ? type : DEFAULT_TYPE;
    }

    function get(type) {
        return TASK_TYPES[normalize(type)];
    }

    // Chuẩn hóa giờ kết thúc "HH:MM"; chỉ hợp lệ khi loại có hasEndTime và lớn hơn giờ bắt đầu
    function normalizeEndTime(type, endTime, startTime) {
        if (!get(type).hasEndTime) return null;
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(endTime || '').trim());
        if (!m) return null;
        const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
        if (h > 23 || mi > 59) return null;
        const end = String(h).padStart(2, '0') + ':' + m[2];
        if (startTime && end <= startTime) return null;
        return end;
    }

    // ---------- PHÁT HIỆN XUNG ĐỘT GIỜ ----------
    // Quy tắc: hạn nộp là MỘT MỐC; loại có khoảng giờ là MỘT KHOẢNG.
    //  - mốc nằm HẲN BÊN TRONG khoảng (start < mốc < end)  => xung đột
    //  - hai khoảng chồng nhau (a.start < b.end && b.start < a.end) => xung đột
    //  - chạm mép (nộp đúng giờ kết thúc/bắt đầu) hoặc hai mốc khác nhau => KHÔNG xung đột
    //  - mục đã hoàn thành và khác ngày bị bỏ qua
    function span(item) {
        const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String((item && item.dueDate) || ''));
        if (!m) return null;
        const start = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
        let end = null;
        if (get(item.taskType).hasEndTime) {
            const e = /^(\d{1,2}):(\d{2})$/.exec(String(item.endTime || ''));
            if (e) {
                const v = parseInt(e[1], 10) * 60 + parseInt(e[2], 10);
                if (v > start) end = v;
            }
        }
        return { day: m[1], start, end };
    }

    function conflictBetween(a, b) {
        if (!a || !b || (a.id && a.id === b.id)) return false;
        if (a.isCompleted || b.isCompleted) return false;
        const x = span(a), y = span(b);
        if (!x || !y || x.day !== y.day) return false;
        if (x.end === null && y.end === null) return false;
        if (x.end !== null && y.end !== null) return x.start < y.end && y.start < x.end;
        const range = x.end !== null ? x : y;
        const point = x.end !== null ? y : x;
        return range.start < point.start && point.start < range.end;
    }

    // Map id -> mảng các mục xung đột với nó
    function findConflicts(items) {
        const out = {};
        const list = items || [];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                if (conflictBetween(list[i], list[j])) {
                    (out[list[i].id] = out[list[i].id] || []).push(list[j]);
                    (out[list[j].id] = out[list[j].id] || []).push(list[i]);
                }
            }
        }
        return out;
    }

    // Các mục trong danh sách xung đột với một ứng viên (dùng khi tạo/sửa)
    function conflictsFor(candidate, items) {
        return (items || []).filter(o => conflictBetween(candidate, o));
    }

    return { TASK_TYPES, DEFAULT_TYPE, normalize, get, normalizeEndTime, conflictBetween, findConflicts, conflictsFor };
});
