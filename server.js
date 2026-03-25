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
// origin: true allows embedded widgets on any site (Squarespace/Wix) to work
const corsOptions = {
  origin: true, 
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Handle preflight requests

// 2. SAFETY: Limit JSON payload size to prevent spam/crashes
app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gmail email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com", 
  port: parseInt(process.env.SMTP_PORT || "587", 10), 
  secure: false, 
  auth: {
    user: process.env.SMTP_USER, // Your Gmail
    pass: process.env.SMTP_PASS, // Your App Password
  },
});

//
// ===== SYSTEM PROMPTS =====
//

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

const INTERNAL_SYSTEM_PROMPT = `
You are Adam's internal assistant for The Paving Stone Pros.

Primary job:
- Help Adam think through paving stone / landscaping projects.
- Use the numbers the server attaches (estimate ranges, meta).
- Generally help with business writing: scope descriptions, emails, notes, etc.

You are allowed to discuss other topics if Adam asks, but default to thinking like 
an experienced hardscape estimator and contractor.
`;

//
// ===== AI EXTRACTOR =====
//

async function extractProjectDetailsAI(messages) {
  // CRASH PROTECTION: Ensure messages is an array
  const safeMessages = Array.isArray(messages) ? messages : [];

  const extractionPrompt = `
    You are a data extraction bot. 
    Analyze the conversation history below and extract the **current valid project details**.
    If the user corrected themselves (e.g. "actually it's 200 sqft", or "no, backyard"), use the LATEST information.
    
    Return JSON ONLY with these fields:
    - sqft (number, or 0 if unknown)
    - project_type (string: "patio", "walkway", "driveway", or null)
    - is_backyard (boolean)
    - access_level (string: "easy", "medium", "difficult")
    - city_town (string, default "Winnipeg" if unknown)
    - is_out_of_town (boolean)
    - material_text (string: the specific paver name mentioned, e.g. "Barkman Holland")

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
      // TYPE SAFETY: Force Number() to prevent string math errors
      sqft: Number(data.sqft) || 0,
      project_type: data.project_type,
      isBackyard: !!data.is_backyard, // Force boolean
      access_level: data.access_level || "medium",
      city_town: data.city_town || "Winnipeg",
      is_out_of_town: !!data.is_out_of_town, // Force boolean
      material_code: material_code
    };
  } catch (err) {
    console.error("AI Extraction Failed:", err);
    return { sqft: 0, material_code: "barkman_holland" }; 
  }
}

//
// ===== PUBLIC / CUSTOMER-FACING CHATBOT =====
//

app.post("/api/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    // 1. Get the conversational reply
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
    });
    let aiReply = completion.choices?.[0]?.message?.content?.trim() || "";

    // 2. Extract Details
    const meta = await extractProjectDetailsAI(messages);
    
    // 3. Determine if user wants price
    const lastUserMessage = messages[messages.length - 1]?.content || "";
    const lowerLastUser = lastUserMessage.toLowerCase();
    const askingForPrice = /\b(price|cost|ballpark|estimate|quote)\b/.test(lowerLastUser);
    const confirmingReady = /\b(yes|sure|ok|ready)\b/.test(lowerLastUser);
    const userAskedPrice = askingForPrice || confirmingReady;

    let estimate = null;
    let reply = aiReply;

    // 4. Calculate Estimate if ready
    if (meta.sqft > 0 && meta.project_type && userAskedPrice) {
      const rawEstimate = calculatePavingEstimate({
        project_type: meta.project_type,
        areas: [{ square_feet: meta.sqft, is_backyard: meta.isBackyard }],
        access_level: meta.access_level,
        material_code: meta.material_code,
        city_town: meta.city_town,
        is_out_of_town: meta.is_out_of_town,
      });

      // Buffer for public facing (Widen range)
      const bufferedLow = Math.round(rawEstimate.low * 0.9);
      const bufferedHigh = Math.round(rawEstimate.high * 1.1);
      const tierDesc = getMaterialTierDescription(meta.material_code);

      // FORMATTING: Use toLocaleString for nice commas
      reply = `Based on what you've told me (${meta.sqft} sqft ${meta.project_type}), your project is likely in the range of **$${bufferedLow.toLocaleString()} – $${bufferedHigh.toLocaleString()} +GST**.\n\nThe material is ${tierDesc}.\n\n⚠️ This is a rough ballpark only. Shall we book a site visit?`;

      estimate = {
        ...rawEstimate,
        low: bufferedLow,
        high: bufferedHigh
      };
    }

    return res.json({ reply, estimate, meta });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//
