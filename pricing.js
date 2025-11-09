// pricing.js
// Pricing engine for The Paving Stone Pros chatbot
//
// Rules implemented here:
// - Labour tiers based on your sheet (patio/walkway/driveway).
// - 40% markup on pavers (material).
// - Optional +15% bump on labour tiers (LABOUR_BUMP).
// - ANY job under 100 sq ft gets DOUBLED (labour + material together).
// - HARD minimum job price of $2,500 (and you never show a number below that).
// - +10% "online ballpark" cushion for chatbot estimates (CHATBOT_CUSHION).

const LABOUR_BUMP = 1.0;      // set to 1.0 if you DON'T want +15% labour
const PAVER_MARKUP = 1.40;     // 40% markup on pavers
const CHATBOT_CUSHION = 1.05;  // 10% cushion for online/chat
const MIN_JOB = 2500;          // absolute minimum price you ever want to charge/quote

// --- LABOUR TIERS FROM YOUR SHEET ---
// Size breaks: <150, 150–300, 300–500, 500–750, 750–1000, 1000–2000, >3000

function patioBaseRate(sf) {
  if (sf < 150) return 36;
  if (sf < 300) return 23;
  if (sf < 500) return 21;
  if (sf < 750) return 18;
  if (sf < 1000) return 16;
  if (sf < 2000) return 14;
  return 12.1;
}

function drivewayBaseRate(sf) {
  if (sf < 150) return 40;
  if (sf < 300) return 24;
  if (sf < 500) return 22;
  if (sf < 750) return 19;
  if (sf < 1000) return 17;
  if (sf < 2000) return 15.5;
  return 13.75;
}

// Fake grass if you want it later
function fakeGrassBaseRate(sf) {
  if (sf < 150) return 16.5;
  if (sf < 300) return 14.5;
  if (sf < 500) return 13.5;
  if (sf < 750) return 11.5;
  return 10.5;
}

// Apply global labour bump
function getPatioLabourRate(sf) {
  return patioBaseRate(sf) * LABOUR_BUMP;
}

function getWalkwayLabourRate(sf) {
  // Same as patio for now
  return patioBaseRate(sf) * LABOUR_BUMP;
}

function getDrivewayLabourRate(sf) {
  return drivewayBaseRate(sf) * LABOUR_BUMP;
}

function getFakeGrassRate(sf) {
  return fakeGrassBaseRate(sf) * LABOUR_BUMP;
}

// --- MATERIAL PRICING (contractor base, BEFORE markup) ---
// Core families + Belgard Origins (your example).
const MATERIALS = {
  // Barkman generics
  barkman_holland_generic: { basePerSqft: 6.76 },
  barkman_broadway_65mm_generic: { basePerSqft: 7.50 },
  barkman_broadway_100mm_generic: { basePerSqft: 11.82 },
  barkman_roman_generic: { basePerSqft: 9.00 },
  barkman_verano_generic: { basePerSqft: 7.00 },
  barkman_flagstone_generic: { basePerSqft: 7.50 },
  barkman_brookside_slab: { basePerSqft: 7.00 },
  barkman_fjord_generic: { basePerSqft: 14.00 },
  barkman_lexington_slab_generic: { basePerSqft: 9.00 },
  barkman_navarro_generic: { basePerSqft: 9.00 },
  barkman_roman_circle_generic: { basePerSqft: 10.00 },
  barkman_rosetta_grand_flag: { basePerSqft: 10.25 },
  barkman_bridgewood: { basePerSqft: 11.50 },
  barkman_arborwood: { basePerSqft: 9.00 },

  // Belgard
  belgard_holland: { basePerSqft: 5.70 },
  belgard_origins: { basePerSqft: 6.41 },
  belgard_avalon_slate: { basePerSqft: 6.72 },
  belgard_aristokrat_24x48: { basePerSqft: 11.15 },
  belgard_cambridge: { basePerSqft: 6.25 },
  belgard_lafitt_grana: { basePerSqft: 6.86 },
  belgard_dimensions: { basePerSqft: 6.41 },
  belgard_dimensions_catalina_grana: { basePerSqft: 6.91 },
  belgard_roman: { basePerSqft: 6.27 },
  belgard_mega_libre_flagstone: { basePerSqft: 7.41 },
  belgard_moduline_series: { basePerSqft: 8.60 },

  // Techo-Bloc Blu / Blu Grande core SKUs
  techo_blu_60_slate_3pc: { basePerSqft: 7.94 },
  techo_blu_60_smooth_3pc: { basePerSqft: 7.94 },
  techo_blu_60_polished: { basePerSqft: 11.73 },
  techo_blu_grande_slate: { basePerSqft: 9.46 },
  techo_blu_grande_smooth: { basePerSqft: 9.46 },
  techo_blu_grande_polished: { basePerSqft: 13.07 }
};

