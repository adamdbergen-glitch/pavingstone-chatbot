// server.js - Paving Stone Pros chatbot + Gmail lead email sending

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
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gmail email transporter (using app password or SMTP creds)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                        // e.g. smtp.gmail.com
  port: parseInt(process.env.SMTP_PORT || "587", 10), // 587 for TLS
  secure: false,                                      // false for 587, true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const SYSTEM_PROMPT = `
You are the estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.

Your ONLY job is to help homeowners describe their paving stone / hardscaping project
and, once all the key details are known and they ask for it, help the server return
a rough ballpark estimate. You are NOT a general-purpose chatbot.

ALWAYS steer the conversation back to paving stone and landscaping projects.
If the user asks off-topic questions (for example "why is the sky blue"), reply briefly
that you are only here to help with paving stone / landscaping estimates and then ask
what kind of project they have in mind.

1) Ask simple, friendly questions to clearly understand the project BEFORE any price is given.
   Ask about:
   • Project type (patio, driveway, walkway, other)
   • Approximate size in square feet
   • Location on the property (front yard, back yard, side, etc.)
   • Access (easy / medium / difficult)
   • City or town (and whether it's out of town from Winnipeg)
   • Material (choose ONE exact product name, not a vague description).
     Examples you can suggest:
       - Barkman: Holland, Broadway 65mm, Broadway 100mm, Verano, Roman, Fjord,
         Lexington slabs, Terrace slabs, Brookside, Diamond Face slabs, Arborwood.
       - Belgard: Holland, Dimensions, Origins, Mega Libre.
       - Techo-Bloc: Blu 60 (Slate or Smooth), Blu Grande, Blu Polished.

   When the user asks for "cheap" or "cost-effective" options, you MAY suggest specific
   budget-friendly lines such as:
     - Barkman Holland
     - Barkman Broadway 65mm
     - Barkman Verano
     - Barkman Brookside / Terrace / Diamond Face slabs
   You can also mention mid-range and premium options like:
     - Barkman Fjord, Lexington slabs, Arborwood
     - Broadway 100mm / Broadway Planks
     - Techo-Bloc Blu 60 / Blu Grande / Blu Polished

   Explain that in most projects, the majority of the cost is in LABOUR, excavation,
   base preparation and compaction, and that the choice of stone usually only nudges
   the final price compared to that base work.

2) Only give a ballpark estimate AFTER:
   • You have all core details (project type, size, access, city/town, one clear material),
   • AND the user has clearly indicated they want a price / estimate / ballpark / quote
     or has confirmed they are ready for a ballpark.

3) When you think everything is ready, you should:
   • Summarise the project in plain language,
   • Then explicitly ask if they are ready for a ballpark estimate if they have not asked yet.

   The server will detect when the user says they want a ballpark and will attach
   the actual CAD dollar range. You should NOT try to invent or format the numbers yourself.

4) VERY IMPORTANT:
   • Do NOT invent dollar amounts or "$ per square foot" yourself – the server will handle pricing.
   • Never use placeholder amounts like "$X–$Y" or "$X to $Y". If you refer to a range
     without real numbers, say "a rough ballpark range" with NO dollar symbols or numbers.
   • When the server attaches a price, it will appear in your reply as a proper CAD range.

5) If any important detail is missing, DO NOT guess and DO NOT mention price.
   Ask a short follow-up question instead.

