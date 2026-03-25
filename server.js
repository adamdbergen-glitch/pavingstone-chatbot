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
Your ONLY job is to help homeowners describe their project. Ask about type, size, location, access, and material.
Do NOT invent dollar amounts yourself.
`;

const INTERNAL_SYSTEM_PROMPT = `
You are Adam's internal assistant for The Paving Stone Pros.
Your job is to help Adam work out project details and prepare business artifacts.
Analyze the current project data and help Adam refine the scope, or write descriptions for QuickBooks and Emails.

STRICT RULE: You must always return a JSON object with:
{
  "reply": "Your message to Adam discussing the project or math",
  "qb_headline": "Professional title for an invoice",
  "qb_description": "Detailed scope of work",
  "email_body": "A draft email for the client"
}
`;

// ===== AI EXTRACTOR =====

async function extractProjectDetailsAI(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const extractionPrompt = `
    Analyze the conversation and extract project details. 
    Use the LATEST info if corrections were made.
    Return JSON ONLY:
    - sqft (number)
    - project_type ("patio", "walkway", "driveway", or null)
    - is_backyard (boolean)
    - access_level ("easy", "medium", "difficult")
    - material_text (string)
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
      material_code: inferMaterialCodeFromText(data.material_text || "")
    };
  } catch (err) {
    return { sqft: 0, material_code: "barkman_holland" }; 
  }
}

// ===== PUBLIC CHATBOT (UNTOUCHED) =====

app.post("/api/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    });
    let aiReply = completion.choices[0].message.content;
    const meta = await extractProjectDetailsAI(messages);
    
    let estimate = null;
    if (meta.sqft > 0 && meta.project_type) {
      const raw = calculatePavingEstimate(meta);
      estimate = { low: Math.round(raw.low * 0.9), high: Math.round(raw.high * 1.1) };
    }
    res.json({ reply: aiReply, estimate, meta });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ===== INTERNAL ESTIMATOR (UPDATED) =====

app.post("/api/internal-chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];

    // 1. Extract details FIRST so the AI knows what we are talking about
    const meta = await extractProjectDetailsAI(messages);

    // 2. Calculate the actual internal price
    let estimate = null;
    if (meta.sqft > 0 && meta.project_type) {
      estimate = calculatePavingEstimate(meta);
    }

    // 3. Single AI call for response and business writing
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: `${INTERNAL_SYSTEM_PROMPT}\n\nCurrent Meta: ${JSON.stringify(meta)}\nCurrent Internal Estimate: ${JSON.stringify(estimate)}` 
        },
        ...messages
      ],
      temperature: 0.3,
    });

    const aiData = JSON.parse(completion.choices[0].message.content);

    return res.json({
      reply: aiData.reply,
      estimate,
      meta,
      qb_headline: aiData.qb_headline,
      qb_description: aiData.qb_description,
      email_body: aiData.email_body,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ===== LEAD CAPTURE =====

app.post("/api/lead", async (req, res) => {
  try {
    const { contact, estimate, messages } = req.body;
    const safeContact = contact || {};
    const safeMessages = Array.isArray(messages) ? messages : [];

    const mailOptions = {
      from: `"Paving Bot" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: `🚧 New Lead: ${safeContact.name || "Unknown"}`,
      text: `Name: ${safeContact.name}\nEmail: ${safeContact.email}\nPhone: ${safeContact.phone}\nEstimate: $${estimate?.low} - $${estimate?.high}\n\nTranscript:\n${safeMessages.map(m => m.content).join('\n')}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false }); }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`🚀 Internal Estimator active on port ${port}`));
