const { execSync } = require('child_process');
const path = require('path');
const dbService = require('../db/database');

const AHMAD_PHONE = '962782932611';

class AiSecretary {
  getConfig() {
    return {
      enabled: dbService.getSetting('ai_secretary_enabled') !== 'false',
      adminPhone: AHMAD_PHONE
    };
  }

  isAiEnabledForContact(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanAhmad = AHMAD_PHONE.replace(/\D/g, '');
    // Always enabled for Ahmad to handle his ticket replies!
    if (cleanPhone === cleanAhmad) return true;

    const config = this.getConfig();
    if (!config.enabled) return false;

    const contact = dbService.getContact(phone);
    if (!contact) return true;
    return Boolean(contact.ai_enabled);
  }

  // Execute Google Antigravity AI via Windows CMD
  async processWithAntigravityCMD(customerPhone, customerName, incomingText, isAdmin = false) {
    const scriptPath = path.join(__dirname, '..', 'ai-engine', 'antigravity-cli.js');
    const payload = {
      customerPhone,
      customerName,
      incomingText,
      isAdmin
    };

    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const command = `cmd.exe /c node "${scriptPath}" --b64=${b64Payload}`;

    try {
      console.log(`⚡ [Google Antigravity CMD] Executing AI Agent for ${customerPhone}...`);
      const stdout = execSync(command, { encoding: 'utf8', timeout: 15000 });
      const match = stdout.match(/__JSON_START__([\s\S]*?)__JSON_END__/);
      if (match) {
        return JSON.parse(match[1]);
      }
      return JSON.parse(stdout);
    } catch (err) {
      console.error('❌ [Antigravity CMD Error]:', err.message);
      // In-process fallback if CMD command throws
      const { runAntigravityAI } = require('../ai-engine/antigravity-cli');
      return await runAntigravityAI(payload);
    }
  }
}

module.exports = new AiSecretary();
