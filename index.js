// ==============================================================
// Memo Pro - Cloudflare Worker 终极版
// 基于您提供的原版 index.html，仅修改数据层，界面完全复刻
// 内嵌资源均已改为 CDN 链接，避免语法冲突
// 部署前请填写下方的 ORIGINAL_CSS 和 ORIGINAL_BODY
// ==============================================================

// ---------- 1. 默认系统配置 ----------
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

// ---------- 2. Worker 主入口 ----------
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
      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, url, corsHeaders);
      }
      // 返回完整前端页面
      return new Response(await getFullHTML(env), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  },

  // 定时任务：检查到期提醒
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkRemindersAndNotify(env));
  }
};

// ---------- 3. API 处理（完全复制 SubsTracker 架构）----------
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

// ---------- 4. KV 数据操作 ----------
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

// ---------- 5. 提醒检查与通知发送 ----------
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
  // Telegram
  if (config.notification.telegram.botToken && config.notification.telegram.chatId) {
    await fetch(`https://api.telegram.org/bot${config.notification.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.notification.telegram.chatId,
        text: `${title}\n\n${content}\n\n⏰ ${time}`,
        parse_mode: 'Markdown'
      })
    });
  }
  // Bark
  if (config.notification.bark.deviceKey) {
    await fetch(`${config.notification.bark.server || 'https://api.day.app'}/${config.notification.bark.deviceKey}/${encodeURIComponent(title)}/${encodeURIComponent(content)}?group=Memo`);
  }
  // Webhook
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
  const testMemo = {
    title: '测试通知',
    content: '这是一条来自 Memo Pro 的测试消息',
    dueTime: new Date().toISOString()
  };
  await sendNotifications(testMemo, config);
  return { success: true };
}

// ---------- 6. 完整前端页面（您只需粘贴原 CSS 和 Body）----------
const ORIGINAL_CSS = `
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

:root {
    --primary-color: #4361ee;
    --secondary-color: #3a0ca3;
    --accent-color: #4cc9f0;
    --light-color: #f8f9fa;
    --dark-color: #212529;
    --success-color: #4CAF50;
    --warning-color: #ff9800;
    --danger-color: #f44336;
    --border-radius: 10px;
    --box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    --transition: all 0.3s ease;
}

body {
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    color: var(--dark-color);
    min-height: 100vh;
    padding: 20px;
}

.container {
    max-width: 1800px;
    margin: 0 auto;
}

/* 在 .container 样式后添加 */
.container.single-month {
    max-width: 85%;
    width: 85%;
    margin: 0 auto;
}

header {
    text-align: center;
    padding: 25px 0 30px;
    margin-bottom: 25px;
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    border-radius: var(--border-radius);
    box-shadow: var(--box-shadow);
    overflow: visible;
    position: relative;
    z-index: 1;
}

header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(45deg, 
        rgba(255,255,255,0.1) 0%, 
        rgba(255,255,255,0.2) 25%, 
        transparent 50%, 
        rgba(0,0,0,0.1) 100%);
    pointer-events: none;
}

h1 {
    font-size: 2.5rem;
    color: white;
    margin-bottom: 10px;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    position: relative;
    z-index: 2;
    letter-spacing: 0.5px;
}

.subtitle {
    font-size: 1.1rem;
    color: rgba(255, 255, 255, 0.9);
    max-width: 800px;
    margin: 0 auto;
    line-height: 1.6;
    position: relative;
    z-index: 2;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 工具栏 */
.toolbar {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 25px;
    padding: 15px 20px;
    background: white;
    border-radius: var(--border-radius);
    box-shadow: var(--box-shadow);
    flex-wrap: wrap;
    position: relative;
    overflow: hidden;
}

.toolbar::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    <!-- background: linear-gradient(90deg, var(--primary-color), var(--secondary-color)); -->
}

.search-container {
    flex: 1;
    min-width: 200px;
    position: relative;
}

.search-input {
    width: 100%;
    padding: 10px 40px 10px 40px;
    border: 2px solid #e9ecef;
    border-radius: 6px;
    font-size: 0.95rem;
    transition: var(--transition);
    background-color: #f8f9fa;
}

.search-input:focus {
    outline: none;
    border-color: var(--primary-color);
    background-color: white;
    box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.1);
}

.search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: #6c757d;
    font-size: 1rem;
}

/* 清除搜索按钮 */
.clear-search {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #6c757d;
    cursor: pointer;
    font-size: 1rem;
    padding: 4px;
    border-radius: 50%;
    display: none;
    transition: var(--transition);
}

.clear-search:hover {
    background-color: rgba(0, 0, 0, 0.05);
    color: var(--danger-color);
}

.toolbar-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.toolbar-btn {
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: var(--transition);
    font-size: 0.9rem;
    white-space: nowrap;
}

.toolbar-btn-primary {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
}

.toolbar-btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(67, 97, 238, 0.3);
}

.toolbar-btn-secondary {
    background: #6c757d;
    color: white;
}

.toolbar-btn-secondary:hover {
    background: #5a6268;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
}

.toolbar-btn-success {
    background: var(--success-color);
    color: white;
}

.toolbar-btn-success:hover {
    background: #388e3c;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

/* 主题选择器样式 */
.theme-selector-container {
    position: absolute;
    top: 25px;
    right: 25px;
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 1000;
}

.theme-selector-btn {
    width: 45px;
    height: 45px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(10px);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    transition: var(--transition);
    margin-bottom: 10px;
    z-index: 1001;
}

.theme-selector-btn:hover {
    transform: translateY(-3px) scale(1.1);
    background: rgba(255, 255, 255, 0.3);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.theme-selector {
    display: none;
    flex-direction: column;
    gap: 8px;
    padding: 15px;
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(10px);
    border-radius: var(--border-radius);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 200px;
    max-height: 400px;
    overflow-y: auto;
    margin-top: 5px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 1002;
}

.theme-selector.active {
    display: flex;
}

.theme-color {
    width: 100%;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    transition: var(--transition);
    display: flex;
    align-items: center;
    padding: 0 12px;
    color: white !important;
    font-weight: 600;
    font-size: 0.9rem;
    margin: 2px 0;
    min-width: 150px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.theme-color:hover {
    transform: translateX(3px);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.1);
}

.theme-color.active {
    border: 2px solid white;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
}

/* 日历导航 */
.calendar-navigation {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 20px;
    margin-bottom: 30px;
    background: white;
    padding: 15px;
    border-radius: var(--border-radius);
    box-shadow: var(--box-shadow);
    position: relative;
    overflow: hidden;
}

.calendar-navigation::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
}

.nav-button {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
    border: none;
    width: 45px;
    height: 45px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 1.2rem;
    transition: var(--transition);
    box-shadow: 0 4px 10px rgba(67, 97, 238, 0.3);
    position: relative;
    overflow: hidden;
}

.nav-button::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.2), transparent);
    opacity: 0;
    transition: var(--transition);
}

.nav-button:hover {
    transform: translateY(-3px);
    box-shadow: 0 6px 20px rgba(67, 97, 238, 0.4);
}

.nav-button:hover::after {
    opacity: 1;
}

.current-period {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--primary-color);
    min-width: 280px;
    text-align: center;
    padding: 8px 20px;
    background: rgba(67, 97, 238, 0.05);
    border-radius: 8px;
    border: 2px solid rgba(67, 97, 238, 0.1);
    transition: var(--transition);
    position: relative;
}

.current-period:hover {
    background: rgba(67, 97, 238, 0.1);
    border-color: rgba(67, 97, 238, 0.2);
}

/* 月份数量选择器 */
.month-count-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(67, 97, 238, 0.08);
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid rgba(67, 97, 238, 0.15);
}

.month-count-selector label {
    font-size: 0.9rem;
    color: var(--primary-color);
    font-weight: 600;
    white-space: nowrap;
}

.month-count-selector select {
    background: white;
    border: 1px solid rgba(67, 97, 238, 0.3);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.9rem;
    color: var(--dark-color);
    cursor: pointer;
    transition: var(--transition);
}

.month-count-selector select:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(67, 97, 238, 0.1);
}

/* 多个月份日历容器 */
.multi-month-calendar {
    display: grid;
    gap: 25px;
    margin-bottom: 25px;
    position: relative;
    width: 100%;
    min-height: 600px;
    /* 每行最多显示2个月份 */
    grid-template-columns: repeat(auto-fill, minmax(calc(50% - 12.5px), 1fr));
}

/* 根据月份数量动态调整网格列数 */
.multi-month-calendar.grid-1 {
    grid-template-columns: 1fr;
    max-width: 100%; /* 新增：最大宽度为90% */
    margin: 0 auto; /* 新增：水平居中 */
    width: 100%; /* 新增：宽度为90% */
    
    white-space: normal; /* 允许换行 */
    height: auto; /* 自动高度 */
    min-height: 18px; /* 最小高度 */
    max-height: 54px; /* 最大3行 */
    <!-- overflow: hidden; -->
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3; /* 最多显示3行 */
    -webkit-box-orient: vertical;
    line-height: 1.3;
    padding: 3px 6px;
    font-size: 0.8rem;
}

.multi-month-calendar.grid-2 {
    grid-template-columns: repeat(2, 1fr);
}

/* 当只显示一个月时，隐藏日历导航按钮 */
.multi-month-calendar.grid-1 ~ .calendar-nav-btn {
    <!-- display: none; -->
}

/* 单个月历样式 - 调整为90%宽度 */
.multi-month-calendar.grid-1 .month-calendar {
    width: 100%; /* 确保月份日历填满90%的容器 */
    max-width: 100%;
    min-width: 0; /* 移除最小宽度限制 */
    resize: none; /* 移除可调整大小功能 */
}

.calendar-container {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
}

.calendar-nav-btn {
    position: absolute;
    top: 20%;
    transform: translateY(-50%);
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
    border: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 1.1rem;
    transition: var(--transition);
    box-shadow: 0 4px 10px rgba(67, 97, 238, 0.3);
    z-index: 5;
    opacity: 0.8;
}

.calendar-nav-btn:hover {
    opacity: 1;
    transform: translateY(-50%) scale(1.1);
}

.calendar-nav-btn.prev-month {
    left: -15px;
}

.calendar-nav-btn.next-month {
    right: -15px;
}

@media (max-width: 1400px) {
    .month-calendar {
        resize: none;
    }
    
    .multi-month-calendar {
        grid-template-columns: repeat(2, 1fr) !important;
    }
}

@media (max-width: 1200px) {
    .multi-month-calendar {
        grid-template-columns: repeat(2, 1fr) !important;
    }
    
    .calendar-nav-btn {
        display: none;
    }
}

@media (max-width: 768px) {
    .container.single-month {
        max-width: 100%;
        width: 100%;
    }
    
    h1 {
        font-size: 2rem;
        padding: 0 15px;
    }
    
    .subtitle {
        font-size: 1rem;
        padding: 0 15px;
    }
    
    .toolbar {
        flex-direction: column;
        align-items: stretch;
    }
    
    .search-container {
        width: 100%;
    }
    
    .toolbar-buttons {
        width: 100%;
        justify-content: stretch;
    }
    
    .toolbar-btn {
        flex: 1;
        min-width: auto;
    }
    
    .calendar-navigation {
        flex-direction: column;
        gap: 15px;
        padding: 15px 10px;
    }
    
    .current-period {
        min-width: auto;
        width: 100%;
        font-size: 1.1rem;
        order: 1;
    }
    
    .month-count-selector {
        order: 2;
        width: 100%;
        justify-content: center;
    }
    
    .nav-button {
        order: 3;
        width: 40px;
        height: 40px;
    }
    
    .multi-month-calendar {
        grid-template-columns: 1fr !important;
        gap: 20px;
    }
    
    .multi-month-calendar.grid-1 {
        grid-template-columns: 1fr !important;
        max-width: 100%; /* 在移动设备上恢复100%宽度 */
        width: 100%;
    }
    
    .calendar-nav-btn {
        display: none;
    }
}

/* 单个月日历样式 */
.month-calendar {
    background-color: white;
    border-radius: var(--border-radius);
    padding: 20px;
    box-shadow: var(--box-shadow);
    position: relative;
    min-height: 700px;
    width: 100%;
    overflow: hidden;
    resize: horizontal;
    overflow-x: auto;
    min-width: 400px;
    max-width: 100%;
}

/* 小尺寸月份样式 */
.month-calendar.small {
    min-height: 500px;
    padding: 15px;
}

.month-calendar.small .month-header {
    margin-bottom: 15px;
}

.month-calendar.small .month-title {
    font-size: 1.2rem;
}

.month-calendar.small .calendar-grid {
    gap: 3px;
}

.month-calendar.small .calendar-day {
    min-height: 100px;
    padding: 5px;
}

.month-calendar.small .day-number {
    font-size: 0.9rem;
    margin-bottom: 4px;
}

.month-calendar.small .day-memo-item {
    padding: 2px 4px;
    font-size: 0.7rem;
    height: 16px;
}

.month-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 15px;
}

.month-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--primary-color);
    display: flex;
    align-items: center;
    gap: 10px;
}

.month-right-area {
    display: flex;
    align-items: center;
    gap: 15px;
    flex-wrap: wrap;
}