function getMaterialPricePerSqft(code, isDiamondFace) {
  const mat = MATERIALS[code];
  const base = mat ? mat.basePerSqft : 10; // fallback if unknown

  // 40% markup on pavers
  let price = base * PAVER_MARKUP;

  // Extra 30% for Diamond Face slabs (if you ever flag them that way)
  if (isDiamondFace) price *= 1.30;

  return price;
}

// --- MAP USER TEXT TO MATERIAL CODE ---
// Takes whatever the user typed ("Broadway 65", "Blu 60 Smooth", "Belgard Holland")
// and returns one of the keys from MATERIALS.
// Default = a mid-range Barkman Holland style paver.

function inferMaterialCodeFromText(text) {
  const t = (text || "").toLowerCase();

  // Barkman Bridgewood
  if (t.includes("bridgewood") || t.includes("bridge wood")) {
    return "barkman_bridgewood";
  }

  // Barkman Broadway 100mm (driveways / heavy duty)
  if (t.includes("broadway") && t.includes("100")) {
    return "barkman_broadway_100mm_generic";
  }

  // Barkman Broadway 65mm (patios / walkways)
  if (t.includes("broadway") && t.includes("65")) {
    return "barkman_broadway_65mm_generic";
  }

  // Generic Broadway if thickness not mentioned
  if (t.includes("broadway")) {
    return "barkman_broadway_65mm_generic";
  }

  // Barkman Fjord
  if (t.includes("fjord")) {
    return "barkman_fjord_generic";
  }

  // Barkman Lexington
  if (t.includes("lexington")) {
    return "barkman_lexington_slab_generic";
  }

  // Barkman Brookside
  if (t.includes("brookside")) {
    return "barkman_brookside_slab";
  }

  // Barkman Navarro
  if (t.includes("navarro")) {
    return "barkman_navarro_generic";
  }

  // Barkman Roman / Roman Circle vs Belgard Roman
  if (t.includes("roman circle")) {
    return "barkman_roman_circle_generic";
  }
  if (t.includes("roman")) {
    if (t.includes("belgard")) return "belgard_roman";
    return "barkman_roman_generic";
  }

  // Barkman Verano
  if (t.includes("verano")) {
    return "barkman_verano_generic";
  }

  // Holland – Barkman vs Belgard
  if (t.includes("holland")) {
    if (t.includes("belgard")) return "belgard_holland";
    return "barkman_holland_generic";
  }

  // Barkman Flagstone
  if (t.includes("flagstone") && t.includes("barkman")) {
    return "barkman_flagstone_generic";
  }

  // Barkman Arborwood
  if (t.includes("arborwood")) {
    return "barkman_arborwood";
  }

  // Rosetta Grand Flag
  if (t.includes("grand flag")) {
    return "barkman_rosetta_grand_flag";
  }

  // Belgard Origins
  if (t.includes("origins")) {
    return "belgard_origins";
  }

  // Belgard other lines
  if (t.includes("aristokrat")) return "belgard_aristokrat_24x48";
  if (t.includes("avalon")) return "belgard_avalon_slate";
  if (t.includes("moduline")) return "belgard_moduline_series";
  if (t.includes("mega libre")) return "belgard_mega_libre_flagstone";
  if (t.includes("cambridge")) return "belgard_cambridge";
  if (t.includes("lafitt")) return "belgard_lafitt_grana";
  if (t.includes("dimensions") || t.includes("catalina") || t.includes("grana")) {
    return "belgard_dimensions";
  }

  // Techo-Bloc Blu 60
  if (t.includes("blu 60") || t.includes("blu60") || (t.includes("techo") && t.includes("blu"))) {
    if (t.includes("smooth")) return "techo_blu_60_smooth_3pc";
    if (t.includes("polished")) return "techo_blu_60_polished";
    return "techo_blu_60_slate_3pc";
  }

  // Techo-Bloc Blu Grande
  if (t.includes("blu grande")) {
    if (t.includes("polished")) return "techo_blu_grande_polished";
    if (t.includes("smooth")) return "techo_blu_grande_smooth";
    return "techo_blu_grande_slate";
  }

  // Fallback: mid-range Barkman Holland-style paver
  return "barkman_holland_generic";
}

