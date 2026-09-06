
const dbService = require('../../db/database');
const identityResolver = require('../../people/identity-resolution/identityResolver');
const memoryEngine = require('../../core/memory/memoryEngine');

module.exports = {
  async getDossier({ query }) {
    const person = await identityResolver.resolve(query);
    const phone = person?.phone || null;

    const messages = phone ? dbService.getMessages(phone, 20) : [];
    const memories = phone ? memoryEngine.getRelevantMemories({ entityPhone: phone, callerClassification: 'owner' }) : [];
    const activeTask = phone ? dbService.getActiveLifecycleTaskForPhone(phone) : null;

    return {
      person,
      messages,
      memories,
      activeTask
    };
  },

  async remember({ personName, personPhone = '', relation = 'VIP', fact = '', aliases = [] }) {
    let identity = null;

    if (personName && personPhone) {
      identity = dbService.upsertIdentity({
        canonical_name: personName,
        phone: personPhone,
        primary_alias: aliases?.[0] || personName,
        relationship_type: relation,
        confidence: 1.0,
        notes: fact || ''
      });

      if (Array.isArray(aliases)) {
        for (const al of aliases) {
          dbService.addIdentityAlias(identity.id, al, 'learned', 'owner_instruction', 1.0);
        }
      }
    }

    if (fact) {
      await memoryEngine.recordLongTermFact({
        entityPhone: personPhone || null,
        entityName: personName || 'أحمد العامودي',
        fact,
        source: 'owner_instruction',
        confidence: 1.0,
        classification: 'owner'
      });
    }

    return { identity, factStored: Boolean(fact) };
  }
};
