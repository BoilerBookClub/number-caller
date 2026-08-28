import { memo } from "react";
import QRCode from "react-qr-code";

/**
 * A QR code that is only rebuilt when what it encodes changes.
 *
 * `react-qr-code` does all of its work inside its render function: it builds
 * the matrix, then walks every module twice to concatenate the two SVG path
 * strings. Nothing about that is cached, so it all runs again on every render
 * of whatever contains it — and both screens that draw a code re-render once a
 * second off the clock that ticks the countdown.
 *
 * Measured against a real 193-byte claim payload at error correction level H
 * (73x73 modules, which is what the knocked-out number in the middle costs):
 * 3.9ms and 137KB of throwaway path string, per render, on a fast desktop.
 * A mid-range phone is several times slower than that, and the attendee ticket
 * is open for the whole evening.
 *
 * The props are a string, a number and a string, so a shallow compare is
 * exactly the right test: the code is regenerated when the payload changes and
 * never for the clock.
 */
const MemoQrCode = memo(QRCode);

MemoQrCode.displayName = "MemoQrCode";

export default MemoQrCode;
