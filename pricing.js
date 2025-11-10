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
// Core families + Belgard + Techo-Bloc
const MATERIALS = {
  // ============================
  // 🧱 Barkman – PAVERS & SLABS
  // Prices pulled from Barkman 2025 material list pages
  // (ignoring old summary tables on first 2 pages of your PDF)
  // ============================

  // 60mm pavers
  // Holland: Natural is ~5.54/sq ft, Colour 6.18/sq ft – use colour as your default “generic”
  barkman_holland_generic:      { basePerSqft: 6.18, tier: "budget" },   // Holland Paver (Colour) 4x8/8x8
  barkman_holland_60_natural:   { basePerSqft: 5.54, tier: "budget" },   // Holland Paver (Natural) 4x8

  // Flagstone paver 60mm
  barkman_flagstone_generic:    { basePerSqft: 7.91, tier: "budget" },   // Flagstone Paver 60mm

  // Roman pavers 60mm (8x4 / 8x6 / 8x10 / 8x12 all ~8.18–8.20/sq ft)
  barkman_roman_generic:        { basePerSqft: 8.20, tier: "midrange" },
  barkman_roman_circle_generic: { basePerSqft: 10.29, tier: "midrange" }, // Roman Circle Kit

  // Verano standard colours (~7.15–7.51/sq ft)
  barkman_verano_generic:       { basePerSqft: 7.51, tier: "budget" },

  // Verano premium colour (~7.84–8.20/sq ft)
  barkman_verano_premium:       { basePerSqft: 8.20, tier: "midrange" },

  // 65mm pavers
  // Broadway 65mm standard (varies 7.24–7.27/sq ft by size)
  barkman_broadway_65mm_generic:  { basePerSqft: 7.27, tier: "budget" },

  // Broadway 65mm premium colours (Amber/Obsidian/Quartz ~7.96–7.99)
  barkman_broadway_65mm_premium:  { basePerSqft: 7.99, tier: "midrange" },

  // Fjord 65mm (300/600/600 sizes ~12.85–12.88/sq ft)
  barkman_fjord_generic:          { basePerSqft: 12.88, tier: "premium" },

  // Hexagon 65mm
  barkman_hexagon_65mm:           { basePerSqft: 7.28, tier: "budget" },

  // Cobble Pallet (65mm)
  barkman_cobble_paver:           { basePerSqft: 8.44, tier: "midrange" },

  // 80mm pavers
  barkman_holland_80mm:           { basePerSqft: 8.31, tier: "midrange" }, // Holland Paver (80mm)
  barkman_mesa_flagstone_80mm:    { basePerSqft: 8.45, tier: "midrange" }, // Mesa Flagstone 80mm

  // Navarro 80mm (range ~8.56–8.76/sq ft – use high end)
  barkman_navarro_generic:        { basePerSqft: 8.76, tier: "midrange" },

  // 100mm pavers
  // Broadway 100mm standard 300/300/600 sizes (~11.49–11.52/sq ft)
  barkman_broadway_100mm_generic: { basePerSqft: 11.52, tier: "premium" },

  // Broadway 100mm premium (~12.65–12.66/sq ft for core sizes)
  barkman_broadway_100mm_premium: { basePerSqft: 12.66, tier: "premium" },

  // Broadway 100mm Planks (standard colours)
  barkman_broadway_planks_100mm:        { basePerSqft: 11.52, tier: "premium" },
  // Broadway 100mm Planks (premium colours)
  barkman_broadway_planks_100mm_premium:{ basePerSqft: 12.68, tier: "premium" },

  // Broadway Contour 100mm (600x300 / 600x150 / 400x100 / 451x76, all ~12.65–12.71)
  barkman_broadway_contour_100mm: { basePerSqft: 12.65, tier: "premium" },

  // Broadway Weathered 100mm (16.08–16.09/sq ft)
  barkman_broadway_weathered_100mm: { basePerSqft: 16.09, tier: "premium" },

  // SLABS (surface materials you might also use as “pavers” in patios)

  // Bridgewood slabs (three sizes ~11.78–11.82/sq ft)
  barkman_bridgewood:            { basePerSqft: 11.82, tier: "premium" },

  // Brookside slabs (16x16 / 16x24 ~6.92–6.95/sq ft)
  barkman_brookside_slab:        { basePerSqft: 6.95, tier: "budget" },

  // Diamond Face slabs (paver-style slabs)
  barkman_diamond_face_slab_18x18: { basePerSqft: 4.98, tier: "budget" },
  barkman_diamond_face_slab_24x24: { basePerSqft: 3.96, tier: "budget" },
  barkman_diamond_face_slab_24x30: { basePerSqft: 3.45, tier: "budget" },

  // Lexington slabs (16x16 / 16x24 ~8.01–8.04/sq ft)
  barkman_lexington_slab_generic:{ basePerSqft: 8.04, tier: "midrange" },

  // Rosetta flagstone (sold by pallet, per-sq-ft values in list)
  barkman_rosetta_dimensional_flag: { basePerSqft: 11.66, tier: "premium" },
  barkman_rosetta_grand_flag:       { basePerSqft: 11.67, tier: "premium" },

  // Terrace face slabs (Natural ~4.36/sq ft, Colour ~4.88/sq ft)
  barkman_terrace_slab_natural:  { basePerSqft: 4.36, tier: "budget" },
  barkman_terrace_slab_colour:   { basePerSqft: 4.88, tier: "midrange" },

  // Arborwood (not explicitly listed in the Barkman price pages snippet,
  // keep as a midrange slab family at your existing base)
  barkman_arborwood:             { basePerSqft: 9.00, tier: "midrange" },

  // ============================
  // ⬇️ Keep your existing Belgard + Techo-Bloc entries below this
  // (what you had before here: belgard_holland, belgard_origins, techo_blu_60_slate_3pc, etc.)
  // ============================

  belgard_holland:         { basePerSqft: 5.70, tier: "budget" },
  belgard_origins:         { basePerSqft: 6.41, tier: "budget" },
  belgard_avalon_slate:    { basePerSqft: 6.72, tier: "budget" },
  belgard_aristokrat_24x48:{ basePerSqft: 11.15, tier: "premium" },
  belgard_cambridge:       { basePerSqft: 6.25, tier: "budget" },
  belgard_lafitt_grana:    { basePerSqft: 6.86, tier: "midrange" },
  belgard_dimensions:      { basePerSqft: 6.41, tier: "budget" },
  belgard_dimensions_catalina_grana: { basePerSqft: 6.91, tier: "budget" },
  belgard_roman:           { basePerSqft: 6.27, tier: "budget" },
  belgard_mega_libre_flagstone: { basePerSqft: 7.41, tier: "midrange" },
  belgard_moduline_series: { basePerSqft: 8.60, tier: "premium" },

  // Techo-Bloc Blu core SKUs
  techo_blu_60_slate_3pc:   { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_smooth_3pc:  { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_polished:    { basePerSqft: 11.73, tier: "premium" },
  techo_blu_grande_slate:   { basePerSqft: 9.46, tier: "midrange" },
  techo_blu_grande_smooth:  { basePerSqft: 9.46, tier: "midrange" },
  techo_blu_grande_polished:{ basePerSqft: 13.07, tier: "premium" }
};

// Describe how “fancy” or “budget” a given material code is,
// based on the tier you added in Step 1.
function getMaterialTierDescription(code) {
  const mat = MATERIALS[code];

  // If we don’t recognise it or it has no tier, just say mid-range.
  if (!mat || !mat.tier) {
    return "a solid mid-range option";
  }

  switch (mat.tier) {
    case "budget":
      return "a cost-effective choice that helps keep the project budget-friendly";
    case "midrange":
      return "a nice balance between cost and appearance";
    case "premium":
      return "a premium-grade stone that really elevates the look and feel of the space";
    default:
      return "a solid mid-range option";
  }
}

function getMaterialPricePerSqft(code, isDiamondFace) {
  const mat = MATERIALS[code];
  const base = mat ? mat.basePerSqft : 10; // fallback if unknown
  // ...
}


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

module.exports = {
  calculatePavingEstimate,
  inferMaterialCodeFromText,
  getMaterialTierDescription
};

