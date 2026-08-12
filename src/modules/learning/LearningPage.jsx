import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLearning } from '../../lib/learning';
import { STAGE } from '../../lib/stages';
import { SCENES, gu, sceneById, sceneIds } from '../../lib/scenes';
import SceneRunner from './SceneRunner';
import VideoStage from './VideoStage';
import SubmitResult from './SubmitResult';
import MemoryRecall from './MemoryRecall';
import './learning.css';

/**
 * The journey, driven entirely by `currentStage` (§22, §23).
 *
 * There is no route per stage on purpose. The stage lives in the yuvak's progress
 * document, so closing the app and signing in on another phone resumes exactly where he
 * was — whereas a URL per stage would let a refresh, a back button or a shared link
 * land him in a stage he has not reached.
 */
export default function LearningPage() {
  const L = useLearning();

  const onFinishLearning = useCallback(() => L.goTo(STAGE.RECOGNITION), [L]);
  const onSubmit = useCallback(() => { L.submit(); }, [L]);

  const pendingIds = useMemo(() => L.pending.filter((id) => sceneById(id)), [L.pending]);

  // Only integers reach the recall stage — never scene records (§19).
  const recallIndexes = useMemo(
    () => SCENES.map((s) => s.index),
    []
  );

  if (!L.ready) {
    return (
      <div className="spinner-page">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
    );
  }

  const body = (() => {
    switch (L.stage) {
      case STAGE.NOT_STARTED:
        return (
          <section className="stage stage-start">
            <header className="runner-head">
              <h2>વર્ણી ધ્યાન</h2>
            </header>
            <p className="runner-hint">
              {gu(L.total)} દ્રશ્યોનું ક્રમબદ્ધ ધ્યાન. પહેલાં વિડિયો દર્શન, પછી ચિત્ર દર્શન.
            </p>
            <nav className="runner-nav runner-nav-single">
              <button type="button" className="btn-gold" onClick={L.begin}>શરૂ કરો</button>
            </nav>
          </section>
        );

      case STAGE.VIDEO_DARSHAN:
        return <VideoStage onContinue={() => L.goTo(STAGE.IMAGE_LEARNING)} />;

      case STAGE.IMAGE_LEARNING:
        return (
          <SceneRunner
            ids={sceneIds()}
            title="દર્શન"
            hint="દરેક દ્રશ્ય શાંતિથી નિહાળો અને એનું વર્ણન વાંચો."
            onFinish={onFinishLearning}
            finishLabel="ઓળખ શરૂ કરો"
          />
        );

      case STAGE.RECOGNITION:
        return (
          <>
            <SceneRunner
              ids={sceneIds()}
              title="ઓળખ"
              hint="જે દર્શન તમને ખરેખર યાદ છે તેને જ ટિક કરો."
              showCheckbox
              isTicked={L.isTicked}
              onToggle={L.toggleRemember}
              onFinish={onSubmit}
              finishLabel="જમા કરો"
            />
            <p className="runner-hint tick-tally" aria-live="polite">
              અત્યાર સુધી ટિક: {gu(L.draftCount)} / {gu(L.total)}
            </p>
          </>
        );

      case STAGE.SUBMITTED:
        return (
          <SubmitResult
            rememberedCount={L.rememberedCount}
            pendingCount={L.pendingCount}
            total={L.totalAtSubmit}
            onReview={() => L.goTo(STAGE.PENDING_REVIEW)}
            onSkipToRecall={() => L.goTo(STAGE.MEMORY_RECALL)}
            syncError={L.syncError}
            saving={L.saving}
            onRetry={L.retrySync}
          />
        );

      case STAGE.PENDING_REVIEW:
        // Only what is pending (§16, §17). The remembered scenes are deliberately not
        // shown again — the attention belongs on the weak ones.
        return (
          <SceneRunner
            ids={pendingIds}
            title="બાકી દર્શન"
            hint={`આ ${gu(pendingIds.length)} દર્શન ફરી શાંતિથી જુઓ.`}
            onFinish={() => L.goTo(STAGE.MEMORY_RECALL)}
            finishLabel="સ્મૃતિ દર્શન શરૂ કરો"
          />
        );

      case STAGE.MEMORY_RECALL:
        return <MemoryRecall indexes={recallIndexes} onFinish={L.complete} />;

      case STAGE.COMPLETED:
        return (
          <section className="stage stage-done">
            <header className="runner-head">
              <h2>દર્શન સંપૂર્ણ</h2>
            </header>
            <div className="done-mark" aria-hidden="true">🪔</div>
            <p className="result-line">
              તમે {gu(L.rememberedCount)} દ્રશ્યો યાદ રાખ્યાં. કુલ {gu(L.completedSessions)} વખત ધ્યાન પૂરું કર્યું.
            </p>
            <p className="runner-hint">જય સ્વામિનારાયણ 🙏</p>
            <nav className="runner-nav runner-nav-single">
              <button type="button" className="btn-gold" onClick={L.begin}>ફરી ધ્યાન કરો</button>
            </nav>
          </section>
        );

      default:
        return null;
    }
  })();

  return (
    <div className="learn-wrap">
      <header className="learn-bar">
        <Link className="linklike" to="/">મુખપૃષ્ઠ</Link>
        {L.stage !== STAGE.NOT_STARTED && L.stage !== STAGE.VIDEO_DARSHAN && (
          <button type="button" className="linklike" onClick={() => L.goTo(STAGE.VIDEO_DARSHAN)}>
            વિડિયો ફરી જુઓ
          </button>
        )}
      </header>

      {body}
    </div>
  );
}
