
/**
 * NOUR AI - Executive Agent Brain Interface
 * Delegates all conversational, identity, memory and task processes to the AgentLoop core.
 */
const agentLoop = require('../core/agent/agentLoop');

class AgentBrain {
  async processIncomingMessage({ fromPhone, senderName, text, isAdmin = false }) {
    return agentLoop.processMessage({ fromPhone, senderName, text });
  }
}

module.exports = new AgentBrain();
