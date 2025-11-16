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
  host: process.env.SMTP_HOST, // e.g. smtp.gmail.com
  port: parseInt(process.env.SMTP_PORT || "587", 10), // 587 for TLS
  secure: false, // false for 587, true for 465
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

   Explain that in most projects, the majority of the cost is in LABOUR and proper
   excavation / base prep, not the stone itself.

2) Be conversational and natural, not like a form. You don't have to ask all questions at once.
   It's okay to ask 1–2 questions at a time, based on what they say.

   Your goal is to get enough detail for a decent ballpark:
   • Project type
   • Approximate total square footage
   • Material choice (or at least a clear direction: budget / mid-range / premium)
   • Where on the property (front / back / side, or driveway)
   • Access difficulty
   • City/town (so the server can apply out-of-town surcharges)

   Only once those key details are known AND the user has clearly said they want a price
   or that they are ready for a ballpark, you should let the server calculate and attach
   a CAD range.

   The server will decide when it has enough info to safely estimate. Internally it will
   calculate a ballpark if:
   • square footage is known
   • project type is known
   • a material is chosen or confidently inferred
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

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.4,
    });

    const aiReply = completion.choices[0].message.content;

    const allUserText = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.toLowerCase())
      .join(" ");

    const lastUserMessage =
      messages.filter((m) => m.role === "user").slice(-1)[0]?.content ||
      "";

    const lowerLastUser = lastUserMessage.toLowerCase();

    const askingForPrice =
      /\b(price|cost|ballpark|estimate|how much|quote)\b/.test(
        lowerLastUser
      ) ||
      /\$\d/.test(lowerLastUser);

    const confirmingReady =
      /\b(yes|yeah|yep|sure|ok|okay|sounds good|go ahead|ready|let's see|let me see)\b/.test(
        lowerLastUser
      ) && !/\b(not yet|later|hold off|don'?t|do not)\b/.test(lowerLastUser);

    const userAskedPrice = askingForPrice || confirmingReady;

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

    let isBackyard =
      allUserText.includes("backyard") ||
      allUserText.includes("back yard") ||
      (allUserText.includes("back") && !allUserText.includes("front"));

    // 4) Access level
    // Default to "medium", but also track whether the user actually mentioned access.
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

    let material_code = inferMaterialCodeFromText(allUserText);

    const explicitMaterialMatch = allUserText.match(
      /holland|broadway 65|broadway 100|broadway plank|verano|roman|fjord|lexington|terrace|brookside|diamond face|arborwood|origins|dimensions|mega libre|blu 60|blu grande|blu polished/
    );

    if (explicitMaterialMatch) {
      material_code = inferMaterialCodeFromText(explicitMaterialMatch[0]);
    }

    // ---- Decide if we are ready to calculate a price ----
    // Keep this fairly loose so we can give a ballpark, but we will clearly state
    // any assumptions if some details are missing.
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

      // You can add more assumptions here later (e.g. front vs backyard, soil conditions, etc.)

      estimate = calculatePavingEstimate({
        project_type,
        areas: [{ square_feet: sqft, is_backyard: isBackyard }],
        access_level,
        material_code,
        city_town: finalCityTown,
        is_out_of_town: finalIsOutOfTown,
      });

      const tierDesc = getMaterialTierDescription(material_code);

      const assumptionsText =
        assumptions.length > 0
          ? `

Because we don't have every detail yet, I had to make a few assumptions for this rough ballpark:
- ${assumptions.join("\n- ")}

If any of that is off, tell me and I can **recalculate** based on your exact situation.`
          : "";

      reply = `Got it – thanks for the details so far.

Based on what you've told me, your project is likely in the range of **$${estimate.low.toLocaleString()}–$${estimate.high.toLocaleString()} +GST**.

The material you've chosen is ${tierDesc}.

Just so you know, most of the cost in this kind of project is in the **labour and proper base preparation**, not just the pavers themselves. Going a bit better on materials can often make sense when you think long term rather than chasing the absolute cheapest option.${assumptionsText}

⚠️ This is a rough ballpark only and may NOT be fully accurate until a site visit is completed and the actual site conditions, slopes, drainage, and any hidden issues are checked.

If you'd like a more precise quote or to book a site visit, I can help you with the next steps.`;
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
    console.error("❌ Error in /chat:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-lead-email", async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      city,
      project_type,
      sqft,
      access_level,
      material_name,
      estimate,
      messages,
    } = req.body;

    const estimateRange =
      estimate && estimate.low && estimate.high
        ? `$${estimate.low.toLocaleString()}–$${estimate.high.toLocaleString()} +GST`
        : "N/A";
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

Name: ${name || "N/A"}
Phone: ${phone || "N/A"}
Email: ${email || "N/A"}
City/Town: ${city || "N/A"}

Project type: ${project_type || "N/A"}
Approx. square footage: ${sqft || "N/A"}
Access level: ${access_level || "N/A"}
Material: ${material_name || "N/A"}

Ballpark estimate range: ${estimateRange}
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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
