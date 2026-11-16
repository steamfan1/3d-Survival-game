// Virginia physiographic regions and the biomes/habitats inside them.
// Colours are low-poly palette swatches (sRGB 0-255).

export const REGION = { COASTAL: 0, PIEDMONT: 1, BLUE_RIDGE: 2, RIDGE_VALLEY: 3, CUMBERLAND: 4 };
export const REGION_NAMES = [
  'Coastal Plain (Tidewater)',
  'Piedmont',
  'Blue Ridge Mountains',
  'Ridge and Valley',
  'Cumberland Plateau',
];

const SAND = [218, 200, 146];
const MUD = [104, 90, 62];
const RED_CLAY = [158, 82, 56];
const ROCK = [128, 127, 121];
const LIMESTONE = [178, 172, 156];

// trees: species -> relative weight. cover: ground cover type -> chance per 2 m cell.
export const BIOMES = [
  { key: 'OCEAN', name: 'Atlantic Ocean', ground: [[205, 192, 145], [196, 182, 136]], soil: [184, 166, 120], steep: [170, 152, 112], treeDensity: 0, trees: {}, cover: {} },
  { key: 'BEACH', name: 'Barrier Beach', ground: [SAND, [224, 206, 152], [210, 192, 138]], soil: SAND, steep: [214, 196, 140], treeDensity: 0, trees: {}, cover: { seaOats: 0.03 } },
  { key: 'DUNES', name: 'Dunes & Sea Oats', ground: [[212, 196, 142], [196, 190, 128], [176, 180, 108]], soil: SAND, steep: [214, 196, 140], treeDensity: 0.02, trees: { waxMyrtle: 1 }, cover: { seaOats: 0.4, shrub: 0.03 } },
  { key: 'MARITIME_FOREST', name: 'Maritime Forest', ground: [[132, 150, 74], [146, 154, 84], [124, 142, 70]], soil: [176, 150, 104], steep: [196, 180, 130], treeDensity: 0.45, trees: { liveOak: 5, loblolly: 3, waxMyrtle: 2 }, cover: { shrub: 0.06, grass: 0.06 } },
  { key: 'ESTUARY', name: 'Back-Bay Sound (Estuary)', ground: [[118, 108, 78], [128, 116, 84]], soil: MUD, steep: MUD, treeDensity: 0, trees: {}, cover: { reeds: 0.08 } },
  { key: 'TIDAL_MARSH', name: 'Tidal Salt Marsh', ground: [[150, 160, 84], [166, 168, 90], [136, 150, 76]], soil: MUD, steep: MUD, treeDensity: 0.004, trees: { waxMyrtle: 1 }, cover: { reeds: 0.55 } },
  { key: 'CYPRESS_SWAMP', name: 'Great Dismal Swamp', ground: [[78, 92, 50], [92, 98, 56], [70, 82, 46]], soil: [70, 56, 40], steep: [90, 74, 52], treeDensity: 0.55, trees: { baldCypress: 6, tupelo: 2, whiteCedar: 1 }, cover: { reeds: 0.12, knees: 0.12, fern: 0.06 } },
  { key: 'COASTAL_PINE', name: 'Coastal Plain Pine Forest', ground: [[128, 158, 74], [140, 160, 80], [150, 150, 84]], soil: [176, 150, 104], steep: [186, 158, 110], treeDensity: 0.38, trees: { loblolly: 6, oak: 2, sweetgum: 1 }, cover: { shrub: 0.04, grass: 0.08 } },
  { key: 'PIEDMONT_HARDWOOD', name: 'Oak-Hickory-Beech Forest', ground: [[104, 160, 70], [96, 150, 64], [118, 166, 74]], soil: RED_CLAY, steep: [168, 88, 60], treeDensity: 0.36, trees: { oak: 5, hickory: 3, beech: 2, tulipPoplar: 1 }, cover: { shrub: 0.03, fern: 0.03 } },
  { key: 'PIEDMONT_PINE_OAK', name: 'Mixed Pine-Oak Woodland', ground: [[118, 162, 72], [130, 164, 78], [140, 156, 76]], soil: RED_CLAY, steep: [168, 88, 60], treeDensity: 0.32, trees: { loblolly: 4, oak: 3, hickory: 1, redcedar: 1 }, cover: { grass: 0.06 } },
  { key: 'PIEDMONT_MEADOW', name: 'Piedmont Meadow', ground: [[136, 180, 80], [148, 184, 86], [160, 178, 84]], soil: RED_CLAY, steep: [168, 88, 60], treeDensity: 0.03, trees: { oak: 1, redcedar: 2 }, cover: { grass: 0.4, flowers: 0.08 } },
  { key: 'COVE_FOREST', name: 'Rich Cove Forest', ground: [[78, 140, 62], [86, 148, 66], [72, 132, 60]], soil: [96, 72, 50], steep: [104, 118, 92], treeDensity: 0.6, trees: { tulipPoplar: 4, hemlock: 2, maple: 2, oak: 1 }, cover: { fern: 0.18, rhododendron: 0.04 } },
  { key: 'APPALACHIAN_OAK', name: 'Appalachian Oak Forest', ground: [[100, 150, 66], [110, 154, 70], [96, 142, 64]], soil: [110, 84, 58], steep: ROCK, treeDensity: 0.5, trees: { oak: 5, hickory: 2, maple: 2, pitchPine: 1 }, cover: { boulder: 0.02, fern: 0.03, rhododendron: 0.02 } },
  { key: 'NORTHERN_HARDWOOD', name: 'Northern Hardwood Forest', ground: [[96, 140, 70], [104, 146, 74], [90, 134, 68]], soil: [96, 76, 54], steep: [132, 130, 124], treeDensity: 0.5, trees: { birch: 3, maple: 3, beech: 3, spruce: 1 }, cover: { fern: 0.1, boulder: 0.02 } },
  { key: 'SPRUCE_FIR', name: 'Spruce-Fir Forest', ground: [[66, 108, 64], [74, 114, 68], [62, 100, 62]], soil: [80, 66, 50], steep: [124, 124, 122], treeDensity: 0.65, trees: { spruce: 6, fir: 4, birch: 1 }, cover: { boulder: 0.04, fern: 0.06 } },
  { key: 'GRASSY_BALD', name: 'Mountain Grassy Bald', ground: [[160, 182, 92], [170, 186, 98], [150, 172, 84]], soil: [110, 90, 62], steep: ROCK, treeDensity: 0.03, trees: { spruce: 1, rhododendron: 2 }, cover: { grass: 0.45, boulder: 0.05, flowers: 0.05 } },
  { key: 'VALLEY_MEADOW', name: 'Limestone Valley Meadow', ground: [[134, 176, 82], [144, 180, 88], [126, 168, 78]], soil: [130, 104, 72], steep: LIMESTONE, treeDensity: 0.05, trees: { oak: 2, redcedar: 2 }, cover: { grass: 0.3, boulder: 0.02, flowers: 0.04 } },
];

export const B = Object.fromEntries(BIOMES.map((b, i) => [b.key, i]));

// Materials for exposed rock underground (karst / caves)
export const CAVE_ROCK = { limestone: LIMESTONE, dark: [112, 108, 100], rock: ROCK, sandstone: [168, 140, 104] };

// Wildlife notes (shown in the field guide; animals arrive in a later build)
export const REGION_WILDLIFE = [
  'Waterfowl, shorebirds (piping plovers), black bears, estuarine life',
  'White-tailed deer, wild turkeys, songbirds, warblers, tanagers',
  'Golden-crowned kinglets, black bears, salamanders, high-altitude flora',
  'Black bears, salamanders, cave-dwelling bats (karst)',
  'Black bears, salamanders, golden-crowned kinglets',
];
