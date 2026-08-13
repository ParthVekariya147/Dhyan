import './page-intro.css';

/**
 * "આ પેજમાં મારે શું કરવાનું છે?" — the same question, answered on every page.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The instruction, and nothing but the instruction
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The instruction is always visible: a યુવક who opens લેવલ ૩ and finds a list of numbered
 * lines with no pictures must be told, on that screen, that the picture is missing on
 * purpose and what he is meant to do instead. That sentence is not an extra — on this app
 * it is half the level.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The 'આ વિભાગમાં શું છે?' panel, and why it is gone
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything else about a page — `contains`, `excludes`, `completion`, `revision`, `next` —
 * used to sit under this component behind one closed `<details>` labelled
 * 'આ વિભાગમાં શું છે?'. The argument for it was that the યુવક wondering where the pictures
 * went would open one line and find out.
 *
 * The સંચાલક's answer is that a યુવક does not open it, and should not have to: it is a
 * specification, written for whoever maintains the app, sitting on the screen where the
 * ધ્યાન is meant to happen. A closed panel is still a thing on the page asking to be read.
 * So the yuvak app now renders the instruction and stops there, which is the one part of
 * the description that was ever addressed to him.
 *
 * **The fields themselves are not gone and must not be deleted.** They are still the
 * specification in shared/domain/journey.js — what a page contains, what it deliberately
 * does not, and what makes it finished — and that is where anybody maintaining this app
 * reads them. Only the yuvak-facing rendering of them was removed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where the words come from
 * ────────────────────────────────────────────────────────────────────────────
 *
 * From shared/domain/journey.js, through usePageSpec() — never typed into a screen. That
 * is what keeps the same page from being described two ways in two places, and it is what
 * lets the સંચાલક rephrase an instruction for his યુવકો without a redeploy (§36). What a
 * page *does* is still code and still not his (§37).
 */

/**
 * The instruction, as the points it is actually made of.
 *
 * It used to be printed as one centred paragraph, and on a phone that is what it looked
 * like: eight lines of Gujarati with no edge to hold on to, out of which a યુવક read the
 * first sentence and the last. Every instruction in the specification is already a list of
 * separate things to do — watch, remember, no ticking here, press આગળ when you are done —
 * so it is shown as one, a line per point, and the eye has somewhere to rest between them.
 *
 * Split on the sentence, not on a character a સંચાલક has to remember to type. He writes
 * ordinary Gujarati into the panel's box and gets the same bullets the code's own wording
 * gets. Newlines win where he does type them, so he can group two sentences on one line.
 *
 * The full stop stays on its point rather than being stripped: this is prose set as a
 * list, not a list of labels, and a paragraph that loses its punctuation the moment it is
 * shown reads as broken text on the one screen that has to be clearest.
 */
function toPoints(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];

  const byLine = raw.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  if (byLine.length > 1) return byLine;

  const sentences = raw.match(/[^.?!]+[.?!]*/g);
  return sentences ? sentences.map((s) => s.trim()).filter(Boolean) : [raw];
}

/**
 * @param {object}  props
 * @param {object}  props.spec   one entry of the journey specification. Rendering nothing
 *                               when it is absent is deliberate: a missing description must
 *                               never be the reason a level fails to open.
 * @param {boolean} [props.compact]  kept so the callers that pass it still typecheck. It
 *                               used to drop the 'આ વિભાગમાં શું છે?' panel; there is no
 *                               panel any more, so compact and full render the same thing.
 *                               EntryGate is the one caller that sets it.
 */
export default function PageIntro({ spec }) {
  if (!spec) return null;
  const points = toPoints(spec.instruction);
  if (!points.length) return null;

  return (
    <section className="page-intro">
      <ul className="page-intro-lead">
        {points.map((point, i) => (
          <li key={i}>{point}</li>
        ))}
      </ul>
    </section>
  );
}
