/**
 * Cloudflare Worker: Gallery 服务
 * - 图片列表（通过签名请求 S3）
 * - 上传签名（返回签名头信息）
 * - 元数据管理（标题、标签、BlurHash）
 * - 图片删除、移动
 * 
 * 环境变量:
 * - UPLOAD_PASSWORD: 上传密码 (可选)
 * - ADMIN_PASSWORD: 管理密码 (用于管理操作)
 * - S3_ENDPOINT: https://s3.bitiful.net
 * - S3_REGION: cn-east-1
 * - S3_BUCKET: lingshichat
 * - S3_ACCESS_KEY: Access Key ID
 * - S3_SECRET_KEY: Secret Access Key
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const METADATA_KEY = 'img/gallery/_metadata.json';
const ADMIN_OWNER_ID = 'admin';
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const KEY_PREFIX = 'img/gallery/';
const SIGN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SIGN_RATE_LIMIT_MAX = 30;
const signRateLimitBucket = new Map();

function json(code, data) {
  const safeCode = Number(code);
  const status = Number.isInteger(safeCode) && safeCode >= 100 && safeCode <= 599 ? safeCode : 500;
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function readBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(str) {
  return base64UrlEncodeBytes(encoder.encode(str));
}

function base64UrlDecodeToBytes(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomHex(bytesLen = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLen));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytesLen = 32) {
  return base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(bytesLen)));
}

function randomId(prefix) {
  return `${prefix}_${randomHex(8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongEnoughPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

async function sha256Base64Url(input) {
  const digestHex = await sha256(input);
  const bytes = new Uint8Array(digestHex.match(/.{1,2}/g).map((pair) => parseInt(pair, 16)));
  return base64UrlEncodeBytes(bytes);
}

async function hashPassword(password, salt = randomHex(16)) {
  const rounds = 120000;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: rounds
    },
    keyMaterial,
    256
  );
  const hash = base64UrlEncodeBytes(new Uint8Array(bits));
  return `pbkdf2_sha256$${rounds}$${salt}$${hash}`;
}

async function verifyPasswordHash(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const [algo, roundsRaw, salt, expectedHash] = storedHash.split('$');
  if (algo !== 'pbkdf2_sha256') return false;
  const rounds = Number(roundsRaw);
  if (!Number.isFinite(rounds) || rounds < 1000 || rounds > 500000) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: rounds
    },
    keyMaterial,
    256
  );
  const computed = base64UrlEncodeBytes(new Uint8Array(bits));
  return safeEqual(computed, expectedHash);
}

function ensureDb(env) {
  if (!env.DB) {
    throw new Error('缺少 D1 绑定，请在 wrangler.toml 配置 d1_databases');
  }
  return env.DB;
}

async function hashSessionToken(token, env) {
  const secret = env.SESSION_SECRET || '';
  return sha256Base64Url(`${secret}:${token}`);
}

async function resolveSession(authHeader, env) {
  const token = readBearerToken(authHeader);
  if (!token) return null;

  // 兼容：保留 ADMIN_PASSWORD 直通管理员能力（建议生产关闭）
  if (env.ADMIN_PASSWORD && token === env.ADMIN_PASSWORD) {
    return {
      sessionId: 'legacy_admin',
      userId: ADMIN_OWNER_ID,
      email: '',
      role: 'admin',
      tokenHash: '',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };
  }

  const db = ensureDb(env);
  const tokenHash = await hashSessionToken(token, env);
  const now = nowIso();

  const row = await db.prepare(`
    SELECT
      s.id AS sessionId,
      s.user_id AS userId,
      s.expires_at AS expiresAt,
      s.revoked_at AS revokedAt,
      u.email AS email,
      u.role AS role,
      u.status AS userStatus
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.userStatus !== 'active') return null;
  if (row.expiresAt <= now) return null;

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email,
    role: row.role,
    tokenHash,
    expiresAt: row.expiresAt
  };
}

async function requireSession(authHeader, env, roles) {
  const session = await resolveSession(authHeader, env);
  if (!session) return { ok: false, code: 401, message: '登录已过期或令牌无效' };
  if (!roles.includes(session.role)) return { ok: false, code: 403, message: '当前角色无权限执行该操作' };
  return { ok: true, session };
}

function extractUserIdFromKey(key) {
  if (!key || typeof key !== 'string') return ADMIN_OWNER_ID;
  if (!key.startsWith(KEY_PREFIX)) return ADMIN_OWNER_ID;
  const relative = key.slice(KEY_PREFIX.length);
  const userSegment = relative.split('/')[0] || '';
  if (userSegment.startsWith('usr_')) {
    return userSegment;
  }
  return ADMIN_OWNER_ID;
}

function ensureScopedUploadKey(rawKey, session) {
  const normalizedRaw = (rawKey || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRaw) return '';

  const relative = normalizedRaw.startsWith(KEY_PREFIX)
    ? normalizedRaw.slice(KEY_PREFIX.length)
    : normalizedRaw;

  if (session.role !== 'user') {
    return `${KEY_PREFIX}${relative}`;
  }

  if (relative.startsWith(`${session.userId}/`)) {
    return `${KEY_PREFIX}${relative}`;
  }

  return `${KEY_PREFIX}${session.userId}/${relative}`;
}

function hitSignRateLimit(subject) {
  const now = Date.now();
  const key = String(subject || 'anonymous');
  const bucket = signRateLimitBucket.get(key);

  if (!bucket || now - bucket.windowStart >= SIGN_RATE_LIMIT_WINDOW_MS) {
    signRateLimitBucket.set(key, { windowStart: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  if (bucket.count > SIGN_RATE_LIMIT_MAX) {
    return true;
  }

  signRateLimitBucket.set(key, bucket);
  return false;
}

function validateUploadInput(key, contentType, sizeBytes) {
  if (!key) return '缺少 key 参数';
  if (!key.startsWith(KEY_PREFIX)) return '非法 key：仅允许上传到 img/gallery/ 下';
  if (key.includes('..')) return '非法 key：不允许路径穿越';
  if (key.includes('\\')) return '非法 key：不允许反斜杠路径';
  if (key === METADATA_KEY || key.endsWith('/_metadata.json')) return '非法 key：禁止写入元数据文件';

  const lowerKey = key.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some(ext => lowerKey.endsWith(ext))) {
    return '仅支持 jpg/png/gif/webp 格式';
  }

  const normalizedMime = (contentType || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return '不支持的 MIME 类型';
  }

  if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > MAX_UPLOAD_SIZE) {
    return '单张图片最大 10MB';
  }

  return '';
}

function normalizeMetadataEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      title: '',
      tags: [],
      userId: ADMIN_OWNER_ID,
      ownerId: ADMIN_OWNER_ID,
      createdByRole: 'admin',
      visibility: 'private',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      version: 1
    };
  }

  const normalizedUserId = entry.userId || entry.ownerId || ADMIN_OWNER_ID;
  const normalizedRole = entry.createdByRole || (normalizedUserId === ADMIN_OWNER_ID ? 'admin' : 'user');

  return {
    ...entry,
    title: typeof entry.title === 'string' ? entry.title : '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    userId: normalizedUserId,
    ownerId: normalizedUserId,
    createdByRole: normalizedRole,
    visibility: entry.visibility || 'private',
    createdAt: entry.createdAt || entry.updatedAt || nowIso(),
    updatedAt: entry.updatedAt || entry.createdAt || nowIso(),
    version: Number.isFinite(entry.version) ? entry.version : 1
  };
}

function canManageResource(session, entry) {
  if (session.role === 'admin') return true;
  if (session.role !== 'user') return false;
  return entry.userId === session.userId || entry.ownerId === session.userId;
}

function resolveResourceEntry(metadata, key) {
  if (metadata[key]) {
    return normalizeMetadataEntry(metadata[key]);
  }
  const userId = extractUserIdFromKey(key);
  const createdByRole = userId === ADMIN_OWNER_ID ? 'admin' : 'user';
  return {
    ...normalizeMetadataEntry(null),
    userId,
    ownerId: userId,
    createdByRole,
    visibility: 'private'
  };
}

function encodeCursorFromKey(key) {
  return base64UrlEncodeString(String(key || ''));
}

function decodeCursorToKey(cursor) {
  if (!cursor) return '';
  try {
    return decoder.decode(base64UrlDecodeToBytes(cursor));
  } catch {
    return '';
  }
}

function buildListResponseItem(image, metadata, session) {
  const base = {
    key: image.key,
    name: image.name,
    url: image.url,
    thumbnailUrl: image.thumbnailUrl,
    size: image.size,
    lastModified: image.lastModified,
    title: metadata.title,
    tags: metadata.tags,
    updatedAt: metadata.updatedAt,
    version: metadata.version
  };

  if (session.role === 'admin') {
    return {
      ...base,
      userId: metadata.userId,
      ownerId: metadata.ownerId,
      createdByRole: metadata.createdByRole,
      visibility: metadata.visibility
    };
  }

  return base;
}

// ============================================
// AWS Signature V4
// ============================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function sha256(data) {
  const buf = data instanceof ArrayBuffer ? data : encoder.encode(data);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key, data) {
  const k = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

async function getSigningKey(secretKey, dateStamp, region) {
  let k = await hmac('AWS4' + secretKey, dateStamp);
  k = await hmac(k, region);
  k = await hmac(k, 's3');
  k = await hmac(k, 'aws4_request');
  return k;
}

async function createSignature(config, method, path, queryParams, headers, bodyHash) {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  
  const canonicalQS = Object.entries(queryParams)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  
  const headerEntries = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]);
  headerEntries.sort(([a], [b]) => a.localeCompare(b));
  const signedHeadersList = headerEntries.map(([k]) => k).join(';');
  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join('');
  
  const canonicalRequest = [method, path, canonicalQS, canonicalHeaders, signedHeadersList, bodyHash].join('\n');
  
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256(canonicalRequest)].join('\n');
  
  const signingKey = await getSigningKey(config.secretKey, dateStamp, config.region);
  const signature = await hmac(signingKey, stringToSign);
  const signatureHex = Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signatureHex}`,
    amzDate
  };
}

// ============================================
// S3 Operations
// ============================================

async function s3Get(config, key) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const headers = { Host: host, 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  const sig = await createSignature(config, 'GET', `/${key}`, {}, headers, headers['x-amz-content-sha256']);
  
  const res = await fetch(`https://${host}/${key}`, {
    headers: { Authorization: sig.authorization, 'x-amz-date': sig.amzDate, 'x-amz-content-sha256': headers['x-amz-content-sha256'] }
  });
  
  return res;
}

async function s3Put(config, key, body, contentType) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const bodyHash = await sha256(body);
  const headers = { Host: host, 'x-amz-content-sha256': bodyHash, 'Content-Type': contentType };
  const sig = await createSignature(config, 'PUT', `/${key}`, {}, headers, bodyHash);
  
  const res = await fetch(`https://${host}/${key}`, {
    method: 'PUT',
    headers: { Authorization: sig.authorization, 'x-amz-date': sig.amzDate, 'x-amz-content-sha256': bodyHash, 'Content-Type': contentType },
    body
  });
  
  return res;
}

async function s3Delete(config, key) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const headers = { Host: host, 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  const sig = await createSignature(config, 'DELETE', `/${key}`, {}, headers, headers['x-amz-content-sha256']);
  
  const res = await fetch(`https://${host}/${key}`, {
    method: 'DELETE',
    headers: { Authorization: sig.authorization, 'x-amz-date': sig.amzDate, 'x-amz-content-sha256': headers['x-amz-content-sha256'] }
  });
  
  return res;
}

async function listImages(config, prefix, maxKeys = 1000) {
  const queryParams = { 'list-type': '2', prefix, 'max-keys': maxKeys.toString() };
  const headers = { Host: `${config.bucket}.s3.bitiful.net`, 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  
  const sig = await createSignature(config, 'GET', '/', queryParams, headers, headers['x-amz-content-sha256']);
  
  const url = `https://${config.bucket}.s3.bitiful.net/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=${maxKeys}`;
  
  const res = await fetch(url, {
    headers: {
      Authorization: sig.authorization,
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': headers['x-amz-content-sha256']
    }
  });
  
  if (!res.ok) throw new Error(`S3 错误: ${res.status}`);
  
  const xml = await res.text();
  return parseImages(xml, config.publicUrl);
}

function parseImages(xml, publicUrl) {
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
  const images = [];
  
  for (const block of xml.split('<Contents>').slice(1)) {
    const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1];
    if (!key) continue;
    if (key.endsWith('_metadata.json')) continue; // 跳过元数据文件
    if (!exts.some(e => key.toLowerCase().endsWith(e))) continue;
    
    images.push({
      key,
      name: key.split('/').pop(),
      size: parseInt(block.match(/<Size>([^<]+)<\/Size>/)?.[1] || '0', 10),
      lastModified: block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] || new Date().toISOString(),
      url: `${publicUrl}/${key}`,
      thumbnailUrl: `${publicUrl}/${key}?w=400&h=400&fit=cover&q=80&f=webp`,
      blurhashUrl: `${publicUrl}/${key}?fmt=blurhash`
    });
  }
  
  return images.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

async function getUploadSignature(config, key, contentType) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const headers = { Host: host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'Content-Type': contentType };
  const sig = await createSignature(config, 'PUT', `/${key}`, {}, headers, 'UNSIGNED-PAYLOAD');
  
  return {
    url: `https://${host}/${key}`,
    headers: {
      Authorization: sig.authorization,
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'Content-Type': contentType
    }
  };
}

async function getDeleteSignature(config, key) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const headers = { Host: host, 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  const sig = await createSignature(config, 'DELETE', `/${key}`, {}, headers, headers['x-amz-content-sha256']);
  
  return {
    url: `https://${host}/${key}`,
    headers: {
      Authorization: sig.authorization,
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': headers['x-amz-content-sha256']
    }
  };
}

// ============================================
// Metadata Operations
// ============================================

async function getMetadata(config) {
  const res = await s3Get(config, METADATA_KEY);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`获取元数据失败: ${res.status}`);
  
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function saveMetadata(config, metadata) {
  const body = JSON.stringify(metadata, null, 2);
  const res = await s3Put(config, METADATA_KEY, body, 'application/json');
  if (!res.ok) throw new Error(`保存元数据失败: ${res.status}`);
  return true;
}

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const action = url.searchParams.get('action') || '';
      const authHeader = request.headers.get('Authorization');

      const config = {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKey: env.S3_ACCESS_KEY,
        secretKey: env.S3_SECRET_KEY,
        publicUrl: `https://${env.S3_BUCKET}.s3.bitiful.net`
      };

      if (action === 'list') {
        let listSession = { role: 'public', userId: '' };
        if (authHeader) {
          const authResult = await requireSession(authHeader, env, ['user', 'admin']);
          if (!authResult.ok) {
            return json(authResult.code, { code: authResult.code, message: authResult.message });
          }
          listSession = authResult.session;
        }

        const requestedPrefix = (url.searchParams.get('prefix') || '').trim();
        const safePrefix = requestedPrefix.startsWith(KEY_PREFIX)
          ? requestedPrefix
          : `${KEY_PREFIX}${requestedPrefix}`;

        const prefix = listSession.role === 'user'
          ? `${KEY_PREFIX}${listSession.userId}/`
          : (safePrefix || KEY_PREFIX);

        const limitRaw = Number(url.searchParams.get('limit'));
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 60;
        const cursorKey = decodeCursorToKey(url.searchParams.get('cursor') || '');

        const images = await listImages(config, prefix);

        const metadata = await getMetadata(config);
        let metadataChanged = false;

        const visibleImages = images
          .map(img => {
            const original = metadata[img.key];
            const normalized = resolveResourceEntry(metadata, img.key);
            const shouldWriteBack = !original || JSON.stringify(original) !== JSON.stringify(normalized);
            if (shouldWriteBack) {
              metadata[img.key] = normalized;
              metadataChanged = true;
              console.log('[gallery-migration] metadata normalized', {
                key: img.key,
                changedFields: Object.keys(normalized).filter((field) => !original || JSON.stringify(original[field]) !== JSON.stringify(normalized[field])),
                migratedAt: new Date().toISOString()
              });
            }
            return { image: img, metadata: normalized };
          })
          .filter(item => listSession.role === 'public' || canManageResource(listSession, item.metadata))
          .sort((a, b) => a.image.key.localeCompare(b.image.key));

        const startIndex = cursorKey
          ? visibleImages.findIndex(item => item.image.key > cursorKey)
          : 0;
        const safeStartIndex = startIndex === -1 ? visibleImages.length : startIndex;

        const pageItems = visibleImages
          .slice(safeStartIndex, safeStartIndex + limit)
          .map(item => buildListResponseItem(item.image, item.metadata, listSession));

        const hasMore = safeStartIndex + limit < visibleImages.length;
        const nextCursor = hasMore && pageItems.length > 0
          ? encodeCursorFromKey(pageItems[pageItems.length - 1].key)
          : '';

        if (metadataChanged) {
          await saveMetadata(config, metadata);
        }

        return json(200, {
          code: 200,
          images: pageItems,
          pagination: {
            limit,
            hasMore,
            nextCursor,
            total: visibleImages.length
          }
        });
      }

      if (action === 'register') {
        if (request.method !== 'POST') {
          return json(405, { code: 405, message: 'register 仅支持 POST' });
        }
        const body = await request.json();
        const email = normalizeEmail(body?.email);
        const password = String(body?.password || '');

        if (!isValidEmail(email)) {
          return json(400, { code: 400, message: '邮箱格式不正确' });
        }
        if (!isStrongEnoughPassword(password)) {
          return json(400, { code: 400, message: '密码长度需为 8-128 位' });
        }

        const db = ensureDb(env);
        const now = nowIso();
        const exists = await db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first();
        if (exists) {
          return json(409, { code: 409, message: '邮箱已注册' });
        }

        const userId = randomId('usr');
        const passwordHash = await hashPassword(password);
        await db.prepare(`
          INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
          VALUES (?, ?, ?, 'user', 'active', ?, ?)
        `).bind(userId, email, passwordHash, now, now).run();

        return json(200, { code: 200, message: '注册成功' });
      }

      if (action === 'login') {
        if (request.method !== 'POST') {
          return json(405, { code: 405, message: 'login 仅支持 POST' });
        }
        if (!env.SESSION_SECRET) {
          return json(500, { code: 500, message: '缺少 SESSION_SECRET 配置' });
        }

        const body = await request.json();
        const email = normalizeEmail(body?.email);
        const password = String(body?.password || '');

        if (!isValidEmail(email) || !password) {
          return json(400, { code: 400, message: '缺少或非法的邮箱/密码参数' });
        }

        const db = ensureDb(env);
        const user = await db.prepare(`
          SELECT id, email, password_hash AS passwordHash, role, status
          FROM users
          WHERE email = ?
          LIMIT 1
        `).bind(email).first();

        if (!user || user.status !== 'active') {
          return json(401, { code: 401, message: '邮箱或密码错误' });
        }

        const passwordMatched = await verifyPasswordHash(password, user.passwordHash);
        if (!passwordMatched) {
          return json(401, { code: 401, message: '邮箱或密码错误' });
        }

        const now = new Date();
        const ttl = user.role === 'admin' ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
        const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
        const sessionId = randomId('ses');
        const token = randomToken(32);
        const tokenHash = await hashSessionToken(token, env);

        await db.prepare(`
          INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent, ip)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          sessionId,
          user.id,
          tokenHash,
          now.toISOString(),
          expiresAt,
          request.headers.get('User-Agent') || '',
          request.headers.get('CF-Connecting-IP') || ''
        ).run();

        await db.prepare(`
          UPDATE users
          SET last_login_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(now.toISOString(), now.toISOString(), user.id).run();

        return json(200, {
          code: 200,
          message: '登录成功',
          data: {
            token,
            role: user.role,
            userId: user.id,
            ownerId: user.id,
            email: user.email,
            expiresAt
          }
        });
      }

      if (action === 'me') {
        const authResult = await requireSession(authHeader, env, ['user', 'admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        return json(200, {
          code: 200,
          data: {
            userId: authResult.session.userId,
            role: authResult.session.role,
            email: authResult.session.email || '',
            expiresAt: authResult.session.expiresAt
          }
        });
      }

      if (action === 'logout') {
        if (request.method !== 'POST') {
          return json(405, { code: 405, message: 'logout 仅支持 POST' });
        }
        const authResult = await requireSession(authHeader, env, ['user', 'admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        if (authResult.session.sessionId !== 'legacy_admin') {
          const db = ensureDb(env);
          await db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(nowIso(), authResult.session.sessionId).run();
        }

        return json(200, { code: 200, message: '已退出登录' });
      }

      if (action === 'sign') {
        const authResult = await requireSession(authHeader, env, ['user', 'admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const rateLimitSubject = authResult.session.role === 'admin' ? 'admin' : authResult.session.userId;
        if (hitSignRateLimit(rateLimitSubject)) {
          return json(429, { code: 429, message: '签名请求过于频繁，请稍后再试' });
        }

        let key = url.searchParams.get('key');
        let contentType = url.searchParams.get('type') || 'image/jpeg';
        let sizeBytes;

        if (request.method === 'POST') {
          const body = await request.json();
          key = body?.key || key;
          contentType = body?.contentType || contentType;
          sizeBytes = Number(body?.sizeBytes);
        }

        const scopedKey = ensureScopedUploadKey(key, authResult.session);
        const inputError = validateUploadInput(scopedKey, contentType, sizeBytes);
        if (inputError) {
          return json(400, { code: 400, message: inputError });
        }

        const upload = await getUploadSignature(config, scopedKey, contentType);
        return json(200, { code: 200, key: scopedKey, ...upload });
      }

      if (action === 'signDelete') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });

        const del = await getDeleteSignature(config, key);
        return json(200, { code: 200, ...del });
      }

      if (action === 'getMeta') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const metadata = await getMetadata(config);
        const key = url.searchParams.get('key');

        if (key) {
          return json(200, { code: 200, metadata: metadata[key] || {} });
        }
        return json(200, { code: 200, metadata });
      }

      if (action === 'updateMeta') {
        const authResult = await requireSession(authHeader, env, ['user', 'admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const body = await request.json();
        const { key, title, tags, expectedVersion } = body;
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });

        const metadata = await getMetadata(config);
        const hasExisting = !!metadata[key];
        const current = resolveResourceEntry(metadata, key);
        const currentStoredVersion = hasExisting ? (Number(current.version) || 1) : 0;

        if (!hasExisting) {
          current.createdAt = new Date().toISOString();
        }

        if (!canManageResource(authResult.session, current)) {
          return json(403, { code: 403, message: '无权限修改该图片' });
        }

        if (expectedVersion !== undefined && expectedVersion !== null) {
          const normalizedExpected = Number(expectedVersion);
          if (!Number.isFinite(normalizedExpected) || normalizedExpected < 0) {
            return json(400, { code: 400, message: 'expectedVersion 非法' });
          }

          if (normalizedExpected !== currentStoredVersion) {
            return json(409, {
              code: 409,
              message: '元数据版本冲突，请刷新后重试',
              currentVersion: currentStoredVersion,
              metadata: current
            });
          }
        }

        if (title !== undefined) current.title = title;
        if (tags !== undefined) current.tags = Array.isArray(tags) ? tags : [];
        current.visibility = current.visibility || 'private';
        current.updatedAt = new Date().toISOString();
        current.version = currentStoredVersion + 1;

        metadata[key] = current;
        await saveMetadata(config, metadata);

        return json(200, { code: 200, message: '元数据已更新', metadata: metadata[key] });
      }

      if (action === 'deleteMeta') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });

        const metadata = await getMetadata(config);
        if (metadata[key]) {
          delete metadata[key];
          await saveMetadata(config, metadata);
        }

        return json(200, { code: 200, message: '元数据已删除' });
      }

      if (action === 'moveImage') {
        const authResult = await requireSession(authHeader, env, ['user', 'admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const body = await request.json();
        const { oldKey, newKey } = body;

        if (!oldKey || !newKey) {
          return json(400, { code: 400, message: '缺少 oldKey 或 newKey' });
        }

        const metadata = await getMetadata(config);
        const oldMeta = resolveResourceEntry(metadata, oldKey);

        if (!canManageResource(authResult.session, oldMeta)) {
          return json(403, { code: 403, message: '无权限移动该图片' });
        }

        const scopedNewKey = ensureScopedUploadKey(newKey, authResult.session);
        const newKeyInputError = validateUploadInput(scopedNewKey, 'image/jpeg');
        if (newKeyInputError) {
          return json(400, { code: 400, message: newKeyInputError });
        }

        // 获取原图片
        const getRes = await s3Get(config, oldKey);
        if (!getRes.ok) {
          return json(404, { code: 404, message: '图片不存在' });
        }

        const imageBody = await getRes.arrayBuffer();
        const contentType = getRes.headers.get('Content-Type') || 'image/jpeg';

        // 复制到新位置
        const putRes = await s3Put(config, scopedNewKey, imageBody, contentType);
        if (!putRes.ok) {
          return json(500, { code: 500, message: '复制图片失败' });
        }

        // 删除原图片
        await s3Delete(config, oldKey);

        // 更新元数据
        const nextUserId = oldMeta.userId || oldMeta.ownerId || extractUserIdFromKey(scopedNewKey);
        metadata[scopedNewKey] = {
          ...oldMeta,
          userId: nextUserId,
          ownerId: nextUserId,
          updatedAt: new Date().toISOString(),
          version: (Number(oldMeta.version) || 0) + 1
        };
        delete metadata[oldKey];
        await saveMetadata(config, metadata);

        return json(200, {
          code: 200,
          message: '图片已移动',
          newUrl: `${config.publicUrl}/${scopedNewKey}`,
          newKey: scopedNewKey
        });
      }

      if (action === 'deleteImage') {
        const authResult = await requireSession(authHeader, env, ['user', 'admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });

        const metadata = await getMetadata(config);
        const entry = resolveResourceEntry(metadata, key);

        if (!canManageResource(authResult.session, entry)) {
          return json(403, { code: 403, message: '无权限删除该图片' });
        }

        const delRes = await s3Delete(config, key);
        if (!delRes.ok && delRes.status !== 204) {
          return json(500, { code: 500, message: '删除图片失败' });
        }

        if (metadata[key]) {
          delete metadata[key];
          await saveMetadata(config, metadata);
        }

        return json(200, { code: 200, message: '图片已删除' });
      }

      return json(400, { code: 400, message: '未知 action' });
    } catch (err) {
      console.error('Worker 错误:', err);
      return json(500, { code: 500, message: err.message || '服务内部错误' });
    }
  }
};
