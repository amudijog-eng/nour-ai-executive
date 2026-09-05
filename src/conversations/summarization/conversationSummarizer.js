
const conversationRetrieval = require('../retrieval/conversationRetrieval');
const dbService = require('../../db/database');

class ConversationSummarizer {
  summarizeTopic({ phone, topicQuery }) {
    const matches = conversationRetrieval.searchConversationHistory({ phone, query: topicQuery, limit: 8 });
    if (matches.length === 0) {
      return {
        found: false,
        summary: `ما لقيت أي محادثات سابقة مسجلة بتخص "${topicQuery}".`,
        matches: []
      };
    }

    // Format matches chronologically
    const chron = [...matches].sort((a, b) => a.id - b.id);
    const dialogue = chron.map(m => `[${m.direction === 'incoming' ? 'الطرف الآخر' : 'نور/أحمد'}]: ${m.text}`).join('\n');

    return {
      found: true,
      lastDate: chron[chron.length - 1].created_at,
      dialogueExcerpt: dialogue,
      matchesCount: chron.length
    };
  }
}

module.exports = new ConversationSummarizer();
