// Memo Pro - 基于Cloudflare Workers的智能备忘录系统

// 系统默认配置
const DEFAULT_CONFIG = {
  adminPassword: "YWRtaW4xMjM=", // Base64编码的"admin123"
  timezone: 8, // 北京时间 UTC+8
  notification: {
    enabled: true,
    telegram: {
      botToken: "",
      chatId: ""
    },
    webhook: {
      url: "",
      method: "POST",
      headers: {},
      template: "{{title}}\n{{content}}\n时间: {{time}}"
    },
    bark: {
      server: "https://api.day.app",
      deviceKey: ""
    }
  },
  reminderCheckCron: "0 0,12 * * *", // 每天检查两次
  allowNotificationHours: [8, 12, 18, 20] // 允许通知的时间段（24小时制）
};

// 用户数据结构
class Memo {
  constructor(data = {}) {
    this.id = data.id || this.generateId();
    this.title = data.title || "";
    this.content = data.content || "";
    this.date = data.date || new Date().toISOString().split('T')[0];
    this.time = data.time || "09:00";
    this.category = data.category || "default";
    this.priority = data.priority || "medium"; // low, medium, high
    this.status = data.status || "pending"; // pending, completed, cancelled
    
    // 提醒设置
    this.reminder = {
      enabled: data.reminder?.enabled || false,
      dateTime: data.reminder?.dateTime || null,
      advanceMinutes: data.reminder?.advanceMinutes || 10,
      repeat: data.reminder?.repeat || "none", // none, daily, weekly, monthly
      lastSent: data.reminder?.lastSent || null
    };
    
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }
  
  generateId() {
    return 'memo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      content: this.content,
      date: this.date,
      time: this.time,
      category: this.category,
      priority: this.priority,
      status: this.status,
      reminder: this.reminder,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

// 主处理函数
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // API 路由
      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, url, corsHeaders);
      }
      
      // 前端页面
      return new Response(await getFrontendHTML(), {
        headers: { 
          'Content-Type': 'text/html; charset=utf-8',
          ...corsHeaders
        }
      });
      
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  },
  
  // 定时任务处理（每天检查提醒）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledReminders(env));
  }
};

