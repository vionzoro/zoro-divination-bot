/**
 * SQLite 数据库模块 —— 持久化对话历史与用户配额
 * 
 * 为什么用 SQLite：
 * - 单机部署足够用（Telegram bot 通常不需要分布式）
 * - 无需额外安装数据库服务（文件型数据库）
 * - 重启程序不丢对话历史
 * 
 * 表结构：
 * - messages: 每条对话消息（用于构建对话上下文）
 * - daily_usage: 每用户每日 API 调用次数（用于限流）
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "bot.db");

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// ---------- 初始化表结构 ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

  CREATE TABLE IF NOT EXISTS daily_usage (
    chat_id INTEGER NOT NULL,
    date TEXT NOT NULL,  -- YYYY-MM-DD 格式
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, date)
  );
`);

// ---------- 消息历史操作 ----------
export function getHistory(chatId: number, maxMessages: number): Array<{ role: "user" | "assistant"; content: string }> {
  const rows = db.prepare(`
    SELECT role, content FROM messages
    WHERE chat_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(chatId, maxMessages) as Array<{ role: string; content: string }>;
  
  // SQLite 返回的是按 created_at DESC 排序的，需要反转回来（旧的在前，新的在后）
  return rows.reverse().map(row => ({
    role: row.role as "user" | "assistant",
    content: row.content,
  }));
}

export function pushMessage(chatId: number, role: "user" | "assistant", content: string): void {
  db.prepare(`
    INSERT INTO messages (chat_id, role, content, created_at)
    VALUES (?, ?, ?, strftime('%s', 'now'))
  `).run(chatId, role, content);
}

export function resetHistory(chatId: number): void {
  db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
}

export function pruneHistory(chatId: number, maxMessages: number): void {
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?`).get(chatId) as { cnt: number };
  if (count.cnt > maxMessages) {
    // 删除最旧的那些，只保留最新的 maxMessages 条
    const toDelete = db.prepare(`
      SELECT id FROM messages
      WHERE chat_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(chatId, count.cnt - maxMessages) as Array<{ id: number }>;
    
    const ids = toDelete.map(row => row.id).join(',');
    if (ids) {
      db.exec(`DELETE FROM messages WHERE id IN (${ids})`);
    }
  }
}

// ---------- 每日配额操作 ----------
export function incrementDailyUsage(chatId: number): number {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const existing = db.prepare(`SELECT count FROM daily_usage WHERE chat_id = ? AND date = ?`).get(chatId, today) as { count: number } | undefined;
  
  if (existing) {
    db.prepare(`UPDATE daily_usage SET count = count + 1 WHERE chat_id = ? AND date = ?`).run(chatId, today);
    return existing.count + 1;
  } else {
    db.prepare(`INSERT INTO daily_usage (chat_id, date, count) VALUES (?, ?, 1)`).run(chatId, today);
    return 1;
  }
}

export function getDailyUsage(chatId: number): number {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare(`SELECT count FROM daily_usage WHERE chat_id = ? AND date = ?`).get(chatId, today) as { count: number } | undefined;
  return row?.count ?? 0;
}

// ---------- 关闭数据库 ----------
export function closeDb(): void {
  db.close();
}
