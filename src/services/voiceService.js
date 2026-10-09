require('dotenv').config();
const axios = require('axios');

class VoiceService {
  getConfig() {
    return {
      apiKey: process.env.FISH_API_KEY || '',
      voiceModelId: process.env.FISH_VOICE_MODEL_ID || '9fd3a23235884ce9ba53767afcb0b75e'
    };
  }

  /**
   * Detect if the incoming message requested a voice note or came as audio
   */
  isVoiceRequested(incomingText, messageType) {
    if (messageType === 'audio') return true;

    if (!incomingText || typeof incomingText !== 'string') return false;

    const lower = incomingText.trim().toLowerCase();
    const voicePatterns = [
      /(?:ابعثي|ابعثيلي|ابعتي|ابعتيلي|ارسل|ارسلي|ردي|احكي)\s*(?:لي\s*)?(?:فويس|تسجيل|صوت|فويس نوت)/iu,
      /(?:بدي|حابب|ودنا|ودّي)\s*(?:فويس|صوتك|تسجيل صوتي|اسمع صوتك)/iu,
      /(?:فويس|فويسات|تسجيل صوتي|voice note|voicenote)/iu,
      /(?:احكي معي صوت|حاكيني صوت|تكلمي صوت)/iu
    ];

    return voicePatterns.some(pattern => pattern.test(lower));
  }

  /**
   * Convert text to cloned voice note via Fish Audio Cloud
   */
  async textToVoice(text, options = {}) {
    const { apiKey, voiceModelId } = this.getConfig();

    if (!apiKey) {
      throw new Error('FISH_API_KEY is not configured in environment variables');
    }

    const emotion = options.emotion || 'natural';
    const breathing = options.breathing !== false;

    // Build emotional tags as per Fish Audio specification
    const tags = [];
    if (breathing) tags.push('[inhale]');
    if (emotion && emotion !== 'natural') tags.push(`[${emotion}]`);

    const cleanText = text.replace(/[*_~`]/g, '').trim();
    const styledText = `${tags.join(' ')} ${cleanText}`.trim();

    console.log(`🎙️ [Fish Audio Cloud] Generating voice note for: "${cleanText.slice(0, 40)}..."`);

    const url = 'https://api.fish.audio/v1/tts';
    const payload = {
      text: styledText,
      reference_id: voiceModelId,
      format: 'mp3'
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        model: 's2.1-pro-free'
      },
      responseType: 'arraybuffer',
      timeout: 30000
    });

    return Buffer.from(response.data);
  }
}

module.exports = new VoiceService();
