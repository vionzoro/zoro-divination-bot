/**
 * 简单JSON文件存储 —— 零原生依赖，不用编译，跨平台稳定
 * 存聊天历史和每日配额，数据量小完全够用
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

// 数据结构
interface DBData {
  messages: Record<number, Array<{ role: "user" | "assistant"; content: string; time: number }>>;
  dailyUsage: Record<string, number>; // key: `${chatId}-${YYYY-MM-DD}`
}

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 加载数据
let db: DBData = { messages: {}, dailyUsage: {} };
if (fs.existsSync(DB_PATH)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch (e) {
    console.log("数据库文件损坏，重新创建");
  }
}

// 保存数据到文件
function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("保存数据失败:", e);
  }
}

// ---------- 消息历史操作 ----------
export function getHistory(chatId: number, maxMessages: number): Array<{ role: "user" | "assistant"; content: string }> {
  const msgs = db.messages[chatId] || [];
  return msgs.slice(-maxMessages).map(m => ({ role: m.role, content: m.content }));
}

export function pushMessage(chatId: number, role: "user" | "assistant", content: string): void {
  if (!db.messages[chatId]) db.messages[chatId] = [];
  db.messages[chatId].push({ role, content, time: Date.now() });
  saveDb();
}

export function resetHistory(chatId: number): void {
  db.messages[chatId] = [];
  saveDb();
}

export function pruneHistory(chatId: number, maxMessages: number): void {
  if (!db.messages[chatId]) return;
  if (db.messages[chatId].length > maxMessages) {
    db.messages[chatId] = db.messages[chatId].slice(-maxMessages);
    saveDb();
  }
}

// ---------- 每日配额操作 ----------
export function incrementDailyUsage(chatId: number): number {
  const today = new Date().toISOString().split('T')[0];
  const key = `${chatId}-${today}`;
  db.dailyUsage[key] = (db.dailyUsage[key] || 0) + 1;
  saveDb();
  return db.dailyUsage[key];
}

export function getDailyUsage(chatId: number): number {
  const today = new Date().toISOString().split('T')[0];
  const key = `${chatId}-${today}`;
  return db.dailyUsage[key] || 0;
}

export function closeDb(): void {
  saveDb();
}
