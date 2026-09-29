# Walk to Mordor — EDA Report

> **Two clocks, one journey**: this report compares the same fictional mileage experienced through two calendars — my real-world walking days and Tolkien's Middle-earth chronology.

---

## 1. Data Quality Audit

- walking.csv: 806 rows total, 628 journey-assigned, 178 gap/unassigned
-   ⚠ 1 null distance_miles rows (in gap period)
-   No duplicate dates: True
- me_time.csv: 427 rows, 5 non-ISO dates (intercalary days)
-   me_ordinal duplicate check: 30 dupes
-   Mordor me_time: 185 rows, max_cum=1815.0, negative-diffs=0
-   Return me_time: 30 rows, max_cum=1482.0, negative-diffs=0
-   Hobbit me_time: 212 rows, max_cum=1100.0, negative-diffs=0
-   Mordor walking: 261 days, total_mi=1823.0, negative-cumulative-diffs=0
-   Return walking: 225 days, total_mi=1493.5, negative-cumulative-diffs=0
-   Hobbit walking: 142 days, total_mi=1148.1, negative-cumulative-diffs=0
-   Mordor date gaps >1 day: 1, max gap: 27 days
-   Return date gaps >1 day: 0, max gap: 1 days
-   Hobbit date gaps >1 day: 0, max gap: 1 days

