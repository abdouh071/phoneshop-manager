import React from 'react';
import { highlightSegments } from '../../utils/searchUtils';

interface HighlightTextProps {
  /** The full text string to display. */
  text: string;
  /** The search query to highlight within the text. */
  query: string;
  /** Optional class name applied to the wrapping <span>. */
  className?: string;
}

/**
 * Renders `text` with any portions matching `query` wrapped in a <mark> element.
 *
 * @example
 *   <HighlightText text="iPhone 15 Pro Max" query="15 pro" />
 *   // → "iPhone " + <mark>15</mark> + " " + <mark>Pro</mark> + " Max"
 */
export const HighlightText: React.FC<HighlightTextProps> = ({ text, query, className }) => {
  const segments = highlightSegments(text, query);

  if (segments.length === 1 && !segments[0].highlight) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark key={i} style={{ background: 'rgba(255, 200, 0, 0.35)', borderRadius: '2px', padding: '0 1px' }}>
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </span>
  );
};

