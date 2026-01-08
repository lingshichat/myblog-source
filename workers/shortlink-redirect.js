/**
 * Cloudflare Worker: Shortlink + API Proxy
 * 集成了短链重定向和 API 代理功能
 */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // ============================================================
        // 🛡️ 1. API 代理功能 (新增)
        // ============================================================
        // 拦截 /_api/ 开头的请求转发到 Cloudflare API
        // 例如: https://worker.dev/_api/zones/xxx -> https://api.cloudflare.com/client/v4/zones/xxx
        if (url.pathname.startsWith('/_api/')) {
            // 处理 CORS 预检请求 (OPTIONS)
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Email, X-Auth-Key',
                        'Access-Control-Max-Age': '86400',
                    },
                });
            }

            // 重写目标 URL: 移除 /_api 前缀，保留其余部分
            const path = url.pathname.replace(/^\/_api/, '');
            const targetUrl = `https://api.cloudflare.com/client/v4${path}${url.search}`;

            // 构造新请求
            const newRequest = new Request(targetUrl, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: 'follow'
            });

            try {
                const response = await fetch(newRequest);
                const data = await response.text();

                // 返回带 CORS 头的响应
                return new Response(data, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                    }
                });
            } catch (err) {
                return new Response(JSON.stringify({
                    success: false,
                    errors: [{ message: 'Proxy Error: ' + err.message }]
                }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
        }

        // ============================================================
        // 🔗 2. 短链重定向功能 (保留原有逻辑)
        // ============================================================

        // 解析 Slug (例如: /go/abc -> abc, /abc -> abc)
        // 使用您原有的逻辑: split + pop
        const slug = url.pathname.split('/').filter(p => p).pop();

        if (!slug) {
            return new Response('Welcome to Shortlinks! Please providing a slug.', { status: 200 });
        }

        try {
            // ⚠️ 修正：使用截图中的 LINK_KV 变量名
            // 如果 env.LINK_KV 不存在，尝试降级到 env.SHORT_LINKS (以防万一)
            const store = env.LINK_KV || env.SHORT_LINKS;

            if (!store) {
                return new Response('Error: KV Namespace not bound. Please bind LINK_KV.', { status: 500 });
            }

            const targetUrl = await store.get(slug);

            if (targetUrl) {
                return Response.redirect(targetUrl, 302);
            }

            return new Response(`Link "/${slug}" not found.`, { status: 404 });
        } catch (err) {
            return new Response('Internal Error: ' + err.message, { status: 500 });
        }
    }
};