/* 任务统计信息 */
.month-stats {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(67, 97, 238, 0.05);
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(67, 97, 238, 0.1);
    font-size: 0.85rem;
    color: #495057;
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.stat-item.total {
    color: var(--primary-color);
    font-weight: 600;
}

.stat-item.completed {
    color: var(--success-color);
}

.stat-item.pending {
    color: var(--danger-color);
}

.complete-all-btn {
    background: linear-gradient(135deg, var(--success-color), #2e7d32);
    color: white;
    border: none;
    padding: 8px 15px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: var(--transition);
    box-shadow: 0 3px 8px rgba(76, 175, 80, 0.3);
    white-space: nowrap;
}

.complete-all-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(76, 175, 80, 0.4);
}

.month-progress {
    display: flex;
    align-items: center;
    gap: 10px;
}

.progress-circle {
    position: relative;
    width: 40px;
    height: 40px;
}

.progress-circle svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
}

.progress-circle-bg {
    fill: none;
    stroke: #e9ecef;
    stroke-width: 4;
}

.progress-circle-fill {
    fill: none;
    stroke: var(--primary-color);
    stroke-width: 4;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.8s ease;
}

.progress-percent {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--primary-color);
}

.weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    text-align: center;
    font-weight: 600;
    color: #495057;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e9ecef;
    font-size: 0.9rem;
}

.calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
    width: 100%;
    min-width: 0;
}

/* 日历单元格 - 添加虚线边框 */
.calendar-day {
    aspect-ratio: 1;
    background-color: #f8f9fa;
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    transition: var(--transition);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 140px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    /* 新增虚线边框 */
    border: 1px dashed rgba(0, 0, 0, 0.15);
}

/* 当月份数量为1时，日历单元格更高 */
.multi-month-calendar.grid-1 .calendar-day {
    min-height: 160px;
}

@media (max-width: 1200px) {
    .calendar-day {
        min-height: 120px;
    }
}

@media (max-width: 768px) {
    .calendar-day {
        min-height: 100px;
        padding: 6px;
    }
}

.calendar-day:hover {
    background-color: #e9ecef;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    z-index: 2;
    /* 鼠标悬停时边框变实线 */
    border: 1px solid rgba(67, 97, 238, 0.3);
}

.calendar-day.today {
    background-color: rgba(67, 97, 238, 0.15);
    border: 2px solid var(--primary-color);
    /* 今日单元格使用实线边框 */
    border-style: solid;
}

.calendar-day.other-month {
    opacity: 0.5;
    background-color: #f0f2f5;
    border: 1px dashed rgba(0, 0, 0, 0.1);
}

.day-number {
    font-size: 1rem;
    font-weight: 700;
    color: var(--dark-color);
    margin-bottom: 6px;
    align-self: flex-start;
    position: relative;
    z-index: 2;
}

.day-memos {
    flex-grow: 1;
    overflow-y: auto;
    font-size: 0.75rem;
    line-height: 1.3;
    max-height: calc(100% - 25px);
    min-height: 90px;
    width: 100%;
    will-change: transform;
    backface-visibility: hidden;
    transform: translateZ(0);
}

.day-memo-item {
    padding: 4px 6px;
    margin-bottom: 3px;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: var(--transition);
    background-color: rgba(255, 255, 255, 0.7);
    border-left: 3px solid;
    font-size: 0.75rem;
    height: 18px;
    width: 100%;
    box-sizing: border-box;
}

/* 当月份数量为1时，显示更长的备忘录标题 */
.multi-month-calendar.grid-1 .day-memo-item {
    white-space: normal; /* 允许换行 */
    height: auto; /* 自动高度 */
    min-height: 18px; /* 最小高度 */
    max-height: 54px; /* 最大3行 */
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3; /* 最多显示3行 */
    -webkit-box-orient: vertical;
    line-height: 1.3;
    padding: 3px 6px;
    font-size: 0.8rem;
}

.day-memo-item:hover {
    border: 2px solid var(--primary-color);
    box-shadow: 0 1px 1px var(--shadow-color);
}

.day-memo-item.completed {
    opacity: 0.6;
    text-decoration: line-through;
}

.memo-count {
    position: absolute;
    top: 8px;
    right: 8px;
    background-color: var(--danger-color);
    color: white;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    font-weight: bold;
    z-index: 3;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* 到期提醒弹窗样式 */
.reminder-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    z-index: 2000;
    align-items: center;
    justify-content: center;
    padding: 15px;
}

.reminder-modal.active {
    display: flex;
}

.reminder-content {
    background-color: white;
    width: 100%;
    max-width: 500px;
    border-radius: var(--border-radius);
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
}

@keyframes slideIn {
    from {
        transform: translateY(-50px);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

.reminder-header {
    padding: 20px;
    background: linear-gradient(90deg, var(--danger-color), #d32f2f);
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.reminder-title {
    font-size: 1.3rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
}

.close-reminder {
    background: none;
    border: none;
    color: white;
    font-size: 1.6rem;
    cursor: pointer;
    transition: var(--transition);
}

.close-reminder:hover {
    transform: rotate(90deg);
}

.reminder-body {
    padding: 20px;
    max-height: 400px;
    overflow-y: auto;
}

.reminder-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.reminder-item {
    padding: 15px;
    background-color: #fff8e1;
    border-radius: 8px;
    border-left: 4px solid var(--warning-color);
    transition: var(--transition);
}

.reminder-item:hover {
    background-color: #fff3cd;
    cursor: pointer;
}

.reminder-item-title {
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 5px;
    color: var(--dark-color);
}

.reminder-item-details {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    color: #6c757d;
}

.reminder-actions {
    padding: 15px 20px;
    background-color: #f8f9fa;
    border-top: 2px solid #e9ecef;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.reminder-settings {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
}

/* 右侧浮动按钮样式 */
.floating-actions {
    position: fixed;
    right: 25px;
    bottom: 25px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 999;
}

.floating-btn {
    width: 55px;
    height: 55px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    transition: var(--transition);
    position: relative;
}

.floating-btn:hover {
    transform: translateY(-5px) scale(1.1);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.floating-btn .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background-color: var(--danger-color);
    color: white;
    font-size: 0.65rem;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
}

/* 铃铛按钮的脉动动画效果 */
.floating-btn.reminder-pulse {
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0% {
        box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.7);
    }
    70% {
        box-shadow: 0 0 0 10px rgba(244, 67, 54, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(244, 67, 54, 0);
    }
}

/* 更新徽章样式 */
#reminderBadge {
    background-color: #ff4757;
}

/* 模态窗口等其余样式保持不变 */
.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 15px;
}

.modal.active {
    display: flex;
}

.modal-content {
    background-color: white;
    width: 100%;
    max-width: 800px;
    max-height: 85vh;
    border-radius: var(--border-radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
    padding: 20px;
    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-title {
    font-size: 1.3rem;
    font-weight: 600;
}

.close-modal {
    background: none;
    border: none;
    color: white;
    font-size: 1.6rem;
    cursor: pointer;
    transition: var(--transition);
}

.close-modal:hover {
    transform: rotate(90deg);
}

.modal-body {
    padding: 20px;
    overflow-y: auto;
    flex-grow: 1;
}

/* 选项卡 */
.tabs {
    display: flex;
    border-bottom: 2px solid #e9ecef;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.tab {
    padding: 12px 18px;
    background: none;
    border: none;
    font-size: 1rem;
    font-weight: 600;
    color: #6c757d;
    cursor: pointer;
    transition: var(--transition);
    position: relative;
}

.tab:hover {
    color: var(--primary-color);
}

.tab.active {
    color: var(--primary-color);
}

.tab.active::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 100%;
    height: 2px;
    background-color: var(--primary-color);
}

.tab-content {
    display: none;
}

.tab-content.active {
    display: block;
}

/* 任务列表 */
.task-list {
    max-height: 300px;
    overflow-y: auto;
    padding-right: 10px;
}

.task-item {
    padding: 12px;
    background-color: #f8f9fa;
    border-radius: 8px;
    margin-bottom: 12px;
    border-left: 4px solid var(--primary-color);
    transition: var(--transition);
}

.task-item:hover {
    background-color: #e9ecef;
}

.task-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.task-title {
    font-weight: 600;
    font-size: 1rem;
}

.task-color {
    width: 18px;
    height: 18px;
    border-radius: 50%;
}

.task-due {
    font-size: 0.85rem;
    color: #6c757d;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 5px;
}

.task-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}

.task-btn {
    padding: 4px 8px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    transition: var(--transition);
}

.task-btn-complete {
    background-color: rgba(76, 175, 80, 0.1);
    color: var(--success-color);
}

.task-btn-complete:hover {
    background-color: var(--success-color);
    color: white;
}

.task-btn-edit {
    background-color: rgba(67, 97, 238, 0.1);
    color: var(--primary-color);
}

.task-btn-edit:hover {
    background-color: var(--primary-color);
    color: white;
}

.task-btn-delete {
    background-color: rgba(244, 67, 54, 0.1);
    color: var(--danger-color);
}

.task-btn-delete:hover {
    background-color: var(--danger-color);
    color: white;
}

/* 表单样式 */
.form-group {
    margin-bottom: 18px;
}

.form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
}

label {
    display: block;
    margin-bottom: 6px;
    font-weight: 600;
    color: #495057;
    font-size: 0.95rem;
}

.form-control {
    width: 100%;
    padding: 10px;
    border: 2px solid #e9ecef;
    border-radius: 6px;
    font-size: 0.95rem;
    transition: var(--transition);
}

.form-control:focus {
    outline: none;
    border-color: var(--primary-color);
}

textarea.form-control {
    min-height: 100px;
    resize: vertical;
    font-family: 'Courier New', monospace;
}

.color-options {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.color-option {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid transparent;
    transition: var(--transition);
}

.color-option:hover {
    transform: scale(1.1);
}

.color-option.selected {
    border-color: var(--dark-color);
    transform: scale(1.1);
}

.markdown-preview {
    padding: 12px;
    border-radius: 6px;
    background-color: #f8f9fa;
    border: 2px solid #e9ecef;
    min-height: 120px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 0.9rem;
}

.markdown-preview h1, 
.markdown-preview h2, 
.markdown-preview h3 {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
}

.markdown-preview ul, 
.markdown-preview ol {
    padding-left: 1.5em;
}

.markdown-preview code {
    background-color: #e9ecef;
    padding: 2px 5px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
}

.markdown-preview pre {
    background-color: #2d2d2d;
    color: #f8f8f2;
    padding: 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
}

.modal-footer {
    padding: 15px 20px;
    background-color: #f8f9fa;
    border-top: 2px solid #e9ecef;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

/* 操作按钮 */
.btn {
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: var(--transition);
    font-size: 0.9rem;
}

.btn-primary {
    background-color: var(--primary-color);
    color: white;
}

.btn-primary:hover {
    background-color: var(--secondary-color);
    transform: translateY(-2px);
}

.btn-secondary {
    background-color: #6c757d;
    color: white;
}

.btn-secondary:hover {
    background-color: #5a6268;
    transform: translateY(-2px);
}

.btn-danger {
    background-color: var(--danger-color);
    color: white;
}

.btn-danger:hover {
    background-color: #d32f2f;
    transform: translateY(-2px);
}

.btn-success {
    background-color: var(--success-color);
    color: white;
}

.btn-success:hover {
    background-color: #388e3c;
    transform: translateY(-2px);
}

.btn-full {
    width: 100%;
}

/* 空状态 */
.empty-state {
    text-align: center;
    padding: 20px 15px;
    color: #6c757d;
}

.empty-state i {
    font-size: 2rem;
    margin-bottom: 10px;
    color: #dee2e6;
}

/* 倒计时 */
.countdown {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 600;
    margin-left: 5px;
}

.countdown.danger {
    background-color: rgba(244, 67, 54, 0.2);
    color: var(--danger-color);
}

.countdown.warning {
    background-color: rgba(255, 152, 0, 0.2);
    color: var(--warning-color);
}

.countdown.success {
    background-color: rgba(76, 175, 80, 0.2);
    color: var(--success-color);
}

/* 滚动条样式 */
::-webkit-scrollbar {
    width: 5px;
}

::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
}

::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
}

/* 导入文件输入 */
#importFileInput {
    display: none;
}

/* 数据管理按钮组 */
.data-management-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 15px;
}

/* 响应式调整 */
@media (max-width: 768px) {
    h1 {
        font-size: 1.8rem;
    }
    
    .month-calendar {
        padding: 15px;
        min-height: 600px;
        resize: none;
        min-width: 100%;
    }
    
    .form-row {
        grid-template-columns: 1fr;
    }
    
    .modal-content {
        max-height: 90vh;
    }
    
    .floating-actions {
        right: 15px;
        bottom: 15px;
    }
    
    .floating-btn {
        width: 48px;
        height: 48px;
        font-size: 1.1rem;
    }
    
    .tabs {
        justify-content: center;
    }
    
    .tab {
        padding: 10px 12px;
        font-size: 0.9rem;
    }
    
    .data-management-buttons {
        grid-template-columns: 1fr;
    }
    
    .theme-selector-container {
        top: 15px;
        right: 15px;
    }
    
    .theme-selector-btn {
        width: 40px;
        height: 40px;
        font-size: 1rem;
    }
}

/* 任务发布说明 */
.task-publish-info {
    margin-top: 20px;
    padding: 15px;
    background-color: #f8f9fa;
    border-radius: 8px;
    font-size: 0.9rem;
}

/* 导出设置说明 */
.export-info {
    margin-top: 20px;
    padding: 15px;
    background-color: #f8f9fa;
    border-radius: 8px;
    font-size: 0.9rem;
}

