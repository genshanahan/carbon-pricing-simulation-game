---
modified_date: 2026-04-17
created_date: 2026-04-15
---
# The Carbon Pricing Simulation Game

An interactive classroom simulation of five carbon regulation regimes — from free markets to cap and trade — designed for sustainability and business education.

**[Try the solo demo](https://genshanahan.github.io/carbon-pricing-game/solo.html)** — no setup required. Play through all five regimes against AI firms in your browser.

**[Launch the facilitated version](https://genshanahan.github.io/carbon-pricing-game/)** — requires a free Firebase project for real-time sync between devices. See [SETUP.md](SETUP.md) for instructions.

## Why this game exists

Students on sustainability and business courses need to understand the orthodox economic logic behind carbon pricing before they can critically appraise it. But the underlying concepts — externalities, deadweight loss, permit markets, Pigouvian taxation — are abstract and difficult to internalise from readings alone. Students who cannot articulate *why* mainstream economists advocate carbon pricing are poorly equipped to engage with the critical perspectives that problematise it.

This game addresses that gap. It walks students through five regulatory regimes using identical production arithmetic: each unit costs $1 to produce, sells for $2, and generates CO₂ emissions. The *only* thing that changes from regime to regime is the regulatory rule. Students feel each mechanism's logic directly — how the rule shapes incentives, redistributes costs, and determines whether the atmosphere survives.

**The game deliberately encodes neoclassical economic orthodoxy.** It models the textbook story — market failure, command-and-control inefficiency, Pigouvian tax, Coasean permit trading — cleanly and simply. This is by design. The game provides the scaffolding students need to grasp the orthodox perspective, which in turn equips them to engage meaningfully with critical perspectives on carbon pricing (distributional justice, regulatory capture, political feasibility) through structured debriefs after each regime.

## What students experience

The session progresses through five regulatory regimes. Capital, costs, and revenue are reset at the start of each regime; the only variable is the rule.

1. **Free Market** — No regulation. Firms compete to maximise profit. The historical pattern: rational profit-maximisation destroys the commons. Students articulate in their own words why unregulated prices fail to reflect the true costs of production.

2. **Command and Control** — A uniform production cap per firm. The atmosphere survives, but the flat cap wastes productive capacity. Students see the deadweight loss that motivates the efficiency critique behind market-based alternatives.

3. **Carbon Tax** — A per-unit tax on emissions replaces the cap. Clean technology (limited slots, sunk investment) halves a firm's emissions and effective tax rate, introducing firm heterogeneity. Price signals redirect behaviour, but create winners and losers. Students confront the distributional consequences of incentive-based regulation.

4. **Cap** — The tax is removed. The regulator issues a fixed number of emissions permits. Clean-tech firms can produce more per permit. Students experience the rigidity of a fixed allocation — some firms are permit-constrained while others have capacity to spare.

5. **Cap and Trade** — Same permit mechanics, but firms may now buy and sell permits through bilateral negotiation. Permits flow to the highest-value users, and a market price emerges. Students see how trade reallocates emissions rights and discover the price the market produces.

## Learning outcomes

By the end of the session, students will have experienced:

- **Market failure** — how rational individual profit-maximisation can structurally produce collective harm (tragedy of the commons)
- **Regulatory trade-offs** — how different regulatory instruments balance environmental effectiveness, economic efficiency, and distributional fairness differently
- **Deadweight loss** — how uniform regulation can waste productive capacity, and why economists advocate price-based alternatives
- **Incentive alignment** — how carbon taxes and permit markets redirect firm behaviour through price signals rather than quantity mandates
- **Emergent market prices** — how bilateral permit trades produce a market price that reflects firms' underlying valuations
- **Firm heterogeneity** — how clean technology investment changes the competitive landscape under each regime, creating winners and losers
- **The scaffolding for critical appraisal** — a concrete, experience-based understanding of the orthodox economic case for carbon pricing, equipping students to engage with critiques of carbon markets, questions of distributional justice, and the political feasibility of regulatory design

## How to use it

### Facilitated mode (classroom)

The primary mode. A facilitator projects the host view on a classroom screen; students join on their phones by scanning a QR code or entering a room code. The facilitator drives the game through the five regimes, entering production decisions and processing rounds. Students see regime rules, use built-in calculators to plan strategy, and submit decisions from their devices. Real-time sync is handled by Firebase Realtime Database (free tier).

**Duration:** ~90 minutes (game + debriefs), though this varies with class size and discussion depth.

**Class size:** Designed for 3–8 firms of 2–3 students each. The facilitator can adjust the number of firms and rounds per regime at game creation.

**Setup:** You will need a free Firebase project for multi-device sync. See **[SETUP.md](SETUP.md)** for step-by-step instructions.

### Solo mode (self-study)

Open **[solo.html](https://genshanahan.github.io/carbon-pricing-game/solo.html)** in any browser. No Firebase, no room code, no other players needed. You play as one firm alongside AI opponents that pursue profit-maximising strategies. Suitable for:

- Educators previewing the game before running it in class
- Students preparing before a facilitated session
- Individual learners exploring carbon pricing concepts independently

## Adapts and extends

This game adapts and extends three prior educational simulations:

- **The Thingamabob Game** — Bigelow, B. (2015). The Thingamabob Game: A simulation on capitalism vs. the climate. In B. Bigelow & T. Swinehart (Eds.), *A people's curriculum for the earth: Teaching climate change and the environmental crisis*. Milwaukee, WI: Rethinking Schools. [PDF](https://hrwstf.org/wp-content/uploads/2025/08/thingamabob-game-capitalism-climate.pdf)

- **The Carbon Emissions Game** — Sethi, G. (2017). The Carbon Emissions Game. SERC InTeGrate. [Link](https://serc.carleton.edu/integrate/teaching_materials/carbon_emissions/unit6.html)

- **The Pollution Game** — Corrigan, J. R. (2011). The Pollution Game: A classroom game demonstrating the relative effectiveness of emissions taxes and tradable permits. *The Journal of Economic Education*, 42(1), 70–78. [doi:10.1080/00220485.2011.536491](https://doi.org/10.1080/00220485.2011.536491)

The key adaptation is simplification: the game strips out continuous marginal abatement cost curves in favour of a binary clean-technology toggle, keeping the arithmetic accessible to students without economics training while preserving the structural dynamics of each regulatory regime.

## How to cite

> Shanahan, G. (2026). *The Carbon Pricing Simulation Game* [Web application]. Cardiff Business School, Cardiff University. Available at: https://github.com/genshanahan/carbon-pricing-game

## Licence

This project is released under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)). See the [`LICENSE`](LICENSE) file for details.

You are free to adapt and share this game for non-commercial educational purposes, provided you give appropriate credit and distribute any adaptations under the same licence.

## Contributing and feedback

Suggestions, bug reports, and pull requests are welcome. Please [open an issue](https://github.com/genshanahan/carbon-pricing-game/issues) or get in touch.
