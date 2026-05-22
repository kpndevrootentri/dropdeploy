'use client';

export const ERROR_PAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .ep-root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #060608;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
    gap: 40px;
  }

  .ep-orb {
    position: fixed;
    border-radius: 50%;
    filter: blur(100px);
    pointer-events: none;
    z-index: 0;
  }
  .ep-orb-1 {
    width: 560px; height: 560px;
    background: radial-gradient(circle, rgba(124,58,237,0.28), transparent 70%);
    top: -180px; left: -120px;
    animation: ep-d1 16s ease-in-out infinite alternate;
  }
  .ep-orb-2 {
    width: 480px; height: 480px;
    background: radial-gradient(circle, rgba(219,39,119,0.2), transparent 70%);
    bottom: -140px; right: -100px;
    animation: ep-d2 20s ease-in-out infinite alternate;
  }
  .ep-orb-3 {
    width: 360px; height: 360px;
    background: radial-gradient(circle, rgba(14,165,233,0.14), transparent 70%);
    top: 50%; left: 50%;
    transform: translate(-50%,-50%);
    animation: ep-d3 13s ease-in-out infinite alternate;
  }
  @keyframes ep-d1 { to { transform: translate(50px, 35px); } }
  @keyframes ep-d2 { to { transform: translate(-35px, -50px); } }
  @keyframes ep-d3 { to { transform: translate(-50%,-52%) scale(1.15); } }

  .ep-digits {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 8px;
  }

  .ep-d {
    display: inline-block;
    font-size: 148px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -2px;
    color: #ddd6fe;
    transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(0);
    text-shadow:
      2px  3px 0 #a78bfa,
      4px  6px 0 #9333ea,
      6px  9px 0 #7c3aed,
      8px  12px 0 #6d28d9,
      10px 15px 0 #5b21b6,
      12px 18px 0 #4c1d95,
      14px 21px 0 #3b0764,
      16px 23px 0 rgba(20,5,50,0.7),
      18px 25px 0 rgba(10,2,28,0.4);
    filter: drop-shadow(0 28px 48px rgba(109,40,217,0.45));
    animation: ep-bob 5s ease-in-out infinite;
  }
  .ep-d:nth-child(1) { animation-delay:  0s; }
  .ep-d:nth-child(2) { animation-delay: -1.8s; }
  .ep-d:nth-child(3) { animation-delay: -3.4s; }

  @keyframes ep-bob {
    0%,100% { transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(0px); }
    50%      { transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(-14px); }
  }

  .ep-label {
    position: relative;
    z-index: 1;
    text-align: center;
  }
  .ep-label h2 {
    font-size: 21px;
    font-weight: 600;
    color: #e2e8f0;
    letter-spacing: -0.2px;
    margin-bottom: 10px;
  }
  .ep-divider {
    width: 44px; height: 2px;
    margin: 0 auto 12px;
    border-radius: 2px;
    background: linear-gradient(90deg, #7c3aed, #db2777);
  }
  .ep-label p {
    font-size: 14px;
    color: #475569;
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .ep-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ep-btn {
    display: inline-block;
    padding: 9px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    border: none;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  .ep-btn:hover { opacity: 0.85; }
  .ep-btn-primary {
    color: #0a0a0a;
    background: #c4b5fd;
  }
  .ep-btn-ghost {
    color: #c4b5fd;
    background: rgba(124,58,237,0.1);
    border: 1px solid rgba(167,139,250,0.25);
  }
`;

interface ErrorPageProps {
  digits: [string, string, string];
  title: string;
  description: string;
  actions?: React.ReactNode;
}

export function ErrorPageContent({ digits, title, description, actions }: ErrorPageProps): React.ReactElement {
  return (
    <div className="ep-root">
      <style dangerouslySetInnerHTML={{ __html: ERROR_PAGE_CSS }} />
      <div className="ep-orb ep-orb-1" />
      <div className="ep-orb ep-orb-2" />
      <div className="ep-orb ep-orb-3" />
      <div className="ep-digits">
        <span className="ep-d">{digits[0]}</span>
        <span className="ep-d">{digits[1]}</span>
        <span className="ep-d">{digits[2]}</span>
      </div>
      <div className="ep-label">
        <h2>{title}</h2>
        <div className="ep-divider" />
        <p>{description}</p>
        {actions && <div className="ep-actions">{actions}</div>}
      </div>
    </div>
  );
}
