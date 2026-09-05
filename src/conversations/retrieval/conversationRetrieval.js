
const dbService = require('../../db/database');

class ConversationRetrieval {
  // Common business concepts & semantic synonym expansions in Jordanian / Levantine dialect
  getSynonymExpansions(query) {
    const q = (query || '').toLowerCase();
    const expansions = new Set();
    expansions.add(query);

    const synonymMap = [
      { trigger: ['فلوس', 'مصاري', 'دفع', 'دفعة', 'حساب', 'مبلغ'], synonyms: ['مبلغ', 'دفع', 'تحويل', 'دفعة', 'فاتورة', 'عقد', 'مستحقات', 'سعر', 'دينار'] },
      { trigger: ['عقد', 'اتفاق', 'توقيع'], synonyms: ['عقد', 'اتفاق', 'توقيع', 'شروط', 'بنود', 'اتفاقية', 'عرض'] },
      { trigger: ['اجتماع', 'موعد', 'لقاء', 'قعدة'], synonyms: ['اجتماع', 'موعد', 'لقاء', 'جلسة', 'الساعة', 'يوم', 'الخميس', 'الجمعة', 'السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'] },
      { trigger: ['عشا', 'غدا', 'مطعم', 'أكل'], synonyms: ['عشا', 'غدا', 'مطعم', 'نلتقي', 'نطلع', 'سهرة'] },
      { trigger: ['مشروع', 'شغل', 'تكسي', 'تاكسي', 'سند'], synonyms: ['مشروع', 'شغل', 'تاكسي', 'تطبيق', 'سيارات', 'توصيل', 'رحلات'] }
    ];

    for (const group of synonymMap) {
      if (group.trigger.some(t => q.includes(t))) {
        group.synonyms.forEach(s => expansions.add(s));
      }
    }

    return Array.from(expansions);
  }

  /**
   * Search conversation history for a specific phone or globally with ranked scoring
   */
  searchConversationHistory({ phone = null, query, limit = 15 }) {
    if (!query) return [];

    const synonyms = this.getSynonymExpansions(query);
    const seenMessageIds = new Set();
    const matchedMessages = [];

    // 1. FTS / Exact query search
    const primaryMatches = dbService.searchMessagesFts(query, phone, limit);
    for (const m of primaryMatches) {
      if (!seenMessageIds.has(m.id)) {
        seenMessageIds.add(m.id);
        matchedMessages.push({ ...m, score: 1.0, matchedTerm: query });
      }
    }

    // 2. Search synonym expansions
    for (const syn of synonyms) {
      if (matchedMessages.length >= limit) break;
      const synMatches = dbService.searchMessagesFts(syn, phone, limit - matchedMessages.length);
      for (const m of synMatches) {
        if (!seenMessageIds.has(m.id)) {
          seenMessageIds.add(m.id);
          matchedMessages.push({ ...m, score: 0.85, matchedTerm: syn });
        }
      }
    }

    // Sort by: recency (id desc) * score
    matchedMessages.sort((a, b) => (b.id * b.score) - (a.id * a.score));

    return matchedMessages.slice(0, limit);
  }

  /**
   * Retrieve chronological timeline of discussions with a contact
   */
  getTimelineContext(phone, limit = 12) {
    if (!phone) return [];
    return dbService.getRecentContext(phone, limit);
  }
}

module.exports = new ConversationRetrieval();
