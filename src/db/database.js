const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'whatsapp.db');
const db = new DatabaseSync(dbPath);

// Initialize core & expanded schemas
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    phone TEXT PRIMARY KEY,
    name TEXT,
    ai_enabled INTEGER DEFAULT 1,
    unread_count INTEGER DEFAULT 0,
    last_message TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT,
    phone TEXT,
    direction TEXT,
    text TEXT,
    type TEXT DEFAULT 'text',
    status TEXT DEFAULT 'sent',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(phone) REFERENCES contacts(phone)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    title TEXT,
    content TEXT,
    type TEXT DEFAULT 'note',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number TEXT UNIQUE,
    customer_phone TEXT,
    customer_name TEXT,
    issue_summary TEXT,
    details TEXT,
    status TEXT DEFAULT 'open',
    admin_reply TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS crm_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    full_name TEXT NOT NULL,
    nickname TEXT,
    relation TEXT,
    company TEXT,
    notes TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_code TEXT UNIQUE,
    requester_phone TEXT,
    target_phone TEXT,
    target_name TEXT,
    intent_type TEXT,
    instruction TEXT,
    status TEXT DEFAULT 'pending',
    last_agent_message TEXT,
    last_target_reply TEXT,
    result_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- EXPANDED NOUR AI CORE SCHEMAS
  CREATE TABLE IF NOT EXISTS identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL,
    phone TEXT UNIQUE,
    primary_alias TEXT,
    relationship_type TEXT DEFAULT 'contact',
    company TEXT,
    confidence REAL DEFAULT 1.0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS identity_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id INTEGER,
    alias TEXT NOT NULL,
    alias_type TEXT DEFAULT 'nickname',
    source TEXT DEFAULT 'system',
    confidence REAL DEFAULT 1.0,
    FOREIGN KEY(identity_id) REFERENCES identities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS identity_phones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id INTEGER,
    phone_normalized TEXT UNIQUE NOT NULL,
    label TEXT DEFAULT 'mobile',
    is_primary INTEGER DEFAULT 1,
    FOREIGN KEY(identity_id) REFERENCES identities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity_id INTEGER,
    to_entity_id INTEGER,
    relation_type TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_phone TEXT,
    entity_name TEXT,
    memory_type TEXT NOT NULL,
    classification TEXT DEFAULT 'internal',
    content TEXT NOT NULL,
    evidence_source TEXT,
    confidence REAL DEFAULT 1.0,
    is_inference INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    participant_phone TEXT,
    participant_name TEXT,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    location TEXT,
    notes TEXT,
    status TEXT DEFAULT 'scheduled',
    created_by TEXT DEFAULT 'Nour AI',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_code TEXT UNIQUE NOT NULL,
    goal TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    owner_phone TEXT DEFAULT '962782932611',
    participants_json TEXT,
    deadline DATETIME,
    steps_json TEXT,
    current_step TEXT,
    context_json TEXT,
    required_approval INTEGER DEFAULT 0,
    history_json TEXT,
    result_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_phone TEXT NOT NULL,
    actor_name TEXT,
    action_type TEXT NOT NULL,
    tool_name TEXT,
    tool_input_json TEXT,
    tool_output_json TEXT,
    risk_level TEXT DEFAULT 'LOW',
    authorization_status TEXT DEFAULT 'AUTHORIZED',
    why_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(phone, text, direction, created_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, evidence_source);
  `);
} catch (_) {}

const initSetting = (key, defaultValue) => {
  const check = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!check) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, defaultValue);
  }
};

initSetting('ai_secretary_enabled', 'true');
initSetting('ai_secretary_name', 'نور (السكرتيرة الذكية)');

const dbService = {
  // Contacts
  getContacts: () => db.prepare('SELECT * FROM contacts ORDER BY last_updated DESC').all(),
  getContact: (phone) => db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone),
  
  upsertContact: (phone, name = '', lastMessage = '') => {
    const existing = db.prepare('SELECT phone FROM contacts WHERE phone = ?').get(phone);
    if (existing) {
      db.prepare(`
        UPDATE contacts 
        SET name = COALESCE(NULLIF(?, ''), name), 
            last_message = ?, 
            unread_count = unread_count + 1,
            last_updated = CURRENT_TIMESTAMP
        WHERE phone = ?
      `).run(name, lastMessage, phone);
    } else {
      db.prepare(`
        INSERT INTO contacts (phone, name, ai_enabled, unread_count, last_message, last_updated)
        VALUES (?, ?, 1, 1, ?, CURRENT_TIMESTAMP)
      `).run(phone, name || phone, lastMessage);
    }
    return dbService.getContact(phone);
  },

  updateContactAi: (phone, enabled) => {
    db.prepare('UPDATE contacts SET ai_enabled = ? WHERE phone = ?').run(enabled ? 1 : 0, phone);
    return dbService.getContact(phone);
  },

  markContactRead: (phone) => {
    db.prepare('UPDATE contacts SET unread_count = 0 WHERE phone = ?').run(phone);
  },

  updateContactName: (phone, name) => {
    db.prepare('UPDATE contacts SET name = ?, last_updated = CURRENT_TIMESTAMP WHERE phone = ?').run(name, phone);
    return dbService.getContact(phone);
  },

  // Messages
  saveMessage: ({ messageId = '', phone, direction, text, type = 'text', status = 'sent' }) => {
    const contact = db.prepare('SELECT phone FROM contacts WHERE phone = ?').get(phone);
    if (!contact) {
      db.prepare(`
        INSERT INTO contacts (phone, name, ai_enabled, unread_count, last_message, last_updated)
        VALUES (?, ?, 1, 0, ?, CURRENT_TIMESTAMP)
      `).run(phone, phone, text);
    } else {
      db.prepare(`
        UPDATE contacts 
        SET last_message = ?, last_updated = CURRENT_TIMESTAMP 
        WHERE phone = ?
      `).run(text, phone);
    }

    const result = db.prepare(`
      INSERT INTO messages (message_id, phone, direction, text, type, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, phone, direction, text, type, status);

    try {
      db.prepare('INSERT INTO messages_fts (phone, text, direction, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(phone, text, direction);
    } catch (_) {}

    return db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
  },

  getMessages: (phone, limit = 50) => {
    if (!phone) return [];
    const clean = String(phone).replace(/[\u200E\u200F\u202A-\u202E\u00A0\u200B-\u200D\uFEFF]/g, '').replace(/\D/g, '');
    return db.prepare('SELECT * FROM messages WHERE phone = ? OR phone LIKE ? ORDER BY id ASC LIMIT ?').all(clean, `%${clean.slice(-9)}`, limit);
  },

  getRecentContext: (phone, limit = 10) => {
    if (!phone) return [];
    const clean = String(phone).replace(/[\u200E\u200F\u202A-\u202E\u00A0\u200B-\u200D\uFEFF]/g, '').replace(/\D/g, '');
    const rows = db.prepare('SELECT direction, text, created_at FROM messages WHERE phone = ? OR phone LIKE ? ORDER BY id DESC LIMIT ?').all(clean, `%${clean.slice(-9)}`, limit);
    return rows.reverse();
  },

  // Notes
  addNote: (phone, title, content, type = 'note') => {
    const res = db.prepare('INSERT INTO notes (phone, title, content, type) VALUES (?, ?, ?, ?)').run(phone, title, content, type);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(res.lastInsertRowid);
  },

  getNotes: (phone = null) => {
    if (phone) return db.prepare('SELECT * FROM notes WHERE phone = ? ORDER BY created_at DESC').all(phone);
    return db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all();
  },

  // Tickets
  createTicket: (customerPhone, customerName, issueSummary, details) => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `TK-${randomNum}`;
    db.prepare(`
      INSERT INTO tickets (ticket_number, customer_phone, customer_name, issue_summary, details, status)
      VALUES (?, ?, ?, ?, ?, 'open')
    `).run(ticketNumber, customerPhone, customerName || customerPhone, issueSummary, details);
    return db.prepare('SELECT * FROM tickets WHERE ticket_number = ?').get(ticketNumber);
  },

  getTickets: (status = null) => {
    if (status) return db.prepare('SELECT * FROM tickets WHERE status = ? ORDER BY id DESC').all(status);
    return db.prepare('SELECT * FROM tickets ORDER BY id DESC').all();
  },

  getTicketByNumber: (ticketNumber) => {
    return db.prepare('SELECT * FROM tickets WHERE ticket_number = ?').get(ticketNumber);
  },

  updateTicketAdminReply: (ticketNumber, adminReply) => {
    db.prepare(`
      UPDATE tickets 
      SET admin_reply = ?, status = 'replied', updated_at = CURRENT_TIMESTAMP 
      WHERE ticket_number = ?
    `).run(adminReply, ticketNumber);
    return db.prepare('SELECT * FROM tickets WHERE ticket_number = ?').get(ticketNumber);
  },

  closeTicket: (ticketNumber) => {
    db.prepare(`UPDATE tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE ticket_number = ?`).run(ticketNumber);
  },

  // Settings
  getSetting: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting: (key, value) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  },

  // CRM Contacts
  getCrmContacts: () => db.prepare('SELECT * FROM crm_contacts ORDER BY full_name ASC').all(),

  getCrmContactByPhone: (phone) => {
    const clean = String(phone).replace(/\D/g, '');
    return db.prepare('SELECT * FROM crm_contacts WHERE phone = ? OR phone LIKE ?').get(clean, `%${clean.slice(-9)}`);
  },

  searchCrmContact: (query) => {
    if (!query) return null;
    const contacts = db.prepare('SELECT * FROM crm_contacts').all();
    const norm = (s) => (s || '').toLowerCase()
      .replace(/[إأآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^\p{L}\p{N}]/gu, '');

    const targetNorm = norm(query);
    for (const c of contacts) {
      const nameNorm = norm(c.full_name);
      const nickNorm = norm(c.nickname);
      if (nameNorm.includes(targetNorm) || targetNorm.includes(nameNorm) || 
          (nickNorm && (nickNorm.includes(targetNorm) || targetNorm.includes(nickNorm)))) {
        return c;
      }
    }
    return null;
  },

  upsertCrmContact: ({ phone, full_name, nickname = '', relation = 'عميل', company = '', notes = '', tags = '' }) => {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const existing = db.prepare('SELECT * FROM crm_contacts WHERE phone = ?').get(cleanPhone);
    if (existing) {
      db.prepare(`
        UPDATE crm_contacts
        SET full_name = ?, nickname = ?, relation = ?, company = ?, notes = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
        WHERE phone = ?
      `).run(full_name, nickname, relation, company, notes, tags, cleanPhone);
    } else {
      db.prepare(`
        INSERT INTO crm_contacts (phone, full_name, nickname, relation, company, notes, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(cleanPhone, full_name, nickname, relation, company, notes, tags);
    }
    return db.prepare('SELECT * FROM crm_contacts WHERE phone = ?').get(cleanPhone);
  },

  // Legacy Agent Tasks
  getAgentTasks: (status = null) => {
    if (status) return db.prepare('SELECT * FROM agent_tasks WHERE status = ? ORDER BY id DESC').all(status);
    return db.prepare('SELECT * FROM agent_tasks ORDER BY id DESC').all();
  },

  // ==========================================
  // NOUR AI EXPANDED CORE IDENTITIES
  // ==========================================
  getIdentityByPhone: (phone) => {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    let res = db.prepare('SELECT * FROM identities WHERE phone = ?').get(clean);
    if (!res && clean.length >= 7) {
      res = db.prepare('SELECT * FROM identities WHERE phone LIKE ?').get(`%${clean.slice(-9)}`);
    }
    if (!res) {
      const phoneMatch = db.prepare('SELECT identity_id FROM identity_phones WHERE phone_normalized = ? OR phone_normalized LIKE ?').get(clean, `%${clean.slice(-9)}`);
      if (phoneMatch) {
        res = db.prepare('SELECT * FROM identities WHERE id = ?').get(phoneMatch.identity_id);
      }
    }
    if (res) {
      res.aliases = db.prepare('SELECT alias, alias_type, confidence FROM identity_aliases WHERE identity_id = ?').all(res.id);
      res.phones = db.prepare('SELECT phone_normalized, label, is_primary FROM identity_phones WHERE identity_id = ?').all(res.id);
    }
    return res;
  },

  getIdentityById: (id) => {
    const res = db.prepare('SELECT * FROM identities WHERE id = ?').get(id);
    if (res) {
      res.aliases = db.prepare('SELECT alias, alias_type, confidence FROM identity_aliases WHERE identity_id = ?').all(res.id);
      res.phones = db.prepare('SELECT phone_normalized, label, is_primary FROM identity_phones WHERE identity_id = ?').all(res.id);
    }
    return res;
  },

  getAllIdentities: () => {
    const identities = db.prepare('SELECT * FROM identities ORDER BY canonical_name ASC').all();
    for (const iden of identities) {
      iden.aliases = db.prepare('SELECT alias, alias_type, confidence FROM identity_aliases WHERE identity_id = ?').all(iden.id);
    }
    return identities;
  },

  upsertIdentity: ({ canonical_name, phone, primary_alias = '', relationship_type = 'contact', company = '', confidence = 1.0, notes = '' }) => {
    const clean = phone ? String(phone).replace(/\D/g, '') : null;
    let existing = null;
    if (clean) {
      existing = db.prepare('SELECT * FROM identities WHERE phone = ?').get(clean);
    }
    if (existing) {
      db.prepare(`
        UPDATE identities
        SET canonical_name = ?, primary_alias = ?, relationship_type = ?, company = ?, confidence = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(canonical_name, primary_alias, relationship_type, company, confidence, notes, existing.id);
      return dbService.getIdentityById(existing.id);
    } else {
      const res = db.prepare(`
        INSERT INTO identities (canonical_name, phone, primary_alias, relationship_type, company, confidence, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(canonical_name, clean, primary_alias, relationship_type, company, confidence, notes);
      const newId = res.lastInsertRowid;
      if (clean) {
        db.prepare('INSERT INTO identity_phones (identity_id, phone_normalized, is_primary) VALUES (?, ?, 1)').run(newId, clean);
      }
      return dbService.getIdentityById(newId);
    }
  },

  addIdentityAlias: (identityId, alias, aliasType = 'nickname', source = 'learned', confidence = 0.9) => {
    const exists = db.prepare('SELECT id FROM identity_aliases WHERE identity_id = ? AND alias = ?').get(identityId, alias);
    if (!exists) {
      db.prepare('INSERT INTO identity_aliases (identity_id, alias, alias_type, source, confidence) VALUES (?, ?, ?, ?, ?)').run(identityId, alias, aliasType, source, confidence);
    }
  },

  // Relationships
  addRelationship: ({ from_entity_id, to_entity_id, relation_type, strength = 1.0, notes = '' }) => {
    const existing = db.prepare('SELECT id FROM relationships WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?').get(from_entity_id, to_entity_id, relation_type);
    if (existing) {
      db.prepare('UPDATE relationships SET strength = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(strength, notes, existing.id);
      return existing.id;
    }
    const res = db.prepare(`
      INSERT INTO relationships (from_entity_id, to_entity_id, relation_type, strength, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(from_entity_id, to_entity_id, relation_type, strength, notes);
    return res.lastInsertRowid;
  },

  getRelationships: (entity_id) => {
    return db.prepare(`
      SELECT r.*, i.canonical_name, i.phone, i.primary_alias
      FROM relationships r
      JOIN identities i ON i.id = (CASE WHEN r.from_entity_id = ? THEN r.to_entity_id ELSE r.from_entity_id END)
      WHERE r.from_entity_id = ? OR r.to_entity_id = ?
    `).all(entity_id, entity_id, entity_id);
  },

  // Memories
  addMemory: ({ entity_phone = null, entity_name = '', memory_type = 'long_term', classification = 'internal', content, evidence_source = 'conversation', confidence = 1.0, is_inference = 0 }) => {
    const cleanPhone = entity_phone ? String(entity_phone).replace(/\D/g, '') : null;
    const res = db.prepare(`
      INSERT INTO memories (entity_phone, entity_name, memory_type, classification, content, evidence_source, confidence, is_inference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cleanPhone, entity_name, memory_type, classification, content, evidence_source, confidence, is_inference ? 1 : 0);
    
    try {
      db.prepare('INSERT INTO memories_fts (content, evidence_source) VALUES (?, ?)').run(content, evidence_source);
    } catch (_) {}

    return db.prepare('SELECT * FROM memories WHERE id = ?').get(res.lastInsertRowid);
  },

  getMemories: ({ entity_phone = null, memory_type = null, classification = null, limit = 20 } = {}) => {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params = [];

    if (entity_phone) {
      const clean = String(entity_phone).replace(/\D/g, '');
      sql += ' AND (entity_phone = ? OR entity_phone LIKE ?)';
      params.push(clean, `%${clean.slice(-9)}`);
    }
    if (memory_type) {
      sql += ' AND memory_type = ?';
      params.push(memory_type);
    }
    if (classification) {
      sql += ' AND classification = ?';
      params.push(classification);
    }

    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    return db.prepare(sql).all(...params);
  },

  searchMemories: (query, limit = 10) => {
    if (!query) return [];
    try {
      const ftsMatches = db.prepare(`
        SELECT m.* FROM memories m
        JOIN memories_fts f ON f.content = m.content
        WHERE memories_fts MATCH ?
        ORDER BY m.id DESC LIMIT ?
      `).all(query, limit);
      if (ftsMatches.length > 0) return ftsMatches;
    } catch (_) {}

    return db.prepare(`
      SELECT * FROM memories
      WHERE content LIKE ? OR entity_name LIKE ?
      ORDER BY id DESC LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit);
  },

  // Lifecycle Tasks
  createLifecycleTask: ({ goal, owner_phone = '962782932611', participants = [], deadline = null, steps = [], context = {}, required_approval = 0 }) => {
    const taskCode = `TASK-${Math.floor(1000 + Math.random() * 9000)}`;
    db.prepare(`
      INSERT INTO tasks (task_code, goal, status, owner_phone, participants_json, deadline, steps_json, current_step, context_json, required_approval, history_json)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskCode,
      goal,
      owner_phone.replace(/\D/g, ''),
      JSON.stringify(participants),
      deadline,
      JSON.stringify(steps),
      steps[0]?.name || 'init',
      JSON.stringify(context),
      required_approval ? 1 : 0,
      JSON.stringify([{ timestamp: new Date().toISOString(), event: 'TASK_CREATED', goal }])
    );
    return dbService.getLifecycleTask(taskCode);
  },

  getLifecycleTask: (taskCode) => {
    const row = db.prepare('SELECT * FROM tasks WHERE task_code = ?').get(taskCode);
    if (!row) return null;
    try {
      row.participants = JSON.parse(row.participants_json || '[]');
      row.steps = JSON.parse(row.steps_json || '[]');
      row.context = JSON.parse(row.context_json || '{}');
      row.history = JSON.parse(row.history_json || '[]');
    } catch (_) {}
    return row;
  },

  getActiveLifecycleTaskForPhone: (phone) => {
    const clean = String(phone).replace(/\D/g, '');
    const rows = db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('RUNNING', 'WAITING_FOR_REPLY', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_AHMAD_DECISION')
      ORDER BY id DESC
    `).all();

    for (const r of rows) {
      let parts = [];
      try { parts = JSON.parse(r.participants_json || '[]'); } catch (_) {}
      if (parts.some(p => p.includes(clean.slice(-9)) || clean.includes(p.replace(/\D/g, '')))) {
        return dbService.getLifecycleTask(r.task_code);
      }
    }
    return null;
  },

  getActiveTaskAwaitingOwnerDecision: (ownerPhone = '962782932611') => {
    const clean = String(ownerPhone).replace(/\D/g, '');
    const row = db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'WAITING_FOR_AHMAD_DECISION' AND (owner_phone = ? OR owner_phone LIKE ?)
      ORDER BY id DESC LIMIT 1
    `).get(clean, `%${clean.slice(-9)}`);
    if (!row) return null;
    return dbService.getLifecycleTask(row.task_code);
  },

  updateLifecycleTask: (taskCode, updates = {}) => {
    const current = dbService.getLifecycleTask(taskCode);
    if (!current) return null;

    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.current_step !== undefined) {
      fields.push('current_step = ?');
      values.push(updates.current_step);
    }
    if (updates.result_summary !== undefined) {
      fields.push('result_summary = ?');
      values.push(updates.result_summary);
    }
    if (updates.context !== undefined) {
      const mergedContext = { ...current.context, ...updates.context };
      fields.push('context_json = ?');
      values.push(JSON.stringify(mergedContext));
    }
    if (updates.historyEvent !== undefined) {
      const updatedHistory = [...current.history, { timestamp: new Date().toISOString(), ...updates.historyEvent }];
      fields.push('history_json = ?');
      values.push(JSON.stringify(updatedHistory));
    }

    if (fields.length === 0) return current;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(taskCode);

    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE task_code = ?`).run(...values);
    return dbService.getLifecycleTask(taskCode);
  },

  getAllLifecycleTasks: (status = null) => {
    let sql = 'SELECT * FROM tasks';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY id DESC';
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => {
      try {
        r.participants = JSON.parse(r.participants_json || '[]');
        r.steps = JSON.parse(r.steps_json || '[]');
        r.context = JSON.parse(r.context_json || '{}');
        r.history = JSON.parse(r.history_json || '[]');
      } catch (_) {}
      return r;
    });
  },

  // Calendar
  createCalendarEvent: ({ title, participant_phone = '', participant_name = '', start_time, end_time = null, location = '', notes = '', created_by = 'Nour AI' }) => {
    const cleanPhone = participant_phone ? String(participant_phone).replace(/\D/g, '') : '';
    const res = db.prepare(`
      INSERT INTO calendar_events (title, participant_phone, participant_name, start_time, end_time, location, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, cleanPhone, participant_name, start_time, end_time, location, notes, created_by);
    return db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(res.lastInsertRowid);
  },

  getCalendarEvents: ({ participant_phone = null, status = 'scheduled', limit = 10 } = {}) => {
    let sql = 'SELECT * FROM calendar_events WHERE 1=1';
    const params = [];
    if (participant_phone) {
      const clean = String(participant_phone).replace(/\D/g, '');
      sql += ' AND (participant_phone = ? OR participant_phone LIKE ?)';
      params.push(clean, `%${clean.slice(-9)}`);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY start_time ASC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  },

  // Audit
  addAuditLog: ({ actor_phone, actor_name = '', action_type, tool_name = '', tool_input = {}, tool_output = {}, risk_level = 'LOW', authorization_status = 'AUTHORIZED', why_reason = '' }) => {
    const cleanPhone = String(actor_phone).replace(/\D/g, '');
    const res = db.prepare(`
      INSERT INTO audit_logs (actor_phone, actor_name, action_type, tool_name, tool_input_json, tool_output_json, risk_level, authorization_status, why_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanPhone,
      actor_name,
      action_type,
      tool_name,
      typeof tool_input === 'string' ? tool_input : JSON.stringify(tool_input),
      typeof tool_output === 'string' ? tool_output : JSON.stringify(tool_output),
      risk_level,
      authorization_status,
      why_reason
    );
    return db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(res.lastInsertRowid);
  },

  getAuditLogs: (limit = 50) => db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit),

  // FTS Messages
  searchMessagesFts: (query, phone = null, limit = 20) => {
    if (!query) return [];
    try {
      let sql = `
        SELECT m.* FROM messages m
        JOIN messages_fts f ON f.rowid = m.id
        WHERE messages_fts MATCH ?
      `;
      const params = [query];
      if (phone) {
        const clean = String(phone).replace(/\D/g, '');
        sql += ' AND (m.phone = ? OR m.phone LIKE ?)';
        params.push(clean, `%${clean.slice(-9)}`);
      }
      sql += ' ORDER BY m.id DESC LIMIT ?';
      params.push(limit);
      const res = db.prepare(sql).all(...params);
      if (res.length > 0) return res;
    } catch (_) {}

    let sql = 'SELECT * FROM messages WHERE text LIKE ?';
    const params = [`%${query}%`];
    if (phone) {
      const clean = String(phone).replace(/\D/g, '');
      sql += ' AND (phone = ? OR phone LIKE ?)';
      params.push(clean, `%${clean.slice(-9)}`);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  },

  ensureCoreIdentities: () => {
    try {
      // 1. Owner: Ahmad Alamoudi (+962782932611)
      const ahmad = dbService.upsertIdentity({
        canonical_name: 'أحمد العامودي',
        phone: '962782932611',
        primary_alias: 'الأستاذ أحمد',
        relationship_type: 'OWNER_DIRECTOR',
        company: 'سند تاكسي ومكتب الأعمال',
        confidence: 1.0,
        notes: 'المالك والمدير الحصري للنظام والمشرف العام وصاحب كافة الصلاحيات التنفيذية'
      });
      const ahmadAliases = ['أحمد العامودي', 'احمد العامودي', 'الأستاذ أحمد', 'الاستاذ احمد', 'أبو شهاب', 'ابو شهاب', 'أحمد', 'احمد', 'المدير'];
      for (const al of ahmadAliases) {
        dbService.addIdentityAlias(ahmad.id, al, 'title', 'system', 1.0);
      }

      // 2. Contact: Mohamed (+962790525996) - standard business contact, NOT father
      const contactMohamed = dbService.upsertIdentity({
        canonical_name: 'السيد محمد',
        phone: '962790525996',
        primary_alias: 'محمد',
        relationship_type: 'عميل / جهة اتصال',
        company: '',
        confidence: 0.9,
        notes: 'جهة اتصال سابقة تواصلت معها نور لمتابعة الأعمال'
      });
      const mohamedAliases = ['السيد محمد', 'سيد محمد', 'محمد'];
      for (const al of mohamedAliases) {
        dbService.addIdentityAlias(contactMohamed.id, al, 'contact', 'system', 0.9);
      }

      // Cleanup any previous incorrect father links or aliases for 90525996
      try {
        db.prepare("DELETE FROM relationships WHERE relation_type = 'FATHER_SON' AND (to_entity_id = ? OR from_entity_id = ?)").run(contactMohamed.id, contactMohamed.id);
        db.prepare("DELETE FROM identity_aliases WHERE (alias LIKE '%العامودي%' OR alias IN ('ابوي', 'أبوي', 'والدي', 'الوالد', 'والد أحمد', 'والد احمد', 'والد الأستاذ أحمد', 'والد الاستاذ احمد', 'أبو أحمد', 'ابو احمد', 'عمي أبو أحمد', 'عمي ابو احمد')) AND identity_id = ?").run(contactMohamed.id);
        db.prepare("DELETE FROM memories WHERE content LIKE '%هو والد الأستاذ أحمد%'").run();
      } catch (_) {}

      // 3. Khaled Salameh (+962791112233)
      const khaled = dbService.upsertIdentity({
        canonical_name: 'خالد سلامة',
        phone: '962791112233',
        primary_alias: 'أبو وليد',
        relationship_type: 'عميل / معرفة شخصية وشريك',
        company: 'شركة الأمل / مجموعة التميز',
        confidence: 0.98,
        notes: 'معرفة شخصية وشريك أعمال مقرب للأستاذ أحمد، يفضل التنسيق المسبق ويفضل واتساب والمواعيد المسائية'
      });
      const khaledAliases = ['خالد سلامة', 'خالد سلامه', 'أبو وليد', 'ابو وليد', 'خالد'];
      for (const al of khaledAliases) {
        dbService.addIdentityAlias(khaled.id, al, 'nickname', 'system', 0.98);
      }
    } catch (e) {
      console.warn('⚠️ [ensureCoreIdentities error]:', e.message);
    }
  }
};

// Auto-seed core identities on initialization
dbService.ensureCoreIdentities();

module.exports = dbService;
