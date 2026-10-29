// 目录静态文件服务：缺省监听 0.0.0.0，服务 dist/repo（本机与同网设备安装测试）。
// 路径必须落在根目录内（含符号链接解析后）。
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import * as path from 'node:path';
import { REPO_INDEX_FILENAME } from '@honyomi/plugin-sdk/repo';

export const SERVE_PORT = 8765;

const PORT = SERVE_PORT;

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.honyomiplug': 'application/zip',
  '.zip': 'application/zip',
  '.js': 'text/javascript',
  '.png': 'image/png',
};

export function pathInsideRoot(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// 把请求路径解析到 root 之内。编码错误或越界返回 400，不碰文件系统。
export function resolveServedPath(root: string, rawUrl: string): { ok: true; file: string } | {
  ok: false;
  status: 400
} {
  let decoded: string;
  try {
    decoded = decodeURIComponent((rawUrl || '').split('?')[0]);
  } catch {
    return { ok: false, status: 400 };
  }
  const name = decoded.replace(/^\//, '') || REPO_INDEX_FILENAME;
  if (name.includes('\0')) {
    return { ok: false, status: 400 };
  }
  const file = path.resolve(root, name);
  if (!pathInsideRoot(root, file)) {
    return { ok: false, status: 400 };
  }
  return { ok: true, file };
}

export function serve(root: string, host = '0.0.0.0'): void {
  const base = path.resolve(root);
  const server = createServer((req, res) => {
    const resolved = resolveServedPath(base, req.url ?? '');
    if (!resolved.ok) {
      res.writeHead(resolved.status, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }
    let file = resolved.file;
    try {
      if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      // 符号链接解析后再确认一次，避免链接指向根目录外。
      file = realpathSync(file);
      if (!pathInsideRoot(base, file)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('bad request');
        return;
      }
      const size = statSync(file).size;
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': size,
      });
      const stream = createReadStream(file);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
        }
        res.end();
      });
      stream.pipe(res);
      console.log(`${new Date().toISOString()} ${req.socket.remoteAddress ?? ''} GET ${req.url} -> 200`);
    } catch {
      if (!res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      }
    }
  });
  server.on('clientError', (_err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.listen(PORT, host, () => {
    console.log(`serving ${base}`);
    console.log(`bind:  ${host}:${PORT}`);
    console.log(`root:  http://127.0.0.1:${PORT}/`);
    console.log(`index: http://127.0.0.1:${PORT}/${REPO_INDEX_FILENAME}`);
  });
}
