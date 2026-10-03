// 模拟跨源宿主:7397 端口伺服 mock-chat.html(模拟 file:// 聊天窗口的独立源)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '/mock-chat') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'mock-chat.html')));
  }
  res.writeHead(404); res.end('not found');
}).listen(7397, '127.0.0.1', () => console.log('[mock-origin] http://127.0.0.1:7397/mock-chat'));
