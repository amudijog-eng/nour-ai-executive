const axios = require('axios');
const dbService = require('../db/database');

const AHMAD_PHONE = '962782932611';

class CloudflareAiService {
  constructor() {
    this.primaryModel = process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct';
    this.fallbackModel = '@cf/meta/llama-3.2-3b-instruct';
  }

  getConfig() {
    return {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
      apiToken: process.env.CLOUDFLARE_API_TOKEN || ''
    };
  }

  /**
   * Main generation method for incoming WhatsApp messages
   */
  async generateReply({ fromPhone, senderName, incomingText }) {
    const { accountId, apiToken } = this.getConfig();
    const cleanPhone = (fromPhone || '').replace(/\D/g, '');
    const isOwner = cleanPhone === AHMAD_PHONE || cleanPhone === '0782932611';

    // 1. Fetch recent conversation history from DB for natural continuity
    const history = dbService.getRecentContext ? dbService.getRecentContext(cleanPhone, 6) : [];

    // 2. Build system instructions tailored to the speaker
    let systemPrompt = '';
    if (isOwner) {
      systemPrompt = `أنتِ "نور"، السكرتيرة والمساعدة الشخصية الذكية للأستاذ أحمد العامودي.
تحدثي بلهجة أردنية عفوية، لبقة، محترمة، وودودة جداً (مثال: يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني، ولا يهمك).
كوني سكرتيرة ومساعدة طبيعية وسريعة ومباشرة كإنسان حقيقي، تفهمين ما يطلبه وتساعدينه في أي مهمة أو استفسار أو ترتيب مواعيد أو تفاصيل عمل بدون أي تعقيد.`;
    } else {
      systemPrompt = `أنتِ "نور"، مساعدة وروبوت في مكتب الأستاذ أحمد العامودي (سند تاكسي والخدمات).
تحدثي بلهجة أردنية محترمة، لطيفة، وعفوية (مثال: يا هلا بحضرتك، أهلاً وسهلاً، تكرم، تفضل كيف بقدر أخدمك اليوم؟).
ساعدي العميل أو المتصل بأدب واختصار ووضوح كإنسان طبيعي.`;
    }

    // 3. Build messages array for Cloudflare Workers AI
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Append recent messages
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history) {
        if (h.direction === 'incoming') {
          messages.push({ role: 'user', content: h.text || '' });
        } else if (h.direction === 'outgoing') {
          messages.push({ role: 'assistant', content: h.text || '' });
        }
      }
    }

    // Ensure the latest incoming message is present
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== incomingText) {
      messages.push({ role: 'user', content: incomingText });
    }

    // 4. Try Cloudflare Workers AI primary model, then fallback
    const modelsToTry = [this.primaryModel, this.fallbackModel];
    for (const model of modelsToTry) {
      try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
        const res = await axios.post(
          url,
          { messages },
          {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 12000
          }
        );

        let reply = res.data?.result?.response || res.data?.result?.choices?.[0]?.message?.content;
        if (reply && typeof reply === 'string') {
          reply = reply.trim();
          // Remove any strange markdown wrappers or asterisks if excessive
          reply = reply.replace(/^["']|["']$/g, '').trim();
          if (reply) {
            console.log(`🤖 [Cloudflare AI (${model})] Replied to ${cleanPhone}: "${reply.slice(0, 80)}..."`);
            return reply;
          }
        }
      } catch (err) {
        console.warn(`⚠️ [Cloudflare AI] Failed on model ${model}:`, err.response?.data?.errors || err.message);
      }
    }

    // Safe friendly fallback if Cloudflare is temporarily unreachable
    if (isOwner) {
      return `يا هلا والله أستاذ أحمد 🌸 معك وسامعتك، شو حابب نرتب أو ننجز هسا؟`;
    }
    return `أهلاً وسهلاً بحضرتك في مكتب الأستاذ أحمد العامودي 🌸 تفضل كيف بقدر أساعدك وأخدمك اليوم؟`;
  }
}

module.exports = new CloudflareAiService();
