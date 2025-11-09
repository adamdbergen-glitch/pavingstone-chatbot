// server.js - Paving Stone Pros chatbot + Gmail lead email sending

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const nodemailer = require("nodemailer");
const { calculatePavingEstimate, inferMaterialCodeFromText } = require("./pricing");

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gmail email transporter (using app password)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                        // e.g. smtp.gmail.com
  port: parseInt(process.env.SMTP_PORT || "587", 10), // 587 for TLS
  secure: false,                                      // false for 587, true for 465
  auth: {
    user: process.env.SMTP_USER,                      // your Gmail address
    pass: process.env.SMTP_PASS                       // your Gmail app password
  }
});

const SYSTEM_PROMPT = `
You are the estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.
Ask simple, friendly questions to gather info about the project (type, size, yard location, access, city/town, and material family).
Do NOT invent dollar amounts yourself or talk about "$ per square foot" — the server will handle pricing.
Always remind the user it's a rough ballpark and a site visit is needed for a firm quote.
Speak casually and clearly.
`;

// === Estimate endpoint ===
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4
    });

    const replyFromAI = completion.choices?.[0]?.message?.content?.trim() || "";

    const last = (messages[messages.length - 1]?.content || "").toLowerCase();

    // Try to read size from last user message
    let sqft = 0;
    const dimMatch = last.match(/(\d+)\s*x\s*(\d+)/); // e.g. 20x20
    if (dimMatch) {
      const length = parseInt(dimMatch[1], 10);
      const width = parseInt(dimMatch[2], 10);
      sqft = length * width;
    } else {
      const sqMatch = last.match(/(\d+)\s*(sqft|square feet|square foot|sq ft)/);
      if (sqMatch) {
        sqft = parseInt(sqMatch[1], 10);
      }
    }

    let estimate = null;
    let reply = replyFromAI;

    if (sqft > 0) {
      // Infer project type
      let project_type = "patio";
      if (last.includes("driveway")) {
        project_type = "driveway";
      } else if (
        last.includes("walkway") ||
        last.includes("sidewalk") ||
        last.includes("path") ||
        last.includes("walk way")
      ) {
        project_type = "walkway";
      }

      // Backyard?
      const isBackyard =
        last.includes("backyard") ||
        last.includes("back yard") ||
        (last.includes("back") && !last.includes("front"));

      // Access level
      let access_level = "medium";
      if (last.includes("easy access")) access_level = "easy";
      if (
        last.includes("tight") ||
        last.includes("difficult") ||
        last.includes("hard access")
      ) access_level = "difficult";

      // City / out-of-town (basic mapping)
      let city_town = "Winnipeg";
      let is_out_of_town = false;
      if (last.includes("steinbach")) {
        city_town = "Steinbach";
        is_out_of_town = true;
      }
      if (last.includes("selkirk")) {
        city_town = "Selkirk";
        is_out_of_town = true;
      }
      if (last.includes("morden") || last.includes("winkler")) {
        city_town = "Morden/Winkler area";
        is_out_of_town = true;
      }

      const material_code = inferMaterialCodeFromText(last);

      estimate = calculatePavingEstimate({
        project_type,
        areas: [{ square_feet: sqft, is_backyard: isBackyard }],
        access_level,
        material_code,
        city_town,
        is_out_of_town
      });

      reply = `Got it! Based on what you've told me, your project will likely fall between **$${estimate.low.toLocaleString()}–$${estimate.high.toLocaleString()} +GST**.

⚠️ This is a rough ballpark only. Final pricing depends on access, base condition, slopes, drainage, and what we see on a site visit.`;
    }

    return res.json({ reply, estimate });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// === Lead capture endpoint ===
app.post("/api/lead", async (req, res) => {
  try {
    console.log("🔥 Lead endpoint hit with body:", req.body);

    const { contact, estimate, messages } = req.body || {};
    const { name, email, phone, address } = contact || {};

    const low = estimate?.low ? `$${estimate.low.toLocaleString()}` : "N/A";
    const high = estimate?.high ? `$${estimate.high.toLocaleString()}` : "N/A";
    const notes = estimate?.notes || "N/A";

    const transcript = (messages || [])
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const toEmail = process.env.LEAD_NOTIFY_EMAIL || process.env.SMTP_USER;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: toEmail,
      subject: `New Paving Stone Pros lead: ${name || "Unknown"}`,
      text: `
You have a new chatbot lead.

Contact details:
- Name: ${name || "N/A"}
- Email: ${email || "N/A"}
- Phone: ${phone || "N/A"}
- Address: ${address || "N/A"}

Estimated range (ballpark only):
- Low: ${low}
- High: ${high}
- Notes: ${notes}

Chat transcript:
${transcript}
`.trim()
    };

    console.log("📧 Sending lead email to:", toEmail);
    await transporter.sendMail(mailOptions);
    console.log("✅ Lead email sent successfully");

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending lead email:", err);
    res.status(500).json({ success: false, error: "Failed to send lead email" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