Speak casually and clearly, like a friendly estimator on the phone.
Do not mention JSON, APIs, or internal logic.
`;

// === Estimate endpoint ===
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    // Call OpenAI to get the conversational reply
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
    });

    const aiReply = completion.choices?.[0]?.message?.content?.trim() || "";

    // ---- Extract info from the conversation so far ----
    const userMessages = messages.filter((m) => m.role === "user");
    const allUserText = userMessages
      .map((m) => (m.content || "").toLowerCase())
      .join(" ");
    const lastUser =
      (userMessages[userMessages.length - 1]?.content || "").toLowerCase();

    // 1) Square footage (search across the whole conversation)
    let sqft = 0;
    const dimMatch = allUserText.match(/(\d+)\s*x\s*(\d+)/); // e.g. "20x20"
    if (dimMatch) {
      const length = parseInt(dimMatch[1], 10);
      const width = parseInt(dimMatch[2], 10);
      sqft = length * width;
    } else {
      const sqMatch = allUserText.match(
        /(\d+)\s*(sqft|square feet|square foot|sq ft)/
      );
      if (sqMatch) {
        sqft = parseInt(sqMatch[1], 10);
      }
    }

    // 2) Project type
    let project_type = null;
    if (allUserText.includes("driveway")) project_type = "driveway";
    else if (
      allUserText.includes("walkway") ||
      allUserText.includes("sidewalk") ||
      allUserText.includes("path") ||
      allUserText.includes("walk way")
    ) {
      project_type = "walkway";
    } else if (
      allUserText.includes("patio") ||
      allUserText.includes("backyard") ||
      allUserText.includes("back yard") ||
      allUserText.includes("yard")
    ) {
      project_type = "patio";
    }

    // 3) Yard location
    const isBackyard =
      allUserText.includes("backyard") ||
      allUserText.includes("back yard") ||
      (allUserText.includes("back") && !allUserText.includes("front"));

    // 4) Access level
    let access_level = "medium";
    if (
      allUserText.includes("easy access") ||
      allUserText.includes("good access") ||
      allUserText.includes("easy to access")
    ) {
      access_level = "easy";
    }
    if (
      allUserText.includes("tight") ||
      allUserText.includes("difficult") ||
      allUserText.includes("hard access") ||
      allUserText.includes("no access")
    ) {
      access_level = "difficult";
    }

    // 5) City / town (basic detection)
    let city_town = null;
    let is_out_of_town = false;
    if (allUserText.includes("winnipeg")) {
      city_town = "Winnipeg";
    } else if (allUserText.includes("steinbach")) {
      city_town = "Steinbach";
      is_out_of_town = true;
    } else if (allUserText.includes("selkirk")) {
      city_town = "Selkirk";
      is_out_of_town = true;
    } else if (
      allUserText.includes("morden") ||
      allUserText.includes("winkler")
    ) {
      city_town = "Morden/Winkler area";
      is_out_of_town = true;
    }

    // 6) Material code (from all user text)
    const material_code = inferMaterialCodeFromText(allUserText);

    // 7) Did the user actually ask for a price / estimate?
    let userAskedPrice = /\b(price|cost|estimate|ballpark|quote|how much)\b/.test(
      lastUser
    );

    const lastMsg = messages[messages.length - 1];
    const prevMsg = messages[messages.length - 2];
    const prevAssistantText =
      prevMsg?.role === "assistant" ? prevMsg.content || "" : "";

    // Previous assistant message was *prompting* an estimate
    // (mentions estimate/ballpark/price but does NOT already contain a $ range)
    const prevWasPromptingEstimate =
      /\b(estimate|ballpark|price|cost|quote)\b/i.test(prevAssistantText) &&
      !prevAssistantText.includes("$");

    // If the previous assistant message was asking "ready for a ballpark?"
    // and the user answered with anything that is NOT clearly "no / not yet / later",
    // treat that as them asking for a price. This only fires BEFORE we've ever given a $ range,
    // so it won't loop and repeat the price on every later message.
    if (
      !userAskedPrice &&
      lastMsg?.role === "user" &&
      prevWasPromptingEstimate
    ) {
      const userText = (lastMsg.content || "").toLowerCase();
      if (!/\b(no|not yet|later)\b/.test(userText)) {
        userAskedPrice = true;
      }
    }

    // ---- Decide if we are ready to calculate a price ----
    const haveAllDetails = sqft > 0 && !!project_type && !!material_code;
    const readyToEstimate = haveAllDetails && userAskedPrice;

    let estimate = null;
    let reply = aiReply;

    if (readyToEstimate) {
      estimate = calculatePavingEstimate({
        project_type,
        areas: [{ square_feet: sqft, is_backyard: isBackyard }],
        access_level,
        material_code,
        city_town: city_town || "Winnipeg",
        is_out_of_town,
      });

      const tierDesc = getMaterialTierDescription(material_code);

      reply = `Got it – thanks for all the details.

Based on what you've told me, your project is likely in the range of **$${estimate.low.toLocaleString()}–$${estimate.high.toLocaleString()} +GST**.

The material you've chosen is ${tierDesc}.

Just so you know, most of the cost in this kind of project is in the **labour, excavation, base preparation, and compaction**. The specific paver you choose usually only moves the final total a little compared to that prep work, so it's often better to pick a stone you really like the look of long term rather than chasing the absolute cheapest option.

⚠️ This is a rough ballpark only and may NOT be fully accurate. Final pricing can change after a site visit once access, base conditions, slopes, drainage, and any hidden issues are checked.

If that range seems reasonable, I can take your name, phone number, email, and address so Adam can schedule a site visit for a firm quote.`;
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
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
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
`.trim(),
    };

    console.log("📧 Sending lead email to:", toEmail);
    await transporter.sendMail(mailOptions);
    console.log("✅ Lead email sent successfully");

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending lead email:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to send lead email" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
