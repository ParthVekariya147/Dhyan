/**
 * The one arrow every 'આગળ' and 'પાછળ' control wears.
 *
 * Why it exists at all: the two ways on at the foot of a દર્શન read as two equal gold
 * pills, and a યુવક who is being asked to move through a hundred scenes should be able to
 * tell forward from back without reading either label. The arrow says the direction; the
 * Gujarati word stays and says the destination. It is never the only thing on a control.
 *
 * Drawn inline, sized in attributes, coloured by `currentColor`, and positioned with an
 * inline style — deliberately, with no class of its own and no stylesheet behind it.
 * /darshan, /learn and /level/N are three lazy chunks (src/App.jsx) and Vite ships each
 * chunk's CSS with the chunk, which is why darshan.css already restates the button rules
 * it borrows. An arrow that depended on a rule living in one of those files would come
 * out unstyled — or unsized, which for an SVG means enormous — on whichever route had not
 * loaded it. This one cannot: everything it needs travels with the element.
 *
 * `aria-hidden`, always. The direction is already in the label a screen reader announces
 * ('આગળ', 'પાછળ', 'હવે પછીની કસોટી'), so a second announcement would only be noise.
 */
export default function NavArrow({ dir = 'next' }) {
  const back = dir === 'back';

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flex: 'none',
        verticalAlign: '-3px',
        marginRight: back ? 8 : 0,
        marginLeft: back ? 0 : 8,
      }}
    >
      {back ? (
        <>
          <path d="M19 12H5" />
          <path d="M11 18l-6-6 6-6" />
        </>
      ) : (
        <>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </>
      )}
    </svg>
  );
}
