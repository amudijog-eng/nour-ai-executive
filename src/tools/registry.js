
const whatsappTools = require('./whatsapp/whatsappTools');
const crmTools = require('./crm/crmTools');
const calendarTools = require('./calendar/calendarTools');
const taskTools = require('./tasks/taskTools');
const memoryTools = require('./memory/memoryTools');
const conversationTools = require('./conversation/conversationTools');
const accessControl = require('../core/permissions/accessControl');
const riskEngine = require('../core/policies/riskEngine');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.registerDefaults();
  }

  register(name, handler, metadata = {}) {
    this.tools.set(name, {
      name,
      handler,
      description: metadata.description || '',
      parameters: metadata.parameters || {},
      riskLevel: metadata.riskLevel || 'LOW'
    });
  }

  registerDefaults() {
    this.register('whatsapp.send', whatsappTools.send, {
      description: 'Send a WhatsApp message to a phone number',
      riskLevel: 'MEDIUM'
    });

    this.register('contacts.resolve', crmTools.resolvePerson, {
      description: 'Resolve human identity across phone, name, aliases and CRM',
      riskLevel: 'LOW'
    });

    this.register('crm.update', crmTools.updateContact, {
      description: 'Update or add a contact in CRM',
      riskLevel: 'MEDIUM'
    });

    this.register('calendar.check', calendarTools.check, {
      description: 'Check scheduled calendar appointments',
      riskLevel: 'LOW'
    });

    this.register('calendar.create', calendarTools.create, {
      description: 'Create an appointment or meeting event in calendar',
      riskLevel: 'MEDIUM'
    });

    this.register('tasks.create', taskTools.create, {
      description: 'Create an autonomous executive task',
      riskLevel: 'MEDIUM'
    });

    this.register('tasks.update', taskTools.update, {
      description: 'Update status or progress of an executive task',
      riskLevel: 'MEDIUM'
    });

    this.register('tasks.get', taskTools.get, {
      description: 'Get task details by code',
      riskLevel: 'LOW'
    });

    this.register('tasks.getActiveForPhone', taskTools.getActiveForPhone, {
      description: 'Get any active running task for a phone number',
      riskLevel: 'LOW'
    });

    this.register('memory.search', memoryTools.search, {
      description: 'Search long-term and episodic memory',
      riskLevel: 'LOW'
    });

    this.register('memory.storeFact', memoryTools.storeFact, {
      description: 'Store a verified long-term fact into memory',
      riskLevel: 'MEDIUM'
    });

    this.register('conversation.search', conversationTools.search, {
      description: 'Search past conversation history with synonym expansion',
      riskLevel: 'LOW'
    });

    this.register('conversation.summarizeTopic', conversationTools.summarizeTopic, {
      description: 'Summarize past dialogue on a specific topic',
      riskLevel: 'LOW'
    });
  }

  async execute(toolName, params, callerRole = 'OWNER') {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`الأداة (${toolName}) غير موجودة في سجل الأدوات.`);
    }

    const authCheck = accessControl.isAuthorizedForTool(callerRole, toolName, tool.riskLevel);
    if (!authCheck.allowed) {
      throw new Error(authCheck.reason);
    }

    const risk = riskEngine.evaluateActionRisk(toolName, params);
    if (risk.level === 'HIGH' && risk.requiresApproval) {
      return {
        status: 'APPROVAL_REQUIRED',
        toolName,
        params,
        reason: risk.reason
      };
    }

    const result = await tool.handler(params);
    return {
      status: 'SUCCESS',
      toolName,
      result
    };
  }

  getToolDeclarations() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }
}

module.exports = new ToolRegistry();
