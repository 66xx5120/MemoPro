# Memo Pro - 基于Cloudflare Workers的智能备忘录系统

要实现“后端能力对齐SubsTracker + 前端界面完全保留原版Memo”，在原版Memo的完整HTML/CSS/JS基础上，将数据存储和通知逻辑从“浏览器IndexedDB”替换为“调用Worker API”。

保留：原版Memo的完整HTML结构、所有CSS配色主题、农历显示、多月份渲染逻辑、进度统计、到期弹窗。

替换：前端的数据读写对象（从IndexedDB换成fetch API调用）。

新增：Worker后端的KV存储、定时任务、多通道通知。

memo-pro/

├── index.js          # Cloudflare Worker（完全复用SubsTracker架构）

└── wrangler.toml     # 配置文件

不需要独立的HTML文件，因为原版Memo的完整前端代码将直接内嵌在Worker返回的HTML字符串中，保持单文件部署的便捷性。

wrangler.toml（与SubsTracker一致）

index.js（完整代码）此文件包含三大部分：

后端API（配置管理、备忘录CRUD、定时提醒）—— 架构完全复制SubsTracker

前端界面——完整复刻memo-akr.pages.dev的HTML/CSS/JS，仅替换数据持久化层

通知渠道（Telegram、Bark、Webhook）—— 直接移植SubsTracker的发送函数

# 部署步骤（Cloudflare Dashboard网页版）

第一步：创建KV命名空间

登录 Cloudflare Dashboard

进入 Workers & Pages → KV

点击 创建命名空间，命名为 MEMO_KV

复制生成的 命名空间ID，将上面命令输出的 ID 替换到wrangler.toml 中的 KV ID

第二步：创建Worker

Workers & Pages → 创建应用程序 → Worker

给Worker命名（例如 memo-pro）

点击 编辑代码，将上面的 index.js 完整代码粘贴覆盖编辑器内容

重点：将代码中的 lunarInfo 数组和 getLunar 函数替换为原版Memo的完整农历实现（从 memo-akr.pages.dev 的源代码中复制）

第三步：绑定KV命名空间

在Worker编辑页面，进入 设置 → 变量

找到 KV命名空间绑定，点击 添加绑定

变量名称：MEMO_KV

KV命名空间：选择刚创建的 MEMO_KV

点击 保存并部署

第四步：添加定时触发器

在 设置 → 触发器

找到 Cron触发器，点击 添加Cron触发器

输入 0 0,12 * * *（每天UTC 0点和12点）

点击 保存

第五步：首次登录

访问 https://你的worker名.你的用户名.workers.dev

默认密码：admin123

立即进入系统配置修改密码并设置通知渠道

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
