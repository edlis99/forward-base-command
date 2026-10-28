# Squad Gameplay and Competitive Map Design

Prepared for Edvinas Benevičius · 28 October 2026

This brief explains Squad's objective systems and proposes a map and settlement design for the strategy game described in the supplied project notes. The gameplay descriptions are factual summaries; the design requirements and prototype targets are recommendations, not official Squad rules.

The project notes establish a Broken Arrow-like strategy interface, Squad-inspired pacing, recognisable settlements, and Leipalingis-area geography. They also describe a 440 × 320-cell map target and an abstract cover model without building interiors. The recommendations below respect that direction. Competitive design is a future design goal; this document does not claim that multiplayer or the proposed mechanics already exist.

**Selected direction, 28 October 2026:** Edvinas prefers RAAS as the main mode and wants dynamic, highly competitive play with no built-in advantage for either side. The competitive rules below are recommendations for achieving that goal; their detailed parameters have not yet been approved or implemented.

## Recommended competitive RAAS ruleset

The fairness target is equal starting opportunities and consistent rules. Positioning, reconnaissance, logistics, force selection, and successful attacks should create advantages during play. Fairness does not require the sides to remain equally strong after different decisions.

RAAS supplies a useful structure: both sides can attack and defend, the front line can move in either direction, and different objective chains can make the same terrain play differently. Randomisation should select among authored, tested chains. It should not invent arbitrary flag locations or move objectives during the match.

| System | Recommended competitive baseline |
| --- | --- |
| Starting resources | Identical ticket pools, deployment budgets, reinforcement income, setup time, and resource caps. |
| Unit access | The same competitive roster and costs for both sides. Cosmetic factions may differ; mechanical faction asymmetry should be evaluated later. |
| Objective selection | Select one complete chain from a pool of validated alternatives before deployment. |
| Objective information | Reveal the selected chain to both sides at the same time during preparation. This is a proposed competitive variant; Squad RAAS commonly reveals later objectives progressively. |
| Objective progression | Capture in order, retain the required preceding point, and allow recapture in both directions. Main deployment bases are not capture objectives. |
| Combat information | Apply the same sight, concealment, detection, and information-sharing rules to both sides, including the AI. |
| Capture | Require sufficient dismounted infantry strength and local numerical superiority. Equal eligible strength stalls progress. Show neutralisation, capture, and the reason for a stalled contest. |
| Capture rate | Bound the speed benefit from extra infantry so one large formation cannot erase the time needed for a response. Tune the minimum commitment against the actual unit model. |
| Ticket pressure | Give territory a controlled ticket-drain effect. Measure whether taking the first contested point predicts victory too strongly. |
| Capture rewards | For the first competitive prototype, use territorial control and ticket pressure without extra combat power or bonus reinforcement income from captures. |
| Forward reinforcement | Require deliberate setup and supply, with access the opponent can threaten. A captured flag does not automatically grant a protected spawn. |
| Randomness | Keep unit statistics and resource access consistent. Avoid random high-impact events or hidden bonuses that decide an otherwise comparable contest. |

**Initial prototype scope:** use five active objectives and a small pool of around three validated chains. These are proposed scope choices, not final balance values. Establish a strong five-point game before increasing the number of simultaneously relevant locations.

For the first balance benchmark, use a mechanically symmetric layout: comparable arrival times, route choices, cover, lines of sight, and reinforcement access. The visual architecture can differ. When adapting the Leipalingis geography, test every objective chain separately; equal distances alone do not establish equal opportunities.

Each important objective should offer at least two viable independent approaches and, where suitable, a third situational route. Provide space for a defending force to counterattack and for an attacking force to change its axis. A single hill, building, bridge, or road exit should not determine the entire match without an accessible counter.

The intended dynamics come from decisions: whether to commit reserves, rotate toward a threatened defence, change approach, intercept reinforcements, or exploit a successful capture. Stable objective rules let players understand and respond to those changes.

**Capture-rule revision:** the preferred competitive proposal is an infantry-strength contest rather than the earlier rule that any surviving defender blocks capture. A lone defender should still be dangerous through combat and observation, but should not automatically freeze an overwhelming occupation. Keep a minimum capture commitment and sustained occupation requirement so rushing a lone unit through a marker is ineffective.

**Validation:** repeat the same route with starting sides swapped, then repeat across comparable human skill levels or controlled AI setups. Record side win rates, opening arrival times, first-objective conversion into wins, capture and recapture frequency, reinforcement travel, asset losses, and route use. Separate the results by objective chain. A pooled 50/50 win rate can hide one route favouring one side and another favouring the other.

