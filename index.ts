import "dotenv/config";
import { Telegraf, Context } from "telegraf";
import { SYSTEM_PROMPT, WELCOME_MESSAGE } from "./persona.js";
import { getHistory, pushMessage, resetHistory, pruneHistory, incrementDailyUsage, closeDb } from "./db.js";
import { logger } from "./logger.js";
import express from "express";
import { callAI, analyzeImage } from "./ai-service.js";

// ---------- 基础校验 ----------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("缺少 TELEGRAM_BOT_TOKEN，请检查 .env 文件");
}

const MAX_TOKENS = 1024;
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES) || 30; // 更短的上下文，更快响应
const DAILY_MESSAGE_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT) || 500;

const bot = new Telegraf<Context>(TELEGRAM_BOT_TOKEN);

// ---------- Express 服务器（用于健康检查） ----------
const app: express.Express = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.send('OK - Guanwei Wisdom Bot is running');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Vercel 需要导出 app
export default app;

const server = app.listen(PORT, () => {
  logger.info(`HTTP 服务器已启动，监听端口 ${PORT}`);
});

// ---------- 节流（防止手抖连点） ----------
const lastRequestAt = new Map<number, number>();
const MIN_INTERVAL_MS = 2000; // 稍微放宽一点，深度思考需要时间

function isThrottled(chatId: number): boolean {
  const now = Date.now();
  const last = lastRequestAt.get(chatId) ?? 0;
  if (now - last < MIN_INTERVAL_MS) return true;
  lastRequestAt.set(chatId, now);
  return false;
}

// ---------- 群聊中是否应该回复 ----------
let botUsername = "";
function shouldRespondInGroup(text: string, isReplyToBot: boolean): boolean {
  if (isReplyToBot) return true;
  if (botUsername && text.includes(`@${botUsername}`)) return true;
  return false;
}

// ---------- 指令 ----------
bot.command("start", (ctx) => {
  ctx.reply(WELCOME_MESSAGE);
});

bot.command("reset", (ctx) => {
  resetHistory(ctx.chat.id);
  ctx.reply("好，之前的对话我已经放下了。我们重新开始，今天想聊点什么？");
});

bot.command("help", (ctx) => {
  ctx.reply(`我是观微，可以和我聊：
佛法、道法、易学、宇宙学、量子力学、脑神经科学、AI、Web3、游戏
想到什么说什么就好，不用客气。

/reset - 清空对话记忆，重新开始
/help - 显示这条帮助
发图片可以看相，发语音我也能听`);
});

// ---------- API 错误处理 ----------
function describeApiError(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (message.includes("401") || message.includes("unauthorized")) {
      return "API Key 好像失效了，需要检查一下配置。";
    }
    if (message.includes("429") || message.includes("rate limit")) {
      return "问的人有点多，我喘口气，几秒后再试一次？";
    }
    if (message.includes("503") || message.includes("unavailable")) {
      return "AI 那边暂时挤爆了，稍等一下再问我。";
    }
    return `刚才走神了，网络好像抖了一下，稍后再试一次？`;
  }
  return "刚才有点卡，再发一次试试？";
}

// ---------- 下载 Telegram 图片并转为 base64 ----------
async function downloadPhoto(ctx: Context, fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href || fileLink.toString());
  
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.statusText}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = buffer[0] === 0xFF && buffer[1] === 0xD8 ? "image/jpeg" :
                   buffer[0] === 0x89 && buffer[1] === 0x50 ? "image/png" :
                   "image/jpeg";
  
  return { buffer, mimeType };
}

// ---------- 构建消息历史 ----------
function buildMessages(chatId: number, maxMessages: number): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const history = getHistory(chatId, maxMessages);
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  let lastRole: string | null = null;
  
  for (const msg of history) {
    if (msg.role === lastRole) {
      // 合并连续相同角色的消息
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && typeof lastMessage.content === 'string') {
        lastMessage.content += '\n' + msg.content;
      }
    } else {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
      lastRole = msg.role;
    }
  }
  
  return messages;
}

