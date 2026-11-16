# Old Dominion: a 3D survival sandbox set in Virginia

A low-poly survival sandbox that runs in the browser. It has its own WebGL2 renderer, deformable voxel terrain, and a grid-based building system that goes down to 1 cm blocks. The world is procedurally generated and follows Virginia's real physiographic regions from east to west.

**Play:** https://steamfan1.github.io/3d-Survival-game/ (requires GitHub Pages, see below)

## Build 1: renderer and world

### Renderer (`src/render/`)
- Custom WebGL2 renderer, with no engine or libraries
- Flat-shaded "Unity low-poly" look: faceted terrain, per-face colour variation, icosahedron foliage
- Directional sun with a 2048² PCF shadow map that follows the camera
- Gradient sky with a sun disc, distance fog, and animated faceted water
- Frustum culling and interleaved 20-byte vertices

### Deformable voxel world (`src/world/`)
- 1 m density voxels in 32 × 32 m chunks, 160 m tall (−24 m to +135 m)
- Smooth **Surface Nets** meshing with flat normals for low-poly facets
- Chunks generate and mesh on Web Workers and stream in around the player
- **Terraform tool:** dig and raise terrain with a spherical brush. Dug faces show the soil and bedrock of the region you're in: red Piedmont clay, coastal sand and peat, or Appalachian limestone.
- Karst caves (spaghetti tunnels and chambers) under the mountains, especially in the Ridge and Valley

### Procedural Virginia
The X axis runs east to west across the state, as on a map:

| Region | Biomes / habitats |
|---|---|
| **Coastal Plain (Tidewater)** (east, +X) | Atlantic Ocean, barrier beaches, dunes and sea oats, maritime forest (live oak, loblolly pine, wax myrtle), back-bay sound (estuary), tidal salt marsh with winding creeks, **Great Dismal Swamp** (bald cypress with knees, tupelo, Atlantic white cedar), coastal plain pine forest |
| **Piedmont** (spawn) | Rolling hills with stream valleys; oak-hickory-beech forest; mixed pine-oak woodland; meadows; red-clay soil |
| **Blue Ridge** | Ridged mountains; high-elevation **spruce-fir forest**, **grassy balds**, northern hardwood (birch, maple, beech), **rich cove forest** (tulip poplar, hemlock), Appalachian oak forest |
| **Ridge and Valley** | Long parallel NE–SW ridges, limestone valley meadows, karst caves |
| **Cumberland Plateau** (far west, −X) | Dissected plateau |

The HUD shows your current region, biome and its typical wildlife. Animals themselves are planned for a later build.

### Building (`src/building/`)
- Grid sizes: **1 cm, 2 cm, 5 cm, 10 cm, 25 cm, 50 cm and 1 m**. All of them share one centimetre lattice, so they line up with each other.
- **Scrap Mechanic-style stretching:** click a surface and drag. The blocks stretch along the axis-aligned plane that best faces your view, so you can reach all three axes in one drag. Look down to stretch across a floor, look ahead to pull it up into a wall, and turn sideways to switch again. The axis you're not looking along keeps its length, and coloured guide lines show which axes are active. Scroll while dragging to lengthen the axis pointing at you. Right-drag removes blocks the same way and splits placed boxes where it cuts through them.
- A drag is stored as one box, however many blocks it holds, so a 3 m × 3 m slab of 1 cm blocks is cheap.
- **Procedural material textures**, generated in the shader with no image files: staggered oak boards with grain and knots, stacked pine logs, irregular fieldstone in mortar, running-bond colonial brick (with the odd dark clinker), mottled clay plaster, layered thatch, staggered slate tiles, whitewashed boards and mossy stone. Each board, brick, stone and tile gets its own tint. Textures are at real-world scale, shrink a little for very fine blocks, and soften with distance.
- **Blocks can sit inside the voxel terrain.** On terrain they sink slightly into the ground instead of floating. Press **V** to start the drag *inside* the surface for foundations, posts and cellars. You can dig terrain around blocks without affecting them.
- Nine materials: oak planks, pine logs, fieldstone, colonial brick, clay plaster, thatch, slate, whitewash and mossy stone.
- Placed blocks are saved in your browser (localStorage). Terrain edits are not saved yet.

## Controls

| Key | Action |
|---|---|
| WASD / mouse | Move / look |
| Space / Shift | Jump (swim up) / sprint |
| F | Toggle fly mode (Space / C = up / down, Shift = fast) |
| Q or Tab | Switch Build ↔ Terraform tool |
| **Build:** left-drag | Stretch blocks out from where you clicked |
| Look while dragging | The stretch axis follows your view (down = floor, ahead = wall) |
| Scroll while dragging | Lengthen the axis pointing at you |
| Right-drag | Remove blocks the same way |
| `[` `]` or `-` `=` | Grid size, 1 cm to 1 m |
| 1–9 / scroll | Material |
| V | Place on surface ↔ inside terrain |
| **Terraform:** hold left / right | Dig / raise terrain |
| `[` `]` | Brush size |
| Esc | Menu: controls, **travel to any biome**, view distance, shadows |

Add `?seed=12345` to the URL to get a different world.

## Running locally
The game uses ES modules, so it has to be served over HTTP. Opening `index.html` directly from disk won't work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Hosting on GitHub Pages
Go to repository **Settings → Pages**, set **Source: Deploy from a branch**, choose **Branch: `main` / root**, and save. The game will be live at `https://steamfan1.github.io/3d-Survival-game/` in about a minute.

## Project layout
```
index.html, style.css
src/main.js                 game loop, tools, HUD, travel menu
src/core/                   math, simplex noise, input
src/render/                 WebGL2 renderer, shaders, mesh builder
src/world/generator.js      Virginia terrain, biomes, caves, density field
src/world/mesher.js         Surface Nets + flat-shaded terrain colouring
src/world/props.js          low-poly trees, shrubs, reeds, rocks
src/world/world.js          chunk streaming, workers, sculpting, raycasts
src/world/chunkWorker.js    off-thread generation
src/building/building.js    centimetre grid building system
src/player/player.js        first-person controller and collision
```

## Ideas for the next builds
Survival systems (health, hunger, thirst, temperature), wildlife (deer, turkeys, black bears, waterfowl, salamanders), resource gathering and crafting, saving terrain edits, day/night cycle and weather.
