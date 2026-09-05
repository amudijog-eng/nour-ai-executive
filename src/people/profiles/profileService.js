
const dbService = require('../../db/database');
const identityResolver = require('../identity-resolution/identityResolver');

class ProfileService {
  async getFullDossier(queryOrPhone) {
    const person = await identityResolver.resolve(queryOrPhone);
    if (!person) return null;

    const memories = person.phone ? dbService.getMemories({ entity_phone: person.phone, limit: 10 }) : [];
    const recentMessages = person.phone ? dbService.getRecentContext(person.phone, 6) : [];
    const openTasks = person.phone ? dbService.getActiveLifecycleTaskForPhone(person.phone) : null;
    const upcomingEvents = person.phone ? dbService.getCalendarEvents({ participant_phone: person.phone, status: 'scheduled', limit: 5 }) : [];

    return {
      person,
      memories: memories.map(m => ({
        type: m.memory_type,
        content: m.content,
        confidence: m.confidence,
        source: m.evidence_source,
        isInference: Boolean(m.is_inference)
      })),
      recentMessages,
      activeTask: openTasks,
      upcomingEvents
    };
  }
}

module.exports = new ProfileService();
