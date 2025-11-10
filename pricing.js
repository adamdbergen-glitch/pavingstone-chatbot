// ============================================================
// PRICING.JS – The Paving Stone Pros
// Updated with 2025 Barkman, Belgard, and Techo-Bloc pricing
// Includes tier tagging + helper for material descriptions
// ============================================================

const PAVER_MARKUP = 1.25; // 25% markup on material by default

// ------------------------------------------------------------
// --- MATERIAL PRICING (contractor base, BEFORE markup) ---
// ------------------------------------------------------------
const MATERIALS = {
  // ============================
  // 🧱 Barkman – PAVERS & SLABS
  // ============================

  // 🟩 Budget
  barkman_holland_generic: { basePerSqft: 6.18, tier: "budget" },
  barkman_holland_60_natural: { basePerSqft: 5.54, tier: "budget" },
  barkman_flagstone_generic: { basePerSqft: 7.91, tier: "budget" },
  barkman_verano_generic: { basePerSqft: 7.51, tier: "budget" },
  barkman_broadway_65mm_generic: { basePerSqft: 7.27, tier: "budget" },
  barkman_hexagon_65mm: { basePerSqft: 7.28, tier: "budget" },
  barkman_brookside_slab: { basePerSqft: 6.95, tier: "budget" },
  barkman_diamond_face_slab_18x18: { basePerSqft: 4.98, tier: "budget" },
  barkman_diamond_face_slab_24x24: { basePerSqft: 3.96, tier: "budget" },
  barkman_diamond_face_slab_24x30: { basePerSqft: 3.45, tier: "budget" },
  barkman_terrace_slab_natural: { basePerSqft: 4.36, tier: "budget" },

  // 🟨 Midrange
  barkman_roman_generic: { basePerSqft: 8.20, tier: "midrange" },
  barkman_roman_circle_generic: { basePerSqft: 10.29, tier: "midrange" },
  barkman_verano_premium: { basePerSqft: 8.20, tier: "midrange" },
  barkman_broadway_65mm_premium: { basePerSqft: 7.99, tier: "midrange" },
  barkman_cobble_paver: { basePerSqft: 8.44, tier: "midrange" },
  barkman_holland_80mm: { basePerSqft: 8.31, tier: "midrange" },
  barkman_mesa_flagstone_80mm: { basePerSqft: 8.45, tier: "midrange" },
  barkman_navarro_generic: { basePerSqft: 8.76, tier: "midrange" },
  barkman_lexington_slab_generic: { basePerSqft: 8.04, tier: "midrange" },
  barkman_arborwood: { basePerSqft: 9.00, tier: "midrange" },
  barkman_terrace_slab_colour: { basePerSqft: 4.88, tier: "midrange" },

  // 🟥 Premium
  barkman_fjord_generic: { basePerSqft: 12.88, tier: "premium" },
  barkman_broadway_100mm_generic: { basePerSqft: 11.52, tier: "premium" },
  barkman_broadway_100mm_premium: { basePerSqft: 12.66, tier: "premium" },
  barkman_broadway_planks_100mm: { basePerSqft: 11.52, tier: "premium" },
  barkman_broadway_planks_100mm_premium: { basePerSqft: 12.68, tier: "premium" },
  barkman_broadway_contour_100mm: { basePerSqft: 12.65, tier: "premium" },
  barkman_broadway_weathered_100mm: { basePerSqft: 16.09, tier: "premium" },
  barkman_bridgewood: { basePerSqft: 11.82, tier: "premium" },
  barkman_rosetta_dimensional_flag: { basePerSqft: 11.66, tier: "premium" },
  barkman_rosetta_grand_flag: { basePerSqft: 11.67, tier: "premium" },

  // ============================
  // 🧱 Belgard – SiteOne Winnipeg contractor pricing 2025
  // ============================
  belgard_holland: { basePerSqft: 4.78, tier: "budget" },
  belgard_dimensions: { basePerSqft: 5.73, tier: "budget" },
  belgard_origins: { basePerSqft: 5.73, tier: "budget" },
  belgard_mega_libre_flagstone: { basePerSqft: 6.27, tier: "midrange" },

  // ============================
  // 🧱 Techo-Bloc – Trade Price List 2025
  // ============================
  techo_blu_60_slate_3pc: { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_smooth_3pc: { basePerSqft: 7.94, tier: "midrange" },
  techo_blu_60_polished: { basePerSqft: 11.73, tier: "premium" },
  techo_blu_grande_slate: { basePerSqft: 9.46, tier: "midrange" },
  techo_blu_grande_smooth: { basePerSqft: 9.46, tier: "midrange" },
  techo_blu_grande_polished: { basePerSqft: 13.07, tier: "premium" }
};

// ------------------------------------------------------------
// --- MATERIAL TIER DESCRIPTION HELPER ---
// ------------------------------------------------------------
function getMaterialTierDescription(code) {
  const mat = MATERIALS[code];

  if (!mat || !mat.tier) return "a solid mid-range option";

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

// ------------------------------------------------------------
// --- MATERIAL PRICE PER SQFT ---
// ------------------------------------------------------------
function getMaterialPricePerSqft(code, isDiamondFace) {
  const mat = MATERIALS[code];
  const base = mat ? mat.basePerSqft : 10; // fallback if unknown

  let price = base * PAVER_MARKUP;
  if (isDiamondFace) price *= 1.30;

  return price;
}

// ------------------------------------------------------------
// --- MAIN ESTIMATE CALCULATION ---
// ------------------------------------------------------------
function calculatePavingEstimate({
  project_type,
  areas,
  access_level,
  material_code,
  city_town,
  is_out_of_town
}) {
  const totalSqft = areas.reduce((sum, a) => sum + a.square_feet, 0);

  // Example sliding-scale labour pricing (can be replaced with your real tiers)
  let labourRate =
    totalSqft < 150
      ? 30
      : totalSqft < 300
      ? 20
      : totalSqft < 500
      ? 17
      : totalSqft < 750
      ? 16
      : totalSqft < 1000
      ? 13
      : 12;

  if (access_level === "medium") labourRate *= 1.05;
  if (access_level === "difficult") labourRate *= 1.10;
  if (is_out_of_town) labourRate *= 1.10;

  const materialCostPerSqft = getMaterialPricePerSqft(material_code);
  const low = Math.round(totalSqft * (labourRate + materialCostPerSqft) * 0.95);
  const high = Math.round(totalSqft * (labourRate + materialCostPerSqft) * 1.05);

  return { low, high };
}

// ------------------------------------------------------------
// --- MATERIAL CODE INFERENCE FROM TEXT ---
// ------------------------------------------------------------
function inferMaterialCodeFromText(text) {
  const lower = text.toLowerCase();

  if (lower.includes("holland")) return "barkman_holland_generic";
  if (lower.includes("broadway") && lower.includes("100"))
    return "barkman_broadway_100mm_generic";
  if (lower.includes("broadway")) return "barkman_broadway_65mm_generic";
  if (lower.includes("roman")) return "barkman_roman_generic";
  if (lower.includes("verano")) return "barkman_verano_generic";
  if (lower.includes("fjord")) return "barkman_fjord_generic";
  if (lower.includes("diamond")) return "barkman_diamond_face_slab_24x24";
  if (lower.includes("navarro")) return "barkman_navarro_generic";
  if (lower.includes("flagstone")) return "barkman_flagstone_generic";
  if (lower.includes("blu") && lower.includes("techo"))
    return "techo_blu_60_slate_3pc";
  if (lower.includes("belgard")) return "belgard_holland";

  return "barkman_broadway_65mm_generic"; // fallback
}

// ------------------------------------------------------------
// --- EXPORTS ---
// ------------------------------------------------------------
module.exports = {
  calculatePavingEstimate,
  inferMaterialCodeFromText,
  getMaterialTierDescription
};
