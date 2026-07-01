# 观微 - Telegram 求道者 Bot

一个通达九大领域知识的 Telegram AI bot，可以和你深入对话：
- 📿 **佛法**：禅修、空性、唯识、中观、公案
- ☯️ **道法**：道德经、庄子、内丹、阴阳五行
- 🔮 **易学**：易经、梅花易数、八字、面相手相
- 🌌 **宇宙学**：大爆炸、黑洞、暗物质、多重宇宙
- ⚛️ **量子力学**：双缝干涉、叠加态、量子纠缠
- 🧠 **脑神经科学**：意识、神经可塑性、冥想脑科学
- 🤖 **AI**：大模型、通用人工智能、技术奇点
- ⛓️ **Web3**：比特币、以太坊、共识机制、密码朋克
- 🎮 **游戏**：游戏设计、独立游戏、元宇宙、游戏哲学

擅长跨学科对话，在东方智慧、现代科学与数字文化之间架起桥梁。

## 功能特性

- 💬 自然聊天风格，不像AI说教
- 🧠 长时记忆，记得之前聊过的内容
- 🖼️ 图片识别，支持面相手相分析
- 🎤 语音消息，自动转文字对话
- 🔄 多模型自动切换，免费API额度用完自动降级
- ⚡ 速度快，支持多用户同时使用
- 📊 SQLite 本地持久化，重启不丢数据

## 快速开始

### 1. 创建 Telegram Bot

1. 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，按照提示创建bot
3. 复制获得的 Bot Token

### 2. 获取 API Key（至少配置一个）

**推荐：Google Gemini（免费额度最高，支持图片+语音）**
- 访问 https://aistudio.google.com/apikey
- 创建 API Key，免费额度每天 1500 次请求，完全够用

可选：
- OpenRouter: https://openrouter.ai/keys （有多个免费模型）
- Groq: https://console.groq.com/keys （速度最快）

### 3. 配置环境变量

```bash
# 复制配置文件
cp .env.example .env

# 编辑 .env 文件，填入你的 Token 和 API Key
```

编辑 `.env` 文件：
```env
TELEGRAM_BOT_TOKEN=你从BotFather获得的token
GOOGLE_API_KEY=你从Google AI Studio获得的key
```

### 4. 安装依赖并运行

```bash
# 安装依赖
npm install

# 开发模式运行（自动重启）
npm run dev

# 或者生产模式
npm run build
npm start
```

看到 `Bot 正在运行，开始接收消息...` 就成功了！

现在去 Telegram 找到你的 bot，发送 `/start` 开始聊天。

## 部署

### 本地运行
```bash
npm start
```
保持终端开着就行，关闭就停止了。

### 后台运行（PM2）
```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name guanwei-bot
pm2 startup
pm2 save
```

### Vercel / Render / Railway
这个项目是标准的 Node.js 项目，直接部署即可，记得设置环境变量。

## 常用命令

- `/start` - 开始对话
- `/reset` - 清空记忆，重新开始
- `/help` - 显示帮助

## 聊天提示

1. **想到什么说什么** - 不用刻意组织语言，像和朋友聊天一样
2. **可以追问** - 没说清楚的地方可以继续问，"为什么？"、"再说说这个"
3. **可以跨界** - 比如问"用量子力学怎么解释禅修？"，这是它最擅长的
4. **发图片** - 发人脸或手掌照片，可以看相
5. **发语音** - 直接说话就行，它能听懂

## 项目结构

```
.
├── index.ts          # Bot 主入口，消息处理
├── persona.ts        # 人格设定，核心灵魂
├── ai-service.ts     # AI 服务封装，多模型切换
├── db.ts             # SQLite 数据库，消息存储
├── logger.ts         # 日志工具
├── data/             # 数据库文件目录
├── package.json
├── tsconfig.json
└── .env              # 配置文件（自己创建）
```

## 自定义修改

想调整bot的性格或知识范围？直接编辑 `persona.ts` 里的 `SYSTEM_PROMPT`，改完重启就行。

## 注意事项

- 这是一个聊天伙伴，不是算命先生，不要问具体的彩票号码、股票预测
- 涉及医疗、法律等专业问题请咨询专业人士
- 玄学内容是传统文化视角，仅供参考，不要迷信
- 免费API有额度限制，省着点用，一个人用完全够