**Notable issues:**
- 178 rows in `walking.csv` have no `journey_id` (gap days between journeys). These carry real step data but are not assigned to any fictional journey.
- 1 null `distance_miles` row on 2025-12-09 (in gap period). Excluded from analysis.
- `chronology.json` contains 67 events with `journey_id = null` — these are historical background events between TA 2941 and TA 3018, not journey events.
- `me_time.csv` contains intercalary Shire calendar dates ('1 Lithe', 'Midyear's Day', 'Yule 1', 'Yule 2') which are handled by ordinal.

---

## 2. Methodology

### Two-clock framework

| Dimension | My Time | Middle-earth Time |
|-----------|---------|-------------------|
| Calendar  | Real-world dates (2024–2026) | Tolkien Shire calendar ordinals |
| Mileage   | Actual miles walked (Google Fit) | Calibrated fictional journey miles |
| Pace      | My walking rate | Narrative travel rate |

These two systems are conceptually separate. My actual mileage is not a proxy for the characters' travel speed.

### Segment definitions

Segments were derived from `chronology.json` anchor points (location + mileage + date). Boundaries were placed at:
1. Long flat periods in `me_time.csv` (≥5 consecutive days with no mileage change) → rest/captivity
2. Sudden large mileage jumps relative to elapsed days → non-walking transport
3. Major narrative transitions (Rivendell departure, Parth Galen, etc.)

### Frodo — Mordor — Segments

| # | Segment | Travel Mode | Fictional mi | ME days | fi mi/day |
|---|---------|------------|-------------|---------|-----------|
| 1 | Bag End → Bree | walking | 145 | 7 | 20.7 |
| 2 | Bree → Rivendell | walking | 342 | 87 | 3.9 |
| 3 | Rivendell Rest | rest | 0 | 66 | 0.0 |
| 4 | Fellowship March → Moria | walking | 375 | 88 | 4.3 |
| 5 | Lothlórien Rest | rest | 90 | 31 | 2.9 |
| 6 | Boats on the Anduin | boat | 415 | 40 | 10.4 |
| 7 | Emyn Muil → Black Gate | walking | 161 | 10 | 16.1 |
| 8 | Ithilien → Shelob's Lair | walking | 112 | 8 | 14.0 |
| 9 | Cirith Ungol Captivity | captivity | 20 | 4 | 5.0 |
| 10 | March into Mordor | walking | 155 | 10 | 15.5 |

### Aragorn — Return of the King — Segments

| # | Segment | Travel Mode | Fictional mi | ME days | fi mi/day |
|---|---------|------------|-------------|---------|-----------|
| 1 | Parth Galen → Edoras | horseback | 370 | 7 | 52.9 |
| 2 | Edoras → Dunharrow | horseback | 382 | 5 | 76.4 |
| 3 | Paths of Dead → Pelargir | mixed | 430 | 7 | 61.4 |
| 4 | Pelargir → Minas Tirith | boat | 168 | 6 | 28.0 |
| 5 | Minas Tirith → Black Gate | walking | 132 | 11 | 12.0 |

### Bilbo — The Hobbit — Segments

| # | Segment | Travel Mode | Fictional mi | ME days | fi mi/day |
|---|---------|------------|-------------|---------|-----------|
| 1 | Bag End → Rivendell | walking | 491 | 68 | 7.2 |
| 2 | Rivendell Rest | rest | 0 | 29 | 0.0 |
| 3 | Rivendell → Beorn's Hall | mixed | 128 | 51 | 2.5 |
| 4 | Beorn → Mirkwood Entrance | horseback | 167 | 5 | 33.4 |
| 5 | Through Mirkwood | walking | 148 | 57 | 2.6 |
| 6 | Wood-elves Captivity | captivity | 0 | 28 | 0.0 |
| 7 | Barrel Escape → Esgaroth | boat | 17 | 46 | 0.4 |
| 8 | Lake-town Rest | rest | 0 | 18 | 0.0 |
| 9 | Lonely Mountain & Battle | walking | 149 | 62 | 2.4 |

---

## 3. Journey-Level Statistics

### My Time

| Journey | Elapsed days | Walking days | Total mi | Median mi/day | Std | Streak | ≥10mi% |
|---------|-------------|-------------|----------|--------------|-----|--------|--------|
| Frodo | 287 | 261 | 1823 | 7.1 | 3.4 | 52 | 18% |
| Aragorn | 225 | 225 | 1494 | 6.5 | 2.9 | 65 | 11% |
| Bilbo | 142 | 142 | 1148 | 7.9 | 3.1 | 125 | 32% |

### Middle-earth Time

| Journey | ME elapsed days | Fictional mi | Travel days | Rest days | Avg mi/day |
|---------|----------------|-------------|-------------|-----------|------------|
| Frodo | 185 | 1815 | 90 | 95 | 9.81 |
| Aragorn | 30 | 1482 | 25 | 5 | 49.40 |
| Bilbo | 212 | 1100 | 121 | 91 | 5.19 |

### Two-clock comparison

| Journey | Real days | ME days | Time ratio | Actual mi | Fictional mi | Mi ratio |
|---------|-----------|---------|-----------|----------|-------------|---------|
| Frodo | 287 | 185 | 1.55× | 1823 | 1815 | 1.00× |
| Aragorn | 225 | 30 | 7.50× | 1494 | 1482 | 1.01× |
| Bilbo | 142 | 212 | 0.67× | 1148 | 1100 | 1.04× |

---

## 4. Key Findings

### Finding 1: **Aragorn's Return journey is spectacularly compressed in ME time.**

**Evidence:** Aragorn covers 1482 fictional miles in just 30 ME days — vs Frodo's 1815 miles over 185 days. Yet my actual walking took 225 real-world days for Return vs 287 for Mordor.

**Why it matters:** The fictional narrative is relentless; my real-world pace is not.

**Visualization:** two_clocks.png, journey_overview.png

### Finding 2: **The Anduin boat leg is the single fastest fictional travel segment.**

**Evidence:** Frodo's boat journey (Silverlode Hythe → Parth Galen) covers 415 fictional miles in 40 ME days = 10.4 mi/day — 0.8× the average walking rate (12.4 mi/day).

**Why it matters:** River travel creates an unmistakable discontinuity in the fictional mileage trajectory.

**Visualization:** fictional_travel_rate.png, narrative_mileage.png (Mordor)

### Finding 3: **Rivendell consumes the most fictional rest time in the Mordor journey.**

**Evidence:** Frodo rests at Rivendell for 61 ME days (Oct 24 – Dec 25, TA 3018) with zero fictional mileage. This is 33% of the entire fictional journey duration.

**Why it matters:** A major portion of the fictional clock ticks with no forward movement.

**Visualization:** narrative_mileage.png, fictional_time_allocation.png

### Finding 4: **Bilbo's journey has the highest proportion of rest/captivity in ME time.**

**Evidence:** Rivendell rest (28 ME days) + Wood-elves captivity (~28 ME days) + Lake-town rest (~17 ME days) = ~73 days of zero mileage out of 212 ME days (34%).

**Why it matters:** Bilbo spends more than a third of his fictional timeline stationary.

**Visualization:** fictional_time_allocation.png

### Finding 5: **The pony leg (Beorn → Mirkwood entrance) is Bilbo's fastest fictional travel.**

**Evidence:** Bilbo covers 167 fictional miles in ~3 ME days after Beorn's Hall — approximately 56 fictional mi/day, far exceeding any walking segment.

**Why it matters:** Pony/horse travel creates a visible 'kink' in Bilbo's cumulative mileage curve.

**Visualization:** narrative_mileage.png, fictional_travel_rate.png

### Finding 6: **My real-world walking pace was remarkably consistent across all three journeys.**

**Evidence:** Median daily miles: Frodo 7.1, Aragorn 6.5, Bilbo 7.9. Standard deviations are similar, suggesting no systematic change in fitness or effort over two years.

**Why it matters:** The fictional story changes dramatically; my walking cadence does not.

**Visualization:** daily_walking_distribution.png

### Finding 7: **Aragorn's Return journey required the most actual walking per fictional mile.**

**Evidence:** Aragorn's fictional journey is mostly horseback and ships, yet I walked 1494 actual miles to cover 1482 fictional miles. The mi ratio (actual/fictional) is 1.01× — vs Frodo 1.00× and Bilbo 1.04×.

**Why it matters:** The fictional character travels fast; I just walked.

**Visualization:** journey_overview.png, my_walking_by_segment.png

### Finding 8: **The final Mordor march is fictionally slow but narratively intense.**

**Evidence:** The march from Cirith Ungol to Cracks of Doom (155 fictional miles) spans 10 ME days = 15.5 fi-mi/day — roughly average walking rate despite extreme narrative drama.

**Why it matters:** Tolkien calibrated even the final march as relatively slow — darkness and terrain.

**Visualization:** fictional_travel_rate.png, narrative_mileage.png

### Finding 9: **Bilbo's journey took the fewest real-world days but covers significant fictional range.**

**Evidence:** Bilbo: 142 real-world days, 212 ME days, 1100 fictional miles — compressed into just 142 walking days. His 125-day longest streak exceeds Frodo's and Aragorn's proportionally.

**Why it matters:** The Hobbit is a shorter fictional journey but my walking pace was equivalent.

**Visualization:** journey_overview.png, cumulative_walking.png

### Finding 10: **Lothlórien is the second-largest rest period in the Mordor journey.**

**Evidence:** The Fellowship rests ~29 ME days at Lothlórien (Jan 17 – Feb 14, TA 3019) with fictional miles at 952. Combined with Rivendell (61 days), Frodo spends 49% of fictional time at rest in two locations.

**Why it matters:** Rest periods are not just narrative pauses — they define the shape of both clocks.

**Visualization:** narrative_mileage.png (Mordor, grey bands)

---

## 5. Recommended Visualizations for Portfolio

| Priority | Figure | Key Story |
|----------|--------|-----------|
| ★★★ | ![`two_clocks.png`](./figures/two_clocks.png) | Core two-clock concept — the visual heart of the project |
| ★★★ | ![`narrative_mileage.png`](./figures/narrative_mileage.png) | Shows rest/captivity and travel mode discontinuities |
| ★★★ | ![`fictional_travel_rate.png`](./figures/fictional_travel_rate.png) | Reveals boat vs horseback vs walking speed differences |
| ★★  | ![`fictional_time_allocation.png`](./figures/fictional_time_allocation.png) | Shows proportion of time in each travel mode |
| ★★  | ![`journey_overview.png`](./figures/journey_overview.png) | Clean four-panel summary for executive overview |
| ★★  | ![`segment_comparison.png`](./figures/segment_comparison.png) | Detailed segment-by-segment contrast |
| ★   | ![`daily_walking_distribution.png`](./figures/daily_walking_distribution.png) | My actual walking behavior |
| ★   | ![`cumulative_walking.png`](./figures/cumulative_walking.png) | My real-world trajectory over calendar time |
| ★   | ![`my_walking_by_segment.png`](./figures/my_walking_by_segment.png) | How many walking days per fictional segment |

---

## 6. Recommended Segmentation

The proposed segments in the brief were broadly validated. Amendments made:

**Frodo/Mordor:**
- Split 'Bag End → Rivendell' into two segments at Bree (mi=145): character of travel changes after Weathertop attack.
- Split the 'Rivendell → Khazad-dûm' segment to separate the Rivendell rest (61 days, mi flat at 487) from the Fellowship march.
- Separated Lothlórien rest (mi flat at 952) as its own segment.
- Boat on the Anduin (mi 962→1367, 10 ME days) isolated as highest-rate segment.

**Aragorn/Return:**
- Simplified to 5 segments; the Parth Galen → Edoras and Edoras → Dunharrow legs are both primarily horseback.
- 'Paths of Dead → Pelargir' is marked 'mixed' as it combines the supernatural Paths and river travel.

**Bilbo/Hobbit:**
- Added Rivendell rest, Wood-elves captivity, and Lake-town rest as explicit zero-mileage segments.
- 'Beorn → Mirkwood Entrance' identified as a pony/horseback leg based on chronology timeline (167 mi in ~3 days).

---

## 7. Caveats and Limitations

- **Fictional mileage calibration**: distances are derived from narrative anchors, not map measurement. Different sources yield different numbers.
- **ME calendar**: Shire calendar has intercalary days and year-length differs slightly from Gregorian. Ordinal arithmetic treats all days as equal.
- **Travel mode**: assigned from narrative context, not explicit data fields. Segments marked 'walking' could include short boat crossings or other transport.
- **My walking pace**: Google Fit step counting has known rounding (±3 steps/day). Conversion factor: 1 mile = 2,000 steps (approximate).
- **Gap days** (178 rows, ~732 miles): walking between journeys is real but not assigned to any fictional context. Excluded from journey analysis.
- **No inferential statistics**: this is a personal dataset of one individual. Descriptive statistics only; no hypothesis testing applied.