// ---------- 核心：文本消息处理 ----------
bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  
  const chatId = ctx.chat.id;
  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
  const isReplyToBot =
    "reply_to_message" in ctx.message &&
    ctx.message.reply_to_message?.from?.username === botUsername;
  
  if (isGroup && !shouldRespondInGroup(text, Boolean(isReplyToBot))) {
    return;
  }
  
  if (isThrottled(chatId)) {
    return;
  }
  
  const usedToday = incrementDailyUsage(chatId);
  if (usedToday > DAILY_MESSAGE_LIMIT) {
    await ctx.reply("今天聊得有点深了，脑子有点转不动，明天我们继续？");
    return;
  }
  
  pushMessage(chatId, "user", text);
  
  try {
    await ctx.sendChatAction("typing");
    
    const messages = buildMessages(chatId, MAX_HISTORY_MESSAGES);
    
    // 添加系统提示
    const systemMessage = {
      role: "system" as const,
      content: SYSTEM_PROMPT,
    };
    
    const allMessages = [systemMessage, ...messages];
    
    // 使用 AI 服务（自动选择 Gemini/OpenRouter/Groq）
    logger.info(`处理消息，上下文长度: ${allMessages.length}`);
    const reply = await callAI(allMessages, MAX_TOKENS);
    
    if (reply) {
      pushMessage(chatId, "assistant", reply);
      pruneHistory(chatId, MAX_HISTORY_MESSAGES);
      await ctx.reply(reply, { reply_parameters: { message_id: ctx.message.message_id } });
    }
  } catch (err) {
    logger.error(`chat ${chatId} 调用 AI 失败:`, err);
    await ctx.reply(describeApiError(err));
  }
});

// ---------- 核心：图片消息处理（面相/手相） ----------
bot.on("photo", async (ctx) => {
  const chatId = ctx.chat.id;
  
  if (isThrottled(chatId)) {
    return;
  }
  
  const usedToday = incrementDailyUsage(chatId);
  if (usedToday > DAILY_MESSAGE_LIMIT) {
    await ctx.reply("今天看得有点多了，眼睛有点花，明天再帮你看？");
    return;
  }
  
  try {
    await ctx.sendChatAction("upload_photo");
    
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    logger.info(`chat ${chatId} 收到图片，file_id: ${fileId}`);
    
    const { buffer, mimeType } = await downloadPhoto(ctx, fileId);
    const base64Image = buffer.toString('base64');
    logger.debug(`图片下载完成，大小: ${buffer.length} bytes, 类型: ${mimeType}`);
    
    const userMessage = ctx.message.caption || "请帮我看看这张照片，从传统相学和现代视角都说说";
    pushMessage(chatId, "user", `[图片] ${userMessage}`);
    
    // 使用 AI 服务分析图片
    const reply = await analyzeImage(base64Image, mimeType, userMessage);
    
    if (reply) {
      pushMessage(chatId, "assistant", reply);
      pruneHistory(chatId, MAX_HISTORY_MESSAGES);
      await ctx.reply(reply, { reply_parameters: { message_id: ctx.message.message_id } });
    }
  } catch (err) {
    logger.error(`chat ${chatId} 处理图片失败:`, err);
    await ctx.reply("抱歉，刚才看走眼了。可能是图片格式问题，或者网络有点卡，再发一次试试？");
  }
});