Equal starting values are an initial condition, not proof of balance. Use both outcome data and the events producing those outcomes to guide adjustments. Valve's published map-balance analysis illustrates this distinction between overall results and objective-level events. [17]

## How Squad is played

Squad's large multiplayer battles normally involve two teams of up to 50 players. Players organise into squads led by squad leaders and combine infantry, vehicles, reconnaissance, logistics, and support weapons. Communication and coordinated movement connect those roles to the objectives. [1]

Most competitive modes use a team ticket pool. Deaths and lost assets consume tickets; objectives can award tickets, impose losses, or cause continuous ticket drain. Consequently, a successful attack must be judged by the position gained and the resources spent. [3]

Reinforcement access is central to sustained combat. A rally point serves its squad, while a HAB spawn bunker at a forward operating base can serve the wider team. Supplies support these positions and ammunition needs. Losing nearby reinforcement access makes it much harder to maintain enough infantry at an objective. [2]

### Capturing an ordinary flag objective

A capture point is an area with a defined boundary. Entering its actual capture area displays its status and progress. An initial neutral objective can be captured by one player. An enemy-held objective normally requires at least three friendly players and a numerical advantage; enemy presence affects contested capture progress. An enemy-owned flag must first be neutralised and then captured for the attacking team. [4]

More friendly presence can speed capture, subject to the mode's rules. Capturing also requires that the point is currently eligible in the objective sequence. Merely reaching a later village does not make its flag capturable. [3][5]

### Objectives in each mode

| Mode | How objectives are taken | How the round is decided |
| --- | --- | --- |
| Advance and Secure — AAS | Both teams capture flags along a preset chain. The route is known at the start. Capture the next eligible point while retaining the preceding friendly point. | Reduce the opponent's tickets to zero. Flag gains affect tickets; advancing sufficiently far causes ticket drain. |
| Random Advance and Secure — RAAS | The same sequential capture principle, but the objective route is randomised. Under fog of war, later objectives are revealed as the team advances. | The same ticket-based contest as AAS, with more uncertainty about the route. |
| Invasion | One team attacks a sequence of objectives initially held by the defenders. A fully captured objective cannot be retaken by the defending team. | Attackers win by taking the last objective or exhausting defender tickets. Defenders win by exhausting attacker tickets or preventing completion before time expires. |
| Skirmish | In the redesigned mode, each side first takes its anchor point. Five further points can then be captured in any order. Taking all five unlocks the enemy anchor. | Holding more points causes ticket drain. Capturing the enemy anchor causes rapid ticket drain that ends the round quickly. |
| Territory Control — TC | Capture neighbouring hexagonal areas, expanding through territory connected to the team's anchor. Cutting the connection disrupts the opponent's ability to expand or contest isolated territory. | Territory control causes ticket drain; near-total territorial control can also end the round. |
| Insurgency | The attacking force searches for randomly positioned weapon caches. Intelligence earned through combat helps reveal targets. Destroy the required caches using the appropriate specialist equipment. | Attackers destroy the required caches; defenders prevent completion by exhausting attacker tickets or running out the clock. |
| Destruction | Attackers search marked areas for caches. Each phase contains two caches; destroying both unlocks a later phase. | Complete all phases before attacker tickets or time run out. |
| Fireteam | A separate five-player cooperative mode against AI. Objectives depend on the mission: destroying targets, hunting vehicles, clearing an area, or reaching extraction. | Complete the scenario's mission conditions rather than following a universal PvP flag chain. |

Sources: AAS [3]; RAAS [6]; Invasion [7]; Skirmish [8]; TC [9]; Insurgency [10]; Destruction [11]; Fireteam [12].

**AAS/RAAS defensive dependency.** An attack and the preceding defensive objective are linked. If both teams neutralise each other's forward defensive flags, neither can complete the next capture until its own defensive point is restored. This is the “double neutral” situation. A force already standing on the next point may need to return to defend. [13]

**Invasion resource pressure.** Attackers begin with a smaller ticket reserve than defenders and receive more tickets for successful captures. This encourages deliberate progress. Defenders must decide how long to contest the current point and when to prepare the next position. Exact ticket amounts depend on the current rules and layer. [7]

**Cache destruction is an equipment task.** Occupying a cache area does not complete it. In Insurgency, squad leader incendiaries or combat engineer charges can destroy caches. In Destruction, the objective requires the relevant engineer or sapper demolition charge. Protecting the specialist is part of the assault. [10][11]

