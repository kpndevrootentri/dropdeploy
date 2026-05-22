'use client';

import { ERROR_PAGE_CSS } from '@/lib/error-page';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>500 Server Error</title>
        <style dangerouslySetInnerHTML={{ __html: ERROR_PAGE_CSS }} />
      </head>
      <body>
        <div className="ep-root">
          <div className="ep-orb ep-orb-1" />
          <div className="ep-orb ep-orb-2" />
          <div className="ep-orb ep-orb-3" />
          <div className="ep-digits">
            <span className="ep-d">5</span>
            <span className="ep-d">0</span>
            <span className="ep-d">0</span>
          </div>
          <div className="ep-label">
            <h2>Internal Server Error</h2>
            <div className="ep-divider" />
            <p>Something went wrong on our end. Please try again.</p>
            <div className="ep-actions">
              <button onClick={reset} className="ep-btn ep-btn-primary">
                Try again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
