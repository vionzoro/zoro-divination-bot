/**
 * 简单的日志工具
 *
 * 生产环境建议换成 Winston 或 Pino 这类更完整的日志库
 * 这里为了轻量，直接用 console.log 加时间戳
 */
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
};
function timestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
export const logger = {
    info: (message, ...args) => {
        console.log(`${colors.green}[INFO]${colors.reset}  ${timestamp()} - ${message}`, ...args);
    },
    warn: (message, ...args) => {
        console.log(`${colors.yellow}[WARN]${colors.reset}  ${timestamp()} - ${message}`, ...args);
    },
    error: (message, ...args) => {
        console.error(`${colors.red}[ERROR]${colors.reset} ${timestamp()} - ${message}`, ...args);
    },
    debug: (message, ...args) => {
        if (process.env.DEBUG) {
            console.log(`${colors.cyan}[DEBUG]${colors.reset} ${timestamp()} - ${message}`, ...args);
        }
    },
};
