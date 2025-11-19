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
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Gmail email transporter (using app password or SMTP creds)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g. smtp.gmail.com
  port: parseInt(process.env.SMTP_PORT || "587", 10), // 587 for TLS
  secure: false, // false for 587, true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

//
// ===== SYSTEM PROMPTS =====
//

// Public / customer-facing estimator bot
const SYSTEM_PROMPT = `
You are the estimating assistant for "The Paving Stone Pros" in Manitoba, Canada.

Your ONLY job is to help homeowners describe their paving stone / hardscaping project
and, once the key details are known and they ask for it, help the server return
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

2) Be conversational and natural, not like a form. Ask 1–2 questions at a time.
   Your goal is to get enough detail for a decent ballpark:
   • Project type
   • Approximate total square footage
   • Material choice (or at least a clear direction: budget / mid-range / premium)
   • Where on the property (front / back / side, or driveway)
   • Access difficulty
   • City/town (so the server can apply out-of-town surcharges)

   Only give a ballpark estimate AFTER:
   • You have core details (project type, size, one clear material),
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
   • When the server attaches a price, it will appear in your reply content with real
     numbers already inserted.

5) When an estimate is attached, you should:
   • Remind the user it is a rough ballpark only.
   • Explain that final pricing requires a site visit to confirm slopes, drainage,
     base conditions, access, and any special requirements.
   • Gently guide them toward booking a site visit or leaving their name, phone, and email
     so Adam from The Paving Stone Pros can follow up.

6) If the user asks about financing or "monthly payments", explain:
   • You are not doing exact financing numbers, but many projects can be broken into
     roughly manageable monthly costs through third-party financing options.
   • Emphasise that any financing is subject to approval with the actual finance provider.

Always be friendly, honest, and avoid over-promising. Underpromise and overdeliver.
`;

// Internal bot: more flexible, meant for Adam / staff
const INTERNAL_SYSTEM_PROMPT = `
You are Adam's internal assistant for The Paving Stone Pros.

Primary job:
- Help Adam think through paving stone / landscaping projects,
- Use the numbers the server attaches (estimate ranges, meta),
- And generally help with business writing: scope descriptions, emails, notes, etc.

You are allowed to discuss other topics (business, life, tech, etc.) if Adam asks,
but default to thinking like an experienced hardscape estimator and contractor.

The server MAY attach to your replies:
- "estimate": an object with low/high CAD range and notes
- "meta": parsed details like sqft, project type, material, access, city

You don't need to calculate prices yourself; focus on explaining,
structuring information, and writing things Adam can drop into QuickBooks or emails.
Be concise, practical, and talk like a real person, not a corporate robot.
`;

