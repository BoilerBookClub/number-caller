import { ZigZagFiller } from "roughjs/bin/fillers/zigzag-filler";

// wired-elements currently calls fillPolygon(), while roughjs exposes fillPolygons().
// Add a tiny runtime bridge so both APIs work.
if (
  ZigZagFiller?.prototype &&
  typeof ZigZagFiller.prototype.fillPolygons === "function" &&
  typeof ZigZagFiller.prototype.fillPolygon !== "function"
) {
  Object.defineProperty(ZigZagFiller.prototype, "fillPolygon", {
    configurable: true,
    writable: true,
    value(points, options) {
      return this.fillPolygons([points], options);
    },
  });
}
