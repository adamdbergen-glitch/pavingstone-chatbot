// server.js - Paving Stone Pros chatbot + Gmail lead email sending + internal estimator

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const nodemailer = require("nodemailer");
const https = require("https");
const fs = require("fs");        
const os = require("os");        
const path = require("path");    
const {
  calculatePavingEstimate,
  calculateRelevelEstimate, 
  inferMaterialCodeFromText,
  getMaterialTierDescription,
} = require("./pricing");

const app = express();

const corsOptions = {
  origin: true, 
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "50mb" })); 

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
You handle new installations (patios, walkways, driveways) AND repair/re-leveling jobs.
Once the key details (approximate square footage, project type, material, or repair condition) are known, ask if they want a ballpark estimate.
If they ask for multiple options, acknowledge both!

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
    If the user asks for multiple options, break them out into separate line items.
    
    Return JSON ONLY with these fields:
    - line_items (Array of objects, each containing):
        - title (string, e.g. "12x15 Patio" or "Driveway Re-level")
        - sqft (number)
        - project_type (string: patio, walkway, driveway, relevel)
        - is_backyard (boolean)
        - material_text (string)
        - needs_edging (boolean - mainly for releveling)
        - is_poor_condition (boolean - mainly for releveling if they say it's ruined/messy)
    - access_level (string)
    - city_town (string)
    - is_out_of_town (boolean)
    
    Conversation:
    ${safeMessages.map(m => `${m.role}: ${m.content}`).join("\n")}
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano", // Keeping the ultra-cheap model for public chat
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: extractionPrompt }],
      temperature: 0.1, 
    });
    const data = JSON.parse(completion.choices[0].message.content);

    const processedItems = (data.line_items || []).map(item => ({
      ...item,
      sqft: Number(item.sqft) || 0,
      material_code: inferMaterialCodeFromText(item.material_text || ""),
      needs_edging: !!item.needs_edging,
      is_poor_condition: !!item.is_poor_condition
    }));

    return {
      line_items: processedItems,
      access_level: data.access_level || "medium",
      city_town: data.city_town || "Winnipeg",
      is_out_of_town: !!data.is_out_of_town
    };
  } catch (err) {
    console.error("AI Extraction Failed:", err);
    return { line_items: [], access_level: "medium", city_town: "Winnipeg", is_out_of_town: false }; 
  }
}

// ===== CUSTOMER FACING BOT =====
app.post("/api/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano", 
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.5, 
    });

    let reply = completion.choices[0].message.content;
    const recentText = (reply + " " + (messages[messages.length - 1]?.content || "")).toLowerCase();
    
    if (recentText.includes("estimate") || recentText.includes("cost") || recentText.includes("price") || recentText.includes("ballpark")) {
      const details = await extractProjectDetailsAI(messages);
      
      if (details && details.line_items && details.line_items.length > 0) {
        let hasValidEstimates = false;
        let estimateText = `\n\nHere are the rough ballpark estimates based on your details:\n`;

        details.line_items.forEach(item => {
          if (item.sqft > 0) {
            hasValidEstimates = true;
            let estimate;

            if (item.project_type === "relevel") {
               estimate = calculateRelevelEstimate({
                 areas: [{ square_feet: item.sqft }],
                 needsEdging: item.needs_edging,
                 isPoorCondition: item.is_poor_condition,
                 isOutOfTown: details.is_out_of_town
               });
            } else {
               estimate = calculatePavingEstimate({
                   project_type: item.project_type,
                   areas: [{ square_feet: item.sqft, is_backyard: item.is_backyard }],
                   access_level: details.access_level,
                   material_code: item.material_code,
                   city_town: details.city_town,
                   is_out_of_town: details.is_out_of_town
               });
            }

            estimateText += `\n- **${item.title || item.project_type}** (approx ${item.sqft} sqft): $${estimate.low.toLocaleString()} - $${estimate.high.toLocaleString()} CAD`;
          }
        });

        if (hasValidEstimates) {
          reply += estimateText + `\n\n*Please note these are just rough guesses based on averages!*`;
        }
      }
    }

    res.json({ reply });
  } catch (err) {
    console.error("Customer Chat Error:", err);
    res.status(500).json({ reply: "Sorry, I'm having trouble connecting right now. Please try again later." });
  }
});