**Seed and training.** Seed layers concentrate fighting into a small area while the server fills and can transition into live play. Shooting ranges support practice rather than a competitive objective contest. [14]

### What a coordinated objective attack involves

A useful attack sequence is: identify the active objective, secure a nearby reinforcement route, observe the approaches, establish supporting fire, move infantry through cover, remove defenders and their nearby reinforcement access, occupy the capture area, and prepare for the next counterattack.

Some of the force must maintain the defensive objective and logistics. Sending every available unit to the attack can lose the previous point and invalidate the advance. These are tactical recommendations derived from the objective and reinforcement systems.

## Proposed map structure for the strategy game

The map should support three scales of decisions at once:

| Scale | What the player decides | What the map must provide |
| --- | --- | --- |
| Region | Which settlement or route deserves the next commitment? | Distinct settlements, objective connections, transport routes, reserves, and meaningful separation. |
| Settlement | Which side of the village should be attacked or defended? | Several approaches, recognisable sectors, a useful street network, and places to assemble forces. |
| Local position | Where should infantry, support weapons, and vehicles move or stop? | Readable cover, firing positions, short crossings, flanking opportunities, and room to withdraw. |

### Region and objective network

Use the Leipalingis-area geography as the spatial reference: actual settlement relationships, road directions, woodland, open land, and water should inform the layout. Document any tactical compression. Do not imply that an invented example below is a surveyed local feature.

For an initial competitive prototype, use a manageable chain of roughly five to seven active objectives distributed among several distinct settlements and strategic sites. This is a proposed starting scope, not a Squad requirement. A village, road junction, bridge area, or supply compound can each justify an objective when controlling it changes movement or reinforcement options.

Give the region a connected network with loops. A primary road should provide efficient movement, while secondary roads and cross-country routes create different risks. A flank should meaningfully change the direction of an attack; two paths that merge at the same final bottleneck do not provide two independent approaches.

Keep visible transitions between settlements: outskirts, fields, wooded corridors, ridges, and transport links. These spaces should offer movement choices, observation, and opportunities to intercept logistics. Their travel time should be long enough to make redeployment matter while keeping transport useful and avoiding excessive empty travel.

For neutral objectives in a symmetric mode, compare practical arrival times for equivalent starting forces. Account for terrain, vehicle access, congestion, exposure, and dismounting, rather than comparing straight-line distances.

### Structure of a competitive village

A village should read as an inhabited place with a centre, streets, properties, access points, and a relationship to the surrounding countryside.

| Village element | Proposed structure | Competitive purpose |
| --- | --- | --- |
| Recognisable centre | A square, civic building, junction, or compact group of important properties. | Gives the settlement an identity and a clear focal area. |
| Street network | One main street, connected secondary streets, and smaller paths through properties. | Supports both direct movement and tactical rotation. |
| Residential blocks | Small clusters of buildings with yards, walls, gardens, and gaps. | Creates local positions and a series of short engagements. |
| Working area | Farmyard, workshop, depot, or comparable location appropriate to the setting. | Provides an alternative foothold and useful vehicle access. |
| Outskirts | Scattered buildings, hedges, woodland edges, and open approaches. | Gives attackers room to stage and defenders forward observation positions. |
| Objective area | A clearly bounded block, courtyard, compound, or central sector. | Makes the required occupation legible and avoids capture from an unrelated road. |
| Rear access | A reserve route that can be threatened but is not exposed immediately to every attacker. | Allows reinforcement, withdrawal, and counterattack. |
| Landmark | A distinctive building, roofline, road bend, or terrain feature. | Supports orientation and concise location references. |

Give a medium-sized village at least two genuinely viable attack directions and a third situational approach where the terrain supports it. A useful prototype has:
- A direct road approach: fast and useful to vehicles, but exposed.
- A covered approach through woodland edges, gardens, or broken terrain: slower and suited to infantry.
- A wider flank through farmland or a secondary road: longer and capable of threatening reinforcement access.

These routes should create trade-offs. If the protected route is also the fastest, easiest, and least detectable, it will dominate play.

Divide larger settlements into understandable sectors such as an outer farm, residential block, central square, and rear depot. A small village may use a single objective covering several useful positions; a larger town may justify several objectives or a sector-based system. Avoid assigning a flag to every building.

### Sightlines, cover, and unit scale

