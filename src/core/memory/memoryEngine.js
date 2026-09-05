
const dbService = require('../../db/database');

class MemoryEngine {
  async recordEpisodicEvent({ entityPhone, entityName, eventDescription, source = 'agent_loop', confidence = 1.0 }) {
    return dbService.addMemory({
      entity_phone: entityPhone,
      entity_name: entityName,
      memory_type: 'episodic',
      classification: 'internal',
      content: eventDescription,
      evidence_source: source,
      confidence,
      is_inference: 0
    });
  }

  async recordLongTermFact({ entityPhone, entityName, fact, source = 'direct_observation', confidence = 0.95, classification = 'internal' }) {
    return dbService.addMemory({
      entity_phone: entityPhone,
      entity_name: entityName,
      memory_type: 'long_term',
      classification,
      content: fact,
      evidence_source: source,
      confidence,
      is_inference: 0
    });
  }

  async recordSemanticInference({ entityPhone, entityName, inference, source = 'ai_inference', confidence = 0.70 }) {
    return dbService.addMemory({
      entity_phone: entityPhone,
      entity_name: entityName,
      memory_type: 'semantic',
      classification: 'internal',
      content: inference,
      evidence_source: source,
      confidence,
      is_inference: 1
    });
  }

  getRelevantMemories({ entityPhone, maxResults = 10, callerClassification = 'internal' }) {
    const all = dbService.getMemories({ entity_phone: entityPhone, limit: maxResults });
    
    // Privacy filtering based on caller classification
    const allowed = ['public'];
    if (callerClassification === 'internal' || callerClassification === 'owner') {
      allowed.push('internal');
    }
    if (callerClassification === 'owner') {
      allowed.push('private', 'sensitive', 'system');
    }

    return all.filter(m => allowed.includes(m.classification.toLowerCase()));
  }

  searchMemories(query, limit = 5) {
    return dbService.searchMemories(query, limit);
  }
}

module.exports = new MemoryEngine();
