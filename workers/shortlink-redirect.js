/**
 * 🔗 短链重定向 Worker (Shortlink Redirect)
 * 
 * 功能：监听主域名的路径请求，从 KV 读取目标 URL 并重定向
 * 使用场景：lingshichat.top/go → 目标 URL
 * 
 * 环境变量：
 * - SHORT_LINKS (KV Namespace Binding)
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // 1️⃣ 只处理特定路径前缀的请求（可选，根据需求调整）
        // 如果想让所有 /xxx 都能作为短链，注释掉这段
        // if (!url.pathname.startsWith('/s/') && !url.pathname.startsWith('/go/')) {
        //     return fetch(request); // 放行到源站
        // }

        // 2️⃣ 提取短链 key
        let key = url.pathname;

        // 支持 /s/ 前缀 (例如 /s/custom -> custom)
        if (key.startsWith('/s/')) {
            key = key.slice(3); // 移除 /s/
        } else {
            key = key.slice(1); // 移除开头的 / (兼容旧的直接访问方式)
        }

        // 移除可能存在的末尾斜杠
        if (key.endsWith('/')) {
            key = key.slice(0, -1);
        }

        if (!key) {
            // 根路径，返回到博客首页或自定义页面
            return Response.redirect('https://lingshichat.top', 302);
        }

        // 3️⃣ 从 KV 读取目标 URL
        try {
            const targetUrl = await env.SHORT_LINKS.get(key);

            if (!targetUrl) {
                // 短链不存在，返回 404 或重定向到首页
                return new Response('短链不存在 😢\n\n访问 https://lingshichat.top 返回首页', {
                    status: 404,
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-cache'
                    }
                });
            }

            // 4️⃣ 重定向到目标 URL
            return Response.redirect(targetUrl, 302);

        } catch (error) {
            console.error('KV Read Error:', error);
            return new Response('服务器错误: ' + error.message, {
                status: 500,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
    }
};
