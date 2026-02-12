# Memo Pro - 基于Cloudflare Workers的智能备忘录系统
memo-pro/

├── index.js              # Cloudflare Worker主文件

├── index.html           # 前端界面

├── wrangler.toml        # 项目配置

└── package.json         # 依赖管理

# 部署步骤：
第一步：创建项目文件

将上面提供的三个文件保存到项目文件夹中。

第二步：配置和部署

1. 创建 KV 命名空间

wrangler kv:namespace create "MEMO_KV"

2. 更新 wrangler.toml 中的 KV ID

将上面命令输出的 ID 替换到 wrangler.toml 中

3. 部署到 Cloudflare Workers

# 配置通知渠道

1. Telegram 配置

在 Telegram 中搜索 @BotFather

发送 /newbot 创建新机器人

获取 Bot Token

搜索 @userinfobot 获取 Chat ID

在系统配置中填入以上信息

2. Bark 配置 (iOS)

在 App Store 下载 Bark

打开应用获取设备 Key

在系统配置中填入设备 Key

3. Webhook 配置

提供接收通知的 Webhook URL

自定义请求方法和消息模板

定时任务配置

系统默认配置了两个定时任务：

每天 UTC 0 点和 12 点检查提醒

可根据时区配置调整检查时间

在 wrangler.toml 中修改：

[[triggers]]

schedule = { cron = "0 8 * * *" }  # 每天 UTC 8 点

安全说明

默认密码: admin123

首次登录后务必修改密码

API 认证: Bearer Token 验证

数据加密: 敏感配置信息存储在 KV 中

# 使用流程

部署应用到 Cloudflare Workers

访问应用 URL

登录系统（默认密码: admin123）

配置通知渠道（Telegram/Bark/Webhook）

创建备忘录并设置提醒

享受智能提醒服务

这个重构版本保留了原 Memo 项目的核心功能（日历显示、任务管理），同时增加了 SubsTracker 的架构优势（云端存储、定时任务、多通道通知），形成了一个完整的企业级备忘录系统。

