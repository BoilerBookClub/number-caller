import bbcLogo from "../assets/bbc_logo.png";

export default function Spinner({ size = 72 }) {
  const px = typeof size === "number" ? `${size}px` : size;

  return (
    <div className="spinner-wrap" style={{ width: px, height: px }}>
      <div className="spinner-ring" />
      <img src={bbcLogo} alt="logo" className="spinner-logo" />
    </div>
  );
}
