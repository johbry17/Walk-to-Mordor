# The Walk to Mordor
### *Three Journeys. One Walker. Two Clocks.*

An interactive data-storytelling project mapping 5,196 miles of real-world walking onto three fictional journeys through Middle-earth. Explore the same routes through two independent timelines: the dates I actually walked, and the dates Tolkien's characters did.

**Project Links**

[Live Visualization](https://johbry17.github.io/Walk-to-Mordor/) &nbsp;·&nbsp;
[About the Project](https://johbry17.github.io/Walk-to-Mordor/static/about) &nbsp;·&nbsp;
[EDA: The Walking Data](https://johbry17.github.io/Walk-to-Mordor/static/eda-walking-data.html) &nbsp;·&nbsp;
[EDA: Two Clocks](https://johbry17.github.io/Walk-to-Mordor/static/eda-two-clocks.html) &nbsp;·&nbsp;
[GitHub Repository](https://github.com/johbry17/Walk-to-Mordor)

---

I grew up reading Tolkien — certified hobbit nerd, can quote *The Silmarillion*, pretty sure my mom was reading it before I was born. I first walked to Mordor to cope with the pandemic. The books gave me something to hold onto: a symbol for doing long, hard things without knowing the outcome, a metaphor for perseverance without any guarantee of success. Giving The Conqueror money to gamify my second walk and mail me shiny medals was a no-brainer. Three hobbit walks, two years, and roughly enough miles to cover the Silk Road later, I had a pile of data and an obvious question. I'm a data nerd. Of course I was going to build something.

## Project Overview

Between March 2024 and June 2026, I completed three virtual walking challenges through [The Conqueror](https://www.theconqueror.events/): Frodo's Walk to Mordor, Aragorn's Return of the King, and Bilbo's journey to the Lonely Mountain. Google Fit logged my steps. Across the full two-year window — including gap periods between challenges — I walked **5,196 miles over 806 days**. All three challenges exceeded their targets.

The central design problem was that the project crosses four independent systems: my real-world calendar, the Shire Calendar, The Conqueror's fictional mileage framework, and the geographic geometry of a fan-made SVG map. None of them speak the same language. Making them cohere required holding them apart first, so each layer could be queried independently by the visualization.

**My Time** advances through real-world dates: each day's recorded walking pushes the character forward by exactly that distance. **Middle-earth Time** advances through Tolkien's chronology — reconstructed from dated events and narrative anchors in the appendices, entirely independent of my walking pace. Both clocks drive the same map renderer. What differs is the shape of movement they produce.

That contrast turned out to be the most interesting finding. Aragorn's 1,482-mile journey spans 225 calendar days in my walking data but just 30 days in Middle-earth Time — a **7.5× divergence**. He had a horse. Frodo's ratio is a more modest 1.55×. Bilbo inverts the pattern entirely: his fictional timeline runs 212 Middle-earth days while I walked the same mileage in only 142 days. I walked faster than Bilbo. Meanwhile, Frodo's fictional mileage stands still for 95 of his 185 Middle-earth days — long rests at Rivendell and Lothlórien — while my real walking continued without pause. The two clocks were simply tracking different things.

The walking data has a story of its own. The habit never stopped: not during a 27-day challenge pause, not during the 147-day inter-journey gap when I accumulated 730+ miles with no active challenge. 90.3% of the 806 project days exceeded 2 miles. The longest unbroken streak ran 125 consecutive days through the entire Bilbo challenge.

**Tools & Technologies:** Python · Pandas · NumPy · Matplotlib · JavaScript · SVG · HTML/CSS · GitHub Pages · Google Fit · The Conqueror

## Gallery

![Middle-earth Time showing Frodo near Mordor and Aragorn at Minas Tirith simultaneously in T.A. 3019, with both characters' active routes and narrative event panels visible](images/map_mordor.png)
*Middle-earth Time, T.A. 3019: Frodo escaping the Tower of Cirith Ungol while Aragorn reaches Minas Tirith. Both journeys are active on screen simultaneously during the final weeks of the War of the Ring — the visualization's most distinctive moment.*

---

![Interactive map view showing Aragorn's route through Rohan with the info panel displaying "Paths of the Dead" and cumulative mileage of 824 miles](images/map_rohan.png)
*Aragorn, My Time, June 3, 2025: the Paths of the Dead. The info panel shows the current location, cumulative miles, and Tolkien's narrative event. The revealed route traces everything walked so far.*

---

![Interactive map view showing Bilbo's route through Mirkwood toward the Lonely Mountain with the Middle-earth Time slider showing September T.A. 2941](images/map_hobbit.png)
*Bilbo, Middle-earth Time: September T.A. 2941, escaping the Elvenking's Halls near the Lonely Mountain. Bilbo's journey runs on its own Shire Calendar, 78 years before Frodo and Aragorn's.*

---

![Three line charts comparing cumulative walking distance over time in My Time versus Middle-earth Time for Frodo, Aragorn, and Bilbo; My Time rises steadily while Middle-earth Time includes long flat plateaus for rest periods](images/two_clocks.png)
*The same fictional mileage, read through two clocks. My Time rises steadily; Middle-earth Time shows long flat plateaus for Rivendell, Lothlórien, and the Wood-elves' captivity — periods when the fictional timeline stands still while real-world walking continued.*

---

![Line chart of cumulative walking miles from March 2024 to June 2026, colored by journey with Frodo in orange, Aragorn in teal, Bilbo in green, and gray gap periods between challenges, reaching 5,196 total miles](images/cumulative_walking.png)
*5,196 miles over 806 days. Grey segments show gap periods between challenges. The consistently steady slope across two years reflects a daily walking habit, not a challenge-driven burst.*

## References

- Tolkien, J.R.R. *The Hobbit*, *The Lord of the Rings* (including appendices), *Unfinished Tales*. Published by HarperCollins / Houghton Mifflin Harcourt.
- Fonstad, Karen Wynn. *The Atlas of Middle-earth*, revised edition. Consulted as a secondary reference for routes, locations, and geography.
- [mapome](https://github.com/k1tesurfen/mapome) by k1tesurfen — Middle-earth base map used for the visualization. Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- [The Conqueror](https://www.theconqueror.events/) — virtual walking challenge mileage and segment framework.
- [Google Fit](https://www.google.com/fit/) — source of personal walking data; only daily aggregate distances are published.

This project is independent, unofficial, and non-commercial. It is not affiliated with or endorsed by the Tolkien Estate, HarperCollins, Houghton Mifflin Harcourt, or The Conqueror. No claim is made to any intellectual property associated with Middle-earth or The Conqueror's challenge structure.