Long views should exist where terrain justifies them, especially across open countryside. Break those views before one position can control all village entrances, the entire objective, and the opponent's reinforcement route at once. A strong hill or building needs a practical counter: a screened approach, another firing position, exposure to supporting weapons, or vulnerable access.

Separate hard cover from concealment consistently. Walls, buildings, and substantial terrain features should communicate protection; bushes and crops should communicate hiding. Cluster cover into readable local positions, with deliberate gaps that make movement a choice. This recommendation follows established level-design practice around cover, visibility, flanking, and retreat routes. [15]

Preserve consistent proportions between soldiers, vehicles, buildings, roads, and yards. Road clearance must be tested with the actual vehicles and turning behaviour. If two vehicles are intended to pass, their path should support that without repeated collision or reversing. Infantry routes and vehicle routes may overlap, but their access rules must be clear.

Because the current prototype has no building interiors, make streets, exterior positions, walls, courtyards, and building footprints provide the initial tactical structure. Interior fighting and multi-floor positions can be designed later when those systems exist.

### Spawns, reserves, and logistics

Protect main deployment areas and provide more than one viable departure route. A single enemy position should not be able to watch every exit. Stage starting forces outside settlement centres so deployment does not erase or overcrowd the places intended for combat.

Place forward reinforcement locations where they support an objective without automatically controlling its capture area. An attacker should be able to contest reinforcement access through a flank, and a defender should have opportunities to protect or replace it.

Avoid awarding a fully protected, instantly usable forward spawn for every captured point. That can turn one successful attack into an automatic chain of losses. Any such benefit needs a setup cost, delay, supply requirement, exposure, or another explicit balancing mechanism.

Separate the value of controlling an objective from the value of controlling the route to it. A road junction outside the capture zone can remain tactically important even without an objective marker.

## Proposed capture rules for the strategy game

These are recommendations for the project, not descriptions of Squad.

1. **Use a visible capture area.** The interface should show its boundary, ownership, progress, and why progress is stopped.
2. **Require eligible infantry presence.** Define the requirement using actual soldiers or configured combat strength, not the number of selected UI icons.
3. **Make defended capture contested.** Require a minimum eligible infantry strength and superiority over the enemy inside the zone. Equal eligible strength stalls capture; the stronger side can progress only when the objective is eligible. Use the same contribution rules for both teams.
4. **Keep the contest area bounded and searchable.** A hidden defender across the whole village should not be able to stall a small central objective indefinitely.
5. **Require sustained occupation.** A unit driving or running through the edge of the area should not instantly transfer control.
6. **Separate neutralisation from ownership.** Show the change from enemy control to neutral to friendly control.
7. **Apply the mode's connection rules.** An ineligible rear objective must not become capturable merely because units reached it.
8. **Keep vehicle and infantry roles complementary.** For the initial ruleset, vehicles support, transport, and interdict; infantry supplies capture presence.
9. **Make capture a commitment.** Units holding the area remain vulnerable to counterattack and need ammunition, reserves, and an available route out.
10. **Validate infantry contest rules in playtests.** Test against both lone-unit capture rushes and lone-defender stalls. Keep capture eligibility, infantry contribution, and the maximum capture-speed benefit explicit and consistent across objectives.

The desired assault sequence is: secure an approach, establish supporting positions, enter the objective area, clear the local defence, hold it, and prepare for a counterattack.

## How the map should change between modes

Use a shared terrain map with separately authored objective layouts and deployment rules.

| Mode | Proposed map-design emphasis |
| --- | --- |
| AAS | A readable chain, viable attacks from both directions, comparable opening access, and meaningful rotations between attack and defence. |
| RAAS | Several pre-tested objective chains. Randomise among validated layouts; do not choose arbitrary settlement combinations. |
| Invasion | Defensible but breachable positions, protected preparation space for attackers, viable fallback routes, and enough separation to prevent capturing the next point immediately. |
| Skirmish-style mode | A compact group of independently contestable objectives, several routes between them, and strong opportunities for local counterattacks. |
| Territory Control | A broad network of connected areas with more than one route toward critical territory. Make cutting a connection possible without making one tiny choke decide every round. |
| Cache modes | Target areas that reward searching and coordinated entry, plus safe-enough specialist access once the defence is beaten. A cache should not be vulnerable to effortless fire from outside the engagement area. |

The same village can play differently depending on its capture boundary, approach direction, neighbouring objectives, and reinforcement rules. Test those combinations separately.

## Prototype targets and acceptance checks

The numerical entries below are proposed first-test targets. They are not measured results or official standards.

