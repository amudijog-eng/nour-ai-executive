
const memoryEngine = require('../../core/memory/memoryEngine');

module.exports = {
  async search({ query, limit = 5 }) {
    return memoryEngine.searchMemories(query, limit);
  },

  async storeFact({ entityPhone, entityName, fact, classification = 'internal' }) {
    return memoryEngine.recordLongTermFact({
      entityPhone,
      entityName,
      fact,
      source: 'agent_instruction',
      confidence: 0.95,
      classification
    });
  },

  async storeInference({ entityPhone, entityName, inference, confidence = 0.75 }) {
    return memoryEngine.recordSemanticInference({
      entityPhone,
      entityName,
      inference,
      source: 'ai_deduction',
      confidence
    });
  }
};