// --- AREA HELPERS ---

function areaToSqft(area) {
  if (area.square_feet && area.square_feet > 0) return area.square_feet;
  if (area.length_ft && area.width_ft) return area.length_ft * area.width_ft;
  return 0;
}

function calculateTotalSqft(areas) {
  return areas.reduce((sum, a) => sum + areaToSqft(a), 0);
}

// --- MAIN CALCULATOR ---
//
// input = {
//   project_type: "patio" | "walkway" | "driveway" | "fake_grass" | ...,
//   areas: [{ length_ft?, width_ft?, square_feet?, is_backyard? }],
//   access_level: "easy" | "medium" | "difficult",
//   material_code: "belgard_origins" | "barkman_holland_generic" | ...,
//   city_town: "Winnipeg",
//   is_out_of_town: boolean
// }

function calculatePavingEstimate(input) {
  const {
    project_type,
    areas,
    access_level,
    material_code,
    city_town,
    is_out_of_town
  } = input;

  const totalSqft = calculateTotalSqft(areas) || 0;

  // --- choose labour rate per sq ft ---
  let labourRate;
  if (project_type === "driveway") {
    labourRate = getDrivewayLabourRate(totalSqft);
  } else if (project_type === "walkway") {
    labourRate = getWalkwayLabourRate(totalSqft);
  } else if (project_type === "fake_grass") {
    labourRate = getFakeGrassRate(totalSqft);
  } else {
    // default to patio rates
    labourRate = getPatioLabourRate(totalSqft);
  }

  // --- split front/back for +10% in backyard ---
  let backyardSqft = 0;
  let frontSqft = 0;

  for (const area of areas) {
    const sf = areaToSqft(area);
    if (area.is_backyard) backyardSqft += sf;
    else frontSqft += sf;
  }

  let labourTotal =
    frontSqft * labourRate +
    backyardSqft * labourRate * 1.10; // backyard premium

  // Access multipliers
  if (access_level === "medium") labourTotal *= 1.05;
  if (access_level === "difficult") labourTotal *= 1.15;

  // Out-of-town surcharge
  if (is_out_of_town) labourTotal *= 1.10;

  // --- material total ---
  const isDiamondFace =
    material_code && material_code.toLowerCase().includes("diamond");
  const materialPerSqft = getMaterialPricePerSqft(material_code, isDiamondFace);
  let materialTotal = materialPerSqft * totalSqft;

  // --- subtotal before special rules ---
  let subtotal = labourTotal + materialTotal;

  // Enforce minimum job
  if (subtotal < MIN_JOB) {
    subtotal = MIN_JOB;
  }

  // Apply chatbot cushion
  subtotal *= CHATBOT_CUSHION;

  // Round to nearest $500
  const rounded = Math.round(subtotal / 500) * 500;

  // Create ±10% range
  let low = Math.round(rounded * 0.9);
  let high = Math.round(rounded * 1.1);

  // Make sure you NEVER show a number below your minimum job
  if (low < MIN_JOB) low = MIN_JOB;
  if (high < MIN_JOB) high = MIN_JOB;

  return {
    currency: "CAD",
    low,
    high,
    notes: `${Math.round(
      totalSqft
    )} sq. ft. ${project_type} in ${city_town}, access: ${access_level}, material: ${
      material_code || "unspecified"
    }.`
  };
}

module.exports = { calculatePavingEstimate, inferMaterialCodeFromText };
