import bbcLogo from "../assets/bbc_logo.png";

export default function Spinner({ size = 72 }) {
  const numericSize = typeof size === "number" ? size : parseInt(size, 10) || 72;
  const px = `${numericSize}px`;
  const ringWidth = Math.max(4, Math.round(numericSize * 0.08));
  const logoPct = 0.56;

  return (
    <div className="spinner-wrap" style={{ width: px, height: px }}>
      <div
        className="spinner-ring"
        style={{ borderWidth: `${ringWidth}px` }}
        aria-hidden
      />
      <img
        src={bbcLogo}
        alt="logo"
        className="spinner-logo"
        style={{ width: `${logoPct * 100}%`, height: `${logoPct * 100}%` }}
      />
    </div>
  );
}