// ---------- 核心：语音消息处理（语音转文字） ----------
bot.on("voice", async (ctx) => {
  const chatId = ctx.chat.id;
  
  if (isThrottled(chatId)) {
    return;
  }
  
  const usedToday = incrementDailyUsage(chatId);
  if (usedToday > DAILY_MESSAGE_LIMIT) {
    await ctx.reply("今天听了太多了，耳朵有点累，明天再聊？");
    return;
  }
  
  try {
    await ctx.sendChatAction("typing");
    
    const voice = ctx.message.voice;
    const fileId = voice.file_id;
    const duration = voice.duration;
    logger.info(`chat ${chatId} 收到语音消息，时长: ${duration}秒，file_id: ${fileId}`);
    
    // 下载语音文件
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.href || fileLink.toString());
    
    if (!response.ok) {
      throw new Error(`下载语音失败: ${response.statusText}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    logger.debug(`语音下载完成，大小: ${buffer.length} bytes`);
    
    // 转文字
    const transcribedText = await transcribeVoice(buffer, duration);
    
    if (!transcribedText || transcribedText.includes("语音识别暂时不可用")) {
      await ctx.reply("抱歉，刚才没听清。环境有点吵或者口音有点重，要不还是发文字吧？");
      return;
    }
    
    logger.info(`语音转文字成功: ${transcribedText}`);
    
    // 将转文字结果当作普通文本消息处理
    const userMessage = transcribedText;
    pushMessage(chatId, "user", `[语音] ${userMessage}`);
    
    await ctx.sendChatAction("typing");
    
    const messages = buildMessages(chatId, MAX_HISTORY_MESSAGES);
    
    const systemMessage = {
      role: "system" as const,
      content: SYSTEM_PROMPT,
    };
    
    const allMessages = [systemMessage, ...messages];
    
    const reply = await callAI(allMessages, MAX_TOKENS);
    
    if (reply) {
      pushMessage(chatId, "assistant", reply);
      pruneHistory(chatId, MAX_HISTORY_MESSAGES);
      await ctx.reply(reply, { reply_parameters: { message_id: ctx.message.message_id } });
    }
  } catch (err) {
    logger.error(`chat ${chatId} 处理语音失败:`, err);
    await ctx.reply("抱歉，刚才没听清楚。再说一遍？或者发文字也行。");
  }
});

// ---------- 下载语音并转文字 ----------
async function transcribeVoice(buffer: Buffer, duration: number): Promise<string> {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  
  if (GOOGLE_API_KEY && GOOGLE_API_KEY !== "") {
    try {
      console.log(`[语音转文字] 使用 Google Gemini API...`);
      
      const base64Audio = buffer.toString('base64');
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "请准确转录这段语音的内容，只返回文字，不要加任何解释。如果是中文就返回中文，英文就返回英文。" },
                { 
                  inline_data: {
                    mime_type: "audio/ogg",
                    data: base64Audio
                  }
                }
              ]
            }],
            generationConfig: {
              maxOutputTokens: 1024,
              temperature: 0.1,
            },
          }),
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API 失败: ${response.status} - ${errorText}`);
      }
      
      const data: any = await response.json();
      const transcribedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      console.log(`[语音转文字] Gemini API 成功，转录长度: ${transcribedText.length}`);
      return transcribedText;
      
    } catch (err: any) {
      console.error(`[语音转文字] Gemini API 调用失败: ${err.message}`);
    }
  }
  
  return `[语音消息 ${duration}秒（语音识别暂时不可用，请发送文字消息）]`;
}

// ---------- 启动 Bot ----------
async function main() {
  try {
    const me = await bot.telegram.getMe();
    botUsername = me.username || "";
    logger.info(`观微 bot 已启动：@${botUsername}`);
    logger.info(`支持领域：佛法 | 道法 | 易学 | 宇宙学 | 量子力学 | 脑神经科学 | AI | Web3 | 游戏`);
    
    // 删除已有的 Webhook，改用 Polling
    await bot.telegram.deleteWebhook();
    logger.info('Webhook 已删除，使用 Polling 模式');
    
    await bot.launch();
    logger.info('Bot 正在运行，开始接收消息...');
  } catch (err) {
    logger.error("启动失败:", err);
    process.exit(1);
  }
}

main();

// ---------- 优雅退出 ----------
function shutdown(signal: string) {
  logger.info(`收到 ${signal}，正在关闭...`);
  bot.stop(signal);
  closeDb();
  server.close();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
