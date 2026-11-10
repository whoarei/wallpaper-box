'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED = new Set(['api', 'assets', 'docs', 'healthz']);
const MAX_MANIFEST = 64 * 1024;

function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false;
  return !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) && !/[?#:%]/.test(value);
}

async function localFile(directory, relative) {
  if (!relativeFile(relative)) return false;
  try {
    const target = await fs.realpath(path.join(directory, relative));
    const inside = path.relative(directory, target);
    if (!inside || inside.startsWith('..' + path.sep) || inside === '..' || path.isAbsolute(inside)) return false;
    return (await fs.stat(target)).isFile();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return false;
    throw error;
  }
}

function text(manifest, key, fallback = '', limit = 200) {
  if (manifest[key] === undefined) return fallback;
  if (typeof manifest[key] !== 'string' || manifest[key].length > limit) throw new Error(`${key} 必须是长度不超过 ${limit} 的字符串`);
  return manifest[key].trim();
}

function fileURL(id, relative) {
  return '/' + id + '/' + relative.split('/').map(encodeURIComponent).join('/');
}

async function discoverModules(root) {
  const rootPath = await fs.realpath(root);
  const folders = await fs.readdir(rootPath, {withFileTypes: true});
  const warnings = [];
  const modules = (await Promise.all(folders.map(async folder => {
    if (!folder.isDirectory() || !SLUG.test(folder.name) || RESERVED.has(folder.name)) return null;
    const id = folder.name;
    try {
      const directory = await fs.realpath(path.join(rootPath, id));
      if (path.dirname(directory) !== rootPath) throw new Error('模块目录必须位于 modules 的直接子目录');
      let manifest = {};
      const manifestPath = path.join(directory, 'module.json');
      try {
        const info = await fs.lstat(manifestPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST) throw new Error('module.json 必须是小于 64 KiB 的普通文件');
        manifest = JSON.parse((await fs.readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
        if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('module.json 必须是 JSON 对象');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (manifest.enabled !== undefined && typeof manifest.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
      if (manifest.enabled === false) return null;
      const entry = text(manifest, 'entry', 'index.html', 256);
      if (!/\.html?$/i.test(entry) || !await localFile(directory, entry)) throw new Error('入口必须是模块内存在的 HTML 文件');
      if (manifest.order !== undefined && (typeof manifest.order !== 'number' || !Number.isFinite(manifest.order))) throw new Error('order 必须是有限数值');
      if (manifest.tags !== undefined && (!Array.isArray(manifest.tags) || manifest.tags.length > 8 || manifest.tags.some(tag => typeof tag !== 'string' || tag.length > 30))) throw new Error('tags 最多包含 8 个长度不超过 30 的字符串');
      let cover = text(manifest, 'cover', '', 256);
      if (!cover) {
        for (const candidate of ['cover.webp', 'cover.jpg', 'cover.png', 'cover.svg']) {
          if (await localFile(directory, candidate)) { cover = candidate; break; }
        }
      }
      if (cover && (!/\.(webp|jpe?g|png|svg|avif|gif)$/i.test(cover) || !await localFile(directory, cover))) {
        warnings.push({id, message: '封面不存在或格式无效，使用默认封面'});
        cover = '';
      }
      return {
        id, name: text(manifest, 'name', id, 80) || id,
        subtitle: text(manifest, 'subtitle', '', 80),
        description: text(manifest, 'description', '', 300),
        tags: manifest.tags || [], order: manifest.order ?? 100,
        entry, href: entry === 'index.html' ? `/${id}/` : fileURL(id, entry),
        cover: cover ? fileURL(id, cover) : null
      };
    } catch (error) {
      warnings.push({id, message: error.message});
      return null;
    }
  }))).filter(Boolean);
  modules.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
  warnings.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return {modules, warnings};
}

function createServer(root) {
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD'); res.writeHead(405); res.end('{"error":"method_not_allowed"}'); return;
    }
    const pathname = req.url.split('?')[0];
    try {
      let result;
      if (pathname === '/healthz') {
        await fs.access(root); result = {status: 'ok', service: 'display-registry'};
      } else if (pathname === '/api/modules') {
        result = await discoverModules(root);
      } else {
        res.writeHead(404); res.end('{"error":"not_found"}'); return;
      }
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result));
    } catch (error) {
      console.error('Module directory unavailable:', error.message);
      res.writeHead(503); res.end('{"error":"module_directory_unavailable"}');
    }
  });
}

if (require.main === module) {
  const root = process.env.MODULES_DIR || path.join(__dirname, '../modules');
  const server = createServer(root);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Display registry ready on port ' + (process.env.PORT || 3000)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = {discoverModules, createServer};
