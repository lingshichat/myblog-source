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

function json(code, data) {
  return new Response(JSON.stringify(data), {
    status: code >= 200 && code < 300 ? code : code === 401 ? 401 : code === 400 ? 400 : 500,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function verifyAdmin(authHeader, adminPassword) {
  if (!adminPassword) return true; // 未配置则开放
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === adminPassword;
}

// ============================================
// AWS Signature V4
// ============================================

const encoder = new TextEncoder();

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
      const action = url.searchParams.get('action') || 'sign';
      const authHeader = request.headers.get('Authorization');
      
      const config = {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKey: env.S3_ACCESS_KEY,
        secretKey: env.S3_SECRET_KEY,
        publicUrl: `https://${env.S3_BUCKET}.s3.bitiful.net`
      };
      
      // 公开接口
      if (action === 'list') {
        const prefix = url.searchParams.get('prefix') || 'img/gallery/';
        const images = await listImages(config, prefix);
        
        // 合并元数据
        const metadata = await getMetadata(config);
        const imagesWithMeta = images.map(img => ({
          ...img,
          ...(metadata[img.key] || {})
        }));
        
        return json(200, { code: 200, images: imagesWithMeta });
      }
      
      if (action === 'sign') {
        const key = url.searchParams.get('key');
        const contentType = url.searchParams.get('type') || 'image/jpeg';
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });
        
        const upload = await getUploadSignature(config, key, contentType);
        return json(200, { code: 200, ...upload });
      }
      
      if (action === 'signDelete') {
        if (!verifyAdmin(authHeader, env.ADMIN_PASSWORD)) {
          return json(401, { code: 401, message: '需要管理员权限' });
        }
        
        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });
        
        const del = await getDeleteSignature(config, key);
        return json(200, { code: 200, ...del });
      }
      
      // 管理接口
      if (action === 'getMeta') {
        const metadata = await getMetadata(config);
        const key = url.searchParams.get('key');
        
        if (key) {
          return json(200, { code: 200, metadata: metadata[key] || {} });
        }
        return json(200, { code: 200, metadata });
      }
      
      if (action === 'updateMeta') {
        if (!verifyAdmin(authHeader, env.ADMIN_PASSWORD)) {
          return json(401, { code: 401, message: '需要管理员权限' });
        }
        
        const body = await request.json();
        const { key, title, tags } = body;
        
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });
        
        const metadata = await getMetadata(config);
        
        if (!metadata[key]) {
          metadata[key] = {};
        }
        
        if (title !== undefined) metadata[key].title = title;
        if (tags !== undefined) metadata[key].tags = tags;
        metadata[key].updatedAt = new Date().toISOString();
        
        await saveMetadata(config, metadata);
        
        return json(200, { code: 200, message: '元数据已更新', metadata: metadata[key] });
      }
      
      if (action === 'deleteMeta') {
        if (!verifyAdmin(authHeader, env.ADMIN_PASSWORD)) {
          return json(401, { code: 401, message: '需要管理员权限' });
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
        if (!verifyAdmin(authHeader, env.ADMIN_PASSWORD)) {
          return json(401, { code: 401, message: '需要管理员权限' });
        }
        
        const body = await request.json();
        const { oldKey, newKey } = body;
        
        if (!oldKey || !newKey) {
          return json(400, { code: 400, message: '缺少 oldKey 或 newKey' });
        }
        
        // 获取原图片
        const getRes = await s3Get(config, oldKey);
        if (!getRes.ok) {
          return json(404, { code: 404, message: '图片不存在' });
        }
        
        const imageBody = await getRes.arrayBuffer();
        const contentType = getRes.headers.get('Content-Type') || 'image/jpeg';
        
        // 复制到新位置
        const putRes = await s3Put(config, newKey, imageBody, contentType);
        if (!putRes.ok) {
          return json(500, { code: 500, message: '复制图片失败' });
        }
        
        // 删除原图片
        await s3Delete(config, oldKey);
        
        // 更新元数据
        const metadata = await getMetadata(config);
        if (metadata[oldKey]) {
          metadata[newKey] = { ...metadata[oldKey] };
          delete metadata[oldKey];
          metadata[newKey].updatedAt = new Date().toISOString();
          await saveMetadata(config, metadata);
        }
        
        return json(200, { 
          code: 200, 
          message: '图片已移动',
          newUrl: `${config.publicUrl}/${newKey}`
        });
      }
      
      if (action === 'deleteImage') {
        if (!verifyAdmin(authHeader, env.ADMIN_PASSWORD)) {
          return json(401, { code: 401, message: '需要管理员权限' });
        }
        
        const key = url.searchParams.get('key');
        if (!key) return json(400, { code: 400, message: '缺少 key 参数' });
        
        // 删除图片
        const delRes = await s3Delete(config, key);
        if (!delRes.ok && delRes.status !== 204) {
          return json(500, { code: 500, message: '删除图片失败' });
        }
        
        // 删除元数据
        const metadata = await getMetadata(config);
        if (metadata[key]) {
          delete metadata[key];
          await saveMetadata(config, metadata);
        }
        
        return json(200, { code: 200, message: '图片已删除' });
      }
      
      return json(400, { code: 400, message: '未知 action' });
      
    } catch (err) {
      console.error('Worker 错误:', err);
      return json(500, { code: 500, message: err.message });
    }
  }
};
