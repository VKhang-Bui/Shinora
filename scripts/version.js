#!/usr/bin/env node
/**
 * Sinh chuỗi phiên bản cho các bản TEST / DOCKER:
 *     <phiên-bản-mới>-<mã-băm-5-ký-tự>-beta      ví dụ: 1.2.0-a3f9c-beta
 * - phiên bản mới: lấy từ package.json
 * - mã băm: SHA1 nội dung mã nguồn (backend, frontend, api, scripts, Dockerfile, package.json)
 *   => đổi code là đổi hash; cùng code thì cùng hash (không phụ thuộc git commit).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const INCLUDE = ['backend', 'frontend', 'api', 'scripts', 'Dockerfile', 'package.json', 'sw.js', 'vercel.json'];
const SKIP = /(\.sqlite|\.sqlite-wal|\.sqlite-shm|vapid\.json|node_modules)/;

function walk(p, out) {
    if (!fs.existsSync(p) || SKIP.test(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) fs.readdirSync(p).sort().forEach(f => walk(path.join(p, f), out));
    else out.push(p);
}

const files = [];
INCLUDE.forEach(f => walk(path.join(root, f), files));
const h = crypto.createHash('sha1');
files.forEach(f => { h.update(path.relative(root, f)); h.update(fs.readFileSync(f)); });

const base = require(path.join(root, 'package.json')).version;
console.log(`${base}-${h.digest('hex').slice(0, 5)}-beta`);
