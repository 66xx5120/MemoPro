// ==============================================================
// Memo Pro - Cloudflare Worker 稳定版（HTML 从 KV 读取）
// 前端页面由 KV 中的 index.html 提供，API 由 Worker 处理
// 必须提前将原版 index.html 存入 MEMO_KV，键名为 "index.html"
// ==============================================================

const DEFAULT_CONFIG = {
  adminPassword: "YWRtaW4xMjM=", // admin123
  timezone: 8,
  notification: {
    enabled: true,
    telegram: { botToken: "", chatId: "" },
    webhook: { url: "", method: "POST", headers: {}, template: "{{title}}\n{{content}}\n时间: {{time}}" },
    bark: { server: "https://api.day.app", deviceKey: "" }
  },
  allowNotificationHours: [8, 12, 18, 20],
  theme: "深空蓝",
  monthCount: 2,
  showLunar: true,
  reminderCheckInterval: 5,
  reminderAdvanceTime: 0,
  soundType: 'default',
  customSoundUrl: '',
  enableDesktopNotification: false
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      // API 请求
      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, url, corsHeaders);
      }

      // 其他请求：从 KV 读取 index.html 并返回
      const html = await env.MEMO_KV.get('index.html');
      if (!html) {
        return new Response('index.html not found in KV', { status: 404 });
      }
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkRemindersAndNotify(env));
  }
};

// ---------- API 处理 ----------
async function handleAPI(request, env, url, corsHeaders) {
  const path = url.pathname;
  const method = request.method;

  if (!path.includes('/api/login') && !await verifyAdmin(request, env)) {
    return new Response(JSON.stringify({ error: "未授权" }), { status: 401, headers: corsHeaders });
  }

  if (path === '/api/config' && method === 'GET') return Response.json(await getConfig(env));
  if (path === '/api/config' && method === 'POST') return Response.json(await updateConfig(request, env));
  if (path === '/api/login') return handleLogin(request, env);
  if (path === '/api/memos' && method === 'GET') return Response.json(await getMemos(env, url));
  if (path === '/api/memos' && method === 'POST') return Response.json(await createMemo(request, env));
  if (path.match(/^\/api\/memos\/[\w-]+$/) && method === 'GET') return Response.json(await getMemo(env, path));
  if (path.match(/^\/api\/memos\/[\w-]+$/) && method === 'PUT') return Response.json(await updateMemo(request, env, path));
  if (path.match(/^\/api\/memos\/[\w-]+$/) && method === 'DELETE') return Response.json(await deleteMemo(env, path));
  if (path === '/api/reminders/test') return Response.json(await testNotification(request, env));
  if (path === '/api/reminders/check') return Response.json(await checkRemindersAndNotify(env));

  return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
}