// API 请求处理
async function handleAPI(request, env, url, corsHeaders) {
  const path = url.pathname;
  const method = request.method;
  
  // 验证管理员权限（除了登录接口）
  if (!path.includes('/login') && !await verifyAdmin(request, env)) {
    return new Response(JSON.stringify({ error: '未授权访问' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
  
  // API 路由分发
  switch (true) {
    case path === '/api/login':
      return handleLogin(request, env);
    
    case path === '/api/config' && method === 'GET':
      return await getConfig(env);
    
    case path === '/api/config' && method === 'POST':
      return await updateConfig(request, env);
    
    case path === '/api/memos' && method === 'GET':
      return await getMemos(env, url);
    
    case path === '/api/memos' && method === 'POST':
      return await createMemo(request, env);
    
    case path.match(/^\/api\/memos\/[\w-]+$/) && method === 'GET':
      return await getMemo(request, env, url);
    
    case path.match(/^\/api\/memos\/[\w-]+$/) && method === 'PUT':
      return await updateMemo(request, env, url);
    
    case path.match(/^\/api\/memos\/[\w-]+$/) && method === 'DELETE':
      return await deleteMemo(request, env, url);
    
    case path === '/api/reminders/test' && method === 'POST':
      return await testNotification(request, env);
    
    case path === '/api/reminders/check' && method === 'POST':
      return await checkReminders(env);
    
    default:
      return new Response(JSON.stringify({ error: '接口不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
  }
}

// 管理员验证
async function verifyAdmin(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return false;
    
    const token = authHeader.replace('Bearer ', '');
    const config = await getConfigData(env);
    
    // 简单验证：检查token是否匹配配置中的密码
    return token === config.adminPassword;
  } catch (error) {
    return false;
  }
}

// 登录处理
async function handleLogin(request, env) {
  const { password } = await request.json();
  const config = await getConfigData(env);
  
  // 验证密码（Base64编码比较）
  const encodedInput = btoa(password);
  const isValid = encodedInput === config.adminPassword;
  
  return new Response(JSON.stringify({
    success: isValid,
    token: isValid ? config.adminPassword : null
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取配置
async function getConfig(env) {
  const config = await getConfigData(env);
  return new Response(JSON.stringify(config), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 更新配置
async function updateConfig(request, env) {
  const updates = await request.json();
  const config = await getConfigData(env);
  
  // 更新配置
  const updatedConfig = { ...config, ...updates };
  await env.MEMO_KV.put('config', JSON.stringify(updatedConfig));
  
  return new Response(JSON.stringify({ success: true, config: updatedConfig }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取配置数据
async function getConfigData(env) {
  const configData = await env.MEMO_KV.get('config');
  return configData ? JSON.parse(configData) : DEFAULT_CONFIG;
}

// 获取备忘录列表
async function getMemos(env, url) {
  const searchParams = url.searchParams;
  const filter = {
    date: searchParams.get('date'),
    category: searchParams.get('category'),
    status: searchParams.get('status'),
    page: parseInt(searchParams.get('page') || '1'),
    limit: parseInt(searchParams.get('limit') || '50')
  };
  
  // 获取所有备忘录
  const memosList = await env.MEMO_KV.get('memos_list', 'json') || [];
  let memos = [];
  
  for (const memoId of memosList) {
    const memoData = await env.MEMO_KV.get(`memo_${memoId}`, 'json');
    if (memoData) memos.push(memoData);
  }
  
  // 应用过滤器
  if (filter.date) {
    memos = memos.filter(m => m.date === filter.date);
  }
  if (filter.category) {
    memos = memos.filter(m => m.category === filter.category);
  }
  if (filter.status) {
    memos = memos.filter(m => m.status === filter.status);
  }
  
  // 按时间排序
  memos.sort((a, b) => {
    const dateA = new Date(`${a.date}T${a.time}`);
    const dateB = new Date(`${b.date}T${b.time}`);
    return dateA - dateB;
  });
  
  // 分页
  const start = (filter.page - 1) * filter.limit;
  const end = start + filter.limit;
  const paginatedMemos = memos.slice(start, end);
  
  return new Response(JSON.stringify({
    memos: paginatedMemos,
    total: memos.length,
    page: filter.page,
    totalPages: Math.ceil(memos.length / filter.limit)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 创建备忘录
async function createMemo(request, env) {
  const data = await request.json();
  const memo = new Memo(data);
  
  // 保存备忘录
  await env.MEMO_KV.put(`memo_${memo.id}`, JSON.stringify(memo.toJSON()));
  
  // 更新备忘录列表
  const memosList = await env.MEMO_KV.get('memos_list', 'json') || [];
  if (!memosList.includes(memo.id)) {
    memosList.push(memo.id);
    await env.MEMO_KV.put('memos_list', JSON.stringify(memosList));
  }
  
  // 如果启用了提醒，设置提醒时间
  if (memo.reminder.enabled && !memo.reminder.dateTime) {
    memo.reminder.dateTime = `${memo.date}T${memo.time}:00`;
    await env.MEMO_KV.put(`memo_${memo.id}`, JSON.stringify(memo.toJSON()));
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    memo: memo.toJSON() 
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取单个备忘录
async function getMemo(request, env, url) {
  const memoId = url.pathname.split('/').pop();
  const memoData = await env.MEMO_KV.get(`memo_${memoId}`, 'json');
  
  if (!memoData) {
    return new Response(JSON.stringify({ error: '备忘录不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify(memoData), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 更新备忘录
async function updateMemo(request, env, url) {
  const memoId = url.pathname.split('/').pop();
  const updates = await request.json();
  
  const existingMemo = await env.MEMO_KV.get(`memo_${memoId}`, 'json');
  if (!existingMemo) {
    return new Response(JSON.stringify({ error: '备忘录不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const updatedMemo = { ...existingMemo, ...updates, updatedAt: new Date().toISOString() };
  await env.MEMO_KV.put(`memo_${memoId}`, JSON.stringify(updatedMemo));
  
  return new Response(JSON.stringify({ 
    success: true, 
    memo: updatedMemo 
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 删除备忘录
async function deleteMemo(request, env, url) {
  const memoId = url.pathname.split('/').pop();
  
  // 删除备忘录
  await env.MEMO_KV.delete(`memo_${memoId}`);
  
  // 从列表中移除
  const memosList = await env.MEMO_KV.get('memos_list', 'json') || [];
  const updatedList = memosList.filter(id => id !== memoId);
  await env.MEMO_KV.put('memos_list', JSON.stringify(updatedList));
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 测试通知
async function testNotification(request, env) {
  const { type, message } = await request.json();
  const config = await getConfigData(env);
  
  let success = false;
  let result = null;
  
  switch (type) {
    case 'telegram':
      if (config.notification.telegram.botToken && config.notification.telegram.chatId) {
        result = await sendTelegramNotification(
          config.notification.telegram.botToken,
          config.notification.telegram.chatId,
          message || '🔔 Memo Pro 测试通知\n这是一个测试通知消息。'
        );
        success = result.ok;
      }
      break;
      
    case 'webhook':
      if (config.notification.webhook.url) {
        result = await sendWebhookNotification(config.notification.webhook, {
          title: '测试通知',
          content: '这是一个测试通知消息。',
          time: new Date().toLocaleString()
        });
        success = result.status >= 200 && result.status < 300;
      }
      break;
      
    case 'bark':
      if (config.notification.bark.deviceKey) {
        result = await sendBarkNotification(config.notification.bark, {
          title: '测试通知',
          body: '这是一个测试通知消息。'
        });
        success = result.ok;
      }
      break;
  }
  
  return new Response(JSON.stringify({ 
    success, 
    result,
    message: success ? '测试通知发送成功' : '测试通知发送失败，请检查配置'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 检查并发送提醒
async function checkReminders(env) {
  const now = new Date();
  const config = await getConfigData(env);
  
  // 检查是否在允许的通知时间段内
  const currentHour = now.getUTCHours() + config.timezone;
  if (!config.allowNotificationHours.includes(currentHour % 24)) {
    return new Response(JSON.stringify({ 
      message: '当前时间段不允许发送通知',
      checked: 0,
      sent: 0
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const memosList = await env.MEMO_KV.get('memos_list', 'json') || [];
  let checked = 0;
  let sent = 0;
  let notifications = [];
  
  for (const memoId of memosList) {
    const memoData = await env.MEMO_KV.get(`memo_${memoId}`, 'json');
    if (!memoData || !memoData.reminder?.enabled) continue;
    
    checked++;
    
    const reminderTime = new Date(memoData.reminder.dateTime);
    const shouldNotify = reminderTime <= now && 
                        (!memoData.reminder.lastSent || 
                         new Date(memoData.reminder.lastSent) < reminderTime);
    
    if (shouldNotify) {
      // 发送通知
      const notificationSent = await sendMemoNotification(memoData, config);
      
      if (notificationSent) {
        // 更新最后发送时间
        memoData.reminder.lastSent = now.toISOString();
        await env.MEMO_KV.put(`memo_${memoId}`, JSON.stringify(memoData));
        
        sent++;
        notifications.push({
          id: memoData.id,
          title: memoData.title,
          time: memoData.reminder.dateTime
        });
      }
    }
  }
  
  return new Response(JSON.stringify({ 
    message: `检查了 ${checked} 个备忘录，发送了 ${sent} 个提醒`,
    checked,
    sent,
    notifications
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 定时任务处理
async function handleScheduledReminders(env) {
  const config = await getConfigData(env);
  const now = new Date();
  
  // 检查是否在允许的通知时间段内
  const currentHour = now.getUTCHours() + config.timezone;
  if (!config.allowNotificationHours.includes(currentHour % 24)) {
    console.log(`当前时间 ${currentHour % 24}:00 不允许发送通知`);
    return;
  }
  
  console.log('开始检查备忘录提醒...');
  const memosList = await env.MEMO_KV.get('memos_list', 'json') || [];
  let sentCount = 0;
  
  for (const memoId of memosList) {
    const memoData = await env.MEMO_KV.get(`memo_${memoId}`, 'json');
    if (!memoData || !memoData.reminder?.enabled) continue;
    
    const reminderTime = new Date(memoData.reminder.dateTime);
    const shouldNotify = reminderTime <= now && 
                        (!memoData.reminder.lastSent || 
                         new Date(memoData.reminder.lastSent) < reminderTime);
    
    if (shouldNotify) {
      try {
        await sendMemoNotification(memoData, config);
        
        // 更新最后发送时间
        memoData.reminder.lastSent = now.toISOString();
        await env.MEMO_KV.put(`memo_${memoId}`, JSON.stringify(memoData));
        
        sentCount++;
        console.log(`已发送提醒: ${memoData.title}`);
      } catch (error) {
        console.error(`发送提醒失败 (${memoData.title}):`, error);
      }
    }
  }
  
  console.log(`提醒检查完成，发送了 ${sentCount} 个提醒`);
}

// 发送备忘录通知
async function sendMemoNotification(memo, config) {
  if (!config.notification.enabled) return false;
  
  const notificationContent = {
    title: `📝 备忘录提醒: ${memo.title}`,
    content: memo.content,
    time: new Date(memo.reminder.dateTime).toLocaleString('zh-CN', { 
      timeZone: `UTC${config.timezone >= 0 ? '+' : ''}${config.timezone}` 
    }),
    priority: memo.priority,
    category: memo.category
  };
  
  let sent = false;
  
  // Telegram 通知
  if (config.notification.telegram.botToken && config.notification.telegram.chatId) {
    const message = `${notificationContent.title}\n\n${notificationContent.content}\n\n⏰ 时间: ${notificationContent.time}\n📂 分类: ${notificationContent.category}\n🚨 优先级: ${notificationContent.priority}`;
    await sendTelegramNotification(
      config.notification.telegram.botToken,
      config.notification.telegram.chatId,
      message
    );
    sent = true;
  }
  
  // Webhook 通知
  if (config.notification.webhook.url) {
    await sendWebhookNotification(config.notification.webhook, notificationContent);
    sent = true;
  }
  
  // Bark 通知
  if (config.notification.bark.deviceKey) {
    await sendBarkNotification(config.notification.bark, {
      title: notificationContent.title,
      body: notificationContent.content
    });
    sent = true;
  }
  
  return sent;
}

// 发送 Telegram 通知
async function sendTelegramNotification(botToken, chatId, message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    })
  });
  
  return await response.json();
}

// 发送 Webhook 通知
async function sendWebhookNotification(webhookConfig, data) {
  let body = webhookConfig.template;
  
  // 替换模板变量
  for (const [key, value] of Object.entries(data)) {
    body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  
  const response = await fetch(webhookConfig.url, {
    method: webhookConfig.method || 'POST',
    headers: webhookConfig.headers || { 'Content-Type': 'application/json' },
    body: webhookConfig.method === 'GET' ? null : body
  });
  
  return response;
}

// 发送 Bark 通知
async function sendBarkNotification(barkConfig, data) {
  const url = `${barkConfig.server}/${barkConfig.deviceKey}/${encodeURIComponent(data.title)}/${encodeURIComponent(data.body || '')}`;
  
  const response = await fetch(url, {
    method: 'POST'
  });
  
  return await response.json();
}

// 获取前端HTML
async function getFrontendHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Memo Pro - 智能备忘录系统</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .app-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 0;
            color: white;
        }
        .header h1 {
            font-size: 2rem;
            font-weight: 600;
        }
        .main-layout {
            display: grid;
            grid-template-columns: 300px 1fr;
            gap: 20px;
            margin-top: 20px;
        }
        .sidebar {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .content {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.3s;
        }
        .btn:hover {
            background: #5a67d8;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
        }
        .modal-content {
            background: white;
            border-radius: 12px;
            padding: 30px;
            max-width: 500px;
            margin: 100px auto;
            max-height: 80vh;
            overflow-y: auto;
        }
        .memo-item {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            transition: all 0.3s;
        }
        .memo-item:hover {
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            transform: translateY(-2px);
        }
        .memo-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .memo-title {
            font-weight: 600;
            font-size: 16px;
            color: #2d3748;
        }
        .memo-priority {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        .priority-high { background: #fed7d7; color: #c53030; }
        .priority-medium { background: #feebc8; color: #c05621; }
        .priority-low { background: #c6f6d5; color: #276749; }
        .memo-content {
            color: #4a5568;
            margin: 10px 0;
            line-height: 1.5;
        }
        .memo-meta {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #718096;
            margin-top: 10px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #4a5568;
        }
        .form-control {
            width: 100%;
            padding: 10px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 14px;
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid #e2e8f0;
            margin-bottom: 20px;
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border-bottom: 3px solid transparent;
        }
        .tab.active {
            border-bottom-color: #667eea;
            color: #667eea;
            font-weight: 500;
        }
        .login-container {
            max-width: 400px;
            margin: 100px auto;
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        .login-title {
            text-align: center;
            margin-bottom: 30px;
            color: #2d3748;
        }
        .notification-badge {
            background: #f56565;
            color: white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            margin-left: 5px;
        }
        @media (max-width: 768px) {
            .main-layout {
                grid-template-columns: 1fr;
            }
            .header h1 {
                font-size: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="app-container" id="app">
        <!-- 登录界面 -->
        <div class="login-container" id="loginView">
            <h2 class="login-title">Memo Pro 登录</h2>
            <div class="form-group">
                <label>管理员密码</label>
                <input type="password" id="password" class="form-control" placeholder="输入密码">
            </div>
            <button class="btn" onclick="login()" style="width: 100%;">登录</button>
            <p style="text-align: center; margin-top: 20px; color: #718096; font-size: 14px;">
                默认密码: admin123
            </p>
        </div>
        
        <!-- 主应用界面 -->
        <div style="display: none;" id="mainView">
            <div class="header">
                <h1>📝 Memo Pro</h1>
                <div>
                    <button class="btn" onclick="showConfig()">系统配置</button>
                    <button class="btn" onclick="addMemo()" style="margin-left: 10px;">+ 新建备忘录</button>
                </div>
            </div>
            
            <div class="main-layout">
                <div class="sidebar">
                    <h3 style="margin-bottom: 20px;">📅 日历</h3>
                    <div id="calendar"></div>
                    <div style="margin-top: 30px;">
                        <h4 style="margin-bottom: 15px;">📊 统计</h4>
                        <div id="stats"></div>
                    </div>
                </div>
                
                <div class="content">
                    <div class="tabs">
                        <div class="tab active" onclick="switchTab('pending')">待办</div>
                        <div class="tab" onclick="switchTab('completed')">已完成</div>
                        <div class="tab" onclick="switchTab('all')">全部</div>
                    </div>
                    
                    <div id="memoList"></div>
                </div>
            </div>
        </div>
        
        <!-- 新增/编辑备忘录模态框 -->
        <div class="modal" id="memoModal">
            <div class="modal-content">
                <h3 style="margin-bottom: 20px;" id="modalTitle">新建备忘录</h3>
                <div class="form-group">
                    <label>标题</label>
                    <input type="text" id="memoTitle" class="form-control" placeholder="输入标题">
                </div>
                <div class="form-group">
                    <label>内容</label>
                    <textarea id="memoContent" class="form-control" rows="4" placeholder="输入详细内容..."></textarea>
                </div>
                <div class="form-group">
                    <label>日期</label>
                    <input type="date" id="memoDate" class="form-control">
                </div>
                <div class="form-group">
                    <label>时间</label>
                    <input type="time" id="memoTime" class="form-control">
                </div>
                <div class="form-group">
                    <label>分类</label>
                    <select id="memoCategory" class="form-control">
                        <option value="default">默认</option>
                        <option value="work">工作</option>
                        <option value="personal">个人</option>
                        <option value="shopping">购物</option>
                        <option value="health">健康</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>优先级</label>
                    <select id="memoPriority" class="form-control">
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                    </select>
                </div>
                
                <!-- 提醒设置 -->
                <div class="form-group">
                    <label style="display: flex; align-items: center;">
                        <input type="checkbox" id="enableReminder" onchange="toggleReminderSettings()">
                        <span style="margin-left: 8px;">启用提醒</span>
                    </label>
                </div>
                
                <div id="reminderSettings" style="display: none; padding: 15px; background: #f7fafc; border-radius: 6px;">
                    <div class="form-group">
                        <label>提醒时间</label>
                        <input type="datetime-local" id="reminderDateTime" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>提前提醒（分钟）</label>
                        <input type="number" id="advanceMinutes" class="form-control" value="10" min="0">
                    </div>
                    <div class="form-group">
                        <label>重复提醒</label>
                        <select id="reminderRepeat" class="form-control">
                            <option value="none">不重复</option>
                            <option value="daily">每天</option>
                            <option value="weekly">每周</option>
                            <option value="monthly">每月</option>
                        </select>
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 30px;">
                    <button class="btn" onclick="saveMemo()" style="flex: 1;">保存</button>
                    <button class="btn" onclick="closeModal()" style="flex: 1; background: #a0aec0;">取消</button>
                </div>
            </div>
        </div>
        
        <!-- 系统配置模态框 -->
        <div class="modal" id="configModal">
            <div class="modal-content">
                <h3 style="margin-bottom: 20px;">⚙️ 系统配置</h3>
                
                <div class="tabs">
                    <div class="tab active" onclick="switchConfigTab('general')">通用</div>
                    <div class="tab" onclick="switchConfigTab('notification')">通知</div>
                    <div class="tab" onclick="switchConfigTab('security')">安全</div>
                </div>
                
                <!-- 通用配置 -->
                <div id="generalConfig">
                    <div class="form-group">
                        <label>时区设置</label>
                        <select id="configTimezone" class="form-control">
                            <option value="8">UTC+8 北京时间</option>
                            <option value="0">UTC 伦敦时间</option>
                            <option value="-5">UTC-5 纽约时间</option>
                            <option value="-8">UTC-8 旧金山时间</option>
                            <option value="9">UTC+9 东京时间</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" id="enableNotifications">
                            <span style="margin-left: 8px;">启用通知系统</span>
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <label>允许通知的时间段（24小时制，逗号分隔）</label>
                        <input type="text" id="allowNotificationHours" class="form-control" value="8,12,18,20">
                    </div>
                </div>
                
                <!-- 通知配置 -->
                <div id="notificationConfig" style="display: none;">
                    <h4 style="margin: 20px 0 15px 0;">Telegram 通知</h4>
                    <div class="form-group">
                        <label>Bot Token</label>
                        <input type="text" id="telegramBotToken" class="form-control" placeholder="从 @BotFather 获取">
                    </div>
                    <div class="form-group">
                        <label>Chat ID</label>
                        <input type="text" id="telegramChatId" class="form-control" placeholder="从 @userinfobot 获取">
                    </div>
                    
                    <div style="margin: 30px 0 15px 0; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                        <h4>Webhook 通知</h4>
                    </div>
                    <div class="form-group">
                        <label>Webhook URL</label>
                        <input type="text" id="webhookUrl" class="form-control" placeholder="https://">
                    </div>
                    <div class="form-group">
                        <label>请求方法</label>
                        <select id="webhookMethod" class="form-control">
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>消息模板</label>
                        <textarea id="webhookTemplate" class="form-control" rows="3">{{title}}\\n{{content}}\\n时间: {{time}}</textarea>
                    </div>
                    
                    <div style="margin: 30px 0 15px 0; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                        <h4>Bark 通知 (iOS)</h4>
                    </div>
                    <div class="form-group">
                        <label>Bark 服务器地址</label>
                        <input type="text" id="barkServer" class="form-control" value="https://api.day.app">
                    </div>
                    <div class="form-group">
                        <label>设备 Key</label>
                        <input type="text" id="barkDeviceKey" class="form-control" placeholder="从 Bark App 获取">
                    </div>
                    
                    <button class="btn" onclick="testNotification('telegram')" style="margin-top: 10px;">测试 Telegram</button>
                    <button class="btn" onclick="testNotification('webhook')" style="margin-top: 10px; margin-left: 10px;">测试 Webhook</button>
                    <button class="btn" onclick="testNotification('bark')" style="margin-top: 10px; margin-left: 10px;">测试 Bark</button>
                </div>
                
                <!-- 安全配置 -->
                <div id="securityConfig" style="display: none;">
                    <div class="form-group">
                        <label>修改管理员密码</label>
                        <input type="password" id="newPassword" class="form-control" placeholder="输入新密码">
                    </div>
                    <div class="form-group">
                        <label>确认新密码</label>
                        <input type="password" id="confirmPassword" class="form-control" placeholder="再次输入新密码">
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 30px;">
                    <button class="btn" onclick="saveConfig()" style="flex: 1;">保存配置</button>
                    <button class="btn" onclick="closeConfig()" style="flex: 1; background: #a0aec0;">关闭</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentUser = null;
        let currentMemoId = null;
        let memos = [];
        let currentTab = 'pending';
        let config = {};
        
        // 初始化
        async function init() {
            const token = localStorage.getItem('memo_token');
            if (!token) return;
            
            try {
                const response = await fetch('/api/config', {
                    headers: { 'Authorization': \`Bearer \${token}\` }
                });
                
                if (response.ok) {
                    config = await response.json();
                    currentUser = token;
                    document.getElementById('loginView').style.display = 'none';
                    document.getElementById('mainView').style.display = 'block';
                    loadMemos();
                    loadCalendar();
                    loadStats();
                } else {
                    localStorage.removeItem('memo_token');
                }
            } catch (error) {
                console.error('初始化失败:', error);
            }
        }
        
        // 登录
        async function login() {
            const password = document.getElementById('password').value;
            
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            
            const result = await response.json();
            
            if (result.success) {
                localStorage.setItem('memo_token', result.token);
                currentUser = result.token;
                document.getElementById('loginView').style.display = 'none';
                document.getElementById('mainView').style.display = 'block';
                init();
            } else {
                alert('密码错误！');
            }
        }
        
        // 加载备忘录
        async function loadMemos() {
            try {
                const response = await fetch(\`/api/memos?status=\${currentTab === 'all' ? '' : currentTab}\`, {
                    headers: { 'Authorization': \`Bearer \${currentUser}\` }
                });
                
                const data = await response.json();
                memos = data.memos || [];
                renderMemos();
            } catch (error) {
                console.error('加载备忘录失败:', error);
            }
        }
        
        // 渲染备忘录列表
        function renderMemos() {
            const container = document.getElementById('memoList');
            const filteredMemos = memos.filter(memo => {
                if (currentTab === 'all') return true;
                return memo.status === currentTab;
            });
            
            if (filteredMemos.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: #718096; padding: 40px 0;">暂无备忘录</p>';
                return;
            }
            
            container.innerHTML = filteredMemos.map(memo => \`
                <div class="memo-item" data-id="\${memo.id}">
                    <div class="memo-header">
                        <span class="memo-title">\${memo.title}</span>
                        <span class="memo-priority priority-\${memo.priority}">\${memo.priority === 'high' ? '高' : memo.priority === 'medium' ? '中' : '低'}</span>
                    </div>
                    <div class="memo-content">\${memo.content}</div>
                    <div class="memo-meta">
                        <span>📅 \${memo.date} ⏰ \${memo.time} 📂 \${memo.category}</span>
                        <span>\${memo.reminder?.enabled ? '🔔' : ''}</span>
                    </div>
                    <div style="margin-top: 10px; display: flex; gap: 8px;">
                        <button class="btn" onclick="editMemo('\${memo.id}')" style="padding: 5px 10px; font-size: 12px;">编辑</button>
                        <button class="btn" onclick="toggleMemoStatus('\${memo.id}', '\${memo.status}')" style="padding: 5px 10px; font-size: 12px; background: \${memo.status === 'completed' ? '#48bb78' : '#4299e1'}">
                            \${memo.status === 'completed' ? '标记为待办' : '标记完成'}
                        </button>
                        <button class="btn" onclick="deleteMemo('\${memo.id}')" style="padding: 5px 10px; font-size: 12px; background: #f56565;">删除</button>
                    </div>
                </div>
            \`).join('');
        }
        
        // 切换标签页
        function switchTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            loadMemos();
        }
        
        // 新增备忘录
        function addMemo() {
            currentMemoId = null;
            document.getElementById('modalTitle').textContent = '新建备忘录';
            document.getElementById('memoTitle').value = '';
            document.getElementById('memoContent').value = '';
            
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('memoDate').value = today;
            document.getElementById('memoTime').value = '09:00';
            document.getElementById('memoCategory').value = 'default';
            document.getElementById('memoPriority').value = 'medium';
            document.getElementById('enableReminder').checked = false;
            document.getElementById('reminderSettings').style.display = 'none';
            
            const now = new Date();
            const reminderTime = new Date(now.getTime() + 60 * 60 * 1000); // 1小时后
            const reminderTimeStr = reminderTime.toISOString().slice(0, 16);
            document.getElementById('reminderDateTime').value = reminderTimeStr;
            
            document.getElementById('memoModal').style.display = 'block';
        }
        
        // 编辑备忘录
        async function editMemo(id) {
            const memo = memos.find(m => m.id === id);
            if (!memo) return;
            
            currentMemoId = id;
            document.getElementById('modalTitle').textContent = '编辑备忘录';
            document.getElementById('memoTitle').value = memo.title;
            document.getElementById('memoContent').value = memo.content;
            document.getElementById('memoDate').value = memo.date;
            document.getElementById('memoTime').value = memo.time;
            document.getElementById('memoCategory').value = memo.category;
            document.getElementById('memoPriority').value = memo.priority;
            document.getElementById('enableReminder').checked = memo.reminder?.enabled || false;
            
            if (memo.reminder?.dateTime) {
                const dt = new Date(memo.reminder.dateTime);
                const dtStr = dt.toISOString().slice(0, 16);
                document.getElementById('reminderDateTime').value = dtStr;
                document.getElementById('advanceMinutes').value = memo.reminder.advanceMinutes || 10;
                document.getElementById('reminderRepeat').value = memo.reminder.repeat || 'none';
            }
            
            document.getElementById('reminderSettings').style.display = memo.reminder?.enabled ? 'block' : 'none';
            document.getElementById('memoModal').style.display = 'block';
        }
        
        // 切换提醒设置显示
        function toggleReminderSettings() {
            const enabled = document.getElementById('enableReminder').checked;
            document.getElementById('reminderSettings').style.display = enabled ? 'block' : 'none';
        }
        
        // 保存备忘录
        async function saveMemo() {
            const memoData = {
                title: document.getElementById('memoTitle').value,
                content: document.getElementById('memoContent').value,
                date: document.getElementById('memoDate').value,
                time: document.getElementById('memoTime').value,
                category: document.getElementById('memoCategory').value,
                priority: document.getElementById('memoPriority').value,
                reminder: {
                    enabled: document.getElementById('enableReminder').checked,
                    dateTime: document.getElementById('reminderDateTime').value,
                    advanceMinutes: parseInt(document.getElementById('advanceMinutes').value),
                    repeat: document.getElementById('reminderRepeat').value
                }
            };
            
            if (!memoData.title.trim()) {
                alert('请输入标题');
                return;
            }
            
            try {
                const url = currentMemoId ? \`/api/memos/\${currentMemoId}\` : '/api/memos';
                const method = currentMemoId ? 'PUT' : 'POST';
                
                const response = await fetch(url, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': \`Bearer \${currentUser}\`
                    },
                    body: JSON.stringify(memoData)
                });
                
                if (response.ok) {
                    closeModal();
                    loadMemos();
                    loadStats();
                } else {
                    const error = await response.json();
                    alert(error.error || '保存失败');
                }
            } catch (error) {
                console.error('保存失败:', error);
                alert('保存失败');
            }
        }
        
        // 切换备忘录状态
        async function toggleMemoStatus(id, currentStatus) {
            const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
            
            try {
                const response = await fetch(\`/api/memos/\${id}\`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': \`Bearer \${currentUser}\`
                    },
                    body: JSON.stringify({ status: newStatus })
                });
                
                if (response.ok) {
                    loadMemos();
                    loadStats();
                }
            } catch (error) {
                console.error('更新状态失败:', error);
            }
        }
        
        // 删除备忘录
        async function deleteMemo(id) {
            if (!confirm('确定删除这个备忘录吗？')) return;
            
            try {
                const response = await fetch(\`/api/memos/\${id}\`, {
                    method: 'DELETE',
                    headers: { 'Authorization': \`Bearer \${currentUser}\` }
                });
                
                if (response.ok) {
                    loadMemos();
                    loadStats();
                }
            } catch (error) {
                console.error('删除失败:', error);
            }
        }
        
        // 关闭模态框
        function closeModal() {
            document.getElementById('memoModal').style.display = 'none';
        }
        
        // 显示系统配置
        async function showConfig() {
            // 加载当前配置到表单
            document.getElementById('configTimezone').value = config.timezone || 8;
            document.getElementById('enableNotifications').checked = config.notification?.enabled !== false;
            document.getElementById('allowNotificationHours').value = config.allowNotificationHours?.join(',') || '8,12,18,20';
            
            // 通知配置
            document.getElementById('telegramBotToken').value = config.notification?.telegram?.botToken || '';
            document.getElementById('telegramChatId').value = config.notification?.telegram?.chatId || '';
            document.getElementById('webhookUrl').value = config.notification?.webhook?.url || '';
            document.getElementById('webhookMethod').value = config.notification?.webhook?.method || 'POST';
            document.getElementById('webhookTemplate').value = config.notification?.webhook?.template || '{{title}}\\n{{content}}\\n时间: {{time}}';
            document.getElementById('barkServer').value = config.notification?.bark?.server || 'https://api.day.app';
            document.getElementById('barkDeviceKey').value = config.notification?.bark?.deviceKey || '';
            
            switchConfigTab('general');
            document.getElementById('configModal').style.display = 'block';
        }
        
        // 切换配置标签页
        function switchConfigTab(tab) {
            document.querySelectorAll('#configModal .tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            
            document.getElementById('generalConfig').style.display = tab === 'general' ? 'block' : 'none';
            document.getElementById('notificationConfig').style.display = tab === 'notification' ? 'block' : 'none';
            document.getElementById('securityConfig').style.display = tab === 'security' ? 'block' : 'none';
        }
        
        // 保存配置
        async function saveConfig() {
            const configData = {
                timezone: parseInt(document.getElementById('configTimezone').value),
                notification: {
                    enabled: document.getElementById('enableNotifications').checked,
                    telegram: {
                        botToken: document.getElementById('telegramBotToken').value,
                        chatId: document.getElementById('telegramChatId').value
                    },
                    webhook: {
                        url: document.getElementById('webhookUrl').value,
                        method: document.getElementById('webhookMethod').value,
                        template: document.getElementById('webhookTemplate').value
                    },
                    bark: {
                        server: document.getElementById('barkServer').value,
                        deviceKey: document.getElementById('barkDeviceKey').value
                    }
                },
                allowNotificationHours: document.getElementById('allowNotificationHours').value
                    .split(',')
                    .map(h => parseInt(h.trim()))
                    .filter(h => !isNaN(h) && h >= 0 && h < 24)
            };
            
            // 检查密码修改
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (newPassword) {
                if (newPassword === confirmPassword) {
                    configData.adminPassword = btoa(newPassword);
                } else {
                    alert('两次输入的密码不一致');
                    return;
                }
            }
            
            try {
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': \`Bearer \${currentUser}\`
                    },
                    body: JSON.stringify(configData)
                });
                
                if (response.ok) {
                    config = await response.json();
                    alert('配置已保存');
                    closeConfig();
                } else {
                    const error = await response.json();
                    alert(error.error || '保存配置失败');
                }
            } catch (error) {
                console.error('保存配置失败:', error);
                alert('保存配置失败');
            }
        }
        
        // 测试通知
        async function testNotification(type) {
            try {
                const response = await fetch('/api/reminders/test', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': \`Bearer \${currentUser}\`
                    },
                    body: JSON.stringify({ type, message: '测试通知消息' })
                });
                
                const result = await response.json();
                alert(result.message);
            } catch (error) {
                console.error('测试通知失败:', error);
                alert('测试通知失败');
            }
        }
        
        // 关闭配置模态框
        function closeConfig() {
            document.getElementById('configModal').style.display = 'none';
        }
        
        // 加载日历
        function loadCalendar() {
            const calendarEl = document.getElementById('calendar');
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth();
            
            let html = \`<div class="calendar-month">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <span>\${year}年\${month + 1}月</span>
                    <span style="color: #667eea;">今天</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px;">
                    <div style="text-align: center; font-size: 12px; color: #718096;">日</div>
                    <div style="text-align: center; font-size: 12px; color: #718096;">一</div>
                    <div style="text-align: center; font-size: 12px; color: #718096;">二</div>
                    <div style="text-align: center; font-size: 12px; color: #718096;">三</div>
                    <div style="text-align: center; font-size: 12px; color: #718096;">四</div>
                    <div style="text-align: center; font-size: 12px; color: #718096;">五</div>
                    <div style="text-align: center; font-size: 12px; color: #718096;">六</div>
            \`;
            
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const startDay = firstDay.getDay();
            const daysInMonth = lastDay.getDate();
            
            // 填充空白
            for (let i = 0; i < startDay; i++) {
                html += '<div></div>';
            }
            
            // 填充日期
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = \`\${year}-\${(month + 1).toString().padStart(2, '0')}-\${day.toString().padStart(2, '0')}\`;
                const dayMemos = memos.filter(m => m.date === dateStr);
                const hasMemos = dayMemos.length > 0;
                const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                
                html += \`<div style="text-align: center; padding: 5px; border-radius: 6px; cursor: pointer; \${isToday ? 'background: #667eea; color: white;' : hasMemos ? 'background: #f7fafc;' : ''}" onclick="filterByDate('\${dateStr}')">
                    \${day}
                    \${hasMemos ? '<div style="font-size: 10px; color: #48bb78;">' + dayMemos.length + '</div>' : ''}
                </div>\`;
            }
            
            html += '</div></div>';
            calendarEl.innerHTML = html;
        }
        
        // 按日期筛选
        function filterByDate(date) {
            // 这里可以扩展为按日期筛选备忘录
            alert('筛选日期: ' + date);
        }
        
        // 加载统计
        function loadStats() {
            const statsEl = document.getElementById('stats');
            const pendingCount = memos.filter(m => m.status === 'pending').length;
            const completedCount = memos.filter(m => m.status === 'completed').length;
            const highPriorityCount = memos.filter(m => m.priority === 'high').length;
            const today = new Date().toISOString().split('T')[0];
            const todayCount = memos.filter(m => m.date === today).length;
            
            statsEl.innerHTML = \`
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #718096;">待办事项</div>
                    <div style="font-size: 18px; font-weight: 600;">\${pendingCount}</div>
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #718096;">已完成</div>
                    <div style="font-size: 18px; font-weight: 600;">\${completedCount}</div>
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #718096;">高优先级</div>
                    <div style="font-size: 18px; font-weight: 600;">\${highPriorityCount}</div>
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #718096;">今日事项</div>
                    <div style="font-size: 18px; font-weight: 600;">\${todayCount}</div>
                </div>
            \`;
        }
        
        // 页面加载时初始化
        document.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>`;
}