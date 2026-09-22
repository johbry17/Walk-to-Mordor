# The Walk to Mordor
### *Two Books. Three Walks. 4,400 Miles.*

An interactive visualization of real-world walking data mapped onto three fictional journeys through Middle-earth: Bilbo's journey in *The Hobbit*, Frodo's road to Mordor, and Aragorn's return in *The Return of the King*. The project connects two years of personal walking history to Tolkien's chronology through a dual-clock interactive map — advancing either through real-world dates or through the Shire Calendar.

**Project Links**&nbsp;&nbsp;
[Live Visualization](https://johbry17.github.io/walk-to-mordor/)&nbsp;&nbsp;
[GitHub Repository](https://github.com/johbry17/walk-to-mordor)

---

I completed all three journeys as virtual walking challenges through [The Conqueror](https://www.theconqueror.events/), logging steps via Google Fit from March 2024 through June 2026. I'd been a Tolkien nerd long before I became a data person, and there was something appealing about the idea that my daily walks — commutes, errands, weekend rambles — were quietly adding up into something a little more epic. The question was how to make that visible without flattening it into a progress bar.

The problem turned out to be more interesting than I expected.

## Project Overview

The challenge wasn't simply plotting miles on a map. My actual walking data lives in real-world calendar time. Tolkien's journeys live in the Shire Calendar. The fictional mileage framework comes from The Conqueror's route structure. The visual route geometry exists on a fan-made SVG map. And the narrative events — Rivendell, the Bridge of Khazad-dûm, the Paths of the Dead — are anchored to Tolkien's dated chronology.

Each of those is a separate system. Making them cohere required separating them first.

The visualization supports two independent time modes. **My Time** moves through real-world dates: each day's actual walking distance advances the character's position on the map. Walk more, move faster. **Middle-earth Time** moves through the Shire Calendar: character position is interpolated across Tolkien's known chronology, independent of my actual walking pace. In Middle-earth Time, Frodo and Aragorn are both active on screen simultaneously during the final weeks of T.A. 3019 — which is exactly how it reads in the books.

Both modes resolve to the same output and drive the same map renderer. The clock is swappable; the route geometry doesn't know which one is running.

Across the full project window: 5,196 miles walked over 806 days. All three challenges exceeded their Conqueror targets.

| Character | Period | Target | Miles Walked |
|---|---|---|---|
| Frodo | Mar 2024 – Jan 2025 | 1,815 mi | 1,823 mi |
| Aragorn | Jan 2025 – Aug 2025 | 1,482 mi | 1,494 mi |
| Bilbo | Jan 2026 – Jun 2026 | 1,100 mi | 1,148 mi |

## Technical Approach

**Custom calendar construction.** Python's `datetime` module doesn't handle the Shire Calendar: every month has exactly 30 days, and special intercalary days (Lithe, Midyear's Day, Yule, and Overlithe in leap years) sit outside the regular month structure. I implemented the calendar from scratch in Python with an absolute ordinal system, so Middle-earth dates could be compared, sorted, and interpolated the same way real dates are. Named special days and conventional date strings both convert to ordinals during preprocessing.

**Temporal modeling.** The Conqueror provides total journey mileage and named milestones. Tolkien's appendices provide dated narrative events. Neither provides a continuous daily record. I built a human-curated anchor file — `me-time-anchors.csv` — that records known Shire dates, cumulative mileage values, place names, and a confidence level for each anchor. Between anchors, mileage is distributed linearly across the relevant calendar days. Rest stops produce zero-movement intervals. The result is a modeled approximation of movement, not a claim about canonical distances.

**Geospatial visualization.** The base map is a fan-made SVG of Middle-earth (mapome, CC BY-SA 4.0) layered with a same-viewbox SVG overlay for route drawing. Each route in `routes.json` has two structures: a dense array of hand-traced geometry points, and a sparse set of calibration anchors linking fictional mileage values to specific geometry indices. A custom `_resolve()` function converts cumulative fictional miles to an exact SVG position by interpolating through the dense geometry — the marker follows every bend of the path rather than cutting straight between anchors. `stroke-dashoffset` reveals the completed route progressively as the slider advances.

**Route builder.** The route geometry doesn't exist anywhere in publishable form. I built a custom interactive tool (`archive/tools/route-builder.html`) to trace it: click to add geometry points, switch modes to assign mileage anchors to specific points, zoom and pan the map, export JSON. All three routes were traced over multiple sessions with this tool.

**Interaction design.** The finished interface includes journey selection, My Time / Middle-earth Time toggle, timeline scrubbing, autoplay at adjustable speed, previous/next step navigation, zoom/pan with mouse and touch/pinch support, a floating info panel with current location and narrative event text, and a responsive mobile layout. No frameworks — vanilla HTML, CSS, and JavaScript.

## Gallery

![Default view: all journeys, Frodo at Day 1](resources/images/map_start.png)
*Default view: Frodo departing Bag End on March 27, 2024. The info panel shows the first narrative event.*

![Frodo in Middle-earth Time, Moria region](resources/images/map_moria.png)
*Frodo's journey in Middle-earth Time: Bridge of Khazad-dûm. The badge marks a challenge rest period mapped to the month-long lament for Gandalf.*

![Frodo and Aragorn converging near Mordor](resources/images/map_mordor.png)
*Middle-earth Time, T.A. 3019: Frodo and Aragorn simultaneously active, with concurrent narrative events in the info panel.*

![Aragorn in Rohan](resources/images/map_rohan.png)
*Aragorn filtered solo, My Time: June 2025, Paths of the Dead.*

![Bilbo in Mirkwood, Middle-earth Time](resources/images/map_hobbit.png)
*Bilbo's journey in Middle-earth Time: T.A. 2941, escaping the Wood-elves at Elvenking's Halls.*

![Mobile layout](resources/images/map_mobile.png)
*Responsive mobile layout: the map fills the viewport with the info panel below.*

![Cumulative walking distance — 5,196 miles](resources/images/cumulative_walking.png)
*Real-world walking context: 5,196 miles across the full project window, with challenge segments colored by character.*

## References

- [The Conqueror](https://www.theconqueror.events/) — virtual walking challenge platform; source of journey mileage structure
- [mapome](https://github.com/k1tesurfen/mapome) by k1tesurfen — Middle-earth SVG base map, CC BY-SA 4.0
- *The Hobbit* and *The Lord of the Rings* by J.R.R. Tolkien (including appendices) — chronology, narrative events, place names
- [Google Fit](https://www.google.com/fit/) — personal walking data source

> **Note:** The project brief mentions Karen Wynn Fonstad's *Atlas of Middle-earth* as a possible secondary reference. Please confirm whether this source was consulted, and add a credit if appropriate.

This project is non-commercial. It is not affiliated with the Tolkien Estate, HarperCollins, The Conqueror, or any other rights holder.

---

Bryan Johns, 2026  
[bryan.johns@informedwanderer.com](mailto:bryan.johns@informedwanderer.com) | [LinkedIn](https://www.linkedin.com/in/b-johns/) | [GitHub](https://github.com/johbry17) | [Portfolio](https://informedwanderer.com)  
— Fluent in Data. Fluent in Human.