// ---------- KV 数据操作 ----------
async function getConfig(env) {
  const data = await env.MEMO_KV.get('config', 'json');
  return { ...DEFAULT_CONFIG, ...data };
}
async function updateConfig(request, env) {
  const newConfig = await request.json();
  const oldConfig = await getConfig(env);
  const config = { ...oldConfig, ...newConfig };
  await env.MEMO_KV.put('config', JSON.stringify(config));
  return { success: true, config };
}
async function verifyAdmin(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  const config = await getConfig(env);
  return token === config.adminPassword;
}
async function handleLogin(request, env) {
  const { password } = await request.json();
  const config = await getConfig(env);
  const isValid = btoa(password) === config.adminPassword;
  return Response.json({ success: isValid, token: isValid ? config.adminPassword : null });
}
async function getMemos(env, url) {
  const list = await env.MEMO_KV.get('memo_list', 'json') || [];
  const memos = [];
  for (const id of list) {
    const memo = await env.MEMO_KV.get(`memo:${id}`, 'json');
    if (memo) memos.push(memo);
  }
  memos.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { memos };
}
async function createMemo(request, env) {
  const data = await request.json();
  const id = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const memo = { id, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await env.MEMO_KV.put(`memo:${id}`, JSON.stringify(memo));
  const list = await env.MEMO_KV.get('memo_list', 'json') || [];
  list.push(id);
  await env.MEMO_KV.put('memo_list', JSON.stringify(list));
  return { success: true, memo };
}
async function updateMemo(request, env, path) {
  const id = path.split('/').pop();
  const updates = await request.json();
  const memo = await env.MEMO_KV.get(`memo:${id}`, 'json');
  if (!memo) throw new Error('Memo not found');
  const updated = { ...memo, ...updates, updatedAt: new Date().toISOString() };
  await env.MEMO_KV.put(`memo:${id}`, JSON.stringify(updated));
  return { success: true, memo: updated };
}
async function deleteMemo(env, path) {
  const id = path.split('/').pop();
  await env.MEMO_KV.delete(`memo:${id}`);
  const list = await env.MEMO_KV.get('memo_list', 'json') || [];
  const newList = list.filter(i => i !== id);
  await env.MEMO_KV.put('memo_list', JSON.stringify(newList));
  return { success: true };
}
async function getMemo(env, path) {
  const id = path.split('/').pop();
  const memo = await env.MEMO_KV.get(`memo:${id}`, 'json');
  if (!memo) throw new Error('Memo not found');
  return { memo };
}

// ---------- 提醒检查与通知 ----------
async function checkRemindersAndNotify(env) {
  const config = await getConfig(env);
  const now = new Date();
  const currentHour = now.getUTCHours() + config.timezone;
  if (!config.allowNotificationHours.includes(currentHour % 24)) {
    return { message: '不在通知时段', checked: 0, sent: 0 };
  }
  const list = await env.MEMO_KV.get('memo_list', 'json') || [];
  let sent = 0;
  const today = new Date().toDateString();
  for (const id of list) {
    const memo = await env.MEMO_KV.get(`memo:${id}`, 'json');
    if (!memo || !memo.dueTime || memo.completed) continue;
    const dueTime = new Date(memo.dueTime);
    const advanceTime = (memo.reminderAdvance || config.reminderAdvanceTime || 0) * 60 * 1000;
    const reminderTime = new Date(dueTime.getTime() - advanceTime);
    const reminderKey = `reminder_${memo.id}_${today}`;
    const sentToday = await env.MEMO_KV.get(reminderKey);
    if (now >= reminderTime && !sentToday) {
      await sendNotifications(memo, config);
      await env.MEMO_KV.put(reminderKey, 'true', { expirationTtl: 86400 });
      sent++;
    }
  }
  return { message: `已发送 ${sent} 条提醒`, checked: list.length, sent };
}
async function sendNotifications(memo, config) {
  if (!config.notification.enabled) return;
  const title = `📅 备忘录提醒: ${memo.title || '无标题'}`;
  const content = memo.content || '无内容';
  const time = new Date(memo.dueTime).toLocaleString('zh-CN', {
    timeZone: `Etc/GMT${config.timezone > 0 ? '-' + config.timezone : '+' + Math.abs(config.timezone)}`
  });
  if (config.notification.telegram.botToken && config.notification.telegram.chatId) {
    await fetch(`https://api.telegram.org/bot${config.notification.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.notification.telegram.chatId, text: `${title}\n\n${content}\n\n⏰ ${time}`, parse_mode: 'Markdown' })
    });
  }
  if (config.notification.bark.deviceKey) {
    await fetch(`${config.notification.bark.server || 'https://api.day.app'}/${config.notification.bark.deviceKey}/${encodeURIComponent(title)}/${encodeURIComponent(content)}?group=Memo`);
  }
  if (config.notification.webhook.url) {
    let body = config.notification.webhook.template
      .replace(/{{title}}/g, title)
      .replace(/{{content}}/g, content)
      .replace(/{{time}}/g, time);
    await fetch(config.notification.webhook.url, {
      method: config.notification.webhook.method || 'POST',
      headers: config.notification.webhook.headers || { 'Content-Type': 'application/json' },
      body
    });
  }
}
async function testNotification(request, env) {
  const { type } = await request.json();
  const config = await getConfig(env);
  const testMemo = { title: '测试通知', content: '这是一条来自 Memo Pro 的测试消息', dueTime: new Date().toISOString() };
  await sendNotifications(testMemo, config);
  return { success: true };
}
