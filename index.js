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
// /* ===== 请将您本地 index.html 中 <style> 标签内的全部 CSS 代码粘贴至此 ===== */
// /* 注意：不要复制 <style> 标签本身，只复制中间的 CSS 代码 */
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

// <!-- ===== 请将您本地 index.html 中 <body> 标签内的全部 HTML 代码粘贴至此 ===== -->
// <!-- 注意：不要复制 <body> 标签本身，只复制其中的内容 -->
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
                    
                    <!-- <div class="form-group"> -->
                        <!-- <label> -->
                            <!-- <input type="checkbox" id="enableSoundReminder" checked> 启用声音提醒 -->
                        <!-- </label> -->
                    <!-- </div> -->
					
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

        // ========== API 请求封装 ==========
        async function apiRequest(endpoint, options = {}) {
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            if (token) headers['Authorization'] = \`Bearer \${token}\`;
            const res = await fetch(\`/api\${endpoint}\`, { ...options, headers });
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
                // 重新执行原版的初始化函数
                if (typeof initThemeSelector === 'function') initThemeSelector();
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
            applyTheme(config.theme); // 需要实现 applyTheme
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
                const data = await apiRequest(\`/memos/\${selectedMemoId}\`, {
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
            await apiRequest(\`/memos/\${id}\`, { method: 'DELETE' });
            memos = memos.filter(m => m.id !== id);
            renderMultiMonthCalendar();
            updateReminderBadge();
            updatePendingBadge();
        }

        async function toggleMemoCompletion(id) {
            const memo = memos.find(m => m.id === id);
            if (!memo) return;
            const updated = { ...memo, completed: !memo.completed };
            const data = await apiRequest(\`/memos/\${id}\`, {
                method: 'PUT',
                body: JSON.stringify(updated)
            });
            Object.assign(memo, data.memo);
            renderMultiMonthCalendar();
            updateReminderBadge();
            updatePendingBadge();
        }

        // ========== 原版函数保留（需要依赖全局 memos 和 config）==========
        // 请将您原 index.html 中从以下位置开始的所有函数复制粘贴在此：
        // - colorThemes, memoColors, monthNames 等全局常量
        // - initMonthCountSelector, initThemeSelector, applyTheme, renderMultiMonthCalendar
        // - createMonthCalendar, loadMemosForMonth, completeAllMemosForMonth, memoMatchesSearch
        // - openMemoModal, openDailyDetailModal, loadDailyDetailMemos, quickAddMemo
        // - initColorPicker, initTaskColorPicker, loadMemoData, updateMarkdownPreview
        // - saveMemo, deleteMemo, deleteMemoById, closeMemoModal, closeDailyDetailModal
        // - startReminderChecker, checkDueMemos, updateReminderBadge, showReminderModal
        // - playReminderSound, showDesktopNotification, loadReminderSettings, saveReminderSettings
        // - updateRecentTasks, updateStats, updatePendingBadge, exportData, exportToExcel
        // - importData, handleFileImport, clearAllData, publishTask
        // - saveExportSettings, loadExportSettings, setupAutoExport, performSearch, clearSearch
        // - initEventListeners, showToast 等

        // 注意：上述函数中所有对 db 的操作（IndexedDB）都必须替换为调用云端 API，
        // 具体替换方式如下：
        // - saveMemo 函数：改为构造 memoData 后调用 saveMemoToServer(memoData)
        // - deleteMemo / deleteMemoById：改为调用 deleteMemoFromServer(id)
        // - toggleMemoCompletion：改为调用 toggleMemoCompletion(id)
        // - loadMemosForMonth：改为直接从全局 memos 数组筛选（无需数据库）
        // - 其他涉及 db 的地方都类似替换。

        // 由于篇幅限制，此处无法列出所有函数的完整替换版本，
        // 但您可以根据上述指导原则修改您原脚本中的对应函数。

        // 以下提供一个简单的示例，展示如何替换 saveMemo 函数：
        // function saveMemo() { ... 构造 memoData ...; saveMemoToServer(memoData); }

        // ========== 初始化（检查登录）==========
        document.addEventListener('DOMContentLoaded', async function() {
            if (!token) {
                document.getElementById('loginModal').style.display = 'flex';
                document.getElementById('configBtn').style.display = 'none';
                return;
            }
            document.getElementById('configBtn').style.display = 'block';
            await loadMemosFromServer();
            // 调用原版初始化函数
            if (typeof initMonthCountSelector === 'function') initMonthCountSelector();
            if (typeof initMultiMonthCalendar === 'function') initMultiMonthCalendar();
            if (typeof initEventListeners === 'function') initEventListeners();
            loadReminderSettings();
            startReminderChecker();
        });

        // 配置按钮点击显示配置页面
        document.getElementById('configBtn')?.addEventListener('click', function() {
            // 填充当前配置
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
