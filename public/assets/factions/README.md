# Fictional factions and model credits

All runtime files are bundled locally. No account, model CDN or external request is required while playing.

| File | Original work and creator | License | Changes |
| --- | --- | --- | --- |
| coalition-rifleman.glb | [Soldier by KolosStudios](https://poly.pizza/m/XT8jgwSesV) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Original GLB; runtime scales, rotates and recolours uniforms for Aster. Existing M4-shaped rifle retained. |
| tank-hull.glb | [Tank by KolosStudios](https://poly.pizza/m/egcLMSGiuA) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Original GLB; runtime scales and recolours both factions. Aster adds an angular turret bustle and side armour; Vostran retains the compact rounded turret. |
| union-rifleman.glb | [SWAT by Quaternius](https://poly.pizza/m/Btfn3G5Xv4) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Original GLB; runtime scales, rotates, recolours field kit, plays supplied gun-ready/run clips and adds an original AK-shaped rifle. |

License and source pages were checked when imported. The GLBs are the public model downloads from the respective source pages (Brotli transfer compression removed without modifying model contents). Attribution is also shown under **Model credits** on the game's main menu. No endorsement by the original creators is implied.

## Art direction and balance

- **Aster Defence Coalition:** fictional western-inspired equipment; Ranger infantry, Bastion MBT, high-cabin Lynx 8×8 APC, Kestrel helicopter with skids.
- **Vostran Union:** fictional eastern-inspired equipment; Motor Rifle infantry, Volk MBT, low boat-hull Bars 8×8 APC, winged Korshun helicopter with wheels.
- These are lightweight low-poly representations for the RTS camera, not exact replicas of real armed forces or photorealistic finished vehicle assets. The source tank hull is shared; faction armour additions provide different silhouettes. APCs, helicopters, added rifle and armour are original procedural meshes in `FactionModels.tsx`.
- Both factions use identical existing unit stats, costs, hitboxes, reinforcement timings and RAAS rules. Team colours remain blue for friendlies and red for enemies, independent of faction identity.
- Match state assigns factions per team. Initial units and all later reinforcements resolve models through their team, so the choice is preserved through respawns.
- Models cache source data and share geometry/materials; animated soldiers clone skeletons. Local procedural fallbacks keep units visible if a model fails to load. No scene-wide suspension is introduced.

Source download URLs:

- Soldier: https://static.poly.pizza/42b9173f-a91c-4abf-b6f5-b21a3965f61a.glb.br
- Tank: https://static.poly.pizza/ba4513d6-e5c6-4a4b-a027-2eb7097d6516.glb.br
- SWAT: https://static.poly.pizza/713f6535-f4f3-4367-a4c6-ced126ae0936.glb.br
