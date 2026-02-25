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

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

  const isLocalDev = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  const isAllowed = isLocalDev || allowedOrigins.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

const METADATA_KEY = 'img/gallery/_metadata.json';
const ADMIN_OWNER_ID = 'admin';
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const PBKDF2_ITERATIONS = 100000;
const KEY_PREFIX = 'img/gallery/';
const SIGN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SIGN_RATE_LIMIT_MAX = 30;
const signRateLimitBucket = new Map();


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

function randomInviteCode() {
  // 生成 8 位大写字母+数字邀请码
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
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
  const rounds = PBKDF2_ITERATIONS;
  try {
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
  } catch (error) {
    console.error('[auth][pbkdf2][hashPassword] failed', {
      rounds,
      saltLength: String(salt || '').length,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function verifyPasswordHash(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const [algo, roundsRaw, salt, expectedHash] = storedHash.split('$');
  if (algo !== 'pbkdf2_sha256') return false;
  const rounds = Number(roundsRaw);
  if (!Number.isFinite(rounds) || rounds < 1000 || rounds > PBKDF2_ITERATIONS) return false;

  try {
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
  } catch (error) {
    console.error('[auth][pbkdf2][verifyPasswordHash] failed', {
      rounds,
      hashAlgo: algo,
      saltLength: String(salt || '').length,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
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

function encodeS3Path(path) {
  return String(path || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

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
  const encodedPath = encodeS3Path(key);
  const sig = await createSignature(config, 'GET', `/${encodedPath}`, {}, headers, headers['x-amz-content-sha256']);

  const res = await fetch(`https://${host}/${encodedPath}`, {
    headers: { Authorization: sig.authorization, 'x-amz-date': sig.amzDate, 'x-amz-content-sha256': headers['x-amz-content-sha256'] }
  });

  return res;
}

async function s3Put(config, key, body, contentType) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const bodyHash = await sha256(body);
  const headers = { Host: host, 'x-amz-content-sha256': bodyHash, 'Content-Type': contentType };
  const encodedPath = encodeS3Path(key);
  const sig = await createSignature(config, 'PUT', `/${encodedPath}`, {}, headers, bodyHash);

  const res = await fetch(`https://${host}/${encodedPath}`, {
    method: 'PUT',
    headers: { Authorization: sig.authorization, 'x-amz-date': sig.amzDate, 'x-amz-content-sha256': bodyHash, 'Content-Type': contentType },
    body
  });

  return res;
}

async function s3Delete(config, key) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const headers = { Host: host, 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  const encodedPath = encodeS3Path(key);
  const sig = await createSignature(config, 'DELETE', `/${encodedPath}`, {}, headers, headers['x-amz-content-sha256']);

  const res = await fetch(`https://${host}/${encodedPath}`, {
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
      thumbnailUrl: `${publicUrl}/${key}?w=400&q=80&f=webp`,
      placeholderUrl: `${publicUrl}/${key}?w=24&q=20&f=webp`,
      blurhashUrl: `${publicUrl}/${key}?fmt=blurhash`
    });
  }

  return images.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

async function getUploadSignature(config, key, contentType, sizeBytes) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const encodedKey = encodeS3Path(key);
  const headers = {
    Host: host,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'Content-Type': contentType,
    'Content-Length': String(sizeBytes)
  };
  const sig = await createSignature(config, 'PUT', `/${encodedKey}`, {}, headers, 'UNSIGNED-PAYLOAD');

  return {
    url: `https://${host}/${encodedKey}`,
    headers: {
      Authorization: sig.authorization,
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'Content-Type': contentType,
      'Content-Length': String(sizeBytes)
    }
  };
}

async function getDeleteSignature(config, key) {
  const host = `${config.bucket}.s3.bitiful.net`;
  const encodedKey = encodeS3Path(key);
  const headers = { Host: host, 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  const sig = await createSignature(config, 'DELETE', `/${encodedKey}`, {}, headers, headers['x-amz-content-sha256']);

  return {
    url: `https://${host}/${encodedKey}`,
    headers: {
      Authorization: sig.authorization,
      'x-amz-date': sig.amzDate,
      'x-amz-content-sha256': headers['x-amz-content-sha256']
    }
  };
}

// ============================================
// Metadata Operations (D1)
// ============================================

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags;
  if (typeof rawTags !== 'string' || !rawTags.trim()) return [];
  try {
    const parsed = JSON.parse(rawTags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function metadataFromDbRow(row) {
  if (!row) return null;
  return {
    title: typeof row.title === 'string' ? row.title : '',
    tags: parseTags(row.tags),
    userId: row.userId || row.user_id || ADMIN_OWNER_ID,
    ownerId: row.ownerId || row.owner_id || row.userId || row.user_id || ADMIN_OWNER_ID,
    createdByRole: row.createdByRole || row.created_by_role || 'user',
    visibility: row.visibility || 'private',
    createdAt: row.createdAt || row.created_at || nowIso(),
    updatedAt: row.updatedAt || row.updated_at || nowIso(),
    version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1
  };
}

function resolveResourceEntryFromRow(row, key) {
  if (row) {
    return normalizeMetadataEntry(metadataFromDbRow(row));
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

async function getImageMetadata(env, key) {
  const db = ensureDb(env);
  return db.prepare(`
    SELECT
      key,
      title,
      tags,
      user_id AS userId,
      owner_id AS ownerId,
      created_by_role AS createdByRole,
      visibility,
      created_at AS createdAt,
      updated_at AS updatedAt,
      version
    FROM images
    WHERE key = ?
    LIMIT 1
  `).bind(key).first();
}

async function getImagesMetadataByKeys(env, keys) {
  const normalizedKeys = Array.from(new Set((keys || []).filter(Boolean)));
  if (normalizedKeys.length === 0) return new Map();

  const db = ensureDb(env);
  const placeholders = normalizedKeys.map(() => '?').join(',');
  const sql = `
    SELECT
      key,
      title,
      tags,
      user_id AS userId,
      owner_id AS ownerId,
      created_by_role AS createdByRole,
      visibility,
      created_at AS createdAt,
      updated_at AS updatedAt,
      version
    FROM images
    WHERE key IN (${placeholders})
  `;
  const result = await db.prepare(sql).bind(...normalizedKeys).all();
  const rows = Array.isArray(result?.results) ? result.results : [];

  const metadataMap = new Map();
  rows.forEach((row) => {
    metadataMap.set(row.key, row);
  });
  return metadataMap;
}

async function listAllImageMetadata(env) {
  const db = ensureDb(env);
  const result = await db.prepare(`
    SELECT
      key,
      title,
      tags,
      user_id AS userId,
      owner_id AS ownerId,
      created_by_role AS createdByRole,
      visibility,
      created_at AS createdAt,
      updated_at AS updatedAt,
      version
    FROM images
  `).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function upsertImageMetadata(env, key, metadata) {
  const db = ensureDb(env);
  const entry = normalizeMetadataEntry(metadata);
  await db.prepare(`
    INSERT INTO images (
      key,
      title,
      tags,
      user_id,
      owner_id,
      created_by_role,
      visibility,
      created_at,
      updated_at,
      version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      title = excluded.title,
      tags = excluded.tags,
      user_id = excluded.user_id,
      owner_id = excluded.owner_id,
      created_by_role = excluded.created_by_role,
      visibility = excluded.visibility,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      version = excluded.version
  `).bind(
    key,
    entry.title,
    JSON.stringify(Array.isArray(entry.tags) ? entry.tags : []),
    entry.userId,
    entry.ownerId,
    entry.createdByRole,
    entry.visibility,
    entry.createdAt,
    entry.updatedAt,
    Number.isFinite(Number(entry.version)) ? Number(entry.version) : 1
  ).run();
}

async function deleteImageMetadata(env, key) {
  const db = ensureDb(env);
  await db.prepare('DELETE FROM images WHERE key = ?').bind(key).run();
}

async function migrateMetadataFromS3(config, env) {
  const res = await s3Get(config, METADATA_KEY);
  if (res.status === 404) {
    return { migrated: 0, skipped: 0 };
  }
  if (!res.ok) {
    throw new Error(`读取历史元数据失败: ${res.status}`);
  }

  let legacyMetadata = {};
  try {
    legacyMetadata = await res.json();
  } catch {
    legacyMetadata = {};
  }

  const entries = Object.entries(legacyMetadata || {}).filter(([key]) => !!key);
  let migrated = 0;
  let skipped = 0;

  for (const [key, raw] of entries) {
    const normalized = resolveResourceEntryFromRow(metadataFromDbRow(raw), key);
    try {
      await upsertImageMetadata(env, key, normalized);
      migrated += 1;
    } catch {
      skipped += 1;
    }
  }

  return { migrated, skipped };
}

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request, env);
    const json = (code, data) => {
      const safeCode = Number(code);
      const status = Number.isInteger(safeCode) && safeCode >= 100 && safeCode <= 599 ? safeCode : 500;
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    };

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
        const prefix = safePrefix || KEY_PREFIX;

        const ownerFilter = (url.searchParams.get('owner') || '').trim().toLowerCase();
        const mineOnly = ownerFilter === 'mine';
        if (mineOnly && listSession.role === 'public') {
          return json(401, { code: 401, message: '登录后可查看“我的图片”' });
        }

        const limitRaw = Number(url.searchParams.get('limit'));
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 60;
        const cursorKey = decodeCursorToKey(url.searchParams.get('cursor') || '');

        const images = await listImages(config, prefix);

        const metadataMap = await getImagesMetadataByKeys(env, images.map((img) => img.key));

        const visibleImages = images
          .map((img) => {
            const row = metadataMap.get(img.key) || null;
            const normalized = resolveResourceEntryFromRow(row, img.key);
            return { image: img, metadata: normalized };
          })
          .filter((item) => {
            if (!mineOnly) {
              return true;
            }
            const ownerId = item.metadata.userId || item.metadata.ownerId || extractUserIdFromKey(item.image.key);
            // 直接匹配 userId
            if (!!ownerId && ownerId === listSession.userId) return true;
            // admin 用户也应看到归属为 ADMIN_OWNER_ID 的历史图片
            if (listSession.role === 'admin' && ownerId === ADMIN_OWNER_ID) return true;
            return false;
          })
          .sort((a, b) => a.image.key.localeCompare(b.image.key));

        const startIndex = cursorKey
          ? visibleImages.findIndex((item) => item.image.key > cursorKey)
          : 0;
        const safeStartIndex = startIndex === -1 ? visibleImages.length : startIndex;

        const pageItems = visibleImages
          .slice(safeStartIndex, safeStartIndex + limit)
          .map((item) => buildListResponseItem(item.image, item.metadata, listSession));

        const hasMore = safeStartIndex + limit < visibleImages.length;
        const nextCursor = hasMore && pageItems.length > 0
          ? encodeCursorFromKey(pageItems[pageItems.length - 1].key)
          : '';

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
        const inviteCode = String(body?.inviteCode || '').trim().toUpperCase();

        if (!isValidEmail(email)) {
          return json(400, { code: 400, message: '邮箱格式不正确' });
        }
        if (!isStrongEnoughPassword(password)) {
          return json(400, { code: 400, message: '密码长度需为 8-128 位' });
        }

        // 邀请码验证（管理员可免邀请码）
        const callerSession = await resolveSession(authHeader, env);
        const isAdminCaller = callerSession && callerSession.role === 'admin';

        if (!isAdminCaller) {
          if (!inviteCode) {
            return json(400, { code: 400, message: '请输入邀请码' });
          }
          const db = ensureDb(env);
          const invite = await db.prepare(
            'SELECT * FROM invitations WHERE code = ? LIMIT 1'
          ).bind(inviteCode).first();

          if (!invite) {
            return json(400, { code: 400, message: '邀请码无效' });
          }
          if (invite.status !== 'active') {
            return json(400, { code: 400, message: '该邀请码已被禁用' });
          }
          if (invite.max_uses > 0 && invite.used_count >= invite.max_uses) {
            return json(400, { code: 400, message: '该邀请码已达使用上限' });
          }
          if (invite.expires_at && invite.expires_at <= nowIso()) {
            return json(400, { code: 400, message: '该邀请码已过期' });
          }
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

        // 消耗邀请码使用次数
        if (!isAdminCaller && inviteCode) {
          await db.prepare(
            'UPDATE invitations SET used_count = used_count + 1 WHERE code = ?'
          ).bind(inviteCode).run();
        }

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

        const upload = await getUploadSignature(config, scopedKey, contentType, sizeBytes);

        // 自动为上传的图片创建 D1 元数据，绑定上传者 userId
        try {
          const session = authResult.session;
          const existingMeta = await getImageMetadata(env, scopedKey);
          if (!existingMeta) {
            await upsertImageMetadata(env, scopedKey, {
              title: '',
              tags: [],
              userId: String(session.userId),
              ownerId: String(session.userId),
              createdByRole: session.role,
              visibility: 'private',
              createdAt: nowIso(),
              updatedAt: nowIso(),
              version: 1
            });
          }
        } catch (metaErr) {
          console.warn('自动创建上传元数据失败（不影响上传）:', metaErr);
        }

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

        const key = url.searchParams.get('key');

        if (key) {
          const row = await getImageMetadata(env, key);
          return json(200, { code: 200, metadata: resolveResourceEntryFromRow(row, key) });
        }

        const rows = await listAllImageMetadata(env);
        const metadata = {};
        rows.forEach((row) => {
          if (row?.key) {
            metadata[row.key] = normalizeMetadataEntry(metadataFromDbRow(row));
          }
        });
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

        const existingRow = await getImageMetadata(env, key);
        const hasExisting = !!existingRow;
        const current = resolveResourceEntryFromRow(existingRow, key);
        const currentStoredVersion = hasExisting ? (Number(current.version) || 1) : 0;

        if (!hasExisting) {
          current.createdAt = nowIso();
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
        current.updatedAt = nowIso();
        current.version = currentStoredVersion + 1;

        await upsertImageMetadata(env, key, current);

        return json(200, { code: 200, message: '元数据已更新', metadata: current });
      }

      if (action === 'deleteMeta') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });

        await deleteImageMetadata(env, key);

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

        const oldRow = await getImageMetadata(env, oldKey);
        const oldMeta = resolveResourceEntryFromRow(oldRow, oldKey);

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
        await upsertImageMetadata(env, scopedNewKey, {
          ...oldMeta,
          userId: nextUserId,
          ownerId: nextUserId,
          updatedAt: nowIso(),
          version: (Number(oldMeta.version) || 0) + 1
        });
        await deleteImageMetadata(env, oldKey);

        return json(200, {
          code: 200,
          message: '图片已移动',
          newUrl: `${config.publicUrl}/${scopedNewKey}`,
          newKey: scopedNewKey
        });
      }

      if (action === 'deleteImage') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }

        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });

        const entryRow = await getImageMetadata(env, key);
        const entry = resolveResourceEntryFromRow(entryRow, key);

        if (!canManageResource(authResult.session, entry)) {
          return json(403, { code: 403, message: '无权限删除该图片' });
        }

        const delRes = await s3Delete(config, key);
        if (!delRes.ok && delRes.status !== 204) {
          return json(500, { code: 500, message: '删除图片失败' });
        }

        await deleteImageMetadata(env, key);

        return json(200, { code: 200, message: '图片已删除' });
      }

      // ============================================
      // 管理员 API
      // ============================================

      if (action === 'adminListUsers') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }
        const db = ensureDb(env);
        const result = await db.prepare(`
          SELECT id, email, role, status, created_at AS createdAt, updated_at AS updatedAt, last_login_at AS lastLoginAt
          FROM users ORDER BY created_at DESC
        `).all();
        return json(200, { code: 200, data: result?.results || [] });
      }

      if (action === 'adminUpdateUser') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }
        const body = await request.json();
        const targetId = String(body?.userId || '').trim();
        if (!targetId) return json(400, { code: 400, message: '缺少 userId' });

        // 禁止修改自己
        if (targetId === authResult.session.userId) {
          return json(400, { code: 400, message: '不能修改自己的角色或状态' });
        }

        const db = ensureDb(env);
        const updates = [];
        const values = [];
        if (body.role && ['user', 'admin'].includes(body.role)) {
          updates.push('role = ?');
          values.push(body.role);
        }
        if (body.status && ['active', 'disabled'].includes(body.status)) {
          updates.push('status = ?');
          values.push(body.status);
        }
        if (updates.length === 0) {
          return json(400, { code: 400, message: '无有效的更新字段' });
        }
        updates.push('updated_at = ?');
        values.push(nowIso());
        values.push(targetId);

        await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
        return json(200, { code: 200, message: '用户信息已更新' });
      }

      if (action === 'adminListInvites') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }
        const db = ensureDb(env);
        const result = await db.prepare(`
          SELECT i.code, i.creator_id AS creatorId, i.max_uses AS maxUses,
                 i.used_count AS usedCount, i.status, i.expires_at AS expiresAt,
                 i.created_at AS createdAt, u.email AS creatorEmail
          FROM invitations i
          LEFT JOIN users u ON u.id = i.creator_id
          ORDER BY i.created_at DESC
        `).all();
        return json(200, { code: 200, data: result?.results || [] });
      }

      if (action === 'adminCreateInvite') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }
        const body = await request.json();
        const maxUses = Number(body?.maxUses);
        const safeMaxUses = Number.isFinite(maxUses) && maxUses >= -1 ? maxUses : 1;

        const db = ensureDb(env);
        const code = randomInviteCode();
        const now = nowIso();
        const expiresAt = body?.expiresAt || null;

        await db.prepare(`
          INSERT INTO invitations (code, creator_id, max_uses, used_count, status, expires_at, created_at)
          VALUES (?, ?, ?, 0, 'active', ?, ?)
        `).bind(code, authResult.session.userId, safeMaxUses, expiresAt, now).run();

        return json(200, { code: 200, data: { code, maxUses: safeMaxUses, expiresAt } });
      }

      if (action === 'adminUpdateInvite') {
        const authResult = await requireSession(authHeader, env, ['admin']);
        if (!authResult.ok) {
          return json(authResult.code, { code: authResult.code, message: authResult.message });
        }
        const body = await request.json();
        const inviteCode = String(body?.code || '').trim();
        if (!inviteCode) return json(400, { code: 400, message: '缺少邀请码' });

        const db = ensureDb(env);
        const updates = [];
        const values = [];
        if (body.status && ['active', 'disabled'].includes(body.status)) {
          updates.push('status = ?');
          values.push(body.status);
        }
        if (body.maxUses !== undefined) {
          const mu = Number(body.maxUses);
          if (Number.isFinite(mu) && mu >= -1) {
            updates.push('max_uses = ?');
            values.push(mu);
          }
        }
        if (updates.length === 0) {
          return json(400, { code: 400, message: '无有效的更新字段' });
        }
        values.push(inviteCode);
        await db.prepare(`UPDATE invitations SET ${updates.join(', ')} WHERE code = ?`).bind(...values).run();
        return json(200, { code: 200, message: '邀请码已更新' });
      }

      return json(400, { code: 400, message: '未知 action' });
    } catch (err) {
      console.error('Worker 错误:', err);
      return json(500, { code: 500, message: err.message || '服务内部错误' });
    }
  }
};
