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

// 2. SAFETY: Limit JSON payload size
app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gmail email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com", 
  port: parseInt(process.env.SMTP_PORT || "587", 10), 
  secure: false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS, 
  },
});

// ===== SYSTEM PROMPTS =====

const SYSTEM_PROMPT = `
You are the estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.

Your ONLY job is to help homeowners describe their paving stone / hardscaping project
and, once the key details are known and they ask for it, help the server return
a rough ballpark estimate. You are NOT a general-purpose chatbot.

ALWAYS steer the conversation back to paving stone and landscaping projects.
If the user asks off-topic questions, reply briefly that you are only here to help 
with paving stone / landscaping estimates and then ask what kind of project they have in mind.
`;

// ===== AI EXTRACTOR =====

async function extractProjectDetailsAI(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const extractionPrompt = `
    You are a data extraction bot. 
    Analyze the conversation history below and extract the **current valid project details**.
    Return JSON ONLY with these fields:
    - sqft (number)
    - project_type (string)
    - is_backyard (boolean)
    - access_level (string)
    - city_town (string)
    - is_out_of_town (boolean)
    - material_text (string)
    Conversation:
    ${safeMessages.map(m => `${m.role}: ${m.content}`).join("\n")}
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: extractionPrompt }],
      temperature: 0.1, 
    });
    const data = JSON.parse(completion.choices[0].message.content);
    const material_code = inferMaterialCodeFromText(data.material_text || "");

    return {
      sqft: Number(data.sqft) || 0,
      project_type: data.project_type,
      isBackyard: !!data.is_backyard,
      access_level: data.access_level || "medium",
      city_town: data.city_town || "Winnipeg",
      is_out_of_town: !!data.is_out_of_town,
      material_code: material_code
    };
  } catch (err) {
    console.error("AI Extraction Failed:", err);
    return { sqft: 0, material_code: "barkman_holland" }; 
  }
}

// ===== INTERNAL ESTIMATOR / APP INTEGRATION =====

app.post("/api/internal-chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    // UPDATED PROMPT: Added "scope_summary" and "customer" extraction
    const ISOLATED_INTERNAL_PROMPT = `
      You are Adam's internal assistant. Talk to Adam to figure out the project scope.
      
      CRITICAL RULE: NEVER give a price, cost, or dollar estimate in your text reply. 
      The external UI handles all pricing.
      
      Return a STRICT JSON object:
      {
        "reply": "Your conversational reply to Adam.",
        "meta": {
          "sqft": number,
          "project_type": "patio" | "walkway" | "driveway" | null,
          "is_backyard": boolean,
          "access_level": "easy" | "medium" | "difficult",
          "material_text": "paver name",
          "scope_summary": "A concise 2-3 sentence professional summary of the project scope."
        },
        "customer": {
          "name": "extracted name or empty",
          "phone": "extracted phone or empty",
          "email": "extracted email or empty",
          "address": "extracted address or empty"
        }
      }
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: ISOLATED_INTERNAL_PROMPT }, ...messages],
      temperature: 0.2, 
    });

    const data = JSON.parse(completion.choices[0].message.content);
    const meta = {
      sqft: Number(data.meta?.sqft) || 0,
      project_type: data.meta?.project_type || 'patio',
      isBackyard: !!data.meta?.is_backyard,
      access_level: data.meta?.access_level || "medium",
      material_code: inferMaterialCodeFromText(data.meta?.material_text || ""),
      scope_summary: data.meta?.scope_summary || "", // Pass the summary to frontend
      city_town: "Winnipeg",
      is_out_of_town: false
    };

    res.json({ reply: data.reply, meta: meta, customer: data.customer || {} });

  } catch (err) {
    console.error("Internal Chat Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
