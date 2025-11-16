// pricing.js
// Pricing engine for The Paving Stone Pros chatbot
//
// Rules implemented here:
// - Labour tiers based on your sheet (patio / walkway / driveway).
// - 40% markup on pavers (material).
// - Optional LABOUR_BUMP multiplier (set to 1.0 if not used).
// - ANY job under 100 sq ft gets DOUBLED (labour + material together).
// - HARD minimum job price of $2,500 (you never show a number below that).
// - A small CHATBOT_CUSHION on top so online ballparks are conservative.

const LABOUR_BUMP = 1.0;      // set >1.0 if you ever want to bump labour globally
const PAVER_MARKUP = 1.40;    // 40% markup on pavers
const CHATBOT_CUSHION = 1.05; // 5% cushion on top of your normal pricing
const MIN_JOB = 2500;         // absolute minimum price

// ------------------------------------------------------------
// MATERIAL PRICING (base contractor cost before markup)
// (these can be tweaked as you update supplier sheets)
// ------------------------------------------------------------

const MATERIALS = {
  // Barkman – budget / core lines
  barkman_holland:              { basePerSqft: 6.18, tier: "budget" },
  barkman_broadway_65:          { basePerSqft: 7.27, tier: "budget" },
  barkman_brookside_slab:       { basePerSqft: 6.95, tier: "budget" },
  barkman_terrace_slab:         { basePerSqft: 4.36, tier: "budget" },
  barkman_diamond_face_24x24:   { basePerSqft: 3.96, tier: "budget" },

  // Barkman – midrange
  barkman_verano:               { basePerSqft: 7.51, tier: "midrange" },
  barkman_roman:                { basePerSqft: 8.20, tier: "midrange" },
  barkman_navarro:              { basePerSqft: 8.76, tier: "midrange" },
  barkman_lexington_slab:       { basePerSqft: 8.04, tier: "midrange" },

  // Barkman – premium
  barkman_fjord:                { basePerSqft: 12.88, tier: "premium" },
  barkman_broadway_100:         { basePerSqft: 11.52, tier: "premium" },
  barkman_broadway_100_premium: { basePerSqft: 12.66, tier: "premium" },
  barkman_arborwood:            { basePerSqft: 11.82, tier: "premium" },

  // Belgard
  belgard_holland:              { basePerSqft: 4.78, tier: "budget" },
  belgard_dimensions:           { basePerSqft: 5.73, tier: "midrange" },
  belgard_origins:              { basePerSqft: 5.73, tier: "midrange" },
  belgard_mega_libre:           { basePerSqft: 6.27, tier: "midrange" },

  // Techo-Bloc Blu family
  techo_blu_60_slate:           { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_smooth:          { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_polished:        { basePerSqft: 11.73, tier: "premium" },
  techo_blu_grande_slate:       { basePerSqft: 9.46, tier: "midrange" },
  techo_blu_grande_smooth:      { basePerSqft: 9.46, tier: "midrange" },
  techo_blu_grande_polished:    { basePerSqft: 13.07, tier: "premium" },
};

// ------------------------------------------------------------
// Helper: describe tier for customer-facing text
// ------------------------------------------------------------
function getMaterialTierDescription(code) {
  const mat = MATERIALS[code];
  if (!mat || !mat.tier) {
    return "a solid mid-range stone option";
  }

  switch (mat.tier) {
    case "budget":
      return "a cost-effective, budget-friendly stone that helps keep the project price down";
    case "midrange":
      return "a nice balance between cost and appearance";
    case "premium":
      return "a premium stone that really elevates the look and feel of the space";
    default:
      return "a solid mid-range stone option";
  }
}

// ------------------------------------------------------------
// Material price per sqft (with markup and optional diamond flag)
// ------------------------------------------------------------
function getMaterialPricePerSqft(code, isDiamondFace) {
  const mat = MATERIALS[code];
  const base = mat ? mat.basePerSqft : 10; // safe fallback

  let price = base * PAVER_MARKUP;
  if (isDiamondFace) {
    price *= 1.30; // extra 30% for Diamond Face slabs
  }

  return price;
}

// ------------------------------------------------------------
// Labour rate lookup based on project_type and totalSqft
// (patio base tiers; walkway ~10% higher; driveway higher again)
// ------------------------------------------------------------
function getLabourRatePerSqft(project_type, totalSqft) {
  // Patio base tiers (from your sheet)
  let base;
  if (totalSqft < 150) base = 30;
  else if (totalSqft < 300) base = 20;
  else if (totalSqft < 500) base = 17;
  else if (totalSqft < 750) base = 16;
  else if (totalSqft < 1000) base = 13;
  else if (totalSqft < 2000) base = 12;
  else base = 11;

  if (project_type === "walkway") {
    base *= 1.10; // 10% bump for walkways
  } else if (project_type === "driveway") {
    base *= 1.25; // extra for deeper excavation + gravel
  }

  return base * LABOUR_BUMP;
}

// ------------------------------------------------------------
// Main estimate calculation
// ------------------------------------------------------------
function calculatePavingEstimate({
  project_type,
  areas,
  access_level,
  material_code,
  city_town,
  is_out_of_town,
}) {
  const totalSqft = (areas || []).reduce(
    (sum, a) => sum + (a.square_feet || 0),
    0
  );

  const anyBackyard = (areas || []).some((a) => a.is_backyard);

  let labourRate = getLabourRatePerSqft(project_type, totalSqft);

  // Access adjustments
  if (access_level === "medium") {
    labourRate *= 1.05;
  } else if (access_level === "difficult") {
    labourRate *= 1.1;
  }

  // Backyard bump (10% for backyard access)
  if (anyBackyard) {
    labourRate *= 1.1;
  }

  // Out-of-town bump (~10% on labour)
  if (is_out_of_town) {
    labourRate *= 1.1;
  }

  const isDiamondFace =
    material_code && material_code.toLowerCase().includes("diamond_face");

  const materialRate = getMaterialPricePerSqft(material_code, isDiamondFace);

  let labourTotal = labourRate * totalSqft;
  let materialTotal = materialRate * totalSqft;

  let subtotal = labourTotal + materialTotal;

  // Double any job under 100 sq ft (tiny-job penalty)
  if (totalSqft > 0 && totalSqft < 100) {
    subtotal *= 2;
  }

  // Enforce hard minimum job
  if (subtotal < MIN_JOB) {
    subtotal = MIN_JOB;
  }

  // Apply chatbot cushion
  const cushioned = subtotal * CHATBOT_CUSHION;

  // Give a small ±5% range around cushioned total
  const low = Math.round(cushioned * 0.95);
  const high = Math.round(cushioned * 1.05);

  return {
    currency: "CAD",
    low,
    high,
    notes: `${Math.round(
      totalSqft
    )} sq. ft. ${project_type || "project"} in ${city_town || "Winnipeg"}, access: ${
      access_level || "medium"
    }, material: ${material_code || "unspecified"}.`,
  };
}

// ------------------------------------------------------------
// Map user text to a material code
// ------------------------------------------------------------
function inferMaterialCodeFromText(text) {
  const t = (text || "").toLowerCase();

  // Very generic / budget / basic phrases → Holland as default
  if (
    t.includes("basic paver") ||
    t.includes("basic stone") ||
    t.includes("budget") ||
    t.includes("cheapest") ||
    t.includes("simple paver") ||
    t.includes("regular brick")
  ) {
    return "barkman_holland";
  }

  // Barkman
  if (t.includes("holland")) return "barkman_holland";
  if (t.includes("broadway 100")) return "barkman_broadway_100";
  if (t.includes("broadway 65")) return "barkman_broadway_65";
  if (t.includes("broadway") && t.includes("driveway"))
    return "barkman_broadway_100";
  if (t.includes("broadway")) return "barkman_broadway_65";
  if (t.includes("verano")) return "barkman_verano";
  if (t.includes("roman")) return "barkman_roman";
  if (t.includes("fjord")) return "barkman_fjord";
  if (t.includes("navarro")) return "barkman_navarro";
  if (t.includes("lexington")) return "barkman_lexington_slab";
  if (t.includes("brookside")) return "barkman_brookside_slab";
  if (t.includes("terrace")) return "barkman_terrace_slab";
  if (t.includes("diamond")) return "barkman_diamond_face_24x24";
  if (t.includes("arborwood") || t.includes("arbor wood"))
    return "barkman_arborwood";

  // Belgard
  if (t.includes("belgard") && t.includes("origin")) return "belgard_origins";
  if (t.includes("belgard") && t.includes("dimension"))
    return "belgard_dimensions";
  if (t.includes("mega libre")) return "belgard_mega_libre";
  if (t.includes("belgard")) return "belgard_holland";

  // Techo-Bloc Blu family
  if (t.includes("techo") && t.includes("blu grande") && t.includes("polish"))
    return "techo_blu_grande_polished";
  if (t.includes("techo") && t.includes("blu grande"))
    return "techo_blu_grande_slate";
  if (t.includes("techo") && t.includes("blu 60") && t.includes("polish"))
    return "techo_blu_60_polished";
  if (t.includes("techo") && t.includes("blu 60"))
    return "techo_blu_60_slate";
  if (t.includes("techo") && t.includes("blu"))
    return "techo_blu_60_slate";

  // If user explicitly says "cheap" or "cost effective" without naming a product
  if (t.includes("cheap") || t.includes("cost effective")) {
    return "barkman_holland";
  }

  // Fallback default: Broadway 65 as a solid mid option
  return "barkman_broadway_65";
}

module.exports = {
  calculatePavingEstimate,
  inferMaterialCodeFromText,
  getMaterialTierDescription,
};