// ===== INTERNAL ESTIMATOR (NOW STATEFUL) =====
app.post("/api/internal-chat", async (req, res) => {
  try {
    const { messages, attachment, currentState } = req.body;
    let aiMessages = Array.isArray(messages) ? [...messages] : [];

    if (attachment) {
      if (attachment.type === 'audio') {
        const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.m4a`);
        
        try {
          const fileResponse = await fetch(attachment.url);
          if (!fileResponse.ok) throw new Error(`Failed to download audio: ${fileResponse.statusText}`);
          
          const arrayBuffer = await fileResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          fs.writeFileSync(tempFilePath, buffer);
        } catch (downloadErr) {
          console.error("Audio Download Error:", downloadErr);
          throw new Error("Could not download the audio file from the provided URL.");
        }

        const transcription = await client.audio.transcriptions.create({
          file: fs.createReadStream(tempFilePath),
          model: "whisper-1",
          prompt: "Paving stone project, hardscaping, patio, driveway, walkway, relevel, Barkman, Charcoal Holland, base, polymeric sand, sqft, measurements, edging."
        });
        
        fs.unlinkSync(tempFilePath);

        console.log("🎙️ WHISPER HEARD:", transcription.text);

        aiMessages.push({
          role: "user",
          content: `Here is a transcript of my voice memo / meeting with the client: "${transcription.text}". Please extract all project details and break them into line items.`
        });
        
      } else if (attachment.type === 'image') {
        const lastMessage = aiMessages.pop();
        aiMessages.push({
          role: "user",
          content: [
            { type: "text", text: lastMessage?.content || "Please analyze this sketch/photo for project measurements and materials, breaking them into separate line items if there are multiple." },
            { type: "image_url", image_url: { url: attachment.url } }
          ]
        });
      }
    }

    // THE FIX: Adding the JSON Scratchpad ("thinking_process") to help the Mini model
    const ISOLATED_INTERNAL_PROMPT = `
      You are Adam's internal estimating assistant. Talk to Adam to figure out the project scope.
      
      You are maintaining a RUNNING STATE of the quote. Here is what you have extracted so far:
      --- CURRENT QUOTE STATE ---
      ${JSON.stringify(currentState || {}, null, 2)}
      ---------------------------
      
      INSTRUCTIONS:
      1. Read the conversation history and any new image/voice transcripts carefully.
      2. UPDATE the Current Quote State with any new information, measurements, corrections, or added/removed line items.
      3. If Adam adds a new area (e.g., "add a walkway"), ADD it to the line_items array.
      4. If Adam corrects a size (e.g., "the patio is actually 500 sqft"), UPDATE the existing line item.
      5. RETAIN all previously extracted customer details and line items unless Adam explicitly changes or removes them!
      
      CRITICAL RULE: NEVER give a price, cost, or dollar estimate in your text reply. 
      The external UI handles all pricing.
      
      Return a STRICT JSON object in this exact format. YOU MUST FILL OUT 'thinking_process' FIRST:
      {
        "thinking_process": "Briefly write down the measurements, material names, and client details you found in the transcript, and explain how you will update the Current Quote State.",
        "reply": "Your conversational reply to Adam confirming what you updated.",
        "line_items": [
          {
            "title": "e.g., Option 1: 12x15 Patio, OR Add Walkway",
            "description": "Details about this specific item",
            "sqft": number,
            "project_type": "patio" | "walkway" | "driveway" | "relevel" | null,
            "material_text": "paver name",
            "is_backyard": boolean,
            "needs_edging": boolean,
            "is_poor_condition": boolean
          }
        ],
        "meta": {
          "access_level": "easy" | "medium" | "difficult",
          "scope_summary": "WRITE THIS SECTION DIRECTLY TO THE CUSTOMER (Use 'you' and 'your'). First, write a warm, professional 2-3 sentence blurb thanking them for the opportunity and expressing excitement about transforming their space. Then, provide a detailed, bulleted 6 to 8 step scope of work for EACH major line item/area. You MUST explicitly state that we use a '3/4 down limestone base compacted to ICPI standards' to survive Manitoba freeze-thaw cycles, and you MUST explicitly state that we sweep in 'polymeric sand' as the jointing material on all projects for a pristine, weed-free finish. Example steps: 1. Excavation and disposal. 2. Geotextile fabric installation. 3. 3/4 down limestone base installation and compaction. 4. Bedding sand grading. 5. Precision installation of paving stones. 6. Securing the perimeter with edge restraints. 7. Polymeric sand jointing and final compaction. 8. Site cleanup."
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
      model: "gpt-5.4-mini", // Retaining the mini model as requested
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: ISOLATED_INTERNAL_PROMPT }, ...aiMessages],
      temperature: 0.1, 
    });

    const data = JSON.parse(completion.choices[0].message.content);
    
    // Server logs the thinking process so you can see the AI's internal logic!
    console.log("🧠 AI SCRATCHPAD:", data.thinking_process);
    
    const processedItems = (data.line_items || []).map(item => ({
      ...item,
      sqft: Number(item.sqft) || 0,
      material_code: inferMaterialCodeFromText(item.material_text || ""),
      needs_edging: !!item.needs_edging,
      is_poor_condition: !!item.is_poor_condition
    }));

    const meta = {
      access_level: data.meta?.access_level || "medium",
      scope_summary: data.meta?.scope_summary || "", 
      city_town: "Winnipeg",
      is_out_of_town: false
    };

    res.json({ reply: data.reply, line_items: processedItems, meta: meta, customer: data.customer || {} });
  } catch (err) {
    console.error("Internal Chat Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== EMAIL LEAD ROUTE =====
app.post("/api/lead", async (req, res) => {
  try {
    const name = req.body.name || req.body.fullName || req.body.customerName || req.body.Name;
    const email = req.body.email || req.body.emailAddress || req.body.Email;
    const phone = req.body.phone || req.body.phoneNumber || req.body.Phone;
    const message = req.body.message || req.body.details || req.body.Message;
    
    const chatHistory = req.body.messages || req.body.transcript || req.body.history;
    let formattedTranscript = "No transcript provided.";
    if (Array.isArray(chatHistory)) {
      formattedTranscript = chatHistory.map(m => `${m.role === 'user' ? 'CUSTOMER' : 'BOT'}: ${m.content}`).join('\n\n');
    } else if (typeof chatHistory === 'string') {
      formattedTranscript = chatHistory;
    }

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER, 
      subject: `New Lead from Paving Stone Pros Chat`,
      text: `You have a new lead from the chatbot!
        
Name: ${name || 'N/A'}
Phone: ${phone || 'N/A'}
Email: ${email || 'N/A'}
        
Message/Details:
${message || 'N/A'}

--- CHAT TRANSCRIPT ---

${formattedTranscript}


--- RAW DATA DUMP ---
${JSON.stringify(req.body, null, 2)}`
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Email sent successfully!" });
  } catch (err) {
    console.error("Email Error:", err);
    res.status(500).json({ error: "Failed to send email." });
  }
});

// ===== SEND ESTIMATE TO CUSTOMER =====
app.post("/api/send-estimate", async (req, res) => {
  try {
    const { customerEmail, customerName, projectName, estimateAmount, portalLink } = req.body;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: customerEmail,
      subject: `Your Project Estimate: ${projectName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <h2 style="color: #0f172a;">Hi ${customerName},</h2>
          <p style="color: #475569; font-size: 16px;">Thank you for considering The Paving Stone Pros! We've put together an itemized estimate for your project: <strong>${projectName}</strong>.</p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #64748b; text-transform: uppercase; font-size: 12px; font-weight: bold;">Estimated Cost (Subtotal)</p>
            <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: 900; color: #0f172a;">$${Number(estimateAmount).toLocaleString()}</p>
          </div>
          <p style="color: #475569; font-size: 16px;">You can view the full itemized breakdown, step-by-step scope of work, and <strong>Approve the Project</strong> directly in your secure client portal:</p>
          <a href="${portalLink}" style="display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: #1e293b; text-decoration: none; font-weight: bold; border-radius: 8px; margin-top: 10px;">View & Approve Estimate</a>
          <p style="color: #475569; margin-top: 30px;">Looking forward to working with you!</p>
          <p style="color: #94a3b8; font-size: 14px;">- The Paving Stone Pros</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error("Send Estimate Error:", err);
    res.status(500).json({ error: "Failed to send estimate." });
  }
});

// ===== SEND FOLLOW-UP EMAIL =====
app.post("/api/send-followup", async (req, res) => {
  try {
    const { customerEmail, customerName, projectName, portalLink } = req.body;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: customerEmail,
      subject: `Checking in on your project: ${projectName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <h2 style="color: #0f172a;">Hi ${customerName},</h2>
          <p style="color: #475569; font-size: 16px;">I'm just checking in to see if you had any questions about the estimate we sent over for your project (<strong>${projectName}</strong>).</p>
          <p style="color: #475569; font-size: 16px;">If you have any questions, feel free to reply directly to this email. If you are ready to move forward, you can approve the contract directly in your portal!</p>
          <a href="${portalLink}" style="display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: #1e293b; text-decoration: none; font-weight: bold; border-radius: 8px; margin-top: 10px;">View Your Estimate</a>
          <p style="color: #475569; margin-top: 30px;">Thanks,</p>
          <p style="color: #94a3b8; font-size: 14px;">- The Paving Stone Pros</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error("Send Followup Error:", err);
    res.status(500).json({ error: "Failed to send follow up." });
  }
});

// ===== APPROVAL NOTIFICATION & QUICKBOOKS WEBHOOK =====
app.post("/api/approve-estimate", async (req, res) => {
  try {
    const { customerName, customerEmail, projectName, adminLink, contractUrl, portalLink, startDate, subtotal, gst, grandTotal } = req.body;

    // 1. Email Adam
    const mailOptionsAdmin = {
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER,
      subject: `🎉 PROJECT APPROVED: ${projectName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 2px solid #10b981; border-radius: 10px; background-color: #ecfdf5;">
          <h2 style="color: #065f46; margin-top: 0;">Good news!</h2>
          <p style="color: #065f46; font-size: 16px;"><strong>${customerName}</strong> has officially approved the estimate and signed the contract for <strong>${projectName}</strong>.</p>
          <div style="background-color: #fff; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #d1fae5;">
            <p style="margin: 0; color: #065f46; font-size: 14px;">Subtotal: $${Number(subtotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            <p style="margin: 5px 0 0 0; color: #065f46; font-size: 14px;">GST (5%): $${Number(gst).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            <p style="margin: 10px 0 0 0; font-size: 20px; font-weight: 900; color: #064e3b;">Total: $${Number(grandTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </div>
          <p style="color: #065f46; font-size: 16px;">It has been automatically scheduled for: <strong>${startDate}</strong></p>
          <a href="${adminLink}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: #fff; text-decoration: none; font-weight: bold; border-radius: 8px; margin-top: 15px;">View Project Dashboard</a>
          <p style="margin-top: 15px;"><a href="${contractUrl}" style="color: #047857;">View Signed Contract</a></p>
        </div>
      `
    };

    // 2. Email Customer Receipt
    const mailOptionsCustomer = {
      from: process.env.SMTP_USER,
      to: customerEmail, 
      subject: `Project Approved & Scheduled: ${projectName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <h2 style="color: #0f172a; margin-top: 0;">Thank you, ${customerName}!</h2>
          <p style="color: #475569; font-size: 16px;">Your project (<strong>${projectName}</strong>) is officially approved and your contract has been signed.</p>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #64748b; font-size: 14px;">Subtotal: $${Number(subtotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">GST (5%): $${Number(gst).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            <p style="margin: 15px 0 0 0; color: #64748b; text-transform: uppercase; font-size: 12px; font-weight: bold;">Approved Total</p>
            <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: 900; color: #0f172a;">$${Number(grandTotal).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </div>

          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #64748b; text-transform: uppercase; font-size: 12px; font-weight: bold;">Projected Start Date</p>
            <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: 900; color: #0f172a;">${startDate}</p>
            <p style="margin: 5px 0 0 0; font-size: 12px; color: #64748b;">(Weather permitting)</p>
          </div>

          <p style="color: #475569; font-size: 16px;">You can view your active project status, download your signed contract, and message the crew directly in your portal:</p>
          <a href="${portalLink}" style="display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: #1e293b; text-decoration: none; font-weight: bold; border-radius: 8px; margin-top: 10px;">Go to My Portal</a>
          
          <p style="color: #475569; font-size: 16px; margin-top: 20px;">For your records, you can also download a direct copy of your signed agreement here:</p>
          <a href="${contractUrl}" style="color: #2563eb; font-weight: bold;">Download Signed Contract PDF</a>
        </div>
      `
    };

    await transporter.sendMail(mailOptionsAdmin);
    if(customerEmail) await transporter.sendMail(mailOptionsCustomer);

    // 3. SEND DATA TO ZAPIER/MAKE WEBHOOK FOR QUICKBOOKS
    if (process.env.ZAPIER_WEBHOOK_URL) {
      try {
        const payload = JSON.stringify({
          customerName: customerName,
          customerEmail: customerEmail || "no-email@provided.com",
          projectName: projectName,
          estimateAmount: subtotal, 
          taxAmount: gst,
          totalAmount: grandTotal,
          depositAmount: 500,
          contractUrl: contractUrl,
          status: "Approved",
          dateApproved: new Date().toISOString()
        });

        const url = new URL(process.env.ZAPIER_WEBHOOK_URL);
        const options = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        };

        const reqWebhook = https.request(options, (resWebhook) => {
          console.log(`Zapier Webhook Status: ${resWebhook.statusCode}`);
        });

        reqWebhook.on('error', (e) => {
          console.error("Failed to ping webhook:", e);
        });

        reqWebhook.write(payload);
        reqWebhook.end();
      } catch (webhookErr) {
        console.error("Webhook prep error:", webhookErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Approve Estimate Error:", err);
    res.status(500).json({ error: "Failed to send approval notification." });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🚀 Chatbot server running on port ${port}`);
});