/* 日历日期的备忘录列表滚动容器 */
.day-memos::-webkit-scrollbar {
    width: 3px;
}

.day-memos::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 3px;
}

.day-memos::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}

/* 日历日期的备忘录颜色标记 */
.memo-color-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
}

/* 导出设置按钮布局 */
.export-buttons-container {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 20px;
    margin-bottom: 20px;
}

.export-buttons-container .btn {
    flex: 1;
    min-width: 120px;
}

.toast {
    position: fixed;
    top: 30px;
    right: 30px;
    padding: 18px 25px;
    <!-- background: var(--card-bg); -->
    background: #333333;
    color: var(--text-primary);
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    transform: translateX(150%);
    transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    border-left: 5px solid var(--primary-color);
    backdrop-filter: blur(10px);
    max-width: 350px;
}

.toast.show {
    transform: translateX(0);
}

.toast-content {
    display: flex;
    color: white;
    align-items: center;
    gap: 15px;
}

.toast-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--primary-gradient);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 18px;
}
`;

const ORIGINAL_BODY = `
<div class="container">
    <header>
        <h1>📅 智能网页工作日历备忘录</h1>
        <p class="subtitle">同时查看多个月份日历，每天显示备忘录标题列表，支持快速操作和智能任务管理</p>
        
        <div class="theme-selector-container">
            <button class="theme-selector-btn" id="themeSelectorBtn" title="切换配色方案">
                <i class="fas fa-palette"></i>
            </button>
            <div class="theme-selector" id="themeSelector">
                <!-- 15种渐变色将通过JS生成 -->
            </div>
        </div>
    </header>

    <!-- 工具栏 -->
    <div class="toolbar">
        <div class="search-container">
            <i class="fas fa-search search-icon"></i>
            <input type="text" class="search-input" id="searchInput" placeholder="搜索备忘录...">
            <button class="clear-search" id="clearSearch" title="清除搜索">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <!-- 月份数量选择器 -->
        <div class="month-count-selector">
            <label for="monthCountSelect">显示月份：</label>
            <select id="monthCountSelect">
                <option value="1">1个月</option>
                <option value="2" selected>2个月</option>
                <option value="3">3个月</option>
                <option value="4">4个月</option>
                <option value="5">5个月</option>
                <option value="6">6个月</option>
                <option value="7">7个月</option>
                <option value="8">8个月</option>
                <option value="9">9个月</option>
                <option value="10">10个月</option>
                <option value="11">11个月</option>
                <option value="12">12个月</option>
            </select>
        </div>
        <div class="toolbar-buttons">
            <button class="toolbar-btn toolbar-btn-primary" id="toolbarPublish">
                <i class="fas fa-bullhorn"></i> 任务发布
            </button>
            <button class="toolbar-btn toolbar-btn-success" id="toolbarExport">
                <i class="fas fa-file-export"></i> 数据导出
            </button>
            <button class="toolbar-btn toolbar-btn-secondary" id="toolbarExportExcel">
                <i class="fas fa-file-export"></i> 导出Excel
            </button>
            <button class="toolbar-btn toolbar-btn-secondary" id="toolbarImport">
                <i class="fas fa-file-import"></i> 数据导入
            </button>
        </div>
    </div>

    <!-- 日历导航区域 -->
    <div class="calendar-navigation" style="display:none;">
        <button class="nav-button" id="prevMonth">
            <i class="fas fa-chevron-left"></i>
        </button>
        
        <div class="current-period" id="currentPeriod">2023年10月 - 2023年11月</div>
        
        <button class="nav-button" id="nextMonth">
            <i class="fas fa-chevron-right"></i>
        </button>
    </div>

    <!-- 多个月份日历容器 -->
    <div class="calendar-container">
        <button class="calendar-nav-btn prev-month" id="calendarPrevMonth" title="前一个月">
            <i class="fas fa-chevron-left"></i>
        </button>
        
        <div class="multi-month-calendar grid-2" id="multiMonthCalendar">
            <!-- 多个月份日历将通过JS动态生成 -->
        </div>
        
        <button class="calendar-nav-btn next-month" id="calendarNextMonth" title="后一个月">
            <i class="fas fa-chevron-right"></i>
        </button>
    </div>
</div>

<!-- 右侧浮动按钮 - 修改后的版本 -->
<div class="floating-actions">
    <button class="floating-btn" id="floatingReminder" title="到期提醒">
        <i class="fas fa-bell"></i>
        <span class="badge" id="reminderBadge" style="display: none;">0</span>
    </button>
    <button class="floating-btn" id="floatingFunctions" title="功能面板">
        <i class="fas fa-cog"></i>
        <span class="badge" id="pendingBadge">0</span>
    </button>
</div>

<!-- 到期提醒弹窗 -->
<div class="reminder-modal" id="reminderModal">
    <div class="reminder-content">
        <div class="reminder-header">
            <div class="reminder-title">
                <i class="fas fa-bell"></i> 到期提醒
            </div>
            <button class="close-reminder" id="closeReminderModal">&times;</button>
        </div>
        <div class="reminder-body">
            <div id="reminderList">
                <!-- 到期提醒内容将通过JS动态添加 -->
                <div class="empty-state">
                    <i class="fas fa-bell-slash"></i>
                    <p>暂无到期提醒</p>
                </div>
            </div>
        </div>
        <div class="reminder-actions">
            <div class="reminder-settings">
                <input type="checkbox" id="autoCloseReminder" >
                <label for="autoCloseReminder">10秒后自动关闭</label>
            </div>
            <div class="export-buttons-container">
                <button class="btn btn-primary" id="markAllAsRead">
                    <i class="fas fa-check-double"></i> 全部标记已读
                </button>
                <button class="btn btn-secondary" id="viewRecentTasks">
                    <i class="fas fa-tasks"></i> 查看最近任务
                </button>
            </div>
        </div>
    </div>
</div>

<!-- 备忘录编辑模态窗口 -->
<div class="modal" id="memoModal">
    <div class="modal-content">
        <div class="modal-header">
            <div class="modal-title">备忘录编辑</div>
            <button class="close-modal" id="closeMemoModal">&times;</button>
        </div>
        <div class="modal-body">
            <form id="memoForm">
                <div class="form-group">
                    <label for="memoTitle">标题</label>
                    <input type="text" class="form-control" id="memoTitle" required>
                </div>
                
                <div class="form-group">
                    <label for="memoDate">日期</label>
                    <input type="date" class="form-control" id="memoDate" required>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="memoDueTime">截止时间</label>
                        <input type="datetime-local" class="form-control" id="memoDueTime">
                    </div>
                    <div class="form-group">
                        <label>备忘录颜色</label>
                        <div class="color-options" id="colorOptions">
                            <!-- 颜色选项将通过JS生成 -->
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="memoContent">内容 (支持Markdown语法)</label>
                    <textarea class="form-control" id="memoContent" rows="5" placeholder="输入备忘录内容，支持Markdown语法..."></textarea>
                </div>
                
                <div class="form-group">
                    <label>预览</label>
                    <div class="markdown-preview" id="markdownPreview">
                        预览将在这里显示...
                    </div>
                </div>
                
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="memoCompleted"> 标记为已完成
                    </label>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="cancelMemo">取消</button>
            <button class="btn btn-danger" id="deleteMemo">删除</button>
            <button class="btn btn-primary" id="saveMemo">保存备忘录</button>
        </div>
    </div>
</div>

<!-- 功能面板模态窗口 -->
<div class="modal" id="functionsModal">
    <div class="modal-content">
        <div class="modal-header">
            <div class="modal-title">功能面板</div>
            <button class="close-modal" id="closeFunctionsModal">&times;</button>
        </div>
        <div class="modal-body">
            <div class="tabs">
                <button class="tab active" data-tab="taskPublish">任务发布</button>
                <button class="tab" data-tab="recentTasks">最近任务</button>
                <button class="tab" data-tab="dataManagement">数据管理</button>
                <button class="tab" data-tab="exportSettings">定时导出</button>
                <button class="tab" data-tab="reminderSettings">提醒设置</button>
            </div>
            
            <!-- 任务发布选项卡 -->
            <div class="tab-content active" id="taskPublishTab">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-bullhorn"></i> 发布新任务</h3>
                <div class="form-group">
                    <label for="taskTitle">任务标题</label>
                    <input type="text" class="form-control" id="taskTitle" placeholder="请输入任务标题">
                </div>
                
                <div class="form-group">
                    <label for="taskDescription">任务描述（支持Markdown）</label>
                    <textarea class="form-control" id="taskDescription" placeholder="请输入任务描述..." rows="4"></textarea>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="taskStartDate">开始日期</label>
                        <input type="date" class="form-control" id="taskStartDate">
                    </div>
                    <div class="form-group">
                        <label for="taskEndDate">结束日期</label>
                        <input type="date" class="form-control" id="taskEndDate">
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="taskColor">任务颜色</label>
                    <div class="color-options" id="taskColorOptions">
                        <!-- 颜色选项将通过JS生成 -->
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="taskDueTime">每日截止时间</label>
                    <input type="time" class="form-control" id="taskDueTime" value="18:00">
                </div>
                
                <button class="btn btn-success btn-full" id="publishTask">
                    <i class="fas fa-paper-plane"></i> 发布并分配到每天
                </button>
                
                <div class="task-publish-info">
                    <h4><i class="fas fa-info-circle"></i> 功能说明</h4>
                    <p style="margin-top: 8px; line-height: 1.5;">
                        此功能将创建一个新任务，并自动分配到从开始日期到结束日期之间的每一天。
                        每天都会创建一个独立的备忘录，便于跟踪每日进度。
                    </p>
                </div>
            </div>
            
            <!-- 最近任务选项卡 -->
            <div class="tab-content" id="recentTasksTab">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-tasks"></i> 最近任务</h3>
                <div class="task-list" id="recentTasksList">
                    <!-- 任务将通过JS动态添加 -->
                    <div class="empty-state">
                        <i class="fas fa-clipboard-list"></i>
                        <p>暂无任务，点击日历上的日期添加新任务</p>
                    </div>
                </div>
            </div>
            
            <!-- 数据管理选项卡 -->
            <div class="tab-content" id="dataManagementTab">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-database"></i> 数据管理</h3>
                <p style="margin-bottom: 15px; color: #6c757d; line-height: 1.5;">
                    所有数据存储在您的浏览器本地，建议定期导出备份以防数据丢失。
                </p>
                
                <div class="data-management-buttons">
                    <button class="btn btn-primary" id="exportData">
                        <i class="fas fa-file-export"></i> 导出数据
                    </button>
                    <button class="btn btn-secondary" id="importData">
                        <i class="fas fa-file-import"></i> 导入数据
                    </button>
                    <button class="btn btn-danger" id="clearData">
                        <i class="fas fa-trash-alt"></i> 清空所有数据
                    </button>
                    <button class="btn btn-secondary" id="viewStats">
                        <i class="fas fa-chart-pie"></i> 查看统计
                    </button>
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px;">
                    <h4><i class="fas fa-info-circle"></i> 统计信息</h4>
                    <div style="margin-top: 10px;">
                        <p>总备忘录数: <span id="totalMemosStat">0</span></p>
                        <p>已完成: <span id="completedMemosStat">0</span></p>
                        <p>未完成: <span id="pendingMemosStat">0</span></p>
                        <p>最早备忘录: <span id="oldestMemoStat">无</span></p>
                        <p>最近更新: <span id="latestUpdateStat">无</span></p>
                    </div>
                </div>
            </div>
            
            <!-- 定时导出选项卡 -->
            <div class="tab-content" id="exportSettingsTab">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-clock"></i> 定时导出设置</h3>
                <div class="form-group">
                    <label for="exportInterval">导出频率</label>
                    <select class="form-control" id="exportInterval">
                        <option value="never">从不</option>
                        <option value="daily">每天</option>
                        <option value="weekly">每周</option>
                        <option value="monthly">每月</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="exportTime">导出时间</label>
                    <input type="time" class="form-control" id="exportTime" value="23:00">
                </div>
                
                <div class="form-group">
                    <label for="lastExport">上次导出时间</label>
                    <input type="text" class="form-control" id="lastExport" value="从未导出" readonly>
                </div>
                
                <!-- 导出设置按钮布局 -->
                <div class="export-buttons-container">
                    <button class="btn btn-primary" id="saveExportSettings">
                        <i class="fas fa-save"></i> 保存设置
                    </button>
                    <button class="btn btn-secondary" id="manualExport">
                        <i class="fas fa-file-export"></i> 立即导出
                    </button>
                </div>
                
                <div class="export-info">
                    <h4><i class="fas fa-info-circle"></i> 注意事项</h4>
                    <ul style="margin-top: 8px; padding-left: 18px; line-height: 1.5;">
                        <li>定时导出功能需要保持浏览器页面打开才能正常工作</li>
                        <li>导出的数据包含所有备忘录和设置</li>
                        <li>建议设置自动导出以防数据丢失</li>
                    </ul>
                </div>
            </div>
            
            <!-- 提醒设置选项卡 -->
            <div class="tab-content" id="reminderSettingsTab">
                <h3 style="margin-bottom: 15px;"><i class="fas fa-bell"></i> 提醒设置</h3>
                <div class="form-group">
                    <label for="reminderCheckInterval">检查频率</label>
                    <select class="form-control" id="reminderCheckInterval">
                        <option value="0.1667">每10秒</option>
                        <option value="1">每1分钟</option>
                        <option value="5">每5分钟</option>
                        <option value="10">每10分钟</option>
                        <option value="15">每15分钟</option>
                        <option value="30">每30分钟</option>
                        <option value="60">每小时</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="reminderAdvanceTime">提前提醒时间</label>
                    <select class="form-control" id="reminderAdvanceTime">
                        <option value="0">到期时提醒</option>
                        <option value="15">提前15分钟</option>
                        <option value="30">提前30分钟</option>
                        <option value="60">提前1小时</option>
                        <option value="1440">提前1天</option>
                    </select>
                </div>
                
                <!-- 修改这里：声音选择选项 -->
                <div class="form-group">
                    <label for="reminderSoundType">提醒声音</label>
                    <select class="form-control" id="reminderSoundType">
                        <option value="default">默认提示音</option>
                        <option value="custom">自定义声音</option>
                        <option value="none">无声音</option>
                    </select>
                </div>
                
                <div class="form-group" id="customSoundUrlGroup" >
                    <label for="customSoundUrl">自定义MP3 URL</label>
                    <input type="text" class="form-control" id="customSoundUrl" 
                           placeholder="https://example.com/sound.mp3">
                    <small class="form-text text-muted">
                        请输入完整的MP3文件URL地址（确保浏览器可以访问）
                    </small>
                </div>
                
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="enableDesktopNotification"> 启用桌面通知（需要浏览器授权）
                    </label>
                </div>
                
                <div class="form-group">
                    <label for="reminderTest">测试提醒</label>
                    <button class="btn btn-warning btn-full" id="testReminder">
                        <i class="fas fa-bell"></i> 发送测试提醒（F5刷新页面停止）
                    </button>
                </div>
                
                <button class="btn btn-primary" id="saveReminderSettings">
                    <i class="fas fa-save"></i> 保存提醒设置
                </button>
                
                <div class="export-info" style="margin-top: 20px;">
                    <h4><i class="fas fa-info-circle"></i> 提醒说明</h4>
                    <ul style="margin-top: 8px; padding-left: 18px; line-height: 1.5;">
                        <li>系统会定期检查到期备忘录并显示提醒</li>
                        <li>提醒弹窗会在页面右上角显示</li>
                        <li>已完成的备忘录不会触发提醒</li>
                        <li>自定义声音需要提供可公开访问的MP3文件URL</li>
                    </ul>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="closeFunctionsModalBtn">关闭</button>
        </div>
    </div>