// Formatter prompt: turn a project + estimate into QB text + email
const INTERNAL_QB_PROMPT = `
You are helping a contractor (Adam from "The Paving Stone Pros" in Manitoba)
prepare an estimate and email for a residential or light commercial hardscape job.

You will receive ONE JSON string as input, with:
- "conversation_summary": brief plain-language summary of what Adam and the client discussed
- "project": {
    sqft,
    project_type,      // "patio", "walkway", "driveway", etc.
    is_backyard,       // boolean
    access_level,      // "easy" | "medium" | "difficult"
    city_town,
    is_out_of_town,    // boolean
    material_code,     // internal code like "barkman_holland"
    material_tier      // human description like "budget", "midrange", etc.
  }
- "estimate": {
    low,
    high,
    notes
  }

Your job is to RETURN STRICT JSON with EXACTLY these fields:
{
  "qb_headline": string,
  "qb_description": string,
  "email_body": string
}

Guidelines:

1) qb_headline
   - 1 line only
   - 5–15 words
   - Include project type, approx size, and material family if possible.
   - Example: "New 400 sq ft Barkman Holland backyard patio – Winnipeg"

2) qb_description
   - Multi-line, plain text (no markdown), suitable for the description field in a QuickBooks estimate.
   - Include:
     - Short recap of scope
     - Key steps: excavation, base prep, compaction, laying pavers, cuts, polymeric sand
     - Mention access level if relevant (e.g. tight backyard access)
     - Include disposal of excavated material if it would normally be included
     - Mention The Paving Stone Pros' 3-year workmanship warranty
     - DO NOT include specific dollar amounts (QuickBooks will handle totals).
   - 3–10 short bullet-style lines separated by line breaks.

3) email_body
   - Write as an email from Adam at The Paving Stone Pros to the client.
   - Friendly, professional, about 120–250 words.
   - Assume the detailed estimate is attached via QuickBooks.
   - Include:
     - Thanks for the opportunity
     - Short summary of what is included in the estimate
     - Mention that the price is based on site conditions discussed and may adjust if hidden issues appear
     - Invite questions or changes to scope
     - Brief reminder of the 3-year workmanship warranty
   - DO NOT include specific dollar amounts (those are in the attached estimate).
   - Sign off as:
     "Thanks,
      Adam
      The Paving Stone Pros"

IMPORTANT:
- Respond with ONLY VALID JSON, no backticks, no extra text.
- Escape line breaks in strings with \\n.
`;

//
// ===== SHARED META EXTRACTOR (used by internal endpoint) =====
//

function extractEstimationMeta(messages) {
  const userMessages = messages.filter((m) => m.role === "user");
  const allUserText = userMessages
    .map((m) => (m.content || "").toLowerCase())
    .join(" ");

  // Square footage: "20x20" or "400 sq ft"
  let sqft = 0;
  const dimMatch = allUserText.match(/(\d+)\s*x\s*(\d+)/); // e.g. "20x20"
  if (dimMatch) {
    const length = parseInt(dimMatch[1], 10);
    const width = parseInt(dimMatch[2], 10);
    if (!isNaN(length) && !isNaN(width)) {
      sqft = length * width;
    }
  } else {
    const sqftMatch = allUserText.match(
      /(\d+)\s*(sq\.?\s*ft|square\s*feet|ft2)/
    );
    if (sqftMatch) {
      const val = parseInt(sqftMatch[1], 10);
      if (!isNaN(val)) sqft = val;
    }
  }

  // Project type
  let project_type = null;
  if (allUserText.includes("driveway")) {
    project_type = "driveway";
  } else if (
    allUserText.includes("walkway") ||
    allUserText.includes("sidewalk") ||
    allUserText.includes("path")
  ) {
    project_type = "walkway";
  } else if (
    allUserText.includes("patio") ||
    allUserText.includes("pad") ||
    allUserText.includes("landing")
  ) {
    project_type = "patio";
  }

  // Backyard?
  const isBackyard =
    allUserText.includes("backyard") ||
    allUserText.includes("back yard") ||
    (allUserText.includes("back") && !allUserText.includes("front"));

  // Access level
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

  // City / town
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
    allUserText.includes("winkler") ||
    allUserText.includes("portage la prairie") ||
    allUserText.includes("gimli") ||
    allUserText.includes("victoria beach") ||
    allUserText.includes("lac du bonnet") ||
    allUserText.includes("stonewall") ||
    allUserText.includes("stony mountain")
  ) {
    city_town = "Out of town";
    is_out_of_town = true;
  }

  // Material
  let material_code = inferMaterialCodeFromText(allUserText);

  const explicitMaterialMatch = allUserText.match(
    /holland|broadway 65|broadway 100|broadway plank|verano|roman|fjord|lexington|terrace|brookside|diamond face|arborwood|origins|dimensions|mega libre|blu 60|blu grande|blu polished/
  );
  if (explicitMaterialMatch) {
    material_code = inferMaterialCodeFromText(explicitMaterialMatch[0]);
  }

  return {
    sqft,
    project_type,
    isBackyard,
    access_level,
    city_town,
    is_out_of_town,
    material_code,
    allUserText,
  };
}