| Check | Initial acceptance target |
| --- | --- |
| Opening arrival | On symmetric layouts with comparable starting units, practical arrival times to the first contested objective differ by no more than about 10%, unless another deliberate advantage offsets the difference. |
| Village approaches | At least two useful independent approaches; a third situational route where appropriate. |
| Main exits | At least two viable exits, with no single position covering both completely. |
| Strong positions | Every position dominating an objective has an accessible and meaningful counter. |
| Objective boundary | Readable at normal play zoom; does not include accidental capture pockets behind impassable geometry. |
| Capture interaction | A lone-unit rush cannot capture an organised defence; one isolated defender cannot automatically stall a much stronger eligible occupation. |
| Reinforcement timing | A defender can attempt a counterattack before losing several objectives to an uninterrupted rush. |
| Road function | Vehicles can follow intended routes, pass where intended, turn at junctions, and reach staging areas. |
| Information | The AI and player follow the same visibility and capture eligibility rules in competitive scenarios. |
| Random layouts | Every permitted RAAS-style chain passes the same route, timing, spawn, and objective checks. |
| Readability | Units, cover, routes, and objective states remain clear with the intended competitive graphics settings. |
| Performance | The busiest settlement remains responsive at the planned maximum unit count. Set a measurable frame-time target once the target hardware is chosen. |

Build a simple playable layout first, test movement and combat, and add visual detail after the layout works. Squad's former lead level designer describes a similar process of blocking out structures, movement, visibility, cover, landscape, and foliage before final art. [16]

Record objective capture times, casualties and asset losses, arrival times, commonly used routes, unused routes, spawn pressure, congestion, and results after swapping sides. Use those observations to explain an imbalance before changing scenery or resource counts.

## Sources and project context

Rules checked against the following material on 28 October 2026. Mode availability and exact values can differ by layer, server configuration, and later updates.

1. [Squad official website — scale and core gameplay](https://www.joinsquad.com/)
2. [Official Squad Wiki — Spawn points](https://squad.fandom.com/wiki/Spawn_points)
3. [Official Squad Wiki — Advance and Secure](https://squad.fandom.com/wiki/Advance_and_Secure)
4. [Official Squad Wiki — Control Point](https://squad.fandom.com/wiki/Control_Point)
5. [Offworld — Squad 8.1 release notes, capture speed changes](https://www.joinsquad.com/updates/squad-8-1-release-notes)
6. [Expanded Squad Field Manual — RAAS](https://expanded-squad-field-manual.github.io/expanded-squad-field-manual/gamemodes/raas.html)
7. [Official Squad Wiki — Invasion](https://squad.fandom.com/wiki/Invasion), with [Expanded Squad Field Manual — Invasion](https://expanded-squad-field-manual.github.io/expanded-squad-field-manual/gamemodes/invasion.html) for victory conditions.
8. [Offworld — Squad 9.0 release notes, redesigned Skirmish](https://www.joinsquad.com/updates/squad-9-0-release-notes)
9. [Official Squad Wiki — Territory Control](https://squad.fandom.com/wiki/Territory_Control)
10. [Official Squad Wiki — Insurgency](https://squad.fandom.com/wiki/Insurgency)
11. [Official Squad Wiki — Destruction](https://squad.fandom.com/wiki/Destruction)
12. [Offworld — Fireteam announcement and mission structure](https://www.joinsquad.com/updates/fireteam-a-brand-new-pve-game-mode-for-squad)
13. [Squad Early Access manual — AAS sequence and double neutral](https://cdn.akamai.steamstatic.com/steam/apps/393380/manuals/Squad_EA-Manual_1_0.pdf?t=1450454625), used only for the sequence example, not historical numeric values.
14. [Offworld Steam announcement — Seed overhaul](https://store.steampowered.com/news/posts/?appids=393380&enddate=1655316029&feed=steam_community_announcements)
15. [Michael Barclay — My Level Design Guidelines](https://mikebarclay.co.uk/my-level-design-guidelines/), used for general cover and readability principles; the proposed map requirements are this brief's recommendations.
16. [Tim Head — Level Design Workflow on Squad](https://timhead.artstation.com/projects/3EY8l2)
17. [Valve — Map Data](https://blog.counter-strike.net/?s=map), historical developer discussion of side outcomes and objective events; used as a testing-method reference, not a claim about current Counter-Strike balance.

Project context: `docs/game-direction.md` inside the supplied `changed-files.zip`, including the agreed settlement direction, map expansion target, current abstraction limits, and open capture-balance question.

