// pricing.js
// Pricing engine for The Paving Stone Pros chatbot

const LABOUR_BUMP = 1.0;      
const PAVER_MARKUP = 1.40;    
const CHATBOT_CUSHION = 1.05; 
const MIN_JOB = 2500;         

// Cost for gravel, sand, edge restraints, and disposal per sq ft.
// In Winnipeg, 6" of base + bedding sand + disposal is approx $4-$6/sqft cost.
const BASE_PREP_COST = 0.00;

const MATERIALS = {
  // Barkman – budget
  barkman_holland:              { basePerSqft: 6.42, tier: "budget" }, 
  barkman_broadway_65:          { basePerSqft: 7.55, tier: "budget" }, 
  barkman_brookside_slab:       { basePerSqft: 7.23, tier: "budget" }, 
  barkman_terrace_slab:         { basePerSqft: 5.07, tier: "budget" }, 
  barkman_diamond_face_24x24:   { basePerSqft: 4.12, tier: "budget" }, 

  // Barkman – midrange
  barkman_verano:               { basePerSqft: 7.44, tier: "midrange" }, 
  barkman_roman:                { basePerSqft: 8.53, tier: "midrange" }, 
  barkman_navarro:              { basePerSqft: 8.56, tier: "midrange" }, 
  barkman_lexington_slab:       { basePerSqft: 8.35, tier: "midrange" }, 

  // Barkman – premium
  barkman_fjord:                { basePerSqft: 13.39, tier: "premium" }, 
  barkman_broadway_100:         { basePerSqft: 11.97, tier: "premium" }, 
  barkman_arborwood:            { basePerSqft: 11.82, tier: "premium" }, 

  // Belgard / Techo (Retained original pricing)
  belgard_holland:              { basePerSqft: 4.78, tier: "budget" },
  belgard_dimensions:           { basePerSqft: 5.73, tier: "midrange" },
  techo_blu_60_slate:           { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_polished:        { basePerSqft: 11.73, tier: "premium" },
};

function getMaterialTierDescription(code) {
  const mat = MATERIALS[code];
  if (!mat || !mat.tier) return "a solid mid-range stone option";
  switch (mat.tier) {
    case "budget": return "a cost-effective stone that keeps the price competitive";
    case "midrange": return "a great balance of modern style and value";
    case "premium": return "a premium stone that elevates the entire look of the property";
    default: return "a solid mid-range stone option";
  }
}

function getMaterialPricePerSqft(code) {
  const mat = MATERIALS[code];
  // Default to Holland price if code not found
  const base = mat ? mat.basePerSqft : 6.42; 
  return base * PAVER_MARKUP;
}

function getLabourRatePerSqft(project_type, totalSqft) {
  // Adjusted Winnipeg Labour Tiers (Installation Wages + Overhead)
  let base;
  if (totalSqft < 150) base = 32;      // Bumped up slightly for small jobs
  else if (totalSqft < 300) base = 22;
  else if (totalSqft < 500) base = 19;
  else if (totalSqft < 750) base = 17;
  else if (totalSqft < 1000) base = 15;
  else base = 13;

  if (project_type === "walkway") base *= 1.10; // +10%
  if (project_type === "driveway") base *= 1.30; // +30% (More dig out)

  return base * LABOUR_BUMP;
}

function calculatePavingEstimate({
  project_type,
  areas,
  access_level,
  material_code,
  city_town,
  is_out_of_town,
}) {
  const totalSqft = (areas || []).reduce((sum, a) => sum + (a.square_feet || 0), 0);
  const anyBackyard = (areas || []).some((a) => a.is_backyard);

  // 1. Calculate Base Labour Rate
  let labourRate = getLabourRatePerSqft(project_type, totalSqft);

  // 2. Add Modifiers (Additive is safer than compounding)
  let accessMultiplier = 1.0;
  if (access_level === "medium") accessMultiplier += 0.05;     // +5%
  if (access_level === "difficult") accessMultiplier += 0.15;  // +15%
  if (anyBackyard) accessMultiplier += 0.10;                   // +10%
  if (is_out_of_town) accessMultiplier += 0.10;                // +10%
  
  const finalLabourRate = labourRate * accessMultiplier;

  // 3. Material Costs
  const paverPrice = getMaterialPricePerSqft(material_code);
  
  // 4. THE FORMULA
  // Total = (Labour + Base Prep + Pavers) * SqFt
  let costPerSqFt = finalLabourRate + BASE_PREP_COST + paverPrice;
  let subtotal = costPerSqFt * totalSqft;

  // 5. Minimum Job Enforcer
  if (subtotal < MIN_JOB) {
    subtotal = MIN_JOB;
  }

  // 6. Chatbot Cushion & Ranges
  const cushioned = subtotal * CHATBOT_CUSHION;
  const low = Math.round(cushioned * 0.95);
  const high = Math.round(cushioned * 1.05);

  return {
    currency: "CAD",
    low,
    high,
    // Note: 'details' is used by server.js for the email report
    details: `${Math.round(totalSqft)} sqft ${project_type} using ${material_code}. Est: $${(cushioned/totalSqft).toFixed(2)}/sqft avg.`,
  };
}

// --- NEW RE-LEVELING LOGIC ---

const RELEVEL_TIERS = {
  small:    { max: 150, rate: 16.50 },
  standard: { max: 450, rate: 12.50 },
  large:    { max: 900, rate: 10.50 },
  volume:   { max: Infinity, rate: 9.00 }
};

function getRelevelBaseRate(totalSqft) {
  if (totalSqft < RELEVEL_TIERS.small.max) return RELEVEL_TIERS.small.rate;
  if (totalSqft < RELEVEL_TIERS.standard.max) return RELEVEL_TIERS.standard.rate;
  if (totalSqft < RELEVEL_TIERS.large.max) return RELEVEL_TIERS.large.rate;
  return RELEVEL_TIERS.volume.rate;
}

function calculateRelevelEstimate({
  areas,
  needsEdging,
  isPoorCondition,
  isOutOfTown
}) {
  const totalSqft = (areas || []).reduce((sum, a) => sum + (a.square_feet || 0), 0);
  let rate = getRelevelBaseRate(totalSqft);

  // Additive modifiers 
  if (needsEdging) rate += 1.50;      // New edging and spikes
  if (isPoorCondition) rate += 3.00;  // Base failure reset
  if (isOutOfTown) rate += 1.00;      // Travel premium

  let subtotal = rate * totalSqft;

  // Enforce existing minimum job price
  if (subtotal < MIN_JOB) {
    subtotal = MIN_JOB;
  }

  const cushioned = subtotal * CHATBOT_CUSHION;
  const low = Math.round(cushioned * 0.95);
  const high = Math.round(cushioned * 1.05);

  return {
    currency: "CAD",
    low,
    high,
    details: `Re-leveling ${Math.round(totalSqft)} sqft. Est: $${(cushioned / totalSqft).toFixed(2)}/sqft avg.`,
  };
}

function inferMaterialCodeFromText(text) {
  const t = (text || "").toLowerCase();
  
  // Specific Product Logic
  if (t.includes("roman")) return "barkman_roman";
  if (t.includes("verano")) return "barkman_verano";
  if (t.includes("broadway") && t.includes("100")) return "barkman_broadway_100";
  if (t.includes("broadway")) return "barkman_broadway_65";
  if (t.includes("blu") && t.includes("polish")) return "techo_blu_60_polished";
  if (t.includes("blu")) return "techo_blu_60_slate";
  if (t.includes("grand") || t.includes("slab")) return "barkman_lexington_slab";

  // Defaults
  if (t.includes("premium") || t.includes("high end")) return "barkman_broadway_65";
  
  return "barkman_holland"; // Default fallback
}

module.exports = {
  calculatePavingEstimate,
  calculateRelevelEstimate,
  inferMaterialCodeFromText,
  getMaterialTierDescription,
};
