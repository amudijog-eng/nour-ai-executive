
const whatsappTools = require('./whatsapp/whatsappTools');
const crmTools = require('./crm/crmTools');
const calendarTools = require('./calendar/calendarTools');
const taskTools = require('./tasks/taskTools');
const memoryTools = require('./memory/memoryTools');
const conversationTools = require('./conversation/conversationTools');
const peopleTools = require('./people/peopleTools');
const ticketTools = require('./tickets/ticketTools');
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
      parameters: metadata.parameters || { type: 'OBJECT', properties: {} },
      riskLevel: metadata.riskLevel || 'LOW'
    });
  }

  registerDefaults() {
    this.register('whatsapp.send', whatsappTools.send, {
      description: 'Send a WhatsApp message to a phone number',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          toPhone: { type: 'STRING', description: 'Recipient phone number, digits only (country code included)' },
          messageText: { type: 'STRING', description: 'The message text to send' },
          reason: { type: 'STRING', description: 'Why this message is being sent, for the audit log' }
        },
        required: ['toPhone', 'messageText']
      }
    });

    this.register('contacts.resolve', crmTools.resolvePerson, {
      description: 'Resolve a human identity across phone number, name, aliases and CRM records',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'A phone number, name, nickname or alias to look up' }
        },
        required: ['query']
      }
    });

    this.register('crm.update', crmTools.updateContact, {
      description: 'Create or update a contact in the CRM',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          phone: { type: 'STRING', description: 'Contact phone number, digits only' },
          name: { type: 'STRING', description: 'Full name of the contact' },
          alias: { type: 'STRING', description: 'Nickname or alias for the contact' },
          relation: { type: 'STRING', description: 'Relationship type, e.g. عميل، شريك، صديق' },
          company: { type: 'STRING', description: 'Company or organization name' },
          notes: { type: 'STRING', description: 'Free-form notes about the contact' }
        },
        required: ['phone', 'name']
      }
    });

    this.register('calendar.check', calendarTools.check, {
      description: 'Check scheduled calendar appointments, optionally filtered to one participant',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          participantPhone: { type: 'STRING', description: 'Filter to appointments with this phone number' },
          limit: { type: 'NUMBER', description: 'Maximum number of events to return' }
        }
      }
    });

    this.register('calendar.create', calendarTools.create, {
      description: 'Create an appointment or meeting event in the calendar',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Title of the event' },
          participantPhone: { type: 'STRING', description: 'Phone number of the other participant' },
          participantName: { type: 'STRING', description: 'Name of the other participant' },
          startTime: { type: 'STRING', description: 'ISO 8601 start datetime' },
          endTime: { type: 'STRING', description: 'ISO 8601 end datetime' },
          location: { type: 'STRING', description: 'Location of the event' },
          notes: { type: 'STRING', description: 'Additional notes' }
        },
        required: ['title', 'startTime']
      }
    });

    this.register('tasks.create', taskTools.create, {
      description: 'Create an autonomous executive task (e.g. coordinate a meeting or dinner) that Nour will follow up on',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          goal: { type: 'STRING', description: 'The goal of the task' },
          ownerPhone: { type: 'STRING', description: 'Owner phone number, defaults to Ahmad' },
          participants: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Phone numbers of task participants' },
          deadline: { type: 'STRING', description: 'ISO 8601 deadline, if any' },
          steps: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, status: { type: 'STRING' } } }, description: 'Task step plan' },
          context: { type: 'OBJECT', properties: {}, description: 'Free-form context data for the task' }
        },
        required: ['goal']
      }
    });

    this.register('tasks.update', taskTools.update, {
      description: 'Update status or progress of an existing executive task',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          taskCode: { type: 'STRING', description: 'Task code, e.g. TASK-1234' },
          status: { type: 'STRING', description: 'New status for the task' },
          currentStep: { type: 'STRING', description: 'New current step name' },
          resultSummary: { type: 'STRING', description: 'Summary of the task result' },
          contextUpdate: { type: 'OBJECT', properties: {}, description: 'Fields to merge into the task context' },
          historyEvent: { type: 'OBJECT', properties: {}, description: 'An event to append to the task history log' }
        },
        required: ['taskCode']
      }
    });

    this.register('tasks.get', taskTools.get, {
      description: 'Get full task details by task code',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          taskCode: { type: 'STRING', description: 'Task code, e.g. TASK-1234 or ORDER-1234' }
        },
        required: ['taskCode']
      }
    });

    this.register('tasks.getActiveForPhone', taskTools.getActiveForPhone, {
      description: 'Get any currently active/running task involving a given phone number',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          phone: { type: 'STRING', description: 'Phone number to check for an active task' }
        },
        required: ['phone']
      }
    });

    this.register('orders.start', taskTools.startOrder, {
      description: 'Start an autonomous food/errand order task: sends the order details to a restaurant or vendor over WhatsApp and tracks the negotiation until confirmed or escalated back to Ahmad',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          instruction: { type: 'STRING', description: 'The original instruction text from Ahmad' },
          targetPhone: { type: 'STRING', description: 'Phone number of the restaurant/vendor, digits only' },
          targetName: { type: 'STRING', description: 'Name of the restaurant/vendor' },
          orderDetails: { type: 'STRING', description: 'Precise order details: items, quantities, special requests' },
          ownerPhone: { type: 'STRING', description: 'Owner phone number, defaults to Ahmad' }
        },
        required: ['targetPhone', 'orderDetails']
      }
    });

    this.register('people.getDossier', peopleTools.getDossier, {
      description: 'Look up everything known about a person: identity, aliases, relationship, recent messages, memories/facts, and any active task involving them',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'A phone number, name, nickname or alias to look up' }
        },
        required: ['query']
      }
    });

    this.register('people.remember', peopleTools.remember, {
      description: 'Save or update a fact, relationship, or person that Ahmad is teaching Nour, into permanent memory and identity records',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          personName: { type: 'STRING', description: 'Name of the person this fact relates to, if any' },
          personPhone: { type: 'STRING', description: 'Phone number of the person, if any' },
          relation: { type: 'STRING', description: 'Relationship type, e.g. FAMILY_FATHER, PARTNER, CLIENT, VIP' },
          fact: { type: 'STRING', description: 'The fact or information to remember, precisely' },
          aliases: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Any alternate names/nicknames for this person' }
        },
        required: ['fact']
      }
    });

    this.register('tickets.reply', ticketTools.reply, {
      description: 'Record Ahmad\'s reply to an open support ticket and prepare the message to forward to the customer',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          ticketNumber: { type: 'STRING', description: 'Ticket number, e.g. TK-1234' },
          replyText: { type: 'STRING', description: "Ahmad's reply text to forward to the customer" }
        },
        required: ['ticketNumber', 'replyText']
      }
    });

    this.register('memory.search', memoryTools.search, {
      description: 'Search long-term and episodic memory',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Search query text' },
          limit: { type: 'NUMBER', description: 'Maximum number of results' }
        },
        required: ['query']
      }
    });

    this.register('memory.storeFact', memoryTools.storeFact, {
      description: 'Store a verified long-term fact into memory',
      riskLevel: 'MEDIUM',
      parameters: {
        type: 'OBJECT',
        properties: {
          entityPhone: { type: 'STRING', description: 'Phone number this fact relates to, if any' },
          entityName: { type: 'STRING', description: 'Name this fact relates to, if any' },
          fact: { type: 'STRING', description: 'The fact to store' },
          classification: { type: 'STRING', description: 'Privacy classification: public, internal, private, sensitive, system' }
        },
        required: ['fact']
      }
    });

    this.register('conversation.search', conversationTools.search, {
      description: 'Search past conversation history with synonym expansion',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          phone: { type: 'STRING', description: 'Restrict search to this phone number' },
          query: { type: 'STRING', description: 'Search query text' },
          limit: { type: 'NUMBER', description: 'Maximum number of results' }
        },
        required: ['query']
      }
    });

    this.register('conversation.summarizeTopic', conversationTools.summarizeTopic, {
      description: 'Summarize past dialogue with someone on a specific topic',
      riskLevel: 'LOW',
      parameters: {
        type: 'OBJECT',
        properties: {
          phone: { type: 'STRING', description: 'Phone number of the conversation to summarize' },
          topicQuery: { type: 'STRING', description: 'The topic to summarize' }
        },
        required: ['phone', 'topicQuery']
      }
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
