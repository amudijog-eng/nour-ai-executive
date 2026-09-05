
const conversationRetrieval = require('../../conversations/retrieval/conversationRetrieval');
const conversationSummarizer = require('../../conversations/summarization/conversationSummarizer');

module.exports = {
  async search({ phone = null, query, limit = 10 }) {
    return conversationRetrieval.searchConversationHistory({ phone, query, limit });
  },

  async summarizeTopic({ phone, topicQuery }) {
    return conversationSummarizer.summarizeTopic({ phone, topicQuery });
  }
};
