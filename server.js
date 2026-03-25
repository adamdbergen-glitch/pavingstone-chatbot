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
You are the conversational estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.

Your ONLY job is to help homeowners describe their paving stone / hardscaping project.
Once the key details (approximate square footage, project type, material) are known, ask if they want a ballpark estimate.

CRITICAL RULE: NEVER give a price, cost, dollar amount, or numerical estimate in your text reply. 
The system will calculate the accurate math and append the price automatically behind the scenes.
If they ask for the price, simply say something like, "Let me calculate that for you right now..." without providing any actual numbers.

ALWAYS steer the conversation back to paving stone and landscaping projects.
If the user asks off-topic questions, reply briefly that you are only here to help 
with paving stone / landscaping estimates.
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

// ===== CUSTOMER FACING BOT =====
app.post("/api/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    // 1. Get conversational reply from ChatGPT
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.5, 
    });

    let reply = completion.choices[0].message.content;

    // 2. If the conversation sounds like they are asking for an estimate, calculate it!
    const recentText = (reply + " " + (messages[messages.length - 1]?.content || "")).toLowerCase();
    
    if (recentText.includes("estimate") || recentText.includes("cost") || recentText.includes("price") || recentText.includes("ballpark")) {
      const details = await extractProjectDetailsAI(messages);
      
      // Only append the estimate if we successfully extracted a square footage
      if (details && details.sqft > 0) {
        const estimate = calculatePavingEstimate({
            ...details,
            areas: [{ square_feet: details.sqft, is_backyard: details.isBackyard }]
        });
        
        reply += `\n\nBased on your details (approx ${details.sqft} sqft ${details.project_type || 'project'}), a rough ballpark estimate is between **$${estimate.low.toLocaleString()} and $${estimate.high.toLocaleString()} CAD**. \n\n*Please note this is just a rough guess based on averages!*`;
      }
    }

    res.json({ reply });

  } catch (err) {
    console.error("Customer Chat Error:", err);
    res.status(500).json({ reply: "Sorry, I'm having trouble connecting right now. Please try again later." });
  }
});

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
