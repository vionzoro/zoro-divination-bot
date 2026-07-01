import "dotenv/config";
import OpenAI from "openai";
import Groq from "groq-sdk";
// ---------- AI 服务封装 ----------
// 支持多个免费 AI 模型，自动切换
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
// 所有可用的免费模型（按优先级排序，额度高速度快的放前面）
// 总共十几个免费模型，一个挂了自动切下一个，基本不可能全挂
const FREE_MODELS = [
    // Groq 系列 - 速度最快，免费额度最高（每天1万4千次）
    {
        name: "groq-llama-8b",
        enabled: () => !!GROQ_API_KEY,
        call: (messages, maxTokens) => callGroq(messages, maxTokens, "llama-3.1-8b-instant"),
    },
    {
        name: "groq-llama-70b",
        enabled: () => !!GROQ_API_KEY,
        call: (messages, maxTokens) => callGroq(messages, maxTokens, "llama-3.1-70b-versatile"),
    },
    {
        name: "groq-mixtral",
        enabled: () => !!GROQ_API_KEY,
        call: (messages, maxTokens) => callGroq(messages, maxTokens, "mixtral-8x7b-32768"),
    },
    {
        name: "groq-gemma",
        enabled: () => !!GROQ_API_KEY,
        call: (messages, maxTokens) => callGroq(messages, maxTokens, "gemma2-9b-it"),
    },
    // Google Gemini - 支持图片语音
    {
        name: "gemini-2.0-flash",
        enabled: () => !!GOOGLE_API_KEY,
        call: callGemini,
    },
    // OpenRouter 免费模型池 - 模型多，兜底用
    {
        name: "openrouter-llama-3.1-8b",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "meta-llama/llama-3.1-8b-instruct:free"),
    },
    {
        name: "openrouter-llama-3.1-70b",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "meta-llama/llama-3.1-70b-instruct:free"),
    },
    {
        name: "openrouter-gemma-2-9b",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "google/gemma-2-9b-it:free"),
    },
    {
        name: "openrouter-qwen-2.5-7b",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "qwen/qwen-2.5-7b-instruct:free"),
    },
    {
        name: "openrouter-deepseek-r1",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "deepseek/deepseek-r1-distill-llama-70b:free"),
    },
    {
        name: "openrouter-mistral-7b",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "mistralai/mistral-7b-instruct:free"),
    },
    {
        name: "openrouter-phi-3",
        enabled: () => !!OPENROUTER_API_KEY,
        call: (messages, maxTokens) => callOpenRouter(messages, maxTokens, "microsoft/phi-3-medium-128k-instruct:free"),
    },
];
// 输出风格指令（彻底避免 AI 味，完全像真人）
const STYLE_INSTRUCTION = `
【最严格输出要求，必须100%遵守】
1. 完全像真人微信聊天，绝对不能有AI感、客服感、科普感
2. 绝对禁止任何列表、序号、bullet points、1.2.3.、- * 这种标记
3. 绝对禁止"首先、其次、最后、综上所述、总而言之、让我来解释"这种套话
4. 绝对禁止任何emoji表情，一个都不要有
5. 绝对禁止任何Markdown格式，不要粗体斜体标题代码
6. 绝对不要说"作为一个AI"、"根据我的知识"这种话，直接说内容
7. 不用"您好、请问、抱歉"这种礼貌用语，就像朋友聊天
8. 标点正常用，不要一堆感叹号问号，不要波浪线，不要省略号卖关子
9. 句子短一点，口语化一点，可以用"其实吧"、"你想啊"、"说实话"这种开头
10. 想到哪说到哪，不用结构严谨，不用面面俱到，说重点就行
11. 不要每段都很长，该断就断，有时候一句话就够了`;
// 后处理：彻底删除AI痕迹和冗余符号
function postProcessText(text) {
    // 删除所有emoji
    text = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F000}-\u{1F02F}]/gu, '');
    // 删除所有Markdown格式标记
    text = text.replace(/\*\*(.*?)\*\*/g, '$1'); // 粗体
    text = text.replace(/\*(.*?)\*/g, '$1'); // 斜体
    text = text.replace(/`(.*?)`/g, '$1'); // 代码
    text = text.replace(/^#{1,6}\s+/gm, ''); // 标题
    text = text.replace(/^[-*+]\s+/gm, ''); // 列表项
    text = text.replace(/^\d+\.\s+/gm, ''); // 数字列表
    // 删除多余的感叹号（保留一个）
    text = text.replace(/!{2,}/g, '!');
    text = text.replace(/！{2,}/g, '！');
    // 删除多余的问号（保留一个）
    text = text.replace(/\?{2,}/g, '?');
    text = text.replace(/？{2,}/g, '？');
    // 删除所有波浪号
    text = text.replace(/～+/g, '');
    text = text.replace(/~+/g, '');
    // 删除多余的省略号
    text = text.replace(/\.{4,}/g, '...');
    text = text.replace(/。{4,}/g, '……');
    // 删除AI套话开头
    text = text.replace(/^(好的|当然|没问题|很高兴为您服务|让我来|作为一个AI|根据我的理解)[，。：]\s*/g, '');
    // 清理多余空行
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}
// 超时包装，单个模型最多等6秒，卡了直接切
function withTimeout(promise, ms = 6000, name) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`TIMEOUT: ${name} 超时`)), ms);
        })
    ]);
}
// ---------- 调用 AI（自动切换所有免费模型） ----------
export async function callAI(messages, maxTokens = 1024) {
    // 精简风格指令，减少token，速度更快
    const shortStyle = `说人话，像朋友聊天，不要列表不要emoji不要Markdown，口语化，别端着。`;
    const messagesWithStyle = messages.map(m => {
        if (m.role === "system") {
            return {
                ...m,
                content: (typeof m.content === "string" ? m.content : "") + "\n\n" + shortStyle
            };
        }
        return m;
    });
    // 获取所有可用的模型
    const availableModels = FREE_MODELS.filter(m => m.enabled());
    if (availableModels.length === 0) {
        return "刚脑子卡了下，再说一遍？";
    }
    console.log(`[AI Service] 可用模型: ${availableModels.length}个`);
    // 依次尝试所有模型，每个最多等6秒
    for (const model of availableModels) {
        try {
            const result = await withTimeout(model.call(messagesWithStyle, maxTokens), 6000, model.name);
            console.log(`[AI Service] ${model.name} 成功`);
            return result;
        }
        catch (error) {
            console.log(`[AI Service] ${model.name} 不行，切下一个`);
            // 直接下一个，不犹豫
        }
    }
    // 所有模型都失败了，快速返回，不让用户等
    console.error(`[AI Service] 所有模型都挂了`);
    return "网有点卡，等下再聊哈。";
}
// ---------- Google Gemini API ----------
async function callGemini(messages, maxTokens) {
    try {
        console.log(`[Gemini] 开始调用...`);
        // 提取系统提示
        const systemMsg = messages.find(m => m.role === "system");
        const systemPrompt = typeof systemMsg?.content === "string" ? systemMsg.content : "";
        // 构建对话历史，合并连续相同角色
        const contents = [];
        for (const m of messages.filter(m => m.role !== "system")) {
            const role = m.role === "assistant" ? "model" : "user";
            const text = typeof m.content === "string" ? m.content : "[图片/多媒体内容]";
            if (contents.length > 0 && contents[contents.length - 1].role === role) {
                contents[contents.length - 1].parts[0].text += "\n" + text;
            }
            else {
                contents.push({ role, parts: [{ text }] });
            }
        }
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
                contents: contents,
                generationConfig: {
                    maxOutputTokens: maxTokens,
                    temperature: 0.95,
                    topP: 0.95,
                },
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            // 429 配额用完直接抛错，让上层切下一个模型
            if (response.status === 429) {
                throw new Error(`QUOTA_EXCEEDED: ${errorText}`);
            }
            throw new Error(`API 调用失败: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        console.log(`[Gemini] 成功，回复长度: ${text.length}`);
        return postProcessText(text);
    }
    catch (error) {
        console.error(`[Gemini] 调用失败: ${error.message}`);
        throw error;
    }
}
// ---------- OpenRouter API ----------
async function callOpenRouter(messages, maxTokens, model) {
    try {
        console.log(`[OpenRouter] 开始调用，模型: ${model}...`);
        const openai = new OpenAI({
            apiKey: OPENROUTER_API_KEY,
            baseURL: "https://openrouter.ai/api/v1",
        });
        const response = await openai.chat.completions.create({
            model: model,
            max_tokens: maxTokens,
            temperature: 0.95,
            top_p: 0.95,
            messages: messages,
        });
        const text = response.choices[0]?.message?.content?.trim() || "";
        console.log(`[OpenRouter] 成功，回复长度: ${text.length}`);
        return postProcessText(text);
    }
    catch (error) {
        console.error(`[OpenRouter] 调用失败: ${error.message}`);
        throw error;
    }
}
// ---------- Groq API ----------
async function callGroq(messages, maxTokens, model) {
    try {
        console.log(`[Groq] 开始调用，模型: ${model}...`);
        const groq = new Groq({
            apiKey: GROQ_API_KEY,
        });
        const response = await groq.chat.completions.create({
            model: model,
            max_tokens: maxTokens,
            temperature: 0.95,
            top_p: 0.95,
            messages: messages,
        });
        const text = response.choices[0]?.message?.content?.trim() || "";
        console.log(`[Groq] 成功，回复长度: ${text.length}`);
        return postProcessText(text);
    }
    catch (error) {
        console.error(`[Groq] 调用失败: ${error.message}`);
        throw error;
    }
}
// ---------- Mock 模式（测试用） ----------
function getMockResponse(messages) {
    const lastMessage = messages.filter(m => m.role === "user").pop();
    const userText = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : "[图片/多媒体内容]";
    return `【测试模式】收到你的消息："${userText}"
所有免费模型都暂时不可用（可能配额用完或网络问题）
请配置以下任一 API Key 以启用完整的 AI 对话功能：
1. GOOGLE_API_KEY（推荐，免费额度高，支持图片语音）
2. OPENROUTER_API_KEY（有多个免费模型可选）
3. GROQ_API_KEY（速度最快，免费额度高）
或者等待配额恢复后再试`;
}
// ---------- 分析图片（面相/手相） ----------
export async function analyzeImage(base64Image, mimeType, prompt) {
    // 优先使用 Gemini（支持图片分析），加10秒超时
    if (GOOGLE_API_KEY) {
        try {
            return await withTimeout(analyzeImageWithGemini(base64Image, mimeType, prompt), 10000, "gemini图片");
        }
        catch (error) {
            console.log(`[图片分析] Gemini 失败，切下一个`);
        }
    }
    // 其次使用 OpenRouter（支持图片分析），加10秒超时
    if (OPENROUTER_API_KEY) {
        try {
            return await withTimeout(analyzeImageWithOpenRouter(base64Image, mimeType, prompt), 10000, "openrouter图片");
        }
        catch (error) {
            console.log(`[图片分析] OpenRouter 失败`);
        }
    }
    // 都失败了
    return "图片看不太清，你直接说吧。";
}
// ---------- 使用 Gemini 分析图片 ----------
async function analyzeImageWithGemini(base64Image, mimeType, prompt) {
    const systemPrompt = `你是观微，精通面相手相，也懂现代科学。分析图片时：
1. 先客观描述观察到的特征
2. 给出传统相学的解读
3. 补充现代心理学或生理学视角
4. 最后说明相不独论，命运还是掌握在自己手里
保持聊天语气，不要太正式。`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: base64Image
                            }
                        }
                    ]
                }],
            generationConfig: {
                maxOutputTokens: 2048,
                temperature: 0.7,
            },
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`图片分析失败: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return postProcessText(text);
}
// ---------- 使用 OpenRouter 分析图片 ----------
async function analyzeImageWithOpenRouter(base64Image, mimeType, prompt) {
    const openai = new OpenAI({
        apiKey: OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
    });
    const response = await openai.chat.completions.create({
        model: "google/gemini-flash-1.5:free",
        max_tokens: 2048,
        messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${mimeType};base64,${base64Image}`
                        }
                    }
                ]
            }],
    });
    const text = response.choices[0]?.message?.content?.trim() || "";
    return postProcessText(text);
}
