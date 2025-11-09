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
- Ask simple, friendly questions to understand the project (type, size, yard location, access, city/town, and material).
- DO NOT make up or calculate dollar amounts yourself.
- Never mention a price per square foot or a total price in dollars.
- When you think you have enough information, just summarise the project in words (no numbers), and the server will calculate the ballpark price separately.
- Always remind the user that any estimate they see is a rough ballpark and may not be accurate without a site visit.

Speak casually and clearly. Do not talk about JSON, APIs, or internal logic.
`;

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
      // (You can add more towns as needed)

      // Infer material from text
      const material_code = inferMaterialCodeFromText(userMsg);

      const estimate = calculatePavingEstimate({
        project_type,
        areas: [{ square_feet: sqft, is_backyard: isBackyard }],
        access_level,
        material_code,
        city_town,
        is_out_of_town
      });

      const reply = `
Got it – thanks for the details!

Based on what you've told me, your project is likely in the range of **$${estimate.low.toLocaleString()}–$${estimate.high.toLocaleString()} +GST**.

⚠️ This is a rough ballpark only and may NOT be fully accurate. Final pricing can change after a site visit once access, base conditions, slopes, drainage, and any hidden issues are checked.

If that range seems reasonable, I can take your name, phone number, email, and address so Adam can schedule a site visit for a firm quote.
`.trim();

      return res.json({ reply, estimate });
    }

    // If we don't have square footage yet, just use the AI's text (no pricing!)
    return res.json({ reply: aiReply, estimate: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Chatbot server running on port ${port}`);
});

