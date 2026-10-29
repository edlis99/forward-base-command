# Fictional factions and model credits

All runtime files are bundled locally. No account, model CDN or external request is required while playing.

| File | Original work and creator | License | Changes |
| --- | --- | --- | --- |
| coalition-rifleman.glb | [Soldier by KolosStudios](https://poly.pizza/m/XT8jgwSesV) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Original GLB; runtime scales, rotates and recolours uniforms for Aster. Existing M4-shaped rifle retained. |
| tank-hull.glb | [Tank by KolosStudios](https://poly.pizza/m/egcLMSGiuA) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Original GLB; runtime scales and recolours both factions. Aster adds an angular turret bustle and side armour; Vostran retains the compact rounded turret. |
| union-rifleman.glb | [SWAT by Quaternius](https://poly.pizza/m/Btfn3G5Xv4) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Original GLB; runtime scales, rotates, recolours field kit, plays supplied gun-ready/run clips and adds an original AK-shaped rifle. |

| aster-rifleman-detailed.glb | [FREE [Military Soldier] RIGGED by BAMEN](https://sketchfab.com/3d-models/free-military-soldier-rigged-e9c56308a67d4a3db62e914fafa4d198) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Rigged, retinted military soldier converted from original FBX by [AetherRadar/operation-steel-tide](https://github.com/AetherRadar/operation-steel-tide/blob/main/assets/models/bamen_military_soldier/LICENSE.md). Added a lightweight in-game procedural gait because this optimized GLB does not include animation clips. Now used by Aster. |
| scarl.glb | [Quaternius Ultimate Guns Pack](https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Unmodified pack model under source repository name `scarl.glb`; optional rifle model for Aster infantry. |
| ak74.glb | [Quaternius Ultimate Guns Pack](https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Unmodified pack model under source repository name `ak74.glb`; optional rifle model for Vostran infantry. |

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

## High-detail upgrade, October 2026

- **Aster infantry:** replace the previous very low-poly KolosStudios soldier with the more detailed BAMEN rigged GLB. The underlying skinned mesh is preserved; a simple non-gameplay gait operates the Mixamo leg bones while units move. The previous source remains retained in this repository as fallback/reference.
- **Vostran infantry:** retain Quaternius's animated soldier (to avoid discarding its supplied movement clips). Use a distinct CC0 AK-style rifle prop where its wrist attachment is available.
- **Equipment:** Quaternius weapon models are visually normalized in `FactionEnhancements.tsx` and do not change weapon damage or range.
- **Vehicles:** original, faction-specific procedural detail meshes add armour panels, ERA blocks, smoke dischargers, hatches, optics, external stores, APC doors and helicopter pods to the existing silhouettes. These are not the exact Sketchfab Bradley/BMP/Leopard files: those downloads were not accessible, so no attribution or imported-model claim is made for them.
- **Licensing:** BAMEN's CC BY 4.0 credit and Quaternius's CC0 provenance must be retained on redistribution. Credit text in Model Credits should be updated if the UI's text diverges from this document.
- **Performance:** these detail components are lightweight, but the 3D game has not been benchmarked here; runtime scale and visual inspection remain necessary.
