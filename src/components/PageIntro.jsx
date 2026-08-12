import './page-intro.css';

/**
 * "આ પેજમાં મારે શું કરવાનું છે?" — the same question, answered on every page.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What it renders, and why in two layers
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The instruction is always visible: a યુવક who opens લેવલ ૩ and finds a list of numbered
 * lines with no pictures must be told, on that screen, that the picture is missing on
 * purpose and what he is meant to do instead. That sentence is not an extra — on this app
 * it is half the level.
 *
 * Everything else — what the page contains, what it deliberately does not, what makes it
 * complete — sits behind one closed `<details>`. Two reasons, and neither is tidiness:
 *
 *   1. A wall of specification above the actual work would push the દર્શન, or the tick
 *      list, below the fold on a phone. The page is the point; the description serves it.
 *   2. The people who need "આમાં શું નથી" are the ones who are already puzzled — the યુવક
 *      wondering where the pictures went, and the સંચાલક being asked about it. Both will
 *      open one line that says "આ વિભાગમાં શું છે?". Nobody else has to read past it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where the words come from
 * ────────────────────────────────────────────────────────────────────────────
 *
 * From shared/domain/journey.js, through usePageSpec() — never typed into a screen. That
 * is what keeps the same page from being described two ways in two places, and it is what
 * lets the સંચાલક rephrase an instruction for his યુવકો without a redeploy (§36). What a
 * page *does* is still code and still not his (§37): `contains` and `excludes` come from
 * the specification and no settings row can rewrite them.
 *
 * Nothing here is styled as a warning and nothing is red (§1 rule 4). "આમાં નથી" is a
 * description of a page, not a list of things withheld from him.
 */

const LABELS = {
  gu: {
    more: 'આ વિભાગમાં શું છે?',
    contains: 'આમાં આટલું છે',
    excludes: 'આમાં આ નથી',
    completion: 'ક્યારે પૂરું ગણાશે',
    revision: 'ફરી જોવું હોય તો',
    next: 'પછી ક્યાં જવાશે',
  },
  en: {
    more: "What's on this page?",
    contains: 'This page has',
    excludes: 'This page does not have',
    completion: 'When it is complete',
    revision: 'To see it again',
    next: 'Where you go next',
  },
};

/**
 * @param {object}  props
 * @param {object}  props.spec   one entry of the journey specification. Rendering nothing
 *                               when it is absent is deliberate: a missing description must
 *                               never be the reason a level fails to open.
 * @param {'gu'|'en'} [props.lang]  લેવલ ૧ is written in English (see EntryGate.jsx); every
 *                               other page is Gujarati. This switches the labels, and the
 *                               caller passes the English wording in `spec` via inEnglish().
 * @param {boolean} [props.compact]  drops the details block, for places that already have
 *                               a fuller description of the same thing on screen.
 */
export default function PageIntro({ spec, lang = 'gu', compact = false }) {
  if (!spec) return null;
  const L = LABELS[lang] ?? LABELS.gu;

  return (
    <section className="page-intro" lang={lang}>
      <p className="page-intro-lead">{spec.instruction}</p>

      {!compact && (
        <details className="page-intro-more">
          {/*
            One line, closed. A `<details>` is used rather than a button and state of our
            own because it is the browser's own disclosure: it opens without JavaScript,
            it is reachable by keyboard, and a screen reader announces it as expanded or
            collapsed without a word of aria from us (§ accessibility).
          */}
          <summary>{L.more}</summary>

          <div className="page-intro-body">
            {spec.contains?.length > 0 && (
              <div className="page-intro-block">
                <p className="page-intro-h">{L.contains}</p>
                <ul>
                  {spec.contains.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/*
              The half that earns this component. "લેવલ ૩ માં ચિત્ર નથી" is a decision, and
              a યુવક who is told so stops looking for a button that was never there.
            */}
            {spec.excludes?.length > 0 && (
              <div className="page-intro-block">
                <p className="page-intro-h">{L.excludes}</p>
                <ul className="is-absent">
                  {spec.excludes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {spec.completion && (
              <div className="page-intro-block">
                <p className="page-intro-h">{L.completion}</p>
                <p className="page-intro-line">{spec.completion}</p>
              </div>
            )}

            {spec.revision && (
              <div className="page-intro-block">
                <p className="page-intro-h">{L.revision}</p>
                <p className="page-intro-line">{spec.revision}</p>
              </div>
            )}

            {/*
              Said, not linked. The buttons that actually navigate are at the foot of the
              page where the work ends; a second set of doors inside an explanation would
              be a way out of the page at the moment it is being explained — and the whole
              rule this app follows is that every Next has exactly one destination.
            */}
            {spec.next?.label && (
              <div className="page-intro-block">
                <p className="page-intro-h">{L.next}</p>
                <p className="page-intro-line">{spec.next.label}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
