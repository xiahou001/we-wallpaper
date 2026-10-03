// 给 resources/app/out/renderer/index.html 注入壁纸层(幂等:已注入则跳过)
// 注入内容 = 极小的远程加载器(样式/逻辑在壁纸服务器上,便于迭代),同时兼容
// asar 原位等长补丁(asar-patch-inplace.js 要求注入后总长不超过原文件)。
const fs = require('fs');
const path = require('path');
// ZCode 安装目录:默认 %LOCALAPPDATA%\Programs\ZCode,可用环境变量 ZCODE_DIR 覆盖
const ZCODE_DIR = process.env.ZCODE_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZCode');
const TARGET = path.join(ZCODE_DIR, 'resources', 'app', 'out', 'renderer', 'index.html');
let html = fs.readFileSync(TARGET, 'utf8');
if (html.includes('embed.css')) { console.log('ALREADY PATCHED'); process.exit(0); }

const anchor = '<title>ZCode</title>';
if (!html.includes(anchor)) { console.error('ANCHOR NOT FOUND'); process.exit(1); }
// 剥掉旧版注入(v1 全量 style+script / v2 重试版)
html = html.replace(/<style id="we-wp-style">[\s\S]*?<\/style>\s*/g, '');
html = html.replace(/<script id="we-wp-script">[\s\S]*?<\/script>\s*/g, '');

const inject = `<link rel="stylesheet" href="http://127.0.0.1:7396/embed.css" /><script src="http://127.0.0.1:7396/embed.js" defer></script>`;

html = html.replace(anchor, anchor + inject);
fs.writeFileSync(TARGET, html);
console.log('PATCHED ' + TARGET);