//
// ===== PUBLIC / CUSTOMER-FACING CHATBOT (BUFFERED RANGE) =====
//

app.post("/api/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
    });

    const aiReply =
      completion.choices?.[0]?.message?.content?.trim() || "";

    const userMessages = messages.filter((m) => m.role === "user");
    const allUserText = userMessages
      .map((m) => (m.content || "").toLowerCase())
      .join(" ");

    const lastUserMessage =
      userMessages[userMessages.length - 1]?.content || "";
    const lowerLastUser = lastUserMessage.toLowerCase();

    // Did the user actually ask for a price / estimate / ballpark?
    const askingForPrice =
      /\b(price|cost|ballpark|estimate|how much|quote)\b/.test(
        lowerLastUser
      ) || /\$\d/.test(lowerLastUser);

    // Did they confirm they're ready? (after the bot says "ready for a ballpark?")
    const confirmingReady =
      /\b(yes|yeah|yep|sure|ok|okay|sounds good|go ahead|ready|let's see|let me see)\b/.test(
        lowerLastUser
      ) && !/\b(not yet|later|hold off|don't|do not)\b/.test(lowerLastUser);

    const userAskedPrice = askingForPrice || confirmingReady;

    // 1) Square footage
    let sqft = 0;
    const sqftMatch =
      allUserText.match(/(\d+)\s*(sq\.? ?ft|square ?feet|ft2)/) ||
      allUserText.match(/(\d+)\s*x\s*(\d+)/);

    if (sqftMatch) {
      if (sqftMatch[3]) {
        const width = parseFloat(sqftMatch[1]);
        const length = parseFloat(sqftMatch[2]);
        if (!isNaN(width) && !isNaN(length)) {
          sqft = width * length;
        }
      } else {
        const val = parseFloat(sqftMatch[1]);
        if (!isNaN(val)) sqft = val;
      }
    }

    // 2) Project type
    let project_type = null;
    if (allUserText.includes("driveway")) {
      project_type = "driveway";
    } else if (
      allUserText.includes("walkway") ||
      allUserText.includes("sidewalk") ||
      allUserText.includes("path")
    ) {
      project_type = "walkway";
    } else if (
      allUserText.includes("patio") ||
      allUserText.includes("pad") ||
      allUserText.includes("landing")
    ) {
      project_type = "patio";
    }

    // 3) Backyard?
    let isBackyard =
      allUserText.includes("backyard") ||
      allUserText.includes("back yard") ||
      (allUserText.includes("back") && !allUserText.includes("front"));

    // 4) Access level – track if user actually mentioned it
    let access_level = "medium";
    let userMentionedAccess = false;

    if (
      allUserText.includes("easy access") ||
      allUserText.includes("good access") ||
      allUserText.includes("easy to access")
    ) {
      access_level = "easy";
      userMentionedAccess = true;
    }
    if (
      allUserText.includes("tight") ||
      allUserText.includes("difficult") ||
      allUserText.includes("hard access") ||
      allUserText.includes("no access")
    ) {
      access_level = "difficult";
      userMentionedAccess = true;
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
      allUserText.includes("winkler") ||
      allUserText.includes("portage la prairie") ||
      allUserText.includes("gimli") ||
      allUserText.includes("victoria beach") ||
      allUserText.includes("lac du bonnet") ||
      allUserText.includes("stonewall") ||
      allUserText.includes("stony mountain")
    ) {
      city_town = "Out of town";
      is_out_of_town = true;
    }

    // 6) Material code
    let material_code = inferMaterialCodeFromText(allUserText);

    // Give priority to explicit matches
    const explicitMaterialMatch = allUserText.match(
      /holland|broadway 65|broadway 100|broadway plank|verano|roman|fjord|lexington|terrace|brookside|diamond face|arborwood|origins|dimensions|mega libre|blu 60|blu grande|blu polished/
    );
    if (explicitMaterialMatch) {
      material_code = inferMaterialCodeFromText(explicitMaterialMatch[0]);
    }

    // ---- Decide if we are ready to calculate a price ----
    const haveAllDetails = sqft > 0 && !!project_type && !!material_code;
    const readyToEstimate = haveAllDetails && userAskedPrice;

    let estimate = null;
    let reply = aiReply;

    if (readyToEstimate) {
      const assumptions = [];

      // City/town: if user never mentioned, assume Winnipeg (no out-of-town surcharge)
      const finalCityTown = city_town || "Winnipeg";
      const finalIsOutOfTown = is_out_of_town;

      if (!city_town) {
        assumptions.push(
          "I assumed your project is in **Winnipeg or nearby**, so there is no extra out-of-town surcharge in this ballpark."
        );
      }

      // Access: if user never said anything, assume medium access
      if (!userMentionedAccess) {
        assumptions.push(
          "I assumed **medium access** (normal access for equipment and materials)."
        );
      }

      // Raw estimate from your pricing engine (internal truth)
      const rawEstimate = calculatePavingEstimate({
        project_type,
        areas: [{ square_feet: sqft, is_backyard: isBackyard }],
        access_level,
        material_code,
        city_town: finalCityTown,
        is_out_of_town: finalIsOutOfTown,
      });

      const rawLow = rawEstimate.low;
      const rawHigh = rawEstimate.high;

      // Customer-facing buffer ±10%
      const bufferedLow = Math.round(rawLow * 0.9);
      const bufferedHigh = Math.round(rawHigh * 1.1);

      const tierDesc = getMaterialTierDescription(material_code);

      const assumptionsText =
        assumptions.length > 0
          ? `

Because we don't have every detail yet, I had to make a few assumptions for this rough ballpark:
- ${assumptions.join("\n- ")}

If any of that is off, tell me and I can **recalculate** based on your exact situation.`
          : "";

      reply = `Got it – thanks for the details so far.

Based on what you've told me, your project is likely in the range of **$${bufferedLow.toLocaleString()}–$${bufferedHigh.toLocaleString()} +GST**.

The material you've chosen is ${tierDesc}.

Just so you know, most of the cost in this kind of project is in the **labour and proper base preparation**, not just the pavers themselves. Going a bit better on materials can often make sense when you think long term rather than chasing the absolute cheapest option.${assumptionsText}

⚠️ This is a rough ballpark only and may NOT be fully accurate until a site visit is completed and the actual site conditions, slopes, drainage, and any hidden issues are checked.

If you'd like a more precise quote or to book a site visit, I can help you with the next steps.`;

      // What we return to the frontend
      estimate = {
        ...rawEstimate,
        low: bufferedLow,
        high: bufferedHigh,
        rawLow,
        rawHigh,
      };
    }

    return res.json({
      reply,
      estimate,
      meta: {
        sqft,
        project_type,
        material_code,
        city_town,
        is_out_of_town,
        access_level,
        userAskedPrice,
      },
    });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//
// ===== INTERNAL ESTIMATOR / QUICKBOOKS HELPER =====
//

app.post("/api/internal-chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];

    // 1) Main conversational reply using a looser internal prompt
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: INTERNAL_SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
    });

    const aiReply =
      completion.choices?.[0]?.message?.content?.trim() || "";

    // 2) Extract project meta and compute estimate if possible (raw, no buffer)
    const meta = extractEstimationMeta(messages);

    let estimate = null;
    if (meta.sqft > 0 && meta.project_type && meta.material_code) {
      estimate = calculatePavingEstimate({
        project_type: meta.project_type,
        areas: [{ square_feet: meta.sqft, is_backyard: meta.isBackyard }],
        access_level: meta.access_level,
        material_code: meta.material_code,
        city_town: meta.city_town || "Winnipeg",
        is_out_of_town: meta.is_out_of_town,
      });
    }

    // 3) Generate QuickBooks headline/description + email if we have an estimate
    let qb_headline = null;
    let qb_description = null;
    let email_body = null;

    if (estimate) {
      const tierDesc = getMaterialTierDescription(meta.material_code);
      const conversation_summary = messages
        .filter((m) => m.role === "user")
        .map((m) => m.content || "")
        .join(" ")
        .slice(-2000); // keep last chunk

      const payload = {
        conversation_summary,
        project: {
          sqft: meta.sqft,
          project_type: meta.project_type,
          is_backyard: meta.isBackyard,
          access_level: meta.access_level,
          city_town: meta.city_town || "Winnipeg",
          is_out_of_town: meta.is_out_of_town,
          material_code: meta.material_code,
          material_tier: tierDesc,
        },
        estimate,
      };

      try {
        const fmtCompletion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: INTERNAL_QB_PROMPT },
            {
              role: "user",
              content: JSON.stringify(payload),
            },
          ],
          temperature: 0.2,
        });

        const fmtContent =
          fmtCompletion.choices?.[0]?.message?.content?.trim() || "{}";

        const parsed = JSON.parse(fmtContent);
        qb_headline = parsed.qb_headline || null;
        qb_description = parsed.qb_description || null;
        email_body = parsed.email_body || null;
      } catch (e) {
        console.error("Failed to parse INTERNAL_QB JSON, using fallback:", e);

        // Fallback text so the right side never stays empty when we have an estimate
        qb_headline =
          qb_headline ||
          `Approx ${meta.sqft || ""} sq ft ${meta.project_type || "project"} – ${meta.city_town || "Winnipeg"}`;

        qb_description =
          qb_description ||
          [
            "• Excavate existing area as needed and dispose of material off site.",
            "• Supply and install compacted gravel base to industry standards.",
            "• Lay chosen paving stones with appropriate pattern and cuts.",
            "• Compact surface and sweep in polymeric joint sand.",
            "• Final clean-up of work area.",
            "• Includes 3-year workmanship warranty from The Paving Stone Pros.",
          ].join("\n");

        email_body =
          email_body ||
          [
            "Hi there,",
            "",
            "Thanks again for the opportunity to quote on your project. I've attached a detailed estimate from The Paving Stone Pros for your review.",
            "",
            "The estimate covers excavation and disposal where required, proper base preparation and compaction, installation of the selected paving stones, all necessary cutting and finishing, and polymeric sand in the joints. It also includes our 3-year workmanship warranty.",
            "",
            "Pricing is based on the site details we've discussed so far. If we discover any hidden issues during the site visit (such as soft spots, drainage problems, or other surprises), we’ll talk through them with you and adjust if needed before proceeding.",
            "",
            "If you have any questions, would like to make changes to the layout or materials, or want to move ahead with scheduling, just let me know.",
            "",
            "Thanks,",
            "Adam",
            "The Paving Stone Pros",
          ].join("\n");
      }
    }

    return res.json({
      reply: aiReply,
      estimate,
      meta: {
        sqft: meta.sqft,
        project_type: meta.project_type,
        material_code: meta.material_code,
        city_town: meta.city_town,
        is_out_of_town: meta.is_out_of_town,
        access_level: meta.access_level,
      },
      qb_headline,
      qb_description,
      email_body,
    });
  } catch (err) {
    console.error("Error in /api/internal-chat:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//
// ===== LEAD CAPTURE (PUBLIC BOT) =====
//

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

Ballpark estimate range: ${low}–${high} +GST
Notes: ${notes}

Conversation transcript:
${transcript}

Please follow up with the client to schedule a site visit and provide a firm quote.
      `,
    };

    await transporter.sendMail(mailOptions);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending lead email:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to send lead email" });
  }
});

//
// ===== START SERVER =====
//

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
