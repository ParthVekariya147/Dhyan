import DarshanFeed from './DarshanFeed';
import ProgressBar from '../../components/ProgressBar';
import BackToTop from '../../components/BackToTop';
import darshan from '../../../content/darshan.json';

export default function DarshanPage() {
  return (
    <>
      <ProgressBar />

      <header className="site-header">
        <h1>નીલકંઠ વર્ણી ધ્યાન</h1>
        <p>૧૦૦ દ્રશ્યોનું ક્રમબદ્ધ દર્શન</p>
        <div className="rule" />
      </header>

      <DarshanFeed items={darshan} />

      <footer>
        ચિત્રો: © Swaminarayan Temple Karelibaug-Vadodara &amp; Kundaldham
        <br />
        જય સ્વામિનારાયણ 🙏
      </footer>

      <BackToTop />
    </>
  );
}
