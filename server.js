// server.js - Paving Stone Pros chatbot + lead endpoint (no email yet)

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { calculatePavingEstimate, inferMaterialCodeFromText } = require("./pricing");

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are the estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.

Your job:
- Ask simple, friendly questions to understand the project (type, size, yard location, access, city/town, and material family such as "Broadway", "Origins", "Blu 60", etc.).
- You may ask if they have a colour TONE preference only in very general terms (for example: light grey, dark grey, tan/brown).
- DO NOT suggest or list specific manufacturer colour names (for example: "Amber", "Silex", "Sandalwood", "Charcoal", etc.).
- If the user asks about exact colours, tell them that exact colour selection happens later during the design / quote stage and does not change the rough ballpark price.
- DO NOT make up or calculate dollar amounts yourself. Never talk about "$ per square foot".
- When you think you have enough information, just summarise the project in words (no prices), and the server will calculate the ballpark price separately.
- Always remind the user that any estimate they see is a rough ballpark and may not be accurate without a site visit.

Speak casually and clearly. Do not talk about JSON, APIs, or internal logic.
`;

// Main chat endpoint (estimate logic)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages
    ];

    // Let the model handle wording / questions
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: apiMessages,
      temperature: 0.4
    });

    const aiReply = completion.choices?.[0]?.message?.content?.trim() || "";

    // Last user message
    const lastMsg = messages[messages.length - 1]?.content || "";
    const userMsg = lastMsg.toLowerCase();

    // --- Try to extract size (sqft) from the USER message ---

    // Pattern "20x20", "15 x 12", etc.
    const dimMatch = userMsg.match(/(\d+)\s*x\s*(\d+)/);
    let sqft = 0;
    if (dimMatch) {
      const length = parseInt(dimMatch[1], 10);
      const width = parseInt(dimMatch[2], 10);
      sqft = length * width;
    } else {
      // Pattern "300 square feet", "300 sqft", "300 sq ft"
      const sqMatch = userMsg.match(/(\d+)\s*(sqft|square feet|square foot|sq ft)/);
      if (sqMatch) {
        sqft = parseInt(sqMatch[1], 10);
      }
    }

    let estimate = null;
    let reply = aiReply;

    // If we have square footage, we will ALWAYS try to estimate
    if (sqft > 0) {
      // Infer project type – default to patio if not obvious
      let project_type = "patio";
      if (userMsg.includes("driveway")) project_type = "driveway";
      else if (
        userMsg.includes("walkway") ||
        userMsg.includes("sidewalk") ||
        userMsg.includes("path") ||
        userMsg.includes("walk way")
      ) project_type = "walkway";

      // Backyard? (true if "backyard" or "back yard" or "back")
      const isBackyard =
        userMsg.includes("backyard") ||
        userMsg.includes("back yard") ||
        (userMsg.includes("back") && !userMsg.includes("front"));

      // Access level guess
      let access_level = "medium";
      if (userMsg.includes("easy access")) access_level = "easy";
      if (
        userMsg.includes("tight") ||
        userMsg.includes("difficult") ||
        userMsg.includes("hard access")
      ) access_level = "difficult";

      // City/town – for now still default to Winnipeg if not clearly out of town
      let city_town = "Winnipeg";
      let is_out_of_town = false;
      if (userMsg.includes("steinbach")) {
        city_town = "Steinbach";
        is_out_of_town = true;
      }
      if (userMsg.includes("selkirk")) {
        city_town = "Selkirk";
        is_out_of_town = true;
      }
      if (userMsg.includes("morden") || userMsg.includes("winkler")) {
        city_town = "Morden/Winkler area";
        is_out_of_town = true;
      }

      // Infer material from text
      const material_code = inferMaterialCodeFromText(userMsg);

      estimate = calculatePavingEstimate({
        project_type,
        areas: [{ square_feet: sqft, is_backyard: isBackyard }],
        access_level,
        material_code,
        city_town,
        is_out_of_town
      });

      reply = `
Got it – thanks for the details!

Based on what you've told me, your project is likely in the range of **$${estimate.low.toLocaleString()}–$${estimate.high.toLocaleString()} +GST**.

⚠️ This is a rough ballpark only and may NOT be fully accurate. Final pricing can change after a site visit once access, base conditions, slopes, drainage, and any hidden issues are checked.

If that range seems reasonable, I can take your name, phone number, email, and address so Adam can schedule a site visit for a firm quote.
`.trim();
    }

    return res.json({ reply, estimate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Lead capture endpoint (test version – no email yet)
app.post("/api/lead", async (req, res) => {
  try {
    console.log("🔥 Lead endpoint hit with body:", req.body);

    // For now, just pretend it worked
    return res.json({ success: true });
  } catch (err) {
    console.error("Error in lead endpoint:", err);
    res.status(500).json({ success: false, error: "Failed in lead endpoint" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Chatbot server running on port ${port}`);
});
