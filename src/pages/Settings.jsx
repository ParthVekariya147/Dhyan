import { useState } from 'react';
import { gu } from '../lib/constants';
import { useScenes } from '../lib/useScenes';
import { useViewingSpeed } from '../lib/useViewingSpeed';
import {
  SPEED_MAX_SECONDS,
  SPEED_MIN_SECONDS,
  SPEED_PRESETS,
  presetForSeconds,
  totalMinutes,
  validateViewingSpeed,
} from '../../shared/domain/viewing-speed.js';
import '../styles/forms.css';
import './settings.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — સેટિંગ (/settings)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Let a યુવક decide how fast the fullscreen દર્શન moves on આપોઆપ, in the
 *                unit he is actually deciding in - how long am I sitting down for - and
 *                remember it so he never sets it twice.
 *
 * Input          useViewingSpeed() (his own choice, joined to the સંચાલક's default),
 *                useScenes() for `total`, which is the multiplier in every minute total
 *                on this page. No query of its own beyond those two.
 * Visible        The four named ગતિ - ઝડપી, મધ્યમ, ધીમું, અતિ ધીમું - each carrying its
 *                seconds and roughly how long the whole collection then takes; a custom
 *                seconds field bounded ૨-૩૦; and one line saying whose setting is in
 *                force at this moment.
 * Actions        Tap a ગતિ. Type a number and keep it. Go back to the સંચાલક's setting.
 *                Nothing else is offered.
 * Persisted      One number, in this browser's localStorage under `varni:speed:v1`, written
 *                synchronously on tap. Nothing is sent to the server - see the long note in
 *                src/lib/useViewingSpeed.js on why this preference is the handset's and not
 *                the `profiles` row's.
 * Completion     None. સેટિંગ is not a level and nothing here is finished or counted.
 * Next           None. It is a leaf: the bar, or the back gesture, is how he leaves it.
 * Previous       મારું (/profile), which is the only link to this page - it is reached
 *                where a યુવક looks for it rather than by standing in the bottom bar,
 *                which stays the સંચાલક's to arrange (shared/domain/navigation.js).
 * Excluded       Everything that is not the આપોઆપ speed. No points, no streaks, no
 *                notifications, no theme, no language toggle - this app is Gujarati (§14)
 *                and a switch offering otherwise would be a promise nothing keeps. The
 *                layout is a stack of sections so a second setting is a second section
 *                rather than a redesign, and today there is exactly one.
 * Loading        Nothing blocks and nothing spins. His own choice is on the device and is
 *                in hand on the first paint; the સંચાલક's default and the scene count both
 *                arrive over the network, so the minute totals are simply not drawn until
 *                the count is known. A missing line is honest; "આશરે ૦ મિનિટ" is not.
 * Error / empty  There is no failure state to render. A storage read that throws, a
 *                damaged stored value and a settings row that never arrives all end at a
 *                usable dwell inside resolveViewingSpeed(), so the worst case on this page
 *                is a preset lit that he did not pick himself - which is exactly what the
 *                "સંચાલકે ગોઠવેલી ગતિ" line below is for.
 * Source of truth  shared/domain/viewing-speed.js for the four presets, the ૨-૩૦ bound and
 *                  the precedence between the સંચાલક's number and his own.
 *                  settings['app'].slideshow for the default. useScenes().total for the
 *                  size of the collection - §62: the total is counted, never typed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one rule this screen is built around
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **One number decides which control is lit, and nothing else does.**
 *
 * Everything visible below is derived from `seconds` — the presets through
 * `presetForSeconds()`, the custom box from whether that returned null. There is no separate
 * "which control did he last touch" state, and that omission is the feature: with one, a યુવક
 * who types 8 into the custom box would light the box while ધીમું sat unlit beside it, and the
 * screen would be disagreeing with itself about what he had just done. With none, 8 is ધીમું
 * however he arrived at it, and exactly one thing on the page can ever be on.
 */
export default function Settings() {
  const { seconds, chosen, setSeconds, clear } = useViewingSpeed();

  /*
    The size of the collection, counted (§62). It is the multiplier in every "આશરે ૯ મિનિટ"
    below, and the reason those minutes are not simply copied from the requirement document's
    table: the document's ૫/૯/૧૫/૨૨ were written against ૧૦૯ દ્રશ્યો, and the day દ્રશ્ય ૧૧૦
    is published every one of them is quietly wrong. useScenes() counts what actually passed
    both gates, so the table corrects itself and nobody has to remember it.
  */
  const { total } = useScenes();

  /**
   * What is in the custom box, or null for "he has not typed in it".
   *
   * null rather than a string seeded from `seconds`, because seeding is wrong twice over: the
   * સંચાલક's default arrives from the network a moment after the first paint, so a seeded box
   * would hold the shared fallback and then have to be corrected under his finger; and once he
   * taps ધીમું, a box still showing what it was seeded with is a control contradicting the
   * chip beside it. Null means "mirror the live value", which is true at every moment until he
   * types - and typing is the only thing that makes the box his.
   */
  const [draft, setDraft] = useState(null);

  /** Cleared on every edit, so a refusal can never outlive the value that caused it. */
  const [commitError, setCommitError] = useState('');

  const text = draft ?? String(seconds);

  /*
    `Number('')` is 0 and `Number(' ')` is 0, which would make an emptied box read as a
    zero-second dwell and pass straight through a naive check. The trim test in front of the
    conversion is what keeps "nothing typed" from becoming a number at all - the same argument
    resolveSlideshow() makes for using `typeof` rather than `Number()`.
  */
  const typed = text.trim() === '' ? NaN : Number(text);

  /*
    The shared rule, run as he types so the message arrives on the keystroke that caused it.
    It is DISPLAY ONLY - `setSeconds()` validates again and is the authority, exactly as the
    panel's Settings page does for the tick word. A live check that drifted from the committing
    one would be a second answer to one question, which is what shared/domain/viewing-speed.js
    exists to prevent.

    `gu()` over the message, not just over numbers built here: validateViewingSpeed() is shared
    with nothing that renders Gujarati digits, so its "2 થી 30 સેકંડ વચ્ચે લખો." carries Latin
    numerals. gu() rewrites the digits in any string, which keeps ૨ and ૩૦ in the same script
    as every other number on this screen (§14) without this page restating the rule's wording.
  */
  const touched = draft !== null && draft.trim() !== '';
  const check = validateViewingSpeed(typed);
  const customError = commitError || (touched && !check.ok ? gu(check.gu) : '');

  /*
    Which control is on. Both lines come from `seconds` and from nothing else - see the header.
    `activePreset` null is precisely what "this is a custom value" means, so the two states are
    one expression and cannot both be true.
  */
  const activePreset = presetForSeconds(seconds);
  const isCustom = !activePreset;

  const pickPreset = (preset) => {
    setSeconds(preset.seconds);
    // Back to mirroring. He has made a choice with the other control, and a box still holding
    // what he half-typed a moment ago is the page remembering something he abandoned.
    setDraft(null);
    setCommitError('');
  };

  const commitCustom = () => {
    const v = setSeconds(typed);
    if (v.ok) {
      setDraft(null);
      setCommitError('');
      return;
    }
    /*
      Reachable even with an untouched box, which is why the message is stored rather than
      derived from `touched`: a સંચાલક may legitimately have set 45 seconds - his bound is
      1-60 and the resolver honours it as-is rather than clamping a number this module does
      not own - so the box can be mirroring a value that is outside the યુવક's own 2-30.
      Pressing "રાખો" on it must say why, not fail silently.
    */
    setCommitError(gu(v.gu));
  };

  const restore = () => {
    clear();
    setDraft(null);
    setCommitError('');
  };

  return (
    <div className="settings-wrap">
      <header className="site-header">
        <h1>સેટિંગ</h1>
        <p>તમારી પસંદ, તમારા ફોનમાં યાદ રહેશે</p>
        <div className="rule" />
      </header>

      <div className="settings-inner">
        {/*
          A <section> per setting, and today there is one. The stack is what leaves room for
          the next one without a redesign - a second setting is a second section with its own
          heading, not a new arrangement of this one.
        */}
        <section className="settings-section" aria-labelledby="speed-heading">
          <h2 className="settings-section-title" id="speed-heading">
            ઓટો સ્લાઇડશોની ગતિ
          </h2>
          <p className="settings-note">
            મોટા પડદે દર્શન કરતી વખતે "ઓટો સ્લાઇડશો" ચાલુ કરો ત્યારે એક દ્રશ્ય કેટલી વાર દેખાય એ અહીંથી નક્કી કરો.
          </p>

          {/*
            Whose setting is in force. The two states produce the same number and must not look
            the same - that is the whole reason `chosen` is returned - because only one of them
            has a way back, and a યુવક who cannot tell which he is in cannot know whether
            "પાછી લાવો" would change anything.
          */}
          <div className={chosen ? 'speed-state is-yours' : 'speed-state'}>
            {chosen ? (
              <>
                <p>તમે પસંદ કરેલી ગતિ ચાલુ છે - એક દ્રશ્ય {gu(seconds)} સેકંડ.</p>
                <button type="button" className="btn btn-quiet speed-restore" onClick={restore}>
                  સંચાલકે ગોઠવેલી ગતિ પાછી લાવો
                </button>
              </>
            ) : (
              <p>
                અત્યારે સંચાલકે ગોઠવેલી ગતિ ચાલુ છે - એક દ્રશ્ય {gu(seconds)} સેકંડ. નીચેથી તમારી પોતાની ગતિ
                પસંદ કરી શકો છો.
              </p>
            )}
          </div>

          <div className="speed-list">
            {SPEED_PRESETS.map((p) => {
              const on = activePreset?.key === p.key;
              /*
                Computed, never typed (§62). Zero means the count has not arrived yet, and the
                row is drawn WITHOUT this line rather than with "આશરે ૦ મિનિટ" - a confident
                zero is a wrong fact, a missing line is only a late one.
              */
              const minutes = totalMinutes(p.seconds, total);
              return (
                <button
                  key={p.key}
                  type="button"
                  /*
                    A toggle button with `aria-pressed`, so a screen reader says "pressed" on
                    the one that is on. The alternative - role="radio" inside a radiogroup -
                    is the truer semantic and brings an obligation with it: a radiogroup owes
                    the user arrow-key roving and a single tab stop, and a group that claims
                    the role without honouring it is worse for the people who rely on it than
                    plain buttons that never claimed it.
                  */
                  aria-pressed={on}
                  className={on ? 'speed-option is-on' : 'speed-option'}
                  onClick={() => pickPreset(p)}
                >
                  <span className="speed-option-text">
                    <span className="speed-name">{p.label}</span>
                    <span className="speed-detail">એક દ્રશ્ય {gu(p.seconds)} સેકંડ</span>
                    {minutes > 0 && (
                      <span className="speed-total">આખું દર્શન આશરે {gu(minutes)} મિનિટ</span>
                    )}
                  </span>
                  {/*
                    Never colour alone (§43). The lit row differs by border, by fill AND by
                    this word - so it survives a bright phone in sunlight, a colour-blind
                    reader and a screenshot printed in grey. The element is always rendered so
                    that turning a row on cannot change its height and shift the rows below it.
                  */}
                  <span className="speed-mark" aria-hidden="true">
                    {on ? '✓ ચાલુ' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          {/*
            The custom field. `type="number"` with `inputMode="numeric"` - the first is what
            makes the browser's own min/max and stepper meaningful, the second is what puts a
            digit keypad under a thumb on a phone instead of a full QWERTY. --fs-input is 16px
            and this field must never go below it: iOS Safari zooms a focused input smaller
            than that and does not zoom back out (tokens.css).
          */}
          <div className={isCustom ? 'speed-custom is-on' : 'speed-custom'}>
            <div className="field">
              <label htmlFor="speed-seconds">અથવા પોતે સેકંડ લખો</label>
              <input
                id="speed-seconds"
                type="number"
                inputMode="numeric"
                min={SPEED_MIN_SECONDS}
                max={SPEED_MAX_SECONDS}
                step={1}
                className={customError ? 'bad' : undefined}
                value={text}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setCommitError('');
                }}
                onKeyDown={(e) => {
                  // Enter commits, because a numeric keypad's ✓ is where a thumb goes next
                  // and reaching back up past the keyboard for a button is not a journey a
                  // યુવક should have to make. This is not inside a <form>, so nothing else
                  // would have happened.
                  if (e.key === 'Enter') commitCustom();
                }}
              />
              {/*
                One reserved line under the field, filled or not (§18) - so a message
                appearing cannot move the button under a thumb already travelling towards it.
              */}
              <div className="field-msg" aria-live="polite">
                {customError ? (
                  <span className="err">{customError}</span>
                ) : (
                  <span className="hint">
                    {gu(SPEED_MIN_SECONDS)} થી {gu(SPEED_MAX_SECONDS)} સેકંડ વચ્ચે
                  </span>
                )}
              </div>
            </div>

            <button type="button" className="btn speed-apply" onClick={commitCustom}>
              આ ગતિ રાખો
            </button>

            {/*
              The same "one control is lit" statement, made in words on the control that
              cannot carry an aria-pressed of its own. It appears only when the live number is
              genuinely not one of the four, which is exactly when no chip above is lit.
            */}
            {isCustom && (
              <p className="speed-custom-on">
                ✓ અત્યારે તમારી લખેલી ગતિ ચાલુ છે - એક દ્રશ્ય {gu(seconds)} સેકંડ
                {totalMinutes(seconds, total) > 0
                  ? `, આખું દર્શન આશરે ${gu(totalMinutes(seconds, total))} મિનિટ`
                  : ''}
                .
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