</div>

<!-- 每日备忘录详情模态窗口 -->
<div class="modal" id="dailyDetailModal">
    <div class="modal-content">
        <div class="modal-header">
            <div class="modal-title">
                <i class="fas fa-list"></i> 每日备忘录详情
                <span style="font-size: 1.1rem; color: white; opacity: 0.9; margin-left: 12px; font-weight: normal;" id="dailyDetailDate">2023年10月1日</span>
            </div>
            <button class="close-modal" id="closeDailyDetailModal">&times;</button>
        </div>
        <div class="modal-body">
            <!-- 快速添加备忘录 -->
            <div style="margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px; border: 2px dashed #dee2e6;">
                <div style="font-size: 1rem; margin-bottom: 12px; color: #495057; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-plus-circle"></i> 快速添加备忘录
                </div>
                <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px;">
                    <input type="text" style="padding: 10px 12px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 0.95rem; transition: var(--transition);" id="quickMemoTitle" placeholder="输入备忘录标题...">
                    <button style="padding: 0 20px; background-color: var(--primary-color); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; transition: var(--transition);" id="quickAddMemo">添加</button>
                </div>
            </div>
            
            <!-- 备忘录列表 -->
            <h3 style="margin-bottom: 12px;"><i class="fas fa-sticky-note"></i> 备忘录列表</h3>
            <div style="max-height: 350px; overflow-y: auto; padding-right: 10px;" id="dailyDetailList">
                <!-- 备忘录将通过JS动态添加 -->
                <div class="empty-state">
                    <i class="fas fa-clipboard"></i>
                    <p>今天还没有备忘录，添加一个吧！</p>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="closeDailyDetailModalBtn">关闭</button>
            <button class="btn btn-primary" id="addNewMemoBtn">
                <i class="fas fa-plus"></i> 添加详细备忘录
            </button>
        </div>
    </div>
</div>

<!-- 导入文件输入 -->
<input type="file" id="importFileInput" accept=".json">

<!-- 消息提示 -->
<div class="toast" id="toast">
    <div class="toast-content">
        <div class="toast-icon">
            <i class="fas fa-check"></i>
        </div>
        <div>
            <div class="toast-message" id="toast-message">操作成功！</div>
            <div class="toast-time" id="toast-time">刚刚</div>
        </div>
    </div>
