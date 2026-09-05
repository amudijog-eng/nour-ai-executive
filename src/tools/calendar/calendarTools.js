
const dbService = require('../../db/database');
const auditService = require('../../security/audit');

module.exports = {
  async check({ participantPhone = null, limit = 5 }) {
    return dbService.getCalendarEvents({ participant_phone: participantPhone, status: 'scheduled', limit });
  },

  async create({ title, participantPhone, participantName = '', startTime, endTime = null, location = '', notes = '' }) {
    const event = dbService.createCalendarEvent({
      title,
      participant_phone: participantPhone,
      participant_name: participantName,
      start_time: startTime,
      end_time: endTime,
      location,
      notes,
      created_by: 'Nour AI'
    });

    auditService.log({
      actorPhone: '962782932611',
      actorName: 'Nour AI',
      actionType: 'CALENDAR_CREATE',
      toolName: 'calendar.create',
      toolInput: { title, participantPhone, startTime, location },
      toolOutput: { id: event.id, status: event.status },
      riskLevel: 'MEDIUM',
      whyReason: 'تثبيت موعد في التقويم'
    });

    return event;
  }
};