// ===== INTERNAL ESTIMATOR / APP INTEGRATION =====
//
app.post("/api/internal-chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    // 1. ISOLATED PROMPT: The public bot never sees this.
    const ISOLATED_INTERNAL_PROMPT = `
      You are Adam's internal assistant. Talk to Adam to figure out the project scope.
      Return a STRICT JSON object with your conversational reply and the extracted data:
      {
        "reply": "Your conversational reply to Adam.",
        "meta": {
          "sqft": number (or 0),
          "project_type": "patio" | "walkway" | "driveway" | null,
          "is_backyard": boolean,
          "access_level": "easy" | "medium" | "difficult",
          "material_text": "paver name or empty"
        }
      }
    `;

    // 2. Fetch from OpenAI
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: ISOLATED_INTERNAL_PROMPT }, ...messages],
      temperature: 0.2, // Low temp prevents JSON formatting errors
    });

    const data = JSON.parse(completion.choices[0].message.content);
    
    // 3. Clean up the variables to send back to the React app
    const meta = {
      sqft: Number(data.meta?.sqft) || 0,
      project_type: data.meta?.project_type || 'patio',
      isBackyard: !!data.meta?.is_backyard,
      access_level: data.meta?.access_level || "medium",
      material_code: inferMaterialCodeFromText(data.meta?.material_text || ""),
      city_town: "Winnipeg",
      is_out_of_town: false
    };

    // 4. Return the AI reply and the variables (Let the React app do the math)
    res.json({ reply: data.reply, meta: meta });

  } catch (err) {
    console.error("Internal Chat Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
//
// ===== LEAD CAPTURE (GMAIL) =====
//

app.post("/api/lead", async (req, res) => {
  try {
    const { contact, estimate, messages } = req.body;
    // CRASH PROTECTION: Handle missing/malformed contact info
    const safeContact = contact || {};
    const safeMessages = Array.isArray(messages) ? messages : [];

    const transcriptText = safeMessages.length > 0
      ? safeMessages.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n")
      : "No transcript available.";

    let estimateText = "No estimate generated.";
    
    // FORMATTING: Clean up the email numbers
    if (estimate) {
      estimateText = `
      Range:   $${Number(estimate.low).toLocaleString()} - $${Number(estimate.high).toLocaleString()} +GST
      Details: ${estimate.details || "N/A"}
      `;
    }

    const mailOptions = {
      from: `"Paving Bot" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // Sends to YOU (Adam)
      subject: `🚧 New Lead: ${safeContact.name || "Unknown"} (${safeContact.city || 'Winnipeg'})`,
      text: `
      NEW LEAD DETAILS
      ----------------
      Name:    ${safeContact.name || "N/A"}
      Email:   ${safeContact.email || "N/A"}
      Phone:   ${safeContact.phone || "N/A"}
      Address: ${safeContact.address || "N/A"}
      
      ESTIMATE GIVEN
      --------------
      ${estimateText}

      CHAT TRANSCRIPT
      ---------------
      ${transcriptText}
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Lead sent for ${safeContact.name || "Unknown"}`);
    res.json({ success: true });

  } catch (error) {
    console.error("Email Error:", error);
    res.status(500).json({ success: false, error: "Failed to send email" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