</div>
`;

async function getFullHTML(env) {
  const config = await getConfig(env);
  const memosData = await getMemos(env, null);
  const memos = memosData.memos || [];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.5, user-scalable=yes">
    <title>智能网页工作日历备忘录 · 云端版</title>
    <!-- Font Awesome 6.4.0 (CDN) -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <!-- GitHub 代码高亮主题 (CDN) -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
    <!-- Highlight.js (CDN) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
    <!-- Lunar 农历库 (CDN) -->
    <script src="https://cdn.jsdelivr.net/npm/lunar-javascript@1.3.3/lunar.min.js"></script>
    <!-- Marked (CDN) -->
    <script src="https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js"></script>
    <!-- XLSX (CDN) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <!-- 原版完整样式（用户粘贴） -->
    <style>${ORIGINAL_CSS}</style>
    <!-- 新增登录和系统配置样式（自动注入） -->
    <style>
        /* 登录模态框样式 */
        #loginModal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); z-index: 2000;
            display: flex; align-items: center; justify-content: center;
        }
        #loginModal .modal-content {
            background: white; border-radius: 10px; padding: 30px;
            max-width: 400px; width: 90%;
        }
        #configBtn {
            position: fixed; bottom: 20px; right: 100px; z-index: 1000;
            background: var(--primary-color); color: white; border: none;
            border-radius: 50%; width: 55px; height: 55px; font-size: 1.3rem;
            cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.2);
        }
        #configPage {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; border-radius: 10px; padding: 30px;
            max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
            z-index: 2001; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        #configPage h3 { margin-bottom: 20px; color: var(--primary-color); }
        #configPage .form-group { margin-bottom: 15px; }
        #configPage label { display: block; margin-bottom: 5px; font-weight: 600; }
        #configPage input, #configPage select, #configPage textarea {
            width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
        }
        #configPage .btn { margin-right: 10px; }
    </style>
</head>
<body>
    <!-- 原版 body 内容（用户粘贴） -->
    ${ORIGINAL_BODY}

    <!-- 新增：登录模态框（仅在未登录时显示） -->
    <div id="loginModal" style="display: none;">
        <div class="modal-content">
            <h3 style="margin-bottom: 20px;">管理员登录</h3>
            <p id="loginError" style="color: red; margin-bottom: 10px;"></p>
            <input type="password" id="loginPassword" placeholder="请输入密码" style="width: 100%; padding: 8px; margin-bottom: 15px;">
            <div style="display: flex; gap: 10px;">
                <button class="btn btn-primary" onclick="handleLogin()">登录</button>
                <button class="btn btn-secondary" onclick="location.reload()">取消</button>
            </div>
        </div>
    </div>

    <!-- 新增：系统配置按钮（登录后显示） -->
    <button id="configBtn" style="display: none;"><i class="fas fa-cog"></i></button>

    <!-- 新增：系统配置页面 -->
    <div id="configPage" style="display: none;">
        <h3>⚙️ 系统配置</h3>
        <div class="form-group">
            <label>时区</label>
            <select id="configTimezone">
                <option value="8">UTC+8 北京时间</option>
                <option value="9">UTC+9 东京时间</option>
                <option value="0">UTC 伦敦时间</option>
                <option value="-5">UTC-5 纽约时间</option>
            </select>
        </div>
        <div class="form-group">
            <label>默认主题</label>
            <select id="configTheme">
                <option>深空蓝</option><option>宝石绿</option><option>日落紫</option>
                <option>暖阳橙</option><option>深海青</option><option>玫瑰粉</option>
                <option>森林墨绿</option><option>星空蓝紫</option><option>珊瑚红</option>
                <option>湖水蓝</option><option>葡萄紫</option><option>大地棕</option>
            </select>
        </div>
        <div class="form-group">
            <label>允许通知时段（小时，24小时制，逗号分隔）</label>
            <input type="text" id="allowHours" value="8,12,18,20">
        </div>
        <h4>Telegram</h4>
        <div class="form-group">
            <label>Bot Token</label>
            <input type="password" id="telegramToken">
        </div>
        <div class="form-group">
            <label>Chat ID</label>
            <input type="text" id="telegramChatId">
        </div>
        <h4>Bark</h4>
        <div class="form-group">
            <label>设备 Key</label>
            <input type="text" id="barkKey">
        </div>
        <h4>Webhook</h4>
        <div class="form-group">
            <label>URL</label>
            <input type="url" id="webhookUrl">
        </div>
        <h4>修改密码</h4>
        <div class="form-group">
            <label>新密码</label>
            <input type="password" id="newPassword">
        </div>
        <div class="form-group">
            <label>确认新密码</label>
            <input type="password" id="confirmPassword">
        </div>
        <div style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="saveConfig()">保存配置</button>
            <button class="btn btn-secondary" onclick="document.getElementById('configPage').style.display='none'">关闭</button>
            <button class="btn btn-danger" onclick="logout()">登出</button>
        </div>
    </div>

<script>
    // ========== 全局变量（由 Worker 注入）==========
    let memos = ${JSON.stringify(memos)};
    let config = ${JSON.stringify(config)};
    let token = localStorage.getItem('memo_token');
    let currentThemeIndex = 0;
    let currentDate = new Date();
    let monthsToShow = 2;
    let selectedDate = null;
    let selectedMemoId = null;
    let dailyDetailDate = new Date();
    let reminderSettings = {
        checkInterval: 5,
        advanceTime: 0,
        soundType: 'default',
        customSoundUrl: '',
        enableDesktopNotification: false
    };
    let dueMemosCount = 0;
    let showLunar = true; // 是否显示农历

    // ========== API 请求封装 ==========
    async function apiRequest(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api${endpoint}`, { ...options, headers });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '请求失败');
        }
        return await res.json();
    }

    // ========== 登录 / 登出 / 配置 ==========
    async function login(password) {
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('memo_token', data.token);
                token = data.token;
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function logout() {
        localStorage.removeItem('memo_token');
        token = null;
        window.location.reload();
    }

    async function handleLogin() {
        const pwd = document.getElementById('loginPassword').value;
        if (await login(pwd)) {
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('configBtn').style.display = 'block';
            await loadMemosFromServer();
            if (typeof initMonthCountSelector === 'function') initMonthCountSelector();
            if (typeof initMultiMonthCalendar === 'function') initMultiMonthCalendar();
            if (typeof initEventListeners === 'function') initEventListeners();
            loadReminderSettings();
            startReminderChecker();
        } else {
            document.getElementById('loginError').textContent = '密码错误';
        }
    }

    async function saveConfig() {
        const newConfig = {
            timezone: parseInt(document.getElementById('configTimezone').value),
            theme: document.getElementById('configTheme').value,
            allowNotificationHours: document.getElementById('allowHours').value.split(',').map(Number),
            notification: {
                enabled: true,
                telegram: {
                    botToken: document.getElementById('telegramToken').value,
                    chatId: document.getElementById('telegramChatId').value
                },
                bark: {
                    deviceKey: document.getElementById('barkKey').value,
                    server: 'https://api.day.app'
                },
                webhook: {
                    url: document.getElementById('webhookUrl').value,
                    method: 'POST',
                    template: '{{title}}\\n{{content}}\\n时间: {{time}}'
                }
            }
        };
        const newPwd = document.getElementById('newPassword').value;
        if (newPwd) {
            const confirmPwd = document.getElementById('confirmPassword').value;
            if (newPwd !== confirmPwd) {
                alert('两次密码不一致');
                return;
            }
            newConfig.adminPassword = btoa(newPwd);
        }
        const data = await apiRequest('/config', { method: 'POST', body: JSON.stringify(newConfig) });
        config = data.config;
        alert('配置已保存');
        document.getElementById('configPage').style.display = 'none';
        applyTheme(config.theme);
    }

    // ========== 备忘录云端操作 ==========
    async function loadMemosFromServer() {
        try {
            const data = await apiRequest('/memos');
            memos = data.memos || [];
            renderMultiMonthCalendar();
            updateReminderBadge();
            updatePendingBadge();
        } catch (e) {
            console.error('加载备忘录失败', e);
        }
    }

    async function saveMemoToServer(memoData) {
        if (selectedMemoId) {
            const data = await apiRequest(`/memos/${selectedMemoId}`, {
                method: 'PUT',
                body: JSON.stringify(memoData)
            });
            const index = memos.findIndex(m => m.id === selectedMemoId);
            if (index !== -1) memos[index] = data.memo;
        } else {
            const data = await apiRequest('/memos', {
                method: 'POST',
                body: JSON.stringify(memoData)
            });
            memos.push(data.memo);
        }
        renderMultiMonthCalendar();
        updateReminderBadge();
        updatePendingBadge();
    }

    async function deleteMemoFromServer(id) {
        await apiRequest(`/memos/${id}`, { method: 'DELETE' });
        memos = memos.filter(m => m.id !== id);
        renderMultiMonthCalendar();
        updateReminderBadge();
        updatePendingBadge();
    }

    async function toggleMemoCompletion(id) {
        const memo = memos.find(m => m.id === id);
        if (!memo) return;
        const updated = { ...memo, completed: !memo.completed };
        const data = await apiRequest(`/memos/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updated)
        });
        Object.assign(memo, data.memo);
        renderMultiMonthCalendar();
        updateReminderBadge();
        updatePendingBadge();
    }

    // ========== 原版常量（保持不变）==========
    const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", 
                      "7月", "8月", "9月", "10月", "11月", "12月"];

    const colorThemes = [
        { name: "深空蓝", primary: "#1a237e", secondary: "#283593", accent: "#3949ab" },
        { name: "宝石绿", primary: "#004d40", secondary: "#00695c", accent: "#00796b" },
        { name: "日落紫", primary: "#6a1b9a", secondary: "#7b1fa2", accent: "#8e24aa" },
        { name: "暖阳橙", primary: "#e65100", secondary: "#ef6c00", accent: "#f57c00" },
        { name: "深海青", primary: "#006064", secondary: "#00838f", accent: "#0097a7" },
        { name: "玫瑰粉", primary: "#880e4f", secondary: "#ad1457", accent: "#c2185b" },
        { name: "森林墨绿", primary: "#1b5e20", secondary: "#2e7d32", accent: "#388e3c" },
        { name: "星空蓝紫", primary: "#311b92", secondary: "#4527a0", accent: "#512da8" },
        { name: "珊瑚红", primary: "#d84315", secondary: "#e64a19", accent: "#f4511e" },
        { name: "湖水蓝", primary: "#00695c", secondary: "#00796b", accent: "#00897b" },
        { name: "葡萄紫", primary: "#4a148c", secondary: "#6a1b9a", accent: "#7b1fa2" },
        { name: "大地棕", primary: "#3e2723", secondary: "#4e342e", accent: "#5d4037" },
        { name: "夜幕深蓝", primary: "#0d47a1", secondary: "#1565c0", accent: "#1976d2" },
        { name: "樱花粉", primary: "#c2185b", secondary: "#d81b60", accent: "#e91e63" },
        { name: "森林绿", primary: "#059669", secondary: "#047857", accent: "#D4AF37" }
    ];

    const memoColors = [
        "#4361ee", "#3a0ca3", "#4cc9f0", "#2ecc71", "#ff9f1c",
        "#9b5de5", "#ef476f", "#7209b7", "#0fa3b1", "#ff6b6b",
        "#00b4d8", "#e5989b", "#52b788", "#7b2cbf", "#fb8500"
    ];

    // ========== 日历和 UI 函数（已修改为使用全局 memos 数组，无 db）==========
    function initMonthCountSelector() {
        const monthCountSelect = document.getElementById('monthCountSelect');
        const savedMonthCount = localStorage.getItem('calendarMonthCount');
        if (savedMonthCount) {
            monthsToShow = parseInt(savedMonthCount);
            monthCountSelect.value = savedMonthCount;
        } else {
            monthsToShow = 2;
            monthCountSelect.value = '2';
        }
        monthCountSelect.addEventListener('change', function() {
            monthsToShow = parseInt(this.value);
            localStorage.setItem('calendarMonthCount', monthsToShow);
            renderMultiMonthCalendar();
        });
    }

    function initThemeSelector() {
        const themeSelector = document.getElementById('themeSelector');
        themeSelector.innerHTML = '';
        colorThemes.forEach((theme, index) => {
            const themeColor = document.createElement('div');
            themeColor.className = `theme-color ${index === currentThemeIndex ? 'active' : ''}`;
            themeColor.style.background = `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
            themeColor.title = theme.name;
            themeColor.dataset.index = index;
            themeColor.textContent = theme.name;
            themeColor.addEventListener('click', function() {
                currentThemeIndex = parseInt(this.dataset.index);
                applyTheme(currentThemeIndex);
                document.querySelectorAll('.theme-color').forEach(el => el.classList.remove('active'));
                this.classList.add('active');
                themeSelector.classList.remove('active');
            });
            themeSelector.appendChild(themeColor);
        });
    }

    function applyTheme(themeIndex) {
        const theme = colorThemes[themeIndex];
        const root = document.documentElement;
        root.style.setProperty('--primary-color', theme.primary);
        root.style.setProperty('--secondary-color', theme.secondary);
        root.style.setProperty('--accent-color', theme.accent);
        document.querySelector('header').style.background = `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
        document.querySelectorAll('.nav-button').forEach(el => {
            el.style.background = `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
        });
        document.querySelectorAll('.calendar-nav-btn').forEach(el => {
            el.style.background = `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
        });
        document.querySelectorAll('.floating-btn').forEach(el => {
            el.style.background = `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
        });
        document.querySelectorAll('.modal-header').forEach(el => {
            el.style.background = `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`;
        });
        document.querySelectorAll('.progress-circle-fill').forEach(el => {
            el.style.stroke = theme.primary;
        });
        document.querySelectorAll('.toolbar-btn-primary').forEach(el => {
            el.style.background = `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
        });
        console.log(`主题已切换为: ${theme.name}`);
    }

    function initMultiMonthCalendar() {
        document.getElementById('prevMonth').addEventListener('click', function() {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderMultiMonthCalendar();
        });
        document.getElementById('nextMonth').addEventListener('click', function() {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderMultiMonthCalendar();
        });
        document.getElementById('calendarPrevMonth').addEventListener('click', function() {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderMultiMonthCalendar();
        });
        document.getElementById('calendarNextMonth').addEventListener('click', function() {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderMultiMonthCalendar();
        });
        renderMultiMonthCalendar();
    }

    function renderMultiMonthCalendar() {
        const container = document.getElementById('multiMonthCalendar');
        const periodDisplay = document.getElementById('currentPeriod');
        container.innerHTML = '';
        if (monthsToShow === 1) {
            container.className = 'multi-month-calendar grid-1';
        } else {
            container.className = 'multi-month-calendar grid-2';
        }
        const months = [];
        for (let i = 0; i < monthsToShow; i++) {
            const monthDate = new Date(currentDate);
            monthDate.setMonth(currentDate.getMonth() + i);
            months.push(monthDate);
        }
        const startMonth = months[0];
        const endMonth = months[monthsToShow - 1];
        if (monthsToShow === 1) {
            periodDisplay.textContent = `${startMonth.getFullYear()}年${startMonth.getMonth()+1}月`;
        } else {
            periodDisplay.textContent = `${startMonth.getFullYear()}年${startMonth.getMonth()+1}月 - ${endMonth.getFullYear()}年${endMonth.getMonth()+1}月`;
        }
        months.forEach((monthDate, index) => {
            const monthCalendar = createMonthCalendar(monthDate, index);
            container.appendChild(monthCalendar);
            loadMemosForMonth(monthDate, `monthCalendar${index}`, index);
        });
        if (monthsToShow === 1) {
            container.className = 'multi-month-calendar grid-1';
            document.querySelector('.container').classList.add('single-month');
        } else {
            container.className = 'multi-month-calendar grid-2';
            document.querySelector('.container').classList.remove('single-month');
        }
    }

    function getLunarDisplay(dateStr) {
        if (!showLunar) return '';
        try {
            const [year, month, day] = dateStr.split('-').map(Number);
            const lunar = Lunar.fromDate(new Date(year, month - 1, day));
            const lunarDay = lunar.getDayInChinese();
            const jieQi = lunar.getJieQi();
            const festival = lunar.getFestivals();
            let display = '';
            if (jieQi) {
                display = jieQi;
            } else if (festival && festival.length > 0) {
                display = festival[0];
            } else {
                display = lunarDay;
                if (lunarDay === '初一') {
                    display = lunar.getMonthInChinese() + '月';
                }
            }
            return display;
        } catch (e) {
            console.error('获取农历信息失败:', e);
            return '';
        }
    }

    function getLunarFullInfo(dateStr) {
        if (!showLunar) return '';
        try {
            const [year, month, day] = dateStr.split('-').map(Number);
            const lunar = Lunar.fromDate(new Date(year, month - 1, day));
            return {
                year: lunar.getYearInGanZhi() + '年',
                month: lunar.getMonthInChinese() + '月',
                day: lunar.getDayInChinese(),
                jieQi: lunar.getJieQi(),
                festival: lunar.getFestivals(),
                zodiac: lunar.getYearShengXiao() + '年',
                lunarDate: lunar.toString()
            };
        } catch (e) {
            return null;
        }
    }

    function updateCalendarDayWithLunar(dayElement, dateStr) {
        if (!showLunar) return;
        const lunarDisplay = getLunarDisplay(dateStr);
        if (!lunarDisplay) return;
        let lunarElement = dayElement.querySelector('.lunar-date');
        if (!lunarElement) {
            lunarElement = document.createElement('div');
            lunarElement.className = 'lunar-date';
            dayElement.querySelector('.day-number').insertAdjacentElement('afterend', lunarElement);
        }
        lunarElement.textContent = lunarDisplay;
        lunarElement.className = 'lunar-date';
        const [year, month, day] = dateStr.split('-').map(Number);
        const lunar = Lunar.fromDate(new Date(year, month - 1, day));
        const jieQi = lunar.getJieQi();
        const festival = lunar.getFestivals();
        if (jieQi) {
            lunarElement.classList.add('solar-term');
            lunarElement.title = '节气: ' + jieQi;
        } else if (festival && festival.length > 0) {
            lunarElement.classList.add('festival');
            lunarElement.title = '节日: ' + festival[0];
        } else if (lunar.getDayInChinese() === '初一') {
            lunarElement.classList.add('first-day');
            lunarElement.title = '农历初一';
        }
    }

    function addLunarStyles() {
        if (!document.getElementById('lunar-styles')) {
            const style = document.createElement('style');
            style.id = 'lunar-styles';
            style.textContent = `
                .lunar-date {
                    font-size: 0.7rem;
                    color: #666;
                    margin-bottom: 3px;
                    text-align: center;
                    line-height: 1.2;
                    min-height: 14px;
                }
                .multi-month-calendar.grid-1 .lunar-date {
                    font-size: 0.75rem;
                    min-height: 16px;
                }
                .lunar-date.solar-term {
                    color: #e91e63;
                    font-weight: bold;
                    background-color: rgba(233, 30, 99, 0.1);
                    border-radius: 3px;
                    padding: 1px 2px;
                    font-size: 0.65rem;
                }
                .lunar-date.festival {
                    color: #4CAF50;
                    font-weight: bold;
                    background-color: rgba(76, 175, 80, 0.1);
                    border-radius: 3px;
                    padding: 1px 2px;
                    font-size: 0.65rem;
                }
                .lunar-date.first-day {
                    color: #2196F3;
                    font-weight: 600;
                }
                .calendar-day.today .lunar-date {
                    color: #fff;
                    background-color: rgba(67, 97, 238, 0.3);
                    border-radius: 3px;
                    padding: 1px 2px;
                }
                .calendar-day.other-month .lunar-date {
                    opacity: 0.5;
                }
                @media (max-width: 768px) {
                    .lunar-date {
                        font-size: 0.6rem;
                        min-height: 12px;
                    }
                    .lunar-date.solar-term,
                    .lunar-date.festival {
                        font-size: 0.55rem;
                    }
                }
                .month-calendar.small .lunar-date {
                    font-size: 0.6rem;
                    min-height: 12px;
                    margin-bottom: 2px;
                }
            `;
            document.head.appendChild(style);
        }
    }

    function createMonthCalendar(monthDate, index) {
        const monthCalendar = document.createElement('div');
        monthCalendar.className = 'month-calendar';
        if (monthsToShow > 4) monthCalendar.classList.add('small');
        monthCalendar.id = `monthCalendar${index}`;
        monthCalendar.dataset.month = monthDate.getMonth();
        monthCalendar.dataset.year = monthDate.getFullYear();
        monthCalendar.innerHTML = `
            <div class="month-header">
                <div class="month-title">
                    ${monthDate.getFullYear()}年 ${monthNames[monthDate.getMonth()]}
                </div>
                <div class="month-right-area">
                    <div class="month-stats" id="monthStats${index}">
                        <div class="stat-item total">
                            <i class="fas fa-tasks"></i>
                            <span class="stat-count-total">0</span>
                        </div>
                        <div class="stat-item completed">
                            <i class="fas fa-check-circle"></i>
                            <span class="stat-count-completed">0</span>
                        </div>
                        <div class="stat-item pending">
                            <i class="fas fa-clock"></i>
                            <span class="stat-count-pending">0</span>
                        </div>
                    </div>
                    <div class="month-progress">
                        <div class="progress-circle" id="progressCircle${index}">
                            <svg viewBox="0 0 36 36">
                                <path class="progress-circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"></path>
                                <path class="progress-circle-fill" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"></path>
                            </svg>
                            <div class="progress-percent">0%</div>
                        </div>
                    </div>
                    <button class="complete-all-btn" data-month-index="${index}">
                        <i class="fas fa-check-double"></i> 一键完成
                    </button>
                </div>
            </div>
            <div class="weekdays">
                <div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div>
            </div>
            <div class="calendar-grid" id="calendarGrid${index}"></div>
        `;
        const calendarGrid = monthCalendar.querySelector('.calendar-grid');
        const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
        const firstDayIndex = firstDay.getDay();
        const prevMonthLastDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 0).getDate();
        const today = new Date();
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth();
        const todayDay = today.getDate();

        for (let i = firstDayIndex; i > 0; i--) {
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            day.textContent = prevMonthLastDay - i + 1;
            calendarGrid.appendChild(day);
        }

        for (let i = 1; i <= lastDay.getDate(); i++) {
            const day = document.createElement('div');
            const dayDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), i);
            const year = dayDate.getFullYear();
            const month = String(dayDate.getMonth() + 1).padStart(2, '0');
            const dayNum = String(dayDate.getDate()).padStart(2, '0');
            const dateString = `${year}-${month}-${dayNum}`;
            day.className = 'calendar-day';
            day.dataset.date = dateString;
            if (year === todayYear && parseInt(month) === todayMonth + 1 && parseInt(dayNum) === todayDay) {
                day.classList.add('today');
            }
            day.innerHTML = `
                <div class="day-number">${i}</div>
                <div class="day-memos" id="dayMemos-${dateString}"></div>
            `;
            day.addEventListener('click', function() {
                const [year, month, day] = this.dataset.date.split('-').map(Number);
                selectedDate = new Date(year, month - 1, day);
                openDailyDetailModal(selectedDate);
            });
            calendarGrid.appendChild(day);
            if (showLunar) updateCalendarDayWithLunar(day, dateString);
        }

        const totalCells = 42;
        const nextDays = totalCells - (firstDayIndex + lastDay.getDate());
        for (let i = 1; i <= nextDays; i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            day.textContent = i;
            calendarGrid.appendChild(day);
        }

        const completeAllBtn = monthCalendar.querySelector('.complete-all-btn');
        completeAllBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const monthIndex = parseInt(this.dataset.monthIndex);
            const monthCalendarEl = document.getElementById(`monthCalendar${monthIndex}`);
            const month = parseInt(monthCalendarEl.dataset.month);
            const year = parseInt(monthCalendarEl.dataset.year);
            completeAllMemosForMonth(month, year);
        });

        return monthCalendar;
    }

    // 一键完成本月所有备忘录（云端版）
    async function completeAllMemosForMonth(month, year) {
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);
        const startStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
        const endStr = `${year}-${String(month+1).padStart(2,'0')}-${String(monthEnd.getDate()).padStart(2,'0')}`;
        if (!confirm(`确定要将${year}年${month+1}月的所有备忘录标记为已完成吗？`)) return;

        const toUpdate = memos.filter(m => m.date >= startStr && m.date <= endStr && !m.completed);
        for (const memo of toUpdate) {
            await toggleMemoCompletion(memo.id);
        }
        showToast(`已成功将 ${toUpdate.length} 个备忘录标记为完成！`);
        renderMultiMonthCalendar();
        updateReminderBadge();
    }

    // 为月份加载备忘录（云端版，直接从 memos 筛选）
    function loadMemosForMonth(monthDate, calendarId, monthIndex) {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth() + 1;
        const monthStr = `${year}-${String(month).padStart(2,'0')}`;
        const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();

        // 清空当天的备忘录
        document.querySelectorAll(`#${calendarId} .calendar-day .day-memos`).forEach(el => el.innerHTML = '');
        document.querySelectorAll(`#${calendarId} .calendar-day .memo-count`).forEach(el => el.remove());

        const monthMemos = memos.filter(m => m.date && m.date.startsWith(monthStr));
        const completedMemos = monthMemos.filter(m => m.completed).length;
        const totalMemos = monthMemos.length;

        monthMemos.forEach(memo => {
            if (searchTerm && !memo.title.toLowerCase().includes(searchTerm) && !(memo.content && memo.content.toLowerCase().includes(searchTerm))) return;

            const dayMemosEl = document.getElementById(`dayMemos-${memo.date}`);
            if (!dayMemosEl) return;

            const memoItem = document.createElement('div');
            memoItem.className = `day-memo-item ${memo.completed ? 'completed' : ''}`;
            memoItem.title = memo.title;
            memoItem.dataset.id = memo.id;
            memoItem.style.borderLeftColor = memo.color || '#4361ee';

            let displayText = memo.title;
            if (monthsToShow > 4) {
                displayText = memo.title.length > 5 ? memo.title.substring(0, 5) + '...' : memo.title;
            } else {
                displayText = memo.title.length > 15 ? memo.title.substring(0, 15) + '...' : memo.title;
            }
            memoItem.innerHTML = `<span class="memo-color-dot" style="background-color: ${memo.color || '#4361ee'}"></span> ${displayText}`;
            memoItem.addEventListener('click', function(e) {
                e.stopPropagation();
                openMemoModal(memo.id);
            });
            dayMemosEl.appendChild(memoItem);

            const dayElement = document.querySelector(`.calendar-day[data-date="${memo.date}"]`);
            if (dayElement) {
                let memoCount = dayElement.querySelector('.memo-count');
                if (!memoCount) {
                    memoCount = document.createElement('div');
                    memoCount.className = 'memo-count';
                    dayElement.appendChild(memoCount);
                }
                const currentCount = parseInt(memoCount.textContent) || 0;
                memoCount.textContent = currentCount + 1;
            }
        });

        const statsEl = document.getElementById(`monthStats${monthIndex}`);
        if (statsEl) {
            statsEl.querySelector('.stat-count-total').textContent = totalMemos;
            statsEl.querySelector('.stat-count-completed').textContent = completedMemos;
            statsEl.querySelector('.stat-count-pending').textContent = totalMemos - completedMemos;
        }

        const progressPercent = totalMemos > 0 ? Math.round((completedMemos / totalMemos) * 100) : 0;
        const progressCircle = document.getElementById(`progressCircle${monthIndex}`);
        if (progressCircle) {
            const fill = progressCircle.querySelector('.progress-circle-fill');
            const percentText = progressCircle.querySelector('.progress-percent');
            fill.style.strokeDasharray = `${progressPercent}, 100`;
            percentText.textContent = `${progressPercent}%`;
        }
    }

    function memoMatchesSearch(memo, searchTerm) {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (memo.title && memo.title.toLowerCase().includes(term)) ||
               (memo.content && memo.content.toLowerCase().includes(term));
    }

    // 打开备忘录编辑模态窗口
    function openMemoModal(memoId = null, date = null) {
        const modal = document.getElementById('memoModal');
        const form = document.getElementById('memoForm');
        const deleteBtn = document.getElementById('deleteMemo');
        const modalTitle = document.querySelector('.modal-title');
        selectedMemoId = memoId;
        form.reset();
        initColorPicker();
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        if (date) {
            const dateYear = date.getFullYear();
            const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
            const dateDay = String(date.getDate()).padStart(2, '0');
            document.getElementById('memoDate').value = `${dateYear}-${dateMonth}-${dateDay}`;
        } else {
            document.getElementById('memoDate').value = `${year}-${month}-${day}`;
        }
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(18, 0, 0, 0);
        document.getElementById('memoDueTime').value = tomorrow.toISOString().slice(0, 16);
        if (memoId) {
            modalTitle.textContent = '编辑备忘录';
            deleteBtn.style.display = 'inline-block';
            loadMemoData(memoId);
        } else {
            modalTitle.textContent = '新建备忘录';
            deleteBtn.style.display = 'none';
        }
        modal.classList.add('active');
        updateMarkdownPreview();
        document.getElementById('memoContent').addEventListener('input', updateMarkdownPreview);
    }

    function openDailyDetailModal(date) {
        const modal = document.getElementById('dailyDetailModal');
        dailyDetailDate = date;
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        document.getElementById('dailyDetailDate').textContent = `${year}年${month}月${day}日`;
        document.getElementById('quickMemoTitle').value = '';
        loadDailyDetailMemos(dailyDetailDate);
        modal.classList.add('active');
    }

    // 加载每日详情备忘录（云端版，从 memos 筛选）
    function loadDailyDetailMemos(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const memoListEl = document.getElementById('dailyDetailList');
        memoListEl.innerHTML = '';
        const dayMemos = memos.filter(m => m.date === dateStr);
        if (dayMemos.length === 0) {
            memoListEl.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard"></i><p>今天还没有备忘录，添加一个吧！</p></div>`;
            return;
        }
        dayMemos.forEach(memo => {
            const memoItem = document.createElement('div');
            memoItem.className = 'task-item';
            memoItem.style.borderLeftColor = memo.color || '#4361ee';
            let countdownHtml = '';
            if (memo.dueTime && !memo.completed) {
                const dueDate = new Date(memo.dueTime);
                const now = new Date();
                const daysDiff = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                let countdownClass = 'success';
                let countdownText = '';
                if (daysDiff < 0) {
                    countdownClass = 'danger';
                    countdownText = `已过期 ${Math.abs(daysDiff)} 天`;
                } else if (daysDiff === 0) {
                    countdownClass = 'danger';
                    countdownText = '今天到期';
                } else if (daysDiff <= 3) {
                    countdownClass = 'warning';
                    countdownText = `${daysDiff} 天后到期`;
                } else {
                    countdownText = `${daysDiff} 天后到期`;
                }
                countdownHtml = `<span class="countdown ${countdownClass}">${countdownText}</span>`;
            }
            memoItem.innerHTML = `
                <div class="task-header">
                    <div class="task-title">${memo.title}</div>
                    <div class="task-color" style="background-color: ${memo.color || '#4361ee'}"></div>
                </div>
                <div class="task-due">
                    <i class="far fa-calendar-alt"></i> 
                    ${memo.date ? new Date(memo.date).toLocaleDateString('zh-CN') : '无日期'} 
                    ${memo.dueTime ? ' - ' + new Date(memo.dueTime).toLocaleDateString('zh-CN') : '无截止日期'}
                    ${countdownHtml}
                </div>
                <div class="task-content">${memo.content ? memo.content.substring(0, 60) + (memo.content.length > 60 ? '...' : '') : '无内容'}</div>
                <div class="task-actions">
                    <button class="task-btn task-btn-complete" data-id="${memo.id}">
                        ${memo.completed ? '<i class="fas fa-undo"></i> 标记为未完成' : '<i class="fas fa-check"></i> 标记为完成'}
                    </button>
                    <button class="task-btn task-btn-edit" data-id="${memo.id}">
                        <i class="fas fa-edit"></i> 编辑
                    </button>
                    <button class="task-btn task-btn-delete" data-id="${memo.id}">
                        <i class="fas fa-trash"></i> 删除
                    </button>
                </div>
            `;
            memoListEl.appendChild(memoItem);
        });

        // 重新绑定事件（简化为使用全局函数，确保事件触发正确的云端操作）
        document.querySelectorAll('.task-btn-complete').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        document.querySelectorAll('.task-btn-edit').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        document.querySelectorAll('.task-btn-delete').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        // 重新绑定新的事件（使用云端函数）
        document.querySelectorAll('.task-btn-complete').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleMemoCompletion(parseInt(this.dataset.id));
            });
        });
        document.querySelectorAll('.task-btn-edit').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                closeDailyDetailModal();
                openMemoModal(parseInt(this.dataset.id));
            });
        });
        document.querySelectorAll('.task-btn-delete').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteMemoById(parseInt(this.dataset.id));
            });
        });
    }

    // 快速添加备忘录（云端版）
    async function quickAddMemo() {
        const title = document.getElementById('quickMemoTitle').value.trim();
        if (!title) return showToast('请输入备忘录标题');
        const year = dailyDetailDate.getFullYear();
        const month = String(dailyDetailDate.getMonth() + 1).padStart(2, '0');
        const day = String(dailyDetailDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const memo = {
            title: title,
            date: dateStr,
            content: '',
            color: memoColors[Math.floor(Math.random() * memoColors.length)],
            completed: false,
            reminderShown: false
        };
        await saveMemoToServer(memo);
        document.getElementById('quickMemoTitle').value = '';
        loadDailyDetailMemos(dailyDetailDate);
    }

    function initColorPicker() {
        const colorOptionsEl = document.getElementById('colorOptions');
        colorOptionsEl.innerHTML = '';
        memoColors.forEach(color => {
            const colorOption = document.createElement('div');
            colorOption.className = 'color-option';
            colorOption.style.backgroundColor = color;
            colorOption.dataset.color = color;
            colorOption.addEventListener('click', function() {
                document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
                this.classList.add('selected');
            });
            colorOptionsEl.appendChild(colorOption);
        });
        colorOptionsEl.firstChild?.classList.add('selected');
    }

    function initTaskColorPicker() {
        const colorOptionsEl = document.getElementById('taskColorOptions');
        if (!colorOptionsEl) return;
        colorOptionsEl.innerHTML = '';
        memoColors.forEach(color => {
            const colorOption = document.createElement('div');
            colorOption.className = 'color-option';
            colorOption.style.backgroundColor = color;
            colorOption.dataset.color = color;
            colorOption.addEventListener('click', function() {
                document.querySelectorAll('#taskColorOptions .color-option').forEach(el => el.classList.remove('selected'));
                this.classList.add('selected');
            });
            colorOptionsEl.appendChild(colorOption);
        });
        colorOptionsEl.firstChild?.classList.add('selected');
    }

    // 加载备忘录数据（从 memos 数组查找）
    function loadMemoData(memoId) {
        const memo = memos.find(m => m.id === memoId);
        if (!memo) return;
        document.getElementById('memoTitle').value = memo.title || '';
        document.getElementById('memoDate').value = memo.date || '';
        document.getElementById('memoDueTime').value = memo.dueTime || '';
        document.getElementById('memoContent').value = memo.content || '';
        document.getElementById('memoCompleted').checked = memo.completed || false;
        if (memo.color) {
            document.querySelectorAll('.color-option').forEach(el => {
                el.classList.remove('selected');
                if (el.dataset.color === memo.color) el.classList.add('selected');
            });
        }
        updateMarkdownPreview();
    }

    function updateMarkdownPreview() {
        const content = document.getElementById('memoContent').value;
        const previewEl = document.getElementById('markdownPreview');
        if (content.trim() === '') {
            previewEl.innerHTML = '<p style="color: #6c757d; font-style: italic;">预览将在这里显示...</p>';
            return;
        }
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true
        });
        previewEl.innerHTML = marked.parse(content);
    }

    // 保存备忘录（云端版）
    function saveMemo() {
        const title = document.getElementById('memoTitle').value.trim();
        const date = document.getElementById('memoDate').value;
        const dueTime = document.getElementById('memoDueTime').value;
        const content = document.getElementById('memoContent').value.trim();
        const completed = document.getElementById('memoCompleted').checked;
        const selectedColor = document.querySelector('.color-option.selected')?.dataset.color || '#4361ee';
        if (!title) return showToast('请输入备忘录标题');
        if (!date) return showToast('请选择日期');
        const memoData = { title, date, dueTime, content, color: selectedColor, completed, reminderShown: false };
        if (selectedMemoId) memoData.id = selectedMemoId;
        saveMemoToServer(memoData).then(() => {
            closeMemoModal();
            showToast('保存成功');
        }).catch(err => {
            console.error(err);
            showToast('保存失败');
        });
    }

    // 删除备忘录（云端版）
    function deleteMemo() {
        if (!selectedMemoId) return;
        if (!confirm('确定删除此备忘录吗？')) return;
        deleteMemoFromServer(selectedMemoId).then(() => {
            closeMemoModal();
            showToast('删除成功');
        });
    }

    function closeMemoModal() {
        const modal = document.getElementById('memoModal');
        modal.classList.remove('active');
        selectedMemoId = null;
    }

    function closeDailyDetailModal() {
        const modal = document.getElementById('dailyDetailModal');
        modal.classList.remove('active');
    }

    function closeReminderModal() {
        const modal = document.getElementById('reminderModal');
        modal.classList.remove('active');
    }

    // 标记所有提醒为已读（云端版：只需清除本地提醒标记，后端提醒状态已在发送时记录）
    function markAllRemindersAsRead() {
        const today = new Date().toDateString();
        Object.keys(localStorage).forEach(key => {
            if (key.includes('reminder_') && key.includes(today)) localStorage.removeItem(key);
        });
        updateReminderBadge();
        closeReminderModal();
    }

    function openFunctionsModal(tab = 'taskPublish') {
        const modal = document.getElementById('functionsModal');
        setActiveTab(tab);
        if (tab === 'taskPublish') {
            initTaskColorPicker();
            const today = new Date();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 7);
            const todayYear = today.getFullYear();
            const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
            const todayDay = String(today.getDate()).padStart(2, '0');
            const tomorrowYear = tomorrow.getFullYear();
            const tomorrowMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
            const tomorrowDay = String(tomorrow.getDate()).padStart(2, '0');
            document.getElementById('taskStartDate').value = `${todayYear}-${todayMonth}-${todayDay}`;
            document.getElementById('taskEndDate').value = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;
        }
        if (tab === 'recentTasks') updateRecentTasks();
        if (tab === 'dataManagement') updateStats();
        modal.classList.add('active');
    }

    function closeFunctionsModal() {
        const modal = document.getElementById('functionsModal');
        modal.classList.remove('active');
    }

    function setActiveTab(tabName) {
        activeTab = tabName;
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.tab === tabName) tab.classList.add('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
            if (content.id === `${tabName}Tab`) content.classList.add('active');
        });
    }

    // 提醒相关（云端版）
    function startReminderChecker() {
        if (reminderTimer) clearInterval(reminderTimer);
        checkDueMemos();
        reminderTimer = setInterval(checkDueMemos, Math.max(10000, reminderSettings.checkInterval * 60 * 1000));
    }

    async function checkDueMemos() {
        try {
            const data = await apiRequest('/reminders/check', { method: 'POST' });
            console.log(`提醒检查: ${data.message}`);
            updateReminderBadge();
        } catch (e) {}
    }

    function updateReminderBadge() {
        // 改为从 localStorage 计算今天已提醒但未读的数量（简单起见，直接取0，因为后端已处理）
        // 实际可从 memos 和 localStorage 计算，但为简化，我们假设所有提醒都由后端弹窗
        const count = 0; // 可扩展
        const badge = document.getElementById('reminderBadge');
        const bellButton = document.getElementById('floatingReminder');
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
            bellButton.classList.add('reminder-pulse');
        } else {
            badge.style.display = 'none';
            bellButton.classList.remove('reminder-pulse');
        }
    }

    function showReminderModal(dueMemos = null) {
        const modal = document.getElementById('reminderModal');
        const reminderList = document.getElementById('reminderList');
        if (dueMemos && dueMemos.length > 0) {
            displayReminders(dueMemos);
        } else {
            // 如果没有传入，则从 localStorage 读取？此处简化，直接显示空
            displayReminders([]);
        }
        modal.classList.add('active');
        playReminderSound();
        if (document.getElementById('autoCloseReminder').checked) {
            setTimeout(() => {
                if (modal.classList.contains('active')) modal.classList.remove('active');
            }, 10000);
        }
        updateReminderBadge();
    }

    function displayReminders(memos) {
        const reminderList = document.getElementById('reminderList');
        reminderList.innerHTML = '';
        if (memos.length === 0) {
            reminderList.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><p>暂无到期提醒</p></div>`;
        } else {
            memos.forEach(memo => {
                const reminderItem = document.createElement('div');
                reminderItem.className = 'reminder-item';
                const dueTime = new Date(memo.dueTime);
                reminderItem.innerHTML = `
                    <div class="reminder-item-title">${memo.title}</div>
                    <div class="reminder-item-details">
                        <span><i class="far fa-calendar"></i> ${dueTime.toLocaleDateString('zh-CN')} ${dueTime.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})}</span>
                    </div>
                `;
                reminderItem.addEventListener('click', function() {
                    openMemoModal(memo.id);
                    closeReminderModal();
                });
                reminderList.appendChild(reminderItem);
            });
        }
    }

    function playReminderSound() {
        const soundType = reminderSettings.soundType;
        if (soundType === 'none') return;
        try {
            if (soundType === 'default') {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 1);
            } else if (soundType === 'custom' && reminderSettings.customSoundUrl) {
                const audio = new Audio(reminderSettings.customSoundUrl);
                audio.volume = 0.7;
                audio.play().catch(e => playDefaultSound());
            }
        } catch (e) {}
    }

    function playDefaultSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1);
        } catch (e) {}
    }

    function showDesktopNotification(memoCount) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('备忘录到期提醒', {
                body: `您有 ${memoCount} 个备忘录已到期，请及时处理。`,
                icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyMmMxLjEgMCAyLS45IDItMnMtLjktMi0yLTItMiAuOS0yIDIgLjkgMiAyIDJ6bTAtMThjLTEuMSAwLTIgLjktMiAycy45IDIgMiAyIDItLjkgMi0yLS45LTItMi0yem0wLTZjLTEuMSAwLTIgLjktMiAycy45IDIgMiAyIDItLjkgMi0yLS45LTItMi0yeiIvPjwvc3ZnPg==',
                tag: 'memo-reminder'
            });
        }
    }

    function loadReminderSettings() {
        // 从 config 读取
        reminderSettings.checkInterval = config.reminderCheckInterval || 5;
        reminderSettings.advanceTime = config.reminderAdvanceTime || 0;
        reminderSettings.soundType = config.soundType || 'default';
        reminderSettings.customSoundUrl = config.customSoundUrl || '';
        reminderSettings.enableDesktopNotification = config.enableDesktopNotification || false;
        document.getElementById('reminderCheckInterval').value = reminderSettings.checkInterval;
        document.getElementById('reminderAdvanceTime').value = reminderSettings.advanceTime;
        document.getElementById('reminderSoundType').value = reminderSettings.soundType;
        document.getElementById('customSoundUrl').value = reminderSettings.customSoundUrl;
        document.getElementById('enableDesktopNotification').checked = reminderSettings.enableDesktopNotification;
        updateSoundUrlGroupVisibility();
    }

    function updateSoundUrlGroupVisibility() {
        const soundType = document.getElementById('reminderSoundType').value;
        const group = document.getElementById('customSoundUrlGroup');
        group.style.display = soundType === 'custom' ? 'block' : 'none';
    }

    function saveReminderSettings() {
        const updates = {
            reminderCheckInterval: parseInt(document.getElementById('reminderCheckInterval').value),
            reminderAdvanceTime: parseInt(document.getElementById('reminderAdvanceTime').value),
            soundType: document.getElementById('reminderSoundType').value,
            customSoundUrl: document.getElementById('customSoundUrl').value,
            enableDesktopNotification: document.getElementById('enableDesktopNotification').checked
        };
        saveConfig({ ...config, ...updates }); // 直接调用 saveConfig，但 saveConfig 需要传入完整配置
        startReminderChecker();
    }

    function testReminder() {
        const testMemos = [{ id: 999, title: '测试提醒', dueTime: new Date().toISOString(), content: '这是一个测试提醒' }];
        showReminderModal(testMemos);
    }

    // 最近任务、统计等（基于 memos 数组）
    function updateRecentTasks() {
        const recentTasksEl = document.getElementById('recentTasksList');
        recentTasksEl.innerHTML = '';
        const sorted = [...memos].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 10);
        if (sorted.length === 0) {
            recentTasksEl.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>暂无任务</p></div>`;
            return;
        }
        sorted.forEach(memo => {
            const taskItem = document.createElement('div');
            taskItem.className = 'task-item';
            taskItem.style.borderLeftColor = memo.color || '#4361ee';
            let countdownHtml = '';
            if (memo.dueTime && !memo.completed) {
                const dueDate = new Date(memo.dueTime);
                const now = new Date();
                const daysDiff = Math.ceil((dueDate - now) / (1000*60*60*24));
                let countdownClass = 'success', countdownText = '';
                if (daysDiff < 0) { countdownClass = 'danger'; countdownText = `已过期 ${Math.abs(daysDiff)} 天`; }
                else if (daysDiff === 0) { countdownClass = 'danger'; countdownText = '今天到期'; }
                else if (daysDiff <= 3) { countdownClass = 'warning'; countdownText = `${daysDiff} 天后到期`; }
                else countdownText = `${daysDiff} 天后到期`;
                countdownHtml = `<span class="countdown ${countdownClass}">${countdownText}</span>`;
            }
            const calendarDateStr = memo.date ? new Date(memo.date).toLocaleDateString('zh-CN') : '无日期';
            const dueDate = memo.dueTime ? new Date(memo.dueTime) : null;
            const dueDateStr = dueDate ? ' - ' + dueDate.toLocaleDateString('zh-CN') : '无截止日期';
            const contentPreview = memo.content ? memo.content.replace(/[#*`]/g,'').substring(0,60)+(memo.content.length>60?'...':'') : '无内容';
            taskItem.innerHTML = `
                <div class="task-header"><div class="task-title">${memo.title||'无标题'}</div><div class="task-color" style="background-color:${memo.color||'#4361ee'}"></div></div>
                <div class="task-due"><i class="far fa-calendar-alt"></i> ${calendarDateStr} ${dueDateStr} ${countdownHtml}</div>
                <div class="task-content">${contentPreview}</div>
                <div class="task-actions">
                    <button class="task-btn task-btn-complete" data-id="${memo.id}">${memo.completed ? '<i class="fas fa-undo"></i> 标记为未完成' : '<i class="fas fa-check"></i> 标记为完成'}</button>
                    <button class="task-btn task-btn-edit" data-id="${memo.id}"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="task-btn task-btn-delete" data-id="${memo.id}"><i class="fas fa-trash"></i> 删除</button>
                </div>
            `;
            recentTasksEl.appendChild(taskItem);
        });
        // 重新绑定事件（同上）
        document.querySelectorAll('.task-btn-complete').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        document.querySelectorAll('.task-btn-edit').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        document.querySelectorAll('.task-btn-delete').forEach(btn => {
            btn.replaceWith(btn.cloneNode(true));
        });
        document.querySelectorAll('.task-btn-complete').forEach(btn => {
            btn.addEventListener('click', function() { toggleMemoCompletion(parseInt(this.dataset.id)); });
        });
        document.querySelectorAll('.task-btn-edit').forEach(btn => {
            btn.addEventListener('click', function() { closeFunctionsModal(); openMemoModal(parseInt(this.dataset.id)); });
        });
        document.querySelectorAll('.task-btn-delete').forEach(btn => {
            btn.addEventListener('click', function() { deleteMemoById(parseInt(this.dataset.id)); });
        });
    }

    function toggleMemoCompletion(memoId) {
        const memo = memos.find(m => m.id === memoId);
        if (!memo) return;
        const updated = { ...memo, completed: !memo.completed };
        apiRequest(`/memos/${memoId}`, { method: 'PUT', body: JSON.stringify(updated) }).then(data => {
            Object.assign(memo, data.memo);
            renderMultiMonthCalendar();
            updateReminderBadge();
            updatePendingBadge();
            if (document.getElementById('dailyDetailModal').classList.contains('active')) loadDailyDetailMemos(dailyDetailDate);
            if (document.getElementById('functionsModal').classList.contains('active')) updateRecentTasks();
        });
    }

    function deleteMemoById(memoId) {
        if (!confirm('确定删除此备忘录吗？')) return;
        deleteMemoFromServer(memoId).then(() => {
            renderMultiMonthCalendar();
            updateRecentTasks();
            updateStats();
            updatePendingBadge();
            updateReminderBadge();
            if (document.getElementById('dailyDetailModal').classList.contains('active')) loadDailyDetailMemos(dailyDetailDate);
        });
    }

    function updateStats() {
        const total = memos.length;
        const completed = memos.filter(m => m.completed).length;
        const pending = total - completed;
        document.getElementById('totalMemosStat').textContent = total;
        document.getElementById('completedMemosStat').textContent = completed;
        document.getElementById('pendingMemosStat').textContent = pending;
        let oldest = null, latest = null;
        if (total > 0) {
            const sortedByDate = [...memos].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
            oldest = new Date(sortedByDate[0].createdAt).toLocaleDateString('zh-CN');
            const sortedByUpdate = [...memos].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            latest = new Date(sortedByUpdate[0].updatedAt).toLocaleDateString('zh-CN');
        }
        document.getElementById('oldestMemoStat').textContent = oldest || '无';
        document.getElementById('latestUpdateStat').textContent = latest || '无';
        updatePendingBadge();
    }

    function updatePendingBadge() {
        const pending = memos.filter(m => !m.completed).length;
        const badge = document.getElementById('pendingBadge');
        if (pending > 0) {
            badge.textContent = pending > 99 ? '99+' : pending;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function exportData() {
        const exportData = {
            memos: memos,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const fileName = `calendar-memo-backup-${new Date().toISOString().slice(0,10)}.json`;
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = fileName;
        link.click();
        showToast('数据导出成功！');
    }

    function exportToExcel() {
        if (memos.length === 0) return showToast('没有数据可以导出！');
        const excelData = memos.map(memo => ({
            'ID': memo.id,
            '标题': memo.title || '',
            '日期': memo.date || '',
            '截止时间': memo.dueTime ? new Date(memo.dueTime).toLocaleString('zh-CN') : '',
            '内容': memo.content ? memo.content.replace(/[#*`]/g,'').substring(0,100) : '',
            '状态': memo.completed ? '已完成' : '未完成',
            '创建时间': memo.createdAt ? new Date(memo.createdAt).toLocaleString('zh-CN') : '',
            '更新时间': memo.updatedAt ? new Date(memo.updatedAt).toLocaleString('zh-CN') : ''
        }));
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "备忘录数据");
        const wscols = [{wch:5},{wch:30},{wch:12},{wch:20},{wch:50},{wch:8},{wch:20},{wch:20}];
        worksheet['!cols'] = wscols;
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `备忘录数据_${new Date().toISOString().slice(0,10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast(`成功导出 ${memos.length} 条备忘录到Excel！`);
    }

    function importData() {
        document.getElementById('importFileInput').click();
    }

    async function handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const importData = JSON.parse(e.target.result);
                if (!importData.memos || !Array.isArray(importData.memos)) throw new Error('文件格式不正确');
                if (!confirm(`即将导入 ${importData.memos.length} 条备忘录。是否继续？`)) return;
                for (const memo of importData.memos) {
                    await saveMemoToServer(memo);
                }
                showToast('数据导入成功！');
                await loadMemosFromServer();
            } catch (error) {
                showToast('文件解析失败');
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    async function clearAllData() {
        if (!confirm('确定要清空所有数据吗？')) return;
        for (const memo of memos) {
            await deleteMemoFromServer(memo.id);
        }
        showToast('所有数据已清空！');
        await loadMemosFromServer();
    }

    async function publishTask() {
        const title = document.getElementById('taskTitle').value.trim();
        const description = document.getElementById('taskDescription').value.trim();
        const startDate = document.getElementById('taskStartDate').value;
        const endDate = document.getElementById('taskEndDate').value;
        const dueTime = document.getElementById('taskDueTime').value;
        if (!title) return showToast('请输入任务标题');
        if (!startDate || !endDate) return showToast('请选择开始日期和结束日期');
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start > end) return showToast('开始日期不能晚于结束日期');
        const days = Math.ceil((end - start) / (1000*60*60*24)) + 1;
        if (days > 100 && !confirm(`此任务将分配到 ${days} 天，数量较多，是否继续？`)) return;
        const selectedColor = document.querySelector('#taskColorOptions .color-option.selected')?.dataset.color || '#4361ee';
        let createdCount = 0;
        const currentDate = new Date(start);
        for (let i = 0; i < days; i++) {
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const day = String(currentDate.getDate()).padStart(2, '0');
            const taskDate = `${year}-${month}-${day}`;
            const dueDateTime = new Date(taskDate + 'T' + dueTime);
            const memo = {
                title: `${title} (第${i+1}天/${days}天)`,
                date: taskDate,
                dueTime: dueDateTime.toISOString(),
                content: description,
                color: selectedColor,
                completed: false,
                reminderShown: false
            };
            await saveMemoToServer(memo);
            createdCount++;
            currentDate.setDate(currentDate.getDate() + 1);
        }
        showToast(`任务发布完成！共创建了 ${createdCount} 个每日任务。`);
    }

    function saveExportSettings() {
        const interval = document.getElementById('exportInterval').value;
        const time = document.getElementById('exportTime').value;
        // 保存到 localStorage 或其他？原版是用 IndexedDB，此处可改为 localStorage
        localStorage.setItem('exportInterval', interval);
        localStorage.setItem('exportTime', time);
        localStorage.setItem('lastExport', new Date().toISOString());
        showToast('导出设置已保存！');
        setupAutoExport();
        updateLastExportTime();
    }

    function loadExportSettings() {
        document.getElementById('exportInterval').value = localStorage.getItem('exportInterval') || 'never';
        document.getElementById('exportTime').value = localStorage.getItem('exportTime') || '23:00';
        const lastExport = localStorage.getItem('lastExport');
        document.getElementById('lastExport').value = lastExport ? new Date(lastExport).toLocaleString('zh-CN') : '从未导出';
    }

    function updateLastExportTime() {
        const lastExport = localStorage.getItem('lastExport');
        document.getElementById('lastExport').value = lastExport ? new Date(lastExport).toLocaleString('zh-CN') : '从未导出';
    }

    function setupAutoExport() {
        if (window.exportTimer) clearInterval(window.exportTimer);
        const interval = document.getElementById('exportInterval').value;
        const time = document.getElementById('exportTime').value;
        if (interval === 'never') return;
        const now = new Date();
        const [hours, minutes] = time.split(':').map(Number);
        const next = new Date();
        next.setHours(hours, minutes, 0, 0);
        if (next < now) next.setDate(next.getDate() + 1);
        let intervalMs;
        switch (interval) {
            case 'daily': intervalMs = 24*60*60*1000; break;
            case 'weekly': intervalMs = 7*24*60*60*1000; break;
            case 'monthly': intervalMs = 30*24*60*60*1000; break;
            default: return;
        }
        const delay = next - now;
        window.exportTimer = setTimeout(function() {
            exportData();
            window.exportTimer = setInterval(exportData, intervalMs);
        }, delay);
    }

    function performSearch() {
        const term = document.getElementById('searchInput').value.trim();
        document.getElementById('clearSearch').style.display = term ? 'block' : 'none';
        renderMultiMonthCalendar();
    }

    function clearSearch() {
        document.getElementById('searchInput').value = '';
        document.getElementById('clearSearch').style.display = 'none';
        renderMultiMonthCalendar();
    }

    function initEventListeners() {
        document.getElementById('saveMemo').addEventListener('click', saveMemo);
        document.getElementById('deleteMemo').addEventListener('click', deleteMemo);
        document.getElementById('cancelMemo').addEventListener('click', closeMemoModal);
        document.getElementById('closeMemoModal').addEventListener('click', closeMemoModal);
        document.getElementById('closeDailyDetailModal').addEventListener('click', closeDailyDetailModal);
        document.getElementById('closeDailyDetailModalBtn').addEventListener('click', closeDailyDetailModal);
        document.getElementById('addNewMemoBtn').addEventListener('click', () => {
            closeDailyDetailModal();
            openMemoModal(null, dailyDetailDate);
        });
        document.getElementById('quickAddMemo').addEventListener('click', quickAddMemo);
        document.getElementById('quickMemoTitle').addEventListener('keypress', (e) => { if (e.key === 'Enter') quickAddMemo(); });
        document.getElementById('themeSelectorBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('themeSelector').classList.toggle('active');
        });
        document.addEventListener('click', (event) => {
            const themeSelector = document.getElementById('themeSelector');
            const btn = document.getElementById('themeSelectorBtn');
            if (!themeSelector.contains(event.target) && !btn.contains(event.target)) {
                themeSelector.classList.remove('active');
            }
        });
        document.getElementById('closeReminderModal').addEventListener('click', closeReminderModal);
        document.getElementById('markAllAsRead').addEventListener('click', markAllRemindersAsRead);
        document.getElementById('viewRecentTasks').addEventListener('click', () => {
            closeReminderModal();
            openFunctionsModal('recentTasks');
        });
        document.getElementById('floatingReminder').addEventListener('click', () => showReminderModal());
        document.getElementById('floatingFunctions').addEventListener('click', () => openFunctionsModal('taskPublish'));
        document.getElementById('closeFunctionsModal').addEventListener('click', closeFunctionsModal);
        document.getElementById('closeFunctionsModalBtn').addEventListener('click', closeFunctionsModal);
        document.getElementById('toolbarPublish').addEventListener('click', () => openFunctionsModal('taskPublish'));
        document.getElementById('toolbarExport').addEventListener('click', exportData);
        document.getElementById('toolbarExportExcel').addEventListener('click', exportToExcel);
        document.getElementById('toolbarImport').addEventListener('click', importData);
        document.getElementById('searchInput').addEventListener('input', function() {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(performSearch, 300);
        });
        document.getElementById('clearSearch').addEventListener('click', clearSearch);
        document.getElementById('exportData').addEventListener('click', exportData);
        document.getElementById('importData').addEventListener('click', importData);
        document.getElementById('clearData').addEventListener('click', clearAllData);
        document.getElementById('importFileInput').addEventListener('change', handleFileImport);
        document.getElementById('viewStats').addEventListener('click', () => { updateStats(); setActiveTab('dataManagement'); });
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                setActiveTab(this.dataset.tab);
                if (this.dataset.tab === 'taskPublish') {
                    initTaskColorPicker();
                    const today = new Date();
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 7);
                    document.getElementById('taskStartDate').value = today.toISOString().split('T')[0];
                    document.getElementById('taskEndDate').value = tomorrow.toISOString().split('T')[0];
                }
                if (this.dataset.tab === 'recentTasks') updateRecentTasks();
            });
        });
        document.getElementById('publishTask').addEventListener('click', publishTask);
        document.getElementById('saveExportSettings').addEventListener('click', saveExportSettings);
        document.getElementById('manualExport').addEventListener('click', exportData);
        document.getElementById('saveReminderSettings').addEventListener('click', saveReminderSettings);
        document.getElementById('testReminder').addEventListener('click', testReminder);
        document.getElementById('functionsModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeFunctionsModal(); });
        document.getElementById('dailyDetailModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDailyDetailModal(); });
        document.getElementById('reminderModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeReminderModal(); });
        document.getElementById('reminderSoundType').addEventListener('change', updateSoundUrlGroupVisibility);
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toast-message');
        const toastIcon = toast.querySelector('.toast-icon i');
        toastMessage.textContent = message;
        const now = new Date();
        document.getElementById('toast-time').textContent = now.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
        if (type === 'error') {
            toast.style.borderLeftColor = '#ef4444';
            toastIcon.className = 'fas fa-exclamation-circle';
        } else if (type === 'warning') {
            toast.style.borderLeftColor = '#f59e0b';
            toastIcon.className = 'fas fa-exclamation-triangle';
        } else if (type === 'info') {
            toast.style.borderLeftColor = '#3b82f6';
            toastIcon.className = 'fas fa-info-circle';
        } else {
            toast.style.borderLeftColor = 'var(--primary-color)';
            toastIcon.className = 'fas fa-check';
        }
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ========== 初始化（检查登录）==========
    document.addEventListener('DOMContentLoaded', async function() {
        if (!token) {
            document.getElementById('loginModal').style.display = 'flex';
            document.getElementById('configBtn').style.display = 'none';
            return;
        }
        document.getElementById('configBtn').style.display = 'block';
        await loadMemosFromServer();
        initMonthCountSelector();
        initMultiMonthCalendar();
        initEventListeners();
        loadReminderSettings();
        startReminderChecker();
        addLunarStyles();
    });

    document.getElementById('configBtn')?.addEventListener('click', function() {
        document.getElementById('configTimezone').value = config.timezone || 8;
        document.getElementById('configTheme').value = config.theme || '深空蓝';
        document.getElementById('allowHours').value = (config.allowNotificationHours || [8,12,18,20]).join(',');
        document.getElementById('telegramToken').value = config.notification?.telegram?.botToken || '';
        document.getElementById('telegramChatId').value = config.notification?.telegram?.chatId || '';
        document.getElementById('barkKey').value = config.notification?.bark?.deviceKey || '';
        document.getElementById('webhookUrl').value = config.notification?.webhook?.url || '';
        document.getElementById('configPage').style.display = 'block';
    });
</script>
</body>
</html>`;
}
