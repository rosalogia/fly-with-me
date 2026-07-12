function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded border border-line bg-white p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">{title}</h2>
      {children}
    </section>
  )
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-40 shrink-0 font-mono text-xs font-semibold uppercase tracking-wider">{name}</dt>
      <dd className="text-ink-soft">{children}</dd>
    </div>
  )
}

export function AboutContent() {
  return (
    <div className="max-w-3xl space-y-4">
      <Section title="What this is">
        <p className="text-sm text-ink-soft">
          A group of friends in different US cities wants to fly to China <em>together</em> — on the
          same long-haul flights — without overpaying or wasting days in transit. This app searches
          real, bookable fares for every party, finds every combination of flights the whole group
          can share, and scores those options against what your money, time, and peace of mind are
          actually worth to you. Every search lives at its own link (<span className="font-mono">/t/…</span>),
          so the group can keep one shared search while anyone spins up their own variations.
        </p>
      </Section>

      <Section title="The approach">
        <ul className="list-inside list-disc space-y-1.5 text-sm text-ink-soft">
          <li>
            <strong>Search once, explore freely.</strong> One refresh sweeps every party, date pair,
            and airport combination, and caches the raw fares. Everything else — scoring, filtering,
            knob-twiddling — happens instantly on that cache and never re-fetches. The cache is
            shared <em>across</em> searches too: duplicating a search and tweaking it only pays for
            the queries that are actually new.
          </li>
          <li>
            <strong>Together = the same physical flights.</strong> An option only counts if every
            party holds a ticket containing the identical shared flights (matched by airline, flight
            number, and date) into and out of China.
          </li>
          <li>
            <strong>Everything is priced in dollars.</strong> Instead of an abstract score, each
            option gets a generalized cost: tickets + estimated hotel nights + a price on
            self-transfer risk + your time valued per hour + penalties for awful flight times. You
            set the exchange rates (the "fine-tune" knobs); the app does the arithmetic.
          </li>
          <li>
            <strong>Only differences are shown.</strong> The cheapest option under your knobs is the
            benchmark; every other option shows what picking it instead effectively costs
            ("vs best"). The ~60 unavoidable hours of travel cancel out of every comparison.
          </li>
          <li>
            <strong>The alternative is always on screen.</strong> Each option is compared against
            everyone abandoning the group and flying their own best route ("if everyone flew
            alone") — so the price of togetherness is explicit, never hidden.
          </li>
        </ul>
      </Section>

      <Section title="Words we use">
        <dl className="space-y-2">
          <Term name="shared flights">
            The flights everyone is on together (internally: the "trunk") — from the meeting airport
            into China, and out of China until the group splits up for home.
          </Term>
          <Term name="meeting airport">
            Where the group converges to board the shared flights — LAX, Istanbul, Munich… The
            "Meet in US / Meet abroad" filter groups options by this.
          </Term>
          <Term name="one ticket">
            A party's whole journey on a single airline ticket. If a connection is late, the airline
            must rebook them — fully protected.
          </Term>
          <Term name="separate tickets">
            (Also "2 tickets" / split tickets.) A party buys their own flight to the meeting airport
            plus the shared flights as a second ticket. Cheaper and sometimes the only way to join —
            but if the first flight is badly delayed, the airline owes them nothing. The timeline
            marks every wait between tickets, with times.
          </Term>
          <Term name="positioning flight">The separate ticket that gets a party to (or home from) the meeting airport.</Term>
          <Term name="cash">Real money out the door: all tickets, plus estimated hotel nights for overnight waits.</Term>
          <Term name="benchmark / vs best">
            The benchmark is the strongest option under your current knobs. Every other row's
            "+$X" is the effective cost of choosing it instead — hover to see what drives it.
          </Term>
          <Term name="best">
            No other visible option is cheaper AND faster AND fairer at the same time. Several
            options are usually "best" — they're different trade-offs, not ties.
          </Term>
          <Term name="spread">
            The gap between the cheapest and priciest traveler. If you settle up with Venmo
            afterwards, set the fairness knob to 0 and ignore this.
          </Term>
          <Term name="door-to-door">
            Average travel time per person, first departure to final arrival, waits included —
            i.e. time not spent in China.
          </Term>
          <Term name="if everyone flew alone">
            Each party's best independent trip — own dates, own routes, no group. The floor that
            "the price of togetherness" is measured against.
          </Term>
          <Term name="search">
            One trip configuration — who flies from where, into/out of which airports, which dates —
            with its own live link (/t/…). The homepage lists them all; the group's shared one is
            marked and can't be deleted.
          </Term>
          <Term name="snapshot">
            A frozen copy of a search's results (or just its setup) at a shareable /s/… link. It
            never changes, even as fares move — re-search before booking. "Open as a new search"
            copies its setup into a search of your own.
          </Term>
          <Term name="history">
            Every time a search's setup is overwritten, the old version is kept and restorable —
            nothing is ever lost to an edit, yours or anyone else's.
          </Term>
        </dl>
      </Section>

      <Section title="How to use it">
        <ol className="list-inside list-decimal space-y-1.5 text-sm text-ink-soft">
          <li>
            <strong>Start from the homepage:</strong> open an existing search, or create your own —
            fresh, or as a copy of another search's setup.
          </li>
          <li>
            <strong>Trip setup:</strong> define who flies from where, the airports into and out of
            China, the date window, and constraints. Press <em>Refresh flight data</em> — the bar
            tells you how many live searches that costs and how much is already cached.
          </li>
          <li>
            <strong>Options:</strong> pick a preset (Balanced / Cheapest cash / Least hassle /
            Fairest) or open "fine-tune" and set your own dollar knobs. Sort any column. The three
            cards on top jump to the cheapest, fastest, and fairest options.
          </li>
          <li>
            <strong>Tell it who you are:</strong> the "I'm" selector in the header re-orients
            everything — the price column becomes what <em>you</em> pay, and option details lead
            with <em>your</em> journey.
          </li>
          <li>
            <strong>Open a row</strong> for the full picture: every party's flights, layovers,
            waits between separate tickets, what the true cost is made of, and what each party
            gives up by not flying alone. Options marked "no route yet" have a button to price a
            split-ticket workaround with live fares.
          </li>
          <li>
            <strong>Experiment:</strong> press <em>Duplicate as new search</em> and change anything
            in your copy — the original is untouched, previously-searched setups show results
            instantly, and every overwritten setup stays restorable in History.
          </li>
          <li>
            <strong>Share:</strong> a search's own link (<span className="font-mono">/t/…</span>) is
            live and changes as it's refreshed; "Share these results" freezes the current view at a
            permanent <span className="font-mono">/s/…</span> link; "Share this setup as a link"
            sends just the configuration. Anyone with a link (and the shared password) can also
            point their own AI assistant at this service — tell it to read{' '}
            <a className="underline" href="/llms.txt">
              <span className="font-mono">/llms.txt</span>
            </a>{' '}
            first (a guide written for agents: recipes, etiquette, what the fields mean). If the
            assistant's web tool can't log in, append{' '}
            <span className="font-mono">?key=&lt;the password&gt;</span> to the URLs you give it.
            Best of all: assistants that support MCP connectors can add this service directly —
            connector URL <span className="font-mono">/mcp?key=&lt;the password&gt;</span> — and get
            proper tools instead of raw URLs.
          </li>
        </ol>
      </Section>

      <Section title="Fine print">
        <ul className="list-inside list-disc space-y-1.5 text-sm text-ink-soft">
          <li>
            Fares are real and bookable <em>at fetch time</em> — they move constantly. Re-run a
            refresh before deciding. This app doesn't sell tickets: each ticket in an option's
            detail has <em>verify &amp; book</em> links that open a matching search on Kayak or
            Google Flights — find the same flight numbers there to confirm the fare, and buy
            there or with the airline.
          </li>
          <li>
            Hotel nights and self-transfer risk are honest <em>estimates and valuations</em>, not
            bills — the knobs exist precisely so you can disagree with the defaults.
          </li>
          <li>
            The "vs best" numbers are relative to the options currently visible; changing filters
            or knobs recomputes them. That's by design — only differences matter for a decision.
          </li>
          <li>
            Refreshes and split-ticket pricing hit a live flight-data provider. It's cheap, not
            free — don't script them in a loop.
          </li>
        </ul>
      </Section>
    </div>
  )
}

export function AboutPage() {
  return <AboutContent />
}
