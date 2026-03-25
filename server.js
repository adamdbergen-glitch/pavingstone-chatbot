// server.js - Paving Stone Pros chatbot + Gmail lead email sending + internal estimator

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const nodemailer = require("nodemailer");
const {
  calculatePavingEstimate,
  inferMaterialCodeFromText,
  getMaterialTierDescription,
} = require("./pricing");

const app = express();

// 1. ROBUST CORS SETUP
const corsOptions = {
  origin: true, 
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); 

app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com", 
  port: parseInt(process.env.SMTP_PORT || "587", 10), 
  secure: false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

//
// ===== SYSTEM PROMPTS =====
//

// LEAVE THIS EXACTLY AS IS FOR YOUR CUSTOMERS
const SYSTEM_PROMPT = `
You are the estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.

Your ONLY job is to help homeowners describe their paving stone / hardscaping project
and, once the key details are known and they ask for it, help the server return
a rough ballpark estimate. You are NOT a general-purpose chatbot.

ALWAYS steer the conversation back to paving stone and landscaping projects.
If the user asks off-topic questions, reply briefly that you are only here to help 
with paving stone / landscaping estimates and then ask what kind of project they have in mind.

1) Ask simple, friendly questions to clearly understand the project BEFORE any price is given.
   Ask about:
   • Project type (patio, driveway, walkway, other)
   • Approximate size in square feet
   • Location on the property (front yard, back yard, side, etc.)
   • Access (easy / medium / difficult)
   • City or town (and whether it's out of town from Winnipeg)
   • Material (choose ONE exact product name, not a vague description).

2) Be conversational and natural. Ask 1–2 questions at a time.
   Only give a ballpark estimate AFTER you have core details (type, size, material).

3) When the server attaches a real price, your reply text will be replaced
   by the server with a message that already includes the correct dollar range.
   Do NOT invent dollar amounts yourself.
`;

// NEW: This is ONLY for Adam in the internal app
const INTERNAL_CHAT_PROMPT = `
You are Adam's internal business assistant for The Paving Stone Pros.
Your goal is to help Adam work out project details (SqFt, Material, Type, Access).

STRICT RULE: You must always return a JSON object. 
If you are just chatting, put your text in the "reply" field. 
Always include the "meta" field with whatever project details you have found so far.

{
  "reply": "Your conversational response to Adam",
  "meta": {
    "sqft": number,
    "project_type": "patio" | "walkway" | "driveway",
    "material_text": "stone name",
    "is_backyard": boolean,
    "access_level": "easy" | "medium" | "difficult"
  }
}
`;

//
// ===== AI EXTRACTORS =====
//

// This remains the standard extractor for the public bot
async function extractProjectDetailsAI(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const extractionPrompt = `
    You are a data extraction bot. 
    Analyze the conversation history below and extract the **current valid project details**.
    Return JSON ONLY with: sqft, project_type, is_backyard, access_level, city_town, is_out_of_town, material_text.
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: extractionPrompt }, ...safeMessages],
      temperature: 0.1, 
    });

    const data = JSON.parse(completion.choices[0].message.content);
    return {
      sqft: Number(data.sqft) || 0,
      project_type: data.project_type,
      isBackyard: !!data.is_backyard,
      access_level: data.access_level || "medium",
      city_town: data.city_town || "Winnipeg",
      is_out_of_town: !!data.is_out_of_town,
      material_code: inferMaterialCodeFromText(data.material_text || "")
    };
  } catch (err) {
    return { sqft: 0, material_code: "barkman_holland" }; 
  }
}

//
// ===== PUBLIC / CUSTOMER-FACING CHATBOT (UNTOUCHED) =====
//

app.post("/api/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
    });
    let aiReply = completion.choices?.[0]?.message?.content?.trim() || "";
    const meta = await extractProjectDetailsAI(messages);
    
    const lastUserMessage = messages[messages.length - 1]?.content || "";
    const lowerLastUser = lastUserMessage.toLowerCase();
    const askingForPrice = /\b(price|cost|ballpark|estimate|quote)\b/.test(lowerLastUser);
    const confirmingReady = /\b(yes|sure|ok|ready)\b/.test(lowerLastUser);

    let estimate = null;
    let reply = aiReply;

    if (meta.sqft > 0 && meta.project_type && (askingForPrice || confirmingReady)) {
      const rawEstimate = calculatePavingEstimate(meta);
      const bufferedLow = Math.round(rawEstimate.low * 0.9);
      const bufferedHigh = Math.round(rawEstimate.high * 1.1);
      const tierDesc = getMaterialTierDescription(meta.material_code);

      reply = `Based on what you've told me (${meta.sqft} sqft ${meta.project_type}), your project is likely in the range of **$${bufferedLow.toLocaleString()} – $${bufferedHigh.toLocaleString()} +GST**.\n\nThe material is ${tierDesc}.\n\n⚠️ This is a rough ballpark only. Shall we book a site visit?`;
      estimate = { ...rawEstimate, low: bufferedLow, high: bufferedHigh };
    }

    return res.json({ reply, estimate, meta });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

//
// ===== INTERNAL ESTIMATOR (ISOLATED) =====
//

app.post("/api/internal-chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];

    // 1. Get structured response from AI
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: INTERNAL_CHAT_PROMPT }, ...messages],
      temperature: 0.2,
    });

    const aiData = JSON.parse(completion.choices[0].message.content);
    
    // 2. Process math for the sidebar
    let estimate = null;
    let meta = null;
    
    if (aiData.meta) {
      // Map the AI text back to your pricing codes
      meta = {
        ...aiData.meta,
        material_code: inferMaterialCodeFromText(aiData.meta.material_text || ""),
        isBackyard: !!aiData.meta.is_backyard,
        city_town: "Winnipeg"
      };

      if (meta.sqft > 0 && meta.project_type) {
        estimate = calculatePavingEstimate(meta);
      }
    }

    return res.json({
      reply: aiData.reply,
      estimate: estimate,
      meta: meta
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//
// ===== LEAD CAPTURE (GMAIL) =====
//

app.post("/api/lead", async (req, res) => {
  try {
    const { contact, estimate, messages } = req.body;
    const safeContact = contact || {};
    const safeMessages = Array.isArray(messages) ? messages : [];

    const mailOptions = {
      from: `"Paving Bot" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: `🚧 New Lead: ${safeContact.name || "Unknown"}`,
      text: `Name: ${safeContact.name}\nEmail: ${safeContact.email}\nPhone: ${safeContact.phone}\n\nChat Transcript:\n${safeMessages.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n")}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
