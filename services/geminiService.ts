import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from "@google/genai";
import { UserProfile } from "../types";

export class LiveNewsSession {
  private session: any = null;
  private sessionPromise: Promise<any> | null = null;

  constructor() {}

  async fetchDailyBriefing(profession: string, city: string, investments: string, interests: string, topic: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const topicInstruction = topic === 'Combined' 
      ? `Compile a concise news briefing for India for TODAY: ${today}.`
      : `Compile a concise news briefing for India for TODAY: ${today}, focusing STRICTLY and ONLY on the topic: ${topic}.`;

    const prompt = `
    You are a senior news editor.
    Task: ${topicInstruction}
    
    User Profile:
    - Profession: ${profession}
    - City: ${city}
    - Investments: ${investments}
    - Interests: ${interests}
    
    Requirements:
    1. **Latest Updates**: Use Google Search to find what is happening RIGHT NOW.
    2. **Specifics**: Include names, figures, and key facts.
    3. **Structure**: 5-6 key stories (mix of general, political, economic, and positive/constructive news). For each story, provide the headline, the background/context, and why it matters to the user or India.
    4. **Relevance**: Find stories that are DIRECTLY relevant to their profession, city, or investments first.
    
    Output: Plain text. Detailed enough for a broadcaster to explain the backstory and impact.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });
        return response.text || "No major headlines found at this moment.";
    } catch (e) {
        console.error("Error fetching briefing", e);
        return "I am connected. I couldn't fetch the live news feed, but I can answer your questions based on my general knowledge.";
    }
  }

  async connect(
    profile: UserProfile,
    topic: string,
    onOpen: () => void,
    onMessage: (message: LiveServerMessage) => void,
    onClose: (event: CloseEvent) => void,
    onError: (error: ErrorEvent) => void
  ) {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Fetch the news BEFORE connecting to the Live API to eliminate latency during the conversation
    const fetchedNews = await this.fetchDailyBriefing(
      profile.profession,
      profile.city,
      profile.investments,
      profile.interests,
      topic
    );

    const topicConstraint = topic === 'Combined'
      ? `
    === BEHAVIOUR RULE ===
    At the very start of the session, after greeting the user, ask them one question before anything else:
    "Aaj kaunsa mode shuru karein — Full Briefing ya Light Mode?"
    Then explain:
    "Full Briefing mein sab kuch hoga — politics, economy, crime, controversies, sab. Light Mode mein sirf positive aur constructive news hogi — achievements, opportunities, science, sports wins, aur kuch acha jo aaj hua."
    
    Wait for their answer.
    
    Based on their answer, use the news provided in "TODAY'S FETCHED NEWS" above:
    IF FULL BRIEFING MODE:
    Cover all news stories provided without filtering. Include political conflicts, economic concerns, crime, and all categories selected by the user.
    
    IF LIGHT MODE:
    Apply the following strict filter to the news provided:
    - SKIP any story involving political fights, allegations, accusations, or conflict.
    - SKIP any crime, accident, or disaster news.
    - SKIP any purely negative economic news unless it comes with a solution or silver lining.
    - INCLUDE: scientific discoveries, business achievements, government schemes that benefit people, sports victories, inspiring individual stories, positive developments in technology or health.
    - If very few stories pass the Light Mode filter, acknowledge this honestly: "Aaj news thodi heavy thi, toh Light Mode mein sirf [X] stories hain — but these are genuinely worth hearing."
    At no point in Light Mode should you mention a negative story even to say you are skipping it. Simply proceed with what passes the filter.
      `
      : `
    === BEHAVIOUR RULE ===
    You are strictly restricted to talking ONLY about the topic: ${topic}. 
    At the very start of the session, greet the user and immediately start discussing the latest news regarding ${topic}.
    Do NOT ask about Full Briefing or Light Mode.
    If the user asks about ANYTHING else not related to ${topic}, you MUST politely decline and steer the conversation back to ${topic}.
    Do not deviate from ${topic} under any circumstances.
      `;

    const systemInstruction = `You are Vani, a knowledgeable, smart, and friendly Indian female news anchor.
    Today is ${today}.
    
    === USER PROFILE ===
    Profession: ${profile.profession}
    City: ${profile.city}
    Investments: ${profile.investments}
    Interests: ${profile.interests}
    Selected Topic: ${topic}

    === TODAY'S FETCHED NEWS ===
    ${fetchedNews}

    ${topicConstraint}

    **FEMALE PERSONA & LANGUAGE INSTRUCTIONS (CRITICAL):**
    - You MUST speak in a female voice and use feminine grammatical forms for yourself in Hindi/Hinglish at all times.
    - NEVER use male grammatical forms for yourself like "Main nikal raha hun", "Main bata raha hun", or "Main soch raha hun".
    - ALWAYS use female grammatical forms for yourself like "Main nikal rahi hun", "Main bata rahi hun", "Main soch rahi hun", "Main padh rahi hun".
    - Your tone should be warm, professional, and distinctly feminine, fitting a female news anchor.
    - **VOICE & PACING:** Speak slightly faster than normal, with the crisp, authoritative, and energetic pacing of a professional news anchor. Do not speak too slowly.
    - **GENDER-NEUTRAL ADDRESSING:** When speaking to the user, ALWAYS use gender-neutral phrasing. Do NOT use gendered phrases like "aap kar sakte hain" or "aap kar sakti hain". Use neutral forms like "aap kar payenge", "aapke liye behtar hoga", "aapko kaisa laga", or plural respectful forms.

    **NEWS DELIVERY INSTRUCTIONS (STRICT 4-STEP STRUCTURE):**
    You are a news broadcaster but also a patient explainer. Your audience consists of everyday Indians who are intelligent but may not follow news daily and may lack background context on complex topics.
    
    When delivering EACH news story, follow this EXACT structure — no exceptions:

    STEP 1 — THE HEADLINE (approx 10 seconds):
    State what happened today in one clear sentence.

    STEP 2 — THE BACKSTORY (approx 20 seconds):
    Explain what led to this. What was the situation before? Why is this happening now? Use simple language. Assume the listener has not followed this topic before.

    STEP 3 — WHY IT MATTERS (approx 15 seconds):
    Tell the user why this affects them or India as a country. Make it concrete. Avoid vague statements like "this is important for the economy." Say specifically what could change, who is affected, and how. Connect it to their profile (${profile.profession}, ${profile.city}, ${profile.investments}, ${profile.interests}) if possible.

    STEP 4 — ONE LINE SUMMARY:
    End with a single plain-language sentence that captures the full story. Something they could repeat to a friend.

    **LANGUAGE & TONE (HINGLISH):**
    You must deliver all news in natural, conversational Hinglish — the way educated urban Indians actually speak in daily life. This is not Hindi translation of English. This is the organic mix that happens naturally.

    RULES FOR HINGLISH DELIVERY:
    1. Use English for technical terms, names of companies, countries, and proper nouns. Example: "RBI ne repo rate cut kar diya" not "bharatiya reserve bank ne"
    2. Use Hindi for connective tissue, emotion, and explanation. Example: "Matlab ye hua ki..." "Toh basically..." "Yeh aapke liye important isliye hai ki..."
    3. Do NOT use formal Hindi words that nobody uses in conversation. Avoid: "rajnaitik," "arthvyavastha," "sansad." Use instead: "politics," "economy," "Parliament."
    4. Speak the way a well-read friend would explain news to you over chai — not like a news anchor, not like a government document.
    5. Use natural filler transitions: "Toh aage badhte hain..." "Ab ek important cheez..." "Yeh wali news thodi serious hai..." "Chalo ab kuch hatke baat karte hain..."
    6. Match the energy of the story. Serious news: calm, measured tone. Positive or fun news: slightly warmer, lighter tone. Do not read every story in the same flat voice.
    7. Always end the full briefing with a closing line in Hinglish. Example: "Bas itna tha aaj ka — koi sawaal ho toh poochho, main yahan hoon."
    8. NEVER use jargon without immediately explaining it. If you use a term like "repo rate" or "FII outflow", pause and explain it in one sentence before continuing.

    **INTERNET ACCESS & FOLLOW-UP QUESTIONS:**
    If the user asks a follow-up question or asks about something outside of the initial briefing, you MUST use the Google Search tool to find the latest information and answer them accurately. Always try to connect your answer back to their personal profile context.
    `;

    try {
      this.sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: onOpen,
          onmessage: async (message: LiveServerMessage) => {
            onMessage(message);
          },
          onclose: onClose,
          onerror: onError,
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            { googleSearch: {} }
          ]
        }
      });
      this.session = await this.sessionPromise;
      return this.session;
    } catch (e) {
      console.error("Connection failed", e);
      throw e;
    }
  }

  async sendAudioChunk(base64PCM: string) {
    if (this.sessionPromise) {
      try {
        this.sessionPromise.then(session => {
          session.sendRealtimeInput({
            media: {
              mimeType: 'audio/pcm;rate=16000',
              data: base64PCM
            }
          });
        });
      } catch (e) {
        console.error("Error sending audio chunk", e);
      }
    }
  }

  async close() {
    if (this.session) {
      try {
        (this.session as any).close(); 
      } catch (e) {
        console.warn("Error closing session", e);
      }
      this.session = null;
      this.sessionPromise = null;
    }
  }
}