import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { listProgress, pendingHotspots } from '../../learning/services/learningService';
import { REMEMBERED_THRESHOLD, rememberedAtLeast, subZoneRegularity } from '../services/reportService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, Empty, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import { dateTimeGu, gu, percent } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { exportCsv, istDateTime, istRange, reportFilename } from '../../../lib/export';
import { dateIST, todayIST } from '../../../../../shared/domain/constants.js';
import { STAGE, STAGE_LABEL } from '../../../lib/domain';
import { subZoneNameEn } from '../../../lib/labels';

/**
 * §38 — organisation-wide progress, paginated. §11 — the two reports the spec names by
 * hand: the '૫૦+ યાદ રાખનારા' one-click list, and the સબઝોન comparison.
 *
 * One query over public.learning_state, newest activity first. The stage filter is a WHERE
 * clause; the સબઝોન filter is not, and the page says so rather than implying it applies to
 * everyone (learning_state carries no sub_zone_id, and copying the profile column into it
 * would duplicate user data into a row rewritten on every stage change — §44).
 *
 * Completion is remembered ÷ the total as it stood when that yuvak submitted, so an old
 * row is not silently re-scored against content added since.
 *
 * Both reports load on an explicit press, not on page open. Each is a scan rather than an
 * aggregate — see the header of ../services/reportService.js for why, and for what that
 * costs — and a page that quietly ran two scans every time it was opened would be paying
 * that cost for a સંચાલક who came here to look at the table.
 */

/**
 * §13 again, and more sharply than on the યુવક list.
 *
 * The ૫૦+ file is the one that leaves the panel most often: it exists so a name can be
 * read out when saints visit. So it carries who and how far, and no contact detail at all
 * — not even behind a checkbox. There is no version of "read the names of the yuvaks who
 * remembered fifty" that needs 2,000 phone numbers on the same sheet, and some of those
 * numbers belong to minors.
 */
const fiftyColumns = [
  { label: 'SMK', value: (r) => r.smk },
  { label: 'Name / નામ', value: (r) => r.name },
  { label: 'Subzone / સબઝોન', value: (r) => subZoneNameEn(r.subZoneId) },
  { label: 'Remembered', value: (r) => r.remembered },
  // Blank, never 0, when he has not submitted a round: the scene count at submit is
  // genuinely unknown then, and a 0 would read as "out of nothing" (§62).
  { label: 'Out of', value: (r) => r.total || '' },
  { label: 'Stage', value: (r) => STAGE_LABEL[r.currentStage] || r.currentStage },
  { label: 'Last activity', value: (r) => istDateTime(r.updatedAt) },
];

/** The comparison, as a file. Aggregate only — no યુવક is named on this sheet (§39). */
const compareColumns = [
  { label: 'Subzone / સબઝોન', value: (r) => subZoneNameEn(r.subZoneId) },
  { label: 'Registered', value: (r) => r.registered },
  { label: 'Yuvaks who submitted', value: (r) => r.submitters },
  { label: 'Rounds submitted', value: (r) => r.rounds },
  { label: 'Took part %', value: (r) => Math.floor(r.share * 1000) / 10 },
];

