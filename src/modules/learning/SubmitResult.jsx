import { gu } from '../../lib/scenes';

/**
 * Stage 4 — the result of a submission (§14).
 *
 * Both numbers are stated plainly before anything else happens, so pending items are
 * never silently dropped. The wording follows §1 rule 4 of the requirement document —
 * ફક્ત આનંદ, નિરાશા નહીં: what is not yet remembered is "બાકી", never a failure, and
 * there is no red anywhere on this screen.
 */
export default function SubmitResult({
  rememberedCount,
  pendingCount,
  total,
  onReview,
  onSkipToRecall,
  syncError,
  saving,
  onRetry,
}) {
  return (
    <section className="stage stage-result">
      <header className="runner-head">
        <h2>આજનું પરિણામ</h2>
      </header>

      <div className="result-grid">
        <div className="result-card is-good">
          <div className="result-num">{gu(rememberedCount)}</div>
          <div className="result-label">યાદ રહ્યાં</div>
        </div>
        <div className="result-card">
          <div className="result-num">{gu(pendingCount)}</div>
          <div className="result-label">બાકી</div>
        </div>
      </div>

      <p className="result-line">
        કુલ {gu(total)} દ્રશ્યોમાંથી તમે {gu(rememberedCount)} યાદ રાખ્યાં.
      </p>

      {syncError && (
        <div className="notice notice-warn" role="status">
          <p>તમારી પ્રગતિ ખોવાઈ નથી.</p>
          <p className="notice-sub">
            નેટ ન હોવાથી હમણાં સચવાયું નથી. નેટ આવે એટલે આપોઆપ સચવાઈ જશે.
          </p>
          <button type="button" className="btn-quiet" onClick={onRetry} disabled={saving}>
            {saving ? 'સાચવાય છે…' : 'ફરી પ્રયત્ન કરો'}
          </button>
        </div>
      )}

      <nav className="runner-nav runner-nav-single">
        {pendingCount > 0 ? (
          <button type="button" className="btn-gold" onClick={onReview}>
            બાકીનાં {gu(pendingCount)} દર્શન કરો
          </button>
        ) : (
          <button type="button" className="btn-gold" onClick={onSkipToRecall}>
            સ્મૃતિ દર્શન શરૂ કરો
          </button>
        )}
      </nav>

      {pendingCount > 0 && (
        <p className="runner-hint">
          <button type="button" className="linklike" onClick={onSkipToRecall}>
            સીધા સ્મૃતિ દર્શન પર જાઓ
          </button>
        </p>
      )}
    </section>
  );
}
