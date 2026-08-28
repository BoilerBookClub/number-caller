import { useEffect, useRef, useState } from "react";

/*
 * How light or dark the camera is currently looking at.
 *
 * The scanner's alignment brackets are drawn over whatever the room happens to
 * be: a translucent white reads well against a table, a floor or a dark jacket,
 * and vanishes entirely against a white wall, a lit ceiling or a phone screen
 * held up at full brightness — which is exactly what the operator is pointing
 * at half the time. So the ink follows the scene instead of assuming one.
 *
 * The frame is sampled straight off the <video>, which is same-origin media and
 * so does not taint a canvas, downscaled to a handful of pixels. That is a few
 * hundred bytes of pixel maths twice a second — far cheaper than it sounds, and
 * an order of magnitude below what the QR decoder behind it is already doing.
 */

// The square drawn into. Downscaling to this is the averaging: the browser's
// own image scaler does the work, and every pixel of the region contributes.
const SAMPLE_UNITS = 12;

// The middle of the frame, which is where the brackets are. The video is
// `object-fit: cover` and centred, so the middle of the picture and the middle
// of the screen are the same point whatever the aspect ratio does.
const SAMPLE_REGION_RATIO = 0.6;

const SAMPLE_INTERVAL_MS = 400;

/*
 * Two thresholds rather than one, and a gap between them.
 *
 * A single threshold flips back and forth every sample when the scene sits on
 * it — a hand moving over a desk is enough — and a frame that changes colour
 * twice a second is worse than one in the wrong colour. Ink only goes dark on
 * a clearly light scene, and only comes back on a clearly dark one.
 */
const LIGHT_ENTER_LUMINANCE = 0.6;
const LIGHT_EXIT_LUMINANCE = 0.45;

/** Rec. 709 relative luminance, 0 (black) to 1 (white). */
function readAverageLuminance(context) {
  const { data } = context.getImageData(0, 0, SAMPLE_UNITS, SAMPLE_UNITS);
  let total = 0;

  for (let index = 0; index < data.length; index += 4) {
    total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }

  return total / (data.length / 4) / 255;
}

/**
 * Returns "light" or "dark" for what the camera is pointed at.
 *
 * `isActive` false parks the sampling — a closed scanner, or a frame that is
 * hidden behind the scan status, has nothing to colour itself against.
 */
export default function useCameraBackdropTone(videoRef, { isActive }) {
  const [tone, setTone] = useState("dark");
  // Read inside the sampler without making it a dependency, which would tear
  // the interval down and build it up again on every change of tone.
  const toneRef = useRef(tone);

  toneRef.current = tone;

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const canvas = document.createElement("canvas");

    canvas.width = SAMPLE_UNITS;
    canvas.height = SAMPLE_UNITS;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return undefined;
    }

    let intervalId = null;

    const sample = () => {
      const video = videoRef.current;

      // HAVE_CURRENT_DATA. Before that there is no frame to draw, and drawing
      // one anyway paints the last one — or nothing at all — as a black square.
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return;
      }

      const region = Math.min(video.videoWidth, video.videoHeight) * SAMPLE_REGION_RATIO;

      try {
        context.drawImage(
          video,
          (video.videoWidth - region) / 2,
          (video.videoHeight - region) / 2,
          region,
          region,
          0,
          0,
          SAMPLE_UNITS,
          SAMPLE_UNITS,
        );

        const luminance = readAverageLuminance(context);
        const isLight =
          toneRef.current === "light"
            ? luminance > LIGHT_EXIT_LUMINANCE
            : luminance > LIGHT_ENTER_LUMINANCE;

        setTone(isLight ? "light" : "dark");
      } catch {
        /* A browser that will not hand back the pixels, which is its right.
           Stop asking and leave the frame in the colour it already has. */
        if (intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    sample();
    intervalId = window.setInterval(sample, SAMPLE_INTERVAL_MS);

    return () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
    };
  }, [isActive, videoRef]);

  return tone;
}