export default function ProgressPage() {
  const [pageSize, setPageSize] = useState(20);
  const [stage, setStage] = useState('');
  const [subZone, setSubZone] = useState('');
  const [page, setPage] = useState(0);
  const cursors = useRef([null]);

  const state = useAsync(
    () => listProgress({ pageSize, cursor: cursors.current[page], stage }),
    [page, pageSize, stage]
  );
  const hot = useAsync(() => pendingHotspots({ sampleSize: 200 }), []);

  /**
   * §11 — '૫૦+ યાદ રાખનારા', one click.
   *
   * `skip` keeps it off until it is asked for; useAsync re-runs when skip flips, and again
   * whenever the સબઝોન select moves, so the list always describes the મંડળ named above it.
   * Unlike the table on this page, that filter is a real WHERE here — reportService embeds
   * profiles and filters in Postgres — so the list is organisation-wide and not "whoever
   * happened to be on this page".
   */
  const [showFifty, setShowFifty] = useState(false);
  const fifty = useAsync(() => rememberedAtLeast({ subZoneId: subZone }), [subZone], { skip: !showFifty });
  const fiftyRows = fifty.data?.rows || [];

  /**
   * §11 — which મંડળ is more regular, over a date range.
   *
   * Defaults to the last thirty days including today, in IST — `dateIST(-29)` and
   * `todayIST()` from shared/domain/constants.js, which are the same helpers §9's reset
   * reasons in. A default of "all time" would answer a different question: a મંડળ that was
   * busy last year and quiet since would look regular.
   */
  const [cFrom, setCFrom] = useState(() => dateIST(-29));
  const [cTo, setCTo] = useState(() => todayIST());
  const [showCompare, setShowCompare] = useState(false);
  const compare = useAsync(
    () => subZoneRegularity(istRange(cFrom, cTo)),
    [cFrom, cTo],
    { skip: !showCompare }
  );
  const compareRows = compare.data?.rows || [];

  /**
   * The four states of a report that has just been asked for (§53).
   *
   * useAsync's effect runs *after* the render in which `skip` flips, so for one frame the
   * hook still reports `loading: false, data: null`. Read literally, that is "the read
   * finished and found nothing" — and the card would flash "No yuvak has reached 50 yet",
   * which is a false statement about 2,000 people. "No data and no error" is therefore
   * counted as still loading, and emptiness is only claimed once a result has actually
   * arrived.
   */
  const reportState = (a, rows) => {
    const loading = a.loading || (!a.data && !a.error);
    return { loading, error: a.error, isEmpty: !loading && !a.error && !rows.length };
  };

  const [exportNote, setExportNote] = useState(null);

  /** Shared by both report cards: write the file, then say what was written (§62). */
  const runExport = (filename, columns, rows, noun) => {
    try {
      const written = exportCsv({ filename, columns, rows });
      setExportNote({ tone: 'notice-ok', text: `Exported ${written} ${noun}.` });
    } catch (e) {
      setExportNote({ tone: 'notice-warn', text: dataError(e) });
    }
  };

  // Two lists, deliberately. `pageRows` is what the query returned; `rows` is what the
  // સબઝોન filter leaves of it.
  //
  // The distinction is the whole fix: AsyncBlock renders <Empty> *instead of* its children,
  // and the children include the <Pager>. Deriving isEmpty from the filtered list meant
  // that picking Navsari on a page that happened to hold none dead-ended the list — "No
  // user has started learning yet.", no Next button, and the Navsari yuvaks who do exist
  // unreachable. isEmpty now means what it says: the query itself returned nothing.
  const pageRows = state.data?.rows || [];
  const rows = pageRows.filter((r) => (subZone ? r.user?.subZoneId === subZone : true));
  const filteredOutWholePage = !!subZone && !!pageRows.length && !rows.length;

  const next = useCallback(() => {
    if (!state.data?.cursor) return;
    cursors.current[page + 1] = state.data.cursor;
    setPage((p) => p + 1);
  }, [state.data, page]);

  const reset = () => {
    cursors.current = [null];
    setPage(0);
  };

  const columns = [
    {
      key: 'user',
      label: 'User',
      render: (r) => (r.user ? <Link to={`/users/${r.uid}`}>{r.user.name}</Link> : <span className="mono">{r.uid.slice(0, 8)}…</span>),
    },
    { key: 'smk', label: 'SMK', render: (r) => <span className="mono">{r.user?.smk || '-'}</span> },
    { key: 'subZone', label: 'Subzone', render: (r) => subZoneNameEn(r.user?.subZoneId) },
    { key: 'stage', label: 'Stage', render: (r) => STAGE_LABEL[r.currentStage] || r.currentStage },
    { key: 'remembered', label: 'Remembered', align: 'right', render: (r) => <span className="mono">{r.remembered}</span> },
    { key: 'pending', label: 'Remaining', align: 'right', render: (r) => <span className="mono">{r.pending}</span> },
    {
      key: 'pct',
      label: 'Completion',
      align: 'right',
      render: (r) => (r.total ? percent(r.remembered, r.total) : '-'),
    },
    { key: 'updatedAt', label: 'Last activity', render: (r) => dateTimeGu(r.updatedAt) },
  ];

  // The empty message follows the filter rather than describing the organisation: with a
  // stage chosen, "No user has started learning yet" would be a claim about 2,000 people
  // made from a query that only looked at one stage of them.
  const emptyMessage = stage
    ? `No user is at ${STAGE_LABEL[stage] || stage} right now. Choose All to see everyone.`
    : 'No user has started learning yet.';

  return (
    <>
      <PageHeader title="Progress" sub="Where each user has reached right now" />

      {/* §28 — one filter bar above the list, pagination below it, and nothing between the
          two but the rows. role="group" gives the bar a name of its own, so a screen reader
          reaching it hears what these two selects govern rather than two loose combo
          boxes. */}
      <div className="filters" role="group" aria-label="Filter the progress list">
        <div className="field">
          <label htmlFor="st">Stage</label>
          <select
            id="st"
            value={stage}
            onChange={(e) => {
              reset();
              setStage(e.target.value);
            }}
          >
            <option value="">All</option>
            {Object.values(STAGE).map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
          <span className="hint">Asked of the database - covers everyone, not just this page.</span>
        </div>
        <div className="field">
          <label htmlFor="sz">Subzone</label>
          <select id="sz" value={subZone} onChange={(e) => setSubZone(e.target.value)}>
            <option value="">All</option>
            <option value="vedroad">Vedroad</option>
            <option value="varachha">Varachha</option>
            <option value="navsari">Navsari</option>
          </select>
          {/* The two hints sit side by side on purpose: the difference between a WHERE
              clause and a filter over the loaded page is the one thing about this bar a
              સંચાલક has to know, and it is easier to read as a contrast than as a warning
              buried under one control. */}
          <span className="hint">Applies only to the rows on this page - use Next to keep looking.</span>
        </div>
      </div>

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !pageRows.length }}
        emptyIcon="◔"
        emptyTitle={stage ? 'Nobody is at this stage' : 'Nothing to show yet'}
        empty={emptyMessage}
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          {filteredOutWholePage ? (
            // Says exactly what happened — this page, not the organisation — and the Pager
            // below it stays on screen, so the next page is one click away.
            //
            // <Empty> rather than a line of small print: this stands where the table was,
            // and a footnote-sized sentence in the space a table just left reads as a
            // rendering failure. Empty is the panel's shape for "nothing here, and here is
            // what to do about it" (§35).
            <Empty
              icon="◔"
              title={`Nobody from ${subZoneNameEn(subZone)} on this page`}
              message="This page of results holds no user from that subzone. Try Next, or choose All."
            />
          ) : (
            <DataTable caption="Progress" columns={columns} rows={rows} rowKey={(r) => r.id} />
          )}
          <Pager
            page={page}
            hasNext={!!state.data?.hasNext}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={next}
            pageSize={pageSize}
            onPageSize={(n) => {
              reset();
              setPageSize(n);
            }}
            busy={state.loading}
          />
        </>
      </AsyncBlock>

      {/* §28 — the table above is the page; everything below it is a report that has to be
          asked for. The rule says so before the first card, so the two halves are not read
          as one long list of things that loaded. */}
      <h2 className="section-title">Reports</h2>

      {/* role="status" so a screen reader hears the result of a press that produced no
          visible change on the page itself — the file went to Downloads (§56). It sits
          above both report cards because either of them can write a file. */}
      {exportNote && (
        <div className={`notice ${exportNote.tone}`} role="status">{exportNote.text}</div>
      )}

      {/*
        §11 — '૫૦+ યાદ રાખનારા', the one-click list. The spec calls it out by itself
        because of what it is for: when saints visit, someone needs the names of the યુવકો
        who have remembered fifty દ્રશ્યો or more, in one press, without building a query.

        Everything about the wording is positive by construction. There is no companion
        "under fifty" list and no place in this card that names who is not on it — a યુવક
        who has not reached fifty is simply not here yet, which is emptiness and not a mark
        against him (§10, §14).
      */}
      <div className="card">
        <h2>{REMEMBERED_THRESHOLD}+ remembered · ૫૦+ યાદ રાખનારા</h2>
        <p className="card-note">
          Yuvaks who have remembered {gu(REMEMBERED_THRESHOLD)} darshan or more, most first.
          Follows the subzone chosen above - and unlike the table, that filter covers
          everyone, not just this page.
        </p>

        {!showFifty ? (
          <button className="btn" type="button" onClick={() => setShowFifty(true)}>
            Show the {REMEMBERED_THRESHOLD}+ list
          </button>
        ) : (
          <AsyncBlock
            state={reportState(fifty, fiftyRows)}
            emptyTitle="Nobody is on this list yet"
            /*
             * The empty state reports the scan, not just its verdict.
             *
             * "No yuvak has reached 50 yet" reads as a broken report to anyone who expects
             * names, and it is the identical sentence when the scan saw nothing at all —
             * an RLS read denial returns zero rows and no error. Naming the highest count
             * found, and how many યુવકો were checked to find it, makes the three cases
             * legible: nobody is close, somebody is nearly there, or nothing was read and
             * the number to question is the zero.
             */
            empty={
              (fifty.data?.scanned ?? 0) === 0
                ? `No learning records were readable${subZone ? ` in ${subZoneNameEn(subZone)}` : ''}. Nothing has been submitted yet, or this account may not be permitted to read them.`
                : `No yuvak has reached ${gu(REMEMBERED_THRESHOLD)} yet${subZone ? ` in ${subZoneNameEn(subZone)}` : ''}. The highest so far is ${gu(fifty.data?.best ?? 0)}, out of ${gu(fifty.data?.scanned ?? 0)} yuvaks checked. The list fills as they go.`
            }
            onRetry={fifty.retry}
            skeleton={<TableSkeleton cols={6} />}
          >
            <>
              <DataTable
                caption={`${REMEMBERED_THRESHOLD}+ remembered`}
                columns={[
                  {
                    key: 'name',
                    label: 'User',
                    render: (r) => <Link to={`/users/${r.uid}`}>{r.name || r.uid.slice(0, 8)}</Link>,
                  },
                  { key: 'smk', label: 'SMK', render: (r) => <span className="mono">{r.smk || '-'}</span> },
                  { key: 'subZone', label: 'Subzone', render: (r) => subZoneNameEn(r.subZoneId) },
                  { key: 'remembered', label: 'Remembered', align: 'right', render: (r) => <span className="mono">{r.remembered}</span> },
                  { key: 'total', label: 'Out of', align: 'right', render: (r) => <span className="mono">{r.total || '-'}</span> },
                  { key: 'stage', label: 'Stage', render: (r) => STAGE_LABEL[r.currentStage] || r.currentStage },
                  { key: 'updatedAt', label: 'Last activity', render: (r) => dateTimeGu(r.updatedAt) },
                ]}
                rows={fiftyRows}
                rowKey={(r) => r.id}
              />

              {/* The scan states its own size, the way the Hardest Darshan sample does. A
                  cap that was reached is said out loud rather than left to be discovered. */}
              <p className="card-note">
                {gu(fiftyRows.length)} of {gu(fifty.data?.scanned ?? 0)} yuvaks checked.
                {fifty.data?.truncated
                  ? ` Only the first ${fifty.data.cap} were read - choose one subzone for a complete list.`
                  : ''}
              </p>

              {/* .toolbar, not .filters: this row acts on the list rather than narrowing
                  it, and .filters would stretch the hint into a 220px column beside the
                  button. The hint stays *next to* the button that writes the file, because
                  what the file leaves out is worth reading before it is written (§13). */}
              <div className="toolbar">
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    runExport(
                      reportFilename(`${REMEMBERED_THRESHOLD}-plus`, { stamp: todayIST() }),
                      fiftyColumns,
                      fiftyRows,
                      'yuvaks'
                    )
                  }
                >
                  Export to Excel (CSV)
                </button>
                <span className="hint grow">Names and progress only - no mobile numbers (§13)</span>
              </div>
            </>
          </AsyncBlock>
        )}
      </div>

      {/*
        §11 — subzone comparison: "which મંડળ is more regular".

        Answered as participation over a date range, never as a score. See
        ../services/reportService.js subZoneRegularity() for why that is both the honest
        reading of the question and the only one the recorded data can support.
      */}
      <div className="card">
        <h2>Subzone comparison · મંડળ</h2>
        <p className="card-note">
          How many yuvaks of each subzone submitted at least one round between these dates,
          out of everyone registered there. It compares how regularly a મંડળ comes - not how
          well anyone scored.
        </p>

        <div className="filters" role="group" aria-label="Date range for the subzone comparison">
          <div className="field">
            <label htmlFor="cf">From</label>
            <input id="cf" type="date" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ct">Up to</label>
            <input id="ct" type="date" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} />
            <span className="hint">Both days included, counted in India (IST)</span>
          </div>
          {/* The button leaves the bar once the report is on screen: from then on the two
              dates re-run it on their own, and a button that no longer does anything new
              is one more thing to read past. */}
          {!showCompare && (
            <button className="btn" type="button" onClick={() => setShowCompare(true)}>
              Compare subzones
            </button>
          )}
        </div>

        {showCompare && (
          <AsyncBlock
            state={reportState(compare, compareRows)}
            emptyTitle="Nothing to compare"
            empty="No subzone is set up yet."
            onRetry={compare.retry}
            skeleton={<TableSkeleton cols={5} />}
          >
            <>
              <DataTable
                caption="Subzone comparison"
                columns={[
                  {
                    key: 'subZone',
                    label: 'Subzone',
                    // The most regular મંડળ is named in words, in the panel's one positive
                    // tone. Nothing marks the bottom row: there is no red anywhere in this
                    // table and no wording that calls a quiet month a failure (§10, §14).
                    // DataTable calls render with the row only — the "top" row is found by
                    // identity against the sorted list rather than by an index it does not
                    // pass.
                    render: (r) => (
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: 'var(--sp-2)',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        {subZoneNameEn(r.subZoneId)}
                        {r.submitters > 0 && r.id === compareRows[0]?.id && (
                          <span className="pill pill-ok">Most regular</span>
                        )}
                      </span>
                    ),
                  },
                  { key: 'registered', label: 'Registered', align: 'right', render: (r) => <span className="mono">{r.registered}</span> },
                  { key: 'submitters', label: 'Did dhyan', align: 'right', render: (r) => <span className="mono">{r.submitters}</span> },
                  { key: 'rounds', label: 'Rounds', align: 'right', render: (r) => <span className="mono">{r.rounds}</span> },
                  // percent() derives it again from the two counts beside it, so the row
                  // cannot show a share that disagrees with its own numbers (§62).
                  { key: 'share', label: 'Took part', align: 'right', render: (r) => percent(r.submitters, r.registered) },
                ]}
                rows={compareRows}
                rowKey={(r) => r.id}
              />

              <p className="card-note">
                Based on {gu(compare.data?.scanned ?? 0)} rounds submitted in this range.
                {compare.data?.truncated ? ` Only the first ${compare.data.cap} were read - choose a shorter range.` : ''}
                {compare.data?.unknownRounds
                  ? ` ${compare.data.unknownRounds} round(s) belong to a subzone this panel does not know and are not counted above.`
                  : ''}
              </p>

              <div className="toolbar">
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    runExport(
                      reportFilename('mandal-comparison', { from: cFrom, to: cTo }),
                      compareColumns,
                      compareRows,
                      'subzones'
                    )
                  }
                >
                  Export to Excel (CSV)
                </button>
                <span className="hint grow">Totals only - no yuvak is named in this file</span>
              </div>
            </>
          </AsyncBlock>
        )}
      </div>

      {/*
        The gap, stated in the panel rather than only in a commit message.

        §11 asks for આજનો સ્કોર, સૌથી સારો સ્કોર and કુલ દિવસ on the yuvak list, and §9
        describes a day's Level 3/4 result being saved permanently before the midnight-IST
        reset. `public.progress` (0001_init.sql:46-60) is the table built for exactly that —
        `date`, `level3_score`, `level4_score`, one row per yuvak per day — and **nothing
        in this codebase reads or writes it**. Levels 3 and 4 are Phase 3 and are not built.

        So there is no day-by-day score history to report over, and no page here invents
        one. Everything above is measured from what the app really records: `learning_state`
        for where a yuvak stands, and `learning_sessions.submitted_at` for when a round
        happened. Saying so in the UI is the point — a સંચાલક who cannot find a daily-score
        report should learn that it does not exist yet, not conclude that everybody scored
        zero.
      */}
      <div className="card">
        <h2>Day-by-day scores</h2>
        <p>
          There is no daily score report yet, because no daily score is being saved yet.
          Levels 3 and 4 - the ticks that produce a day's score, and the midnight reset that
          files it into history - are still to be built.
        </p>
        <p className="card-note">
          Until then, the date ranges in this panel report what is genuinely recorded: when a
          yuvak registered (Users) and when a round was submitted (Sessions). Nothing here
          shows a score for a date.
        </p>
      </div>

      {/*
        §39 — which scenes are hardest. Honest about being a sample, not the whole org.

        The guard used to be `!hot.loading && !hot.error && rows.length > 0`, so a failed
        read removed the entire section: no message, no Try again, and nothing to say the
        section had ever been there. Every other block on this page goes through AsyncBlock
        and its four states (§53); this one now does too, and an empty sample is stated
        rather than hidden.
      */}
      <div className="card">
        <h2>Hardest Darshan</h2>
        {/* The caveat is said before the numbers as well as after them. What follows is a
            sample of recent rounds, not an organisation-wide fact, and a reader who takes
            the top row to a meeting must have met that sentence before he met the row —
            the exact sample size is stated under the table, where the figure it qualifies
            actually is. */}
        <p className="card-note">
          Which દર્શન are most often still remaining, measured from a sample of the most
          recent rounds - not from every round ever submitted.
        </p>
        <AsyncBlock
          state={{ ...hot, isEmpty: !hot.loading && !hot.error && !hot.data?.rows?.length }}
          emptyTitle="Nothing to compare yet"
          empty="No round has been submitted yet, so there is nothing to compare."
          onRetry={hot.retry}
          skeleton={<TableSkeleton cols={4} />}
        >
          <>
            {/* Optional chaining throughout: AsyncBlock builds its children before it
                decides which state to render, so `hot.data` is still null during the load
                and on an error. */}
            <DataTable
              caption="Hardest Darshan"
              columns={[
                // Every label is written to survive on its own, because below 900px the
                // row becomes a card and each label is read next to one value with no
                // header row above it to give it context. "Rounds in sample" says what
                // the last column counts; "Total sessions" read like an org-wide figure.
                { key: 'id', label: 'Darshan', render: (r) => <Link className="mono" to={`/darshan/${r.id}`}>{r.id}</Link> },
                { key: 'rememberedPct', label: 'Remembered %', align: 'right', render: (r) => <span className="mono">{r.rememberedPct}%</span> },
                { key: 'missed', label: 'Still remaining', align: 'right', render: (r) => <span className="mono">{r.missed}</span> },
                { key: 'seen', label: 'Rounds in sample', align: 'right', render: (r) => <span className="mono">{r.seen}</span> },
              ]}
              rows={hot.data?.rows?.slice(0, 10) || []}
              rowKey={(r) => r.id}
            />
            <p className="card-note">
              Based on a sample of the last {gu(hot.data?.sample ?? 0)} sessions. No user's name appears here - the totals are enough.
            </p>
          </>
        </AsyncBlock>
      </div>
    </>
  );
}
