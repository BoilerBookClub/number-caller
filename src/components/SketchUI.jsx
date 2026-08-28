/*
 * Every wired-element starts at `opacity: 0` and only becomes visible once the
 * library adds a `wired-rendered` class to it. React controls the class
 * attribute here, so each time a className changes React rewrites the attribute
 * and drops that token — the element goes invisible until something triggers a
 * redraw. That is why toggling the graphs panel made the whole attendee list
 * blink out, and why roster rows intermittently lost their background. Baking
 * the token into the class string keeps the element visible across re-renders.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import "../roughCompat";
import { line as drawSketchLine } from "wired-elements/lib/wired-lib.js";
import "wired-elements/lib/wired-button.js";
import "wired-elements/lib/wired-card.js";
import "wired-elements/lib/wired-checkbox.js";
import "wired-elements/lib/wired-combo.js";
import "wired-elements/lib/wired-dialog.js";
import "wired-elements/lib/wired-divider.js";
import "wired-elements/lib/wired-icon-button.js";
import "wired-elements/lib/wired-input.js";
import "wired-elements/lib/wired-item.js";
import "wired-elements/lib/wired-progress.js";
import "wired-elements/lib/wired-search-input.js";
import "wired-elements/lib/wired-slider.js";
import "wired-elements/lib/wired-textarea.js";
import "wired-elements/lib/wired-toggle.js";

/*
 * Redraw a wired element whenever its box changes size.
 *
 * Every wired element draws its outline to an SVG sized from the box it
 * measured at the moment lit last called updated(), and then leaves it there —
 * WiredBase.wiredRender() only re-runs on a lit update, never on a change of
 * size that came from CSS. So anything whose height or width is decided by a
 * stylesheet rather than by its own content keeps whatever outline it happened
 * to be born with: a corner button given a min-height by a rule stays drawn at
 * the smaller size its text alone would have been, and the drawn box no longer
 * fills the element, which reads as slack on the sides that the layout has
 * already tightened.
 *
 * `wiredRender(true)` forces the remeasure. The first frame and the delayed
 * pass cover the two ways a first paint can be wrong — layout not settled, and
 * webfonts arriving late and changing the text metrics.
 */
function useWiredRedraw(elementRef, deps, { delayMs = 0 } = {}) {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return undefined;
    }

    let frameId = null;
    let timeoutId = null;
    let resizeObserver = null;

    const redraw = () => {
      if (typeof element.requestUpdate === "function") {
        element.requestUpdate();
      }

      if (typeof element.wiredRender === "function") {
        element.wiredRender(true);
      }
    };

    redraw();
    frameId = window.requestAnimationFrame(redraw);
    timeoutId = window.setTimeout(redraw, delayMs);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(redraw);
      resizeObserver.observe(element);
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const SketchButton = forwardRef(function SketchButton(
  { type = "button", onClick, disabled, className = "", ...props },
  ref,
) {
  /* An internal ref as well as the forwarded one, because the redraw below has
     to reach the element itself; callers still get the same node. */
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  /*
   * Sized by CSS in several places — the navbar's buttons stretch to fill their
   * row, and a panel's corner action takes the height of the header band — so
   * this is exactly the case the hook above exists for. Without it the drawn
   * rectangle kept the height the label alone would have had and sat inside the
   * button's real box, which read as slack on whichever edge the layout had
   * just pulled in.
   */
  useWiredRedraw(innerRef, [className, disabled], { delayMs: 60 });

  const handleClick = (event) => {
    // Do not rely on the custom element setting pointer-events: none. The
    // controls behind this include End Event and the queue's primary action.
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (typeof onClick === "function") {
      onClick(event);
    }

    if (event.defaultPrevented || !event.currentTarget) {
      return;
    }

    const parentForm = event.currentTarget.closest("form");
    if (!parentForm) {
      return;
    }

    if (type === "submit" && typeof parentForm.requestSubmit === "function") {
      parentForm.requestSubmit();
      return;
    }

    if (type === "reset" && typeof parentForm.reset === "function") {
      parentForm.reset();
    }
  };

  return (
    <wired-button
      ref={innerRef}
      class={className ? `sketch-button wired-rendered ${className}` : "sketch-button wired-rendered"}
      disabled={disabled}
      onClick={handleClick}
      {...props}
    />
  );
});

const SketchInput = forwardRef(function SketchInput(
  { onChange, value, defaultValue, className = "", ...props },
  ref,
) {
  const innerRef = useRef(null);
  const hasAppliedDefaultValueRef = useRef(false);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const inputElement = innerRef.current;
    if (!inputElement) {
      return undefined;
    }

    const handleInput = (event) => {
      if (typeof onChange === "function") {
        const sourceEvent = event?.detail?.sourceEvent;
        onChange(sourceEvent || event);
      }
    };

    inputElement.addEventListener("input", handleInput);

    return () => {
      inputElement.removeEventListener("input", handleInput);
    };
  }, [onChange]);

  useEffect(() => {
    const inputElement = innerRef.current;
    if (!inputElement || value === undefined) {
      return;
    }

    const normalizedValue = value == null ? "" : String(value);
    if (inputElement.value !== normalizedValue) {
      inputElement.value = normalizedValue;
    }
  }, [value]);

  useEffect(() => {
    const inputElement = innerRef.current;
    if (!inputElement || value !== undefined || hasAppliedDefaultValueRef.current) {
      return;
    }

    if (defaultValue !== undefined) {
      inputElement.value = defaultValue == null ? "" : String(defaultValue);
      hasAppliedDefaultValueRef.current = true;
    }
  }, [defaultValue, value]);

  return (
    <wired-input
      ref={innerRef}
      class={className ? `sketch-input wired-rendered ${className}` : "sketch-input wired-rendered"}
      {...props}
    />
  );
});

const SketchSearchInput = forwardRef(function SketchSearchInput(
  { onChange, value, defaultValue, className = "", ...props },
  ref,
) {
  const innerRef = useRef(null);
  const hasAppliedDefaultValueRef = useRef(false);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const inputElement = innerRef.current;
    if (!inputElement) {
      return undefined;
    }

    const handleInput = (event) => {
      if (typeof onChange === "function") {
        const sourceEvent = event?.detail?.sourceEvent;
        onChange(sourceEvent || event);
      }
    };

    inputElement.addEventListener("input", handleInput);
    inputElement.addEventListener("change", handleInput);

    return () => {
      inputElement.removeEventListener("input", handleInput);
      inputElement.removeEventListener("change", handleInput);
    };
  }, [onChange]);

  useEffect(() => {
    const inputElement = innerRef.current;
    if (!inputElement || value === undefined) {
      return;
    }

    const normalizedValue = value == null ? "" : String(value);
    if (inputElement.value !== normalizedValue) {
      inputElement.value = normalizedValue;
    }
  }, [value]);

  useEffect(() => {
    const inputElement = innerRef.current;
    if (!inputElement || value !== undefined || hasAppliedDefaultValueRef.current) {
      return;
    }

    if (defaultValue !== undefined) {
      inputElement.value = defaultValue == null ? "" : String(defaultValue);
      hasAppliedDefaultValueRef.current = true;
    }
  }, [defaultValue, value]);

  /*
   * The width here is decided entirely by the grid it sits in, so it drew its
   * rectangle at whatever the first render measured and kept it: on a narrow
   * screen the outline hung off the right of the card, while the combos below
   * it — which do observe their own size — lined up correctly.
   */
  useWiredRedraw(innerRef, [className]);

  return (
    <wired-search-input
      ref={innerRef}
      class={className ? `sketch-search-input wired-rendered ${className}` : "sketch-search-input wired-rendered"}
      {...props}
    />
  );
});

const SketchTextarea = forwardRef(function SketchTextarea(
  { onChange, value, defaultValue, className = "", autoGrow = false, maxrows, rows, ...props },
  ref,
) {
  const innerRef = useRef(null);
  const hasAppliedDefaultValueRef = useRef(false);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const textareaElement = innerRef.current;
    if (!textareaElement) {
      return undefined;
    }

    const handleInput = (event) => {
      if (typeof onChange === "function") {
        const sourceEvent = event?.detail?.sourceEvent;
        onChange(sourceEvent || event);
      }
    };

    textareaElement.addEventListener("input", handleInput);
    textareaElement.addEventListener("change", handleInput);

    return () => {
      textareaElement.removeEventListener("input", handleInput);
      textareaElement.removeEventListener("change", handleInput);
    };
  }, [onChange]);

  useEffect(() => {
    const textareaElement = innerRef.current;
    if (!textareaElement || value === undefined) {
      return;
    }

    const normalizedValue = value == null ? "" : String(value);
    if (textareaElement.value !== normalizedValue) {
      textareaElement.value = normalizedValue;
    }
  }, [value]);

  useEffect(() => {
    const textareaElement = innerRef.current;
    if (!textareaElement || value !== undefined || hasAppliedDefaultValueRef.current) {
      return;
    }

    if (defaultValue !== undefined) {
      textareaElement.value = defaultValue == null ? "" : String(defaultValue);
      hasAppliedDefaultValueRef.current = true;
    }
  }, [defaultValue, value]);

  useEffect(() => {
    const textareaElement = innerRef.current;
    if (!textareaElement) {
      return;
    }

    if (rows !== undefined && !autoGrow) {
      const normalizedRows = Number(rows);
      if (Number.isFinite(normalizedRows)) {
        textareaElement.rows = normalizedRows;
      }
    }

    if (maxrows !== undefined) {
      const normalizedMaxRows = Number(maxrows);
      if (Number.isFinite(normalizedMaxRows)) {
        textareaElement.maxrows = normalizedMaxRows;
      }
    }
  }, [autoGrow, maxrows, rows]);

  /**
   * Grows the field to fit its content.
   *
   * wired-textarea declares `maxrows` but never uses it: the inner textarea has
   * a fixed `rows` and `resize: none`, so anything longer than one line is
   * simply hidden. Measure from the collapsed height each time — measuring the
   * current height would ratchet the row count upward and never shrink back.
   */
  useEffect(() => {
    const textareaElement = innerRef.current;

    if (!autoGrow || !textareaElement) {
      return undefined;
    }

    const resize = () => {
      const innerTextarea = textareaElement.shadowRoot?.getElementById("textarea");

      if (!innerTextarea) {
        return;
      }

      // wired-textarea hard-codes 10px of vertical padding, which leaves a gap
      // under a single line of text.
      innerTextarea.style.paddingTop = "6px";
      innerTextarea.style.paddingBottom = "6px";
      innerTextarea.style.boxSizing = "border-box";
      innerTextarea.style.overflowY = "hidden";

      // Collapse first: scrollHeight is never smaller than the visible box, so
      // measuring at the current height can only ever grow the field.
      innerTextarea.style.height = "auto";

      const contentHeight = innerTextarea.scrollHeight;
      const styles = window.getComputedStyle(innerTextarea);
      const verticalPadding =
        Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      const fontSize = Number.parseFloat(styles.fontSize) || 16;
      const rawLineHeight = Number.parseFloat(styles.lineHeight);
      // Reported as "normal" or as the authored unitless multiplier in some
      // browsers; only used to cap the height at maxrows.
      const lineHeight =
        !Number.isFinite(rawLineHeight) || styles.lineHeight === "normal"
          ? fontSize * 1.4
          : rawLineHeight < 4
            ? fontSize * rawLineHeight
            : rawLineHeight;
      const maxRows = Number(maxrows) || 0;
      const maxHeight = maxRows ? maxRows * lineHeight + verticalPadding : Number.POSITIVE_INFINITY;
      const nextHeight = Math.min(contentHeight, maxHeight);

      // Set the height outright rather than rounding up to whole rows — that
      // rounding is what left a blank line under multi-line rules.
      innerTextarea.style.height = `${nextHeight}px`;
      innerTextarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";

      if (typeof textareaElement.wiredRender === "function") {
        textareaElement.wiredRender(true);
      }
    };

    resize();

    const frameId = window.requestAnimationFrame(resize);

    textareaElement.addEventListener("input", resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      textareaElement.removeEventListener("input", resize);
    };
  }, [autoGrow, maxrows, rows, value]);

  useEffect(() => {
    const textareaElement = innerRef.current;
    if (!textareaElement) {
      return undefined;
    }

    let frameId = null;
    let timeoutId = null;
    let resizeObserver = null;

    const redraw = () => {
      if (typeof textareaElement.requestUpdate === "function") {
        textareaElement.requestUpdate();
      }

      if (typeof textareaElement.wiredRender === "function") {
        textareaElement.wiredRender(true);
      }
    };

    redraw();
    frameId = window.requestAnimationFrame(redraw);
    timeoutId = window.setTimeout(redraw, 0);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        redraw();
      });
      resizeObserver.observe(textareaElement);
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [className, maxrows, rows, value]);

  return (
    <wired-textarea
      ref={innerRef}
      class={className ? `sketch-textarea wired-rendered ${className}` : "sketch-textarea wired-rendered"}
      rows={rows}
      maxrows={maxrows}
      {...props}
    />
  );
});

const SketchCard = forwardRef(function SketchCard(
  {
    children,
    className = "",
    fill = "",
    redrawDelayMs = 0,
    redrawOnResize = false,
    redrawSignal,
    strokeColor = "",
    style,
    ...props
  },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  const mergedStyle = {
    ...style,
    ...(fill ? { "--sketch-fill-color": fill } : {}),
    ...(strokeColor
      ? {
          "--wired-card-background-fill": strokeColor,
        }
      : {}),
  };

  useEffect(() => {
    if (!redrawOnResize && !(Number(redrawDelayMs) > 0) && redrawSignal === undefined) {
      return undefined;
    }

    const cardElement = innerRef.current;
    if (!cardElement) {
      return undefined;
    }

    let frameId = null;
    let timeoutId = null;
    let delayedTimeoutId = null;
    let resizeObserver = null;

    const redraw = () => {
      if (typeof cardElement.requestUpdate === "function") {
        cardElement.requestUpdate();
      }

      if (typeof cardElement.wiredRender === "function") {
        cardElement.wiredRender(true);
      }
    };

    redraw();
    frameId = window.requestAnimationFrame(redraw);
    timeoutId = window.setTimeout(redraw, 0);

    if (Number(redrawDelayMs) > 0) {
      delayedTimeoutId = window.setTimeout(redraw, Number(redrawDelayMs));
    }

    if (redrawOnResize && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        redraw();
      });
      resizeObserver.observe(cardElement);
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (delayedTimeoutId != null) {
        window.clearTimeout(delayedTimeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [className, fill, redrawDelayMs, redrawOnResize, redrawSignal, strokeColor]);

  return (
    <wired-card
      ref={innerRef}
      class={className ? `sketch-card wired-rendered ${className}` : "sketch-card wired-rendered"}
      style={mergedStyle}
      {...props}
    >
      {children}
    </wired-card>
  );
});

const SketchCombo = forwardRef(function SketchCombo(
  { children, className = "", fullWidth = false, onChange, selected, ...props },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const comboElement = innerRef.current;
    if (!comboElement || selected === undefined) {
      return;
    }

    const normalizedSelected = selected == null ? "" : String(selected);
    let frameId = null;
    let timeoutId = null;

    const applySelectedValue = () => {
      comboElement.selected = normalizedSelected;

      // wired-combo can throw if refreshSelection runs before its shadow slot is ready.
      const slotElement = comboElement.shadowRoot?.getElementById?.("slot");
      if (slotElement && typeof comboElement.refreshSelection === "function") {
        comboElement.refreshSelection();
      }

      if (typeof comboElement.requestUpdate === "function") {
        comboElement.requestUpdate();
      }
    };

    applySelectedValue();
    frameId = window.requestAnimationFrame(applySelectedValue);
    timeoutId = window.setTimeout(applySelectedValue, 0);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [selected, children]);

  useEffect(() => {
    const comboElement = innerRef.current;
    if (!comboElement || typeof onChange !== "function") {
      return undefined;
    }

    const handleSelected = (event) => {
      const selectedValue = event?.detail?.selected ?? comboElement.selected ?? "";
      onChange({
        target: {
          value: selectedValue,
        },
      });
    };

    comboElement.addEventListener("selected", handleSelected);

    return () => {
      comboElement.removeEventListener("selected", handleSelected);
    };
  }, [onChange]);

  /*
   * wired-combo positions its outline and drop arrow from the text's measured
   * width at draw time, and never redraws on its own. The sketch fonts load
   * after that first draw, so the label grows underneath an arrow placed for
   * the fallback font. One redraw once the fonts settle puts them back in step.
   */
  useEffect(() => {
    const comboElement = innerRef.current;
    if (!comboElement || !document.fonts?.ready) {
      return undefined;
    }

    let cancelled = false;

    document.fonts.ready.then(() => {
      if (!cancelled && typeof comboElement.requestUpdate === "function") {
        comboElement.requestUpdate();
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const comboElement = innerRef.current;
    if (!comboElement || !fullWidth) {
      return undefined;
    }

    let positionFrameId = null;

    const positionDropdownCard = () => {
      const cardElement = comboElement.shadowRoot?.getElementById?.("card");
      if (!cardElement || cardElement.style.display === "none") {
        return;
      }

      const gapPx = 6;
      const viewportHeight =
        window.innerHeight || document.documentElement?.clientHeight || 0;
      const hostRect = comboElement.getBoundingClientRect();
      const cardRect = cardElement.getBoundingClientRect();
      const spaceBelow = Math.max(0, viewportHeight - hostRect.bottom - gapPx);
      const spaceAbove = Math.max(0, hostRect.top - gapPx);
      const shouldOpenUpward = cardRect.height > spaceBelow && spaceAbove > spaceBelow;
      const maxDropdownHeight = Math.max(
        128,
        Math.floor(shouldOpenUpward ? spaceAbove : spaceBelow),
      );

      cardElement.style.left = "0px";
      cardElement.style.right = "auto";
      cardElement.style.zIndex = "1000";
      cardElement.style.overflowY = "auto";
      cardElement.style.overscrollBehavior = "contain";
      cardElement.style.maxHeight = `${maxDropdownHeight}px`;

      if (shouldOpenUpward) {
        cardElement.style.top = "auto";
        cardElement.style.bottom = `calc(100% + ${gapPx}px)`;
      } else {
        cardElement.style.bottom = "auto";
        cardElement.style.top = `calc(100% + ${gapPx}px)`;
      }
    };

    const requestDropdownPosition = () => {
      if (positionFrameId != null) {
        window.cancelAnimationFrame(positionFrameId);
      }

      positionFrameId = window.requestAnimationFrame(() => {
        positionFrameId = null;
        positionDropdownCard();
      });
    };

    const syncComboLayout = () => {
      const shadowRoot = comboElement.shadowRoot;
      const containerElement = shadowRoot?.getElementById?.("container");
      const textPanelElement = shadowRoot?.getElementById?.("textPanel");
      const dropPanelElement = shadowRoot?.getElementById?.("dropPanel");
      if (!containerElement || !textPanelElement || !dropPanelElement) {
        return;
      }

      const hostWidth = comboElement.getBoundingClientRect().width;
      if (!(hostWidth > 0)) {
        return;
      }

      // wired-combo renders inline shadow children; force a stable full-width, left-aligned flex layout.
      containerElement.style.display = "flex";
      containerElement.style.width = "100%";
      containerElement.style.alignItems = "stretch";
      containerElement.style.textAlign = "left";
      textPanelElement.style.flex = "1 1 auto";
      textPanelElement.style.minWidth = "0";
      textPanelElement.style.width = "auto";
      textPanelElement.style.display = "inline-flex";
      textPanelElement.style.alignItems = "center";
      textPanelElement.style.justifyContent = "flex-start";
      textPanelElement.style.textAlign = "left";
      // The longest font names would otherwise run under the drop arrow.
      textPanelElement.style.overflow = "hidden";
      textPanelElement.style.whiteSpace = "nowrap";
      textPanelElement.style.textOverflow = "ellipsis";
      dropPanelElement.style.flex = "0 0 34px";
      dropPanelElement.style.width = "34px";
      dropPanelElement.style.minWidth = "34px";

      /*
       * The label is a <span> inside the panel, and the panel is a flex
       * container — text-overflow on a flex container never reaches the text
       * inside it, so the ellipsis has to be set on the span itself. Without
       * this a long name is cut mid-letter at the panel's edge.
       */
      const labelElement = textPanelElement.querySelector("span");

      if (labelElement) {
        labelElement.style.minWidth = "0";
        labelElement.style.overflow = "hidden";
        labelElement.style.whiteSpace = "nowrap";
        labelElement.style.textOverflow = "ellipsis";
      }

      /*
       * Optional fixed height, so a combo can be lined up with a neighbouring
       * input. It has to be applied to the panels rather than the host: the
       * sketch outline is drawn from #textPanel's bounding rect, so sizing the
       * host alone just pads empty space around a short box.
       *
       * The value is read from a CSS custom property — a constant, not a
       * measurement of the element itself, which is what made the earlier
       * height sync grow without bound.
       *
       * border-box first: #textPanel carries 8px of padding, so as a content
       * box the requested height came out 16px taller than asked for, and the
       * picker stood visibly taller than the field beside it.
       */
      const fixedHeight = window
        .getComputedStyle(comboElement)
        .getPropertyValue("--sketch-combo-height")
        .trim();

      if (fixedHeight) {
        textPanelElement.style.boxSizing = "border-box";
        textPanelElement.style.height = fixedHeight;
        textPanelElement.style.minHeight = fixedHeight;
        dropPanelElement.style.boxSizing = "border-box";
        dropPanelElement.style.height = fixedHeight;
        dropPanelElement.style.minHeight = fixedHeight;
      }

      /*
       * The panels used to be given an explicit pixel height derived from the
       * host's measured height. Since the panels are inside the host, that is a
       * feedback loop: whenever the surrounding padding exceeded the 10px that
       * was subtracted, every pass made the element a few pixels taller and the
       * ResizeObserver fired again — the combo grew without limit until it ran
       * off the screen. `align-items: stretch` above already matches the two
       * panels to the container, with no measurement involved.
       */

      if (typeof comboElement.requestUpdate === "function") {
        comboElement.requestUpdate();
      }

      requestDropdownPosition();
    };

    let frameId = null;
    let timeoutId = null;
    frameId = window.requestAnimationFrame(syncComboLayout);
    timeoutId = window.setTimeout(syncComboLayout, 0);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        syncComboLayout();
      });
      resizeObserver.observe(comboElement);
    }

    let mutationObserver = null;
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        requestDropdownPosition();
      });
      mutationObserver.observe(comboElement, {
        attributes: true,
        attributeFilter: ["aria-expanded"],
      });
    }

    comboElement.addEventListener("click", requestDropdownPosition);
    comboElement.addEventListener("keydown", requestDropdownPosition);
    comboElement.addEventListener("selected", requestDropdownPosition);
    window.addEventListener("resize", requestDropdownPosition);
    window.addEventListener("scroll", requestDropdownPosition, true);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (positionFrameId != null) {
        window.cancelAnimationFrame(positionFrameId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
      }
      comboElement.removeEventListener("click", requestDropdownPosition);
      comboElement.removeEventListener("keydown", requestDropdownPosition);
      comboElement.removeEventListener("selected", requestDropdownPosition);
      window.removeEventListener("resize", requestDropdownPosition);
      window.removeEventListener("scroll", requestDropdownPosition, true);
    };
  }, [children, fullWidth, selected]);

  return (
    <wired-combo
      ref={innerRef}
      class={className ? `sketch-combo wired-rendered ${className}` : "sketch-combo wired-rendered"}
      {...props}
    >
      {children}
    </wired-combo>
  );
});

const SketchToggle = forwardRef(function SketchToggle(
  { checked, defaultChecked, disabled, onChange, className = "", ...props },
  ref,
) {
  const innerRef = useRef(null);
  const hasAppliedDefaultCheckedRef = useRef(false);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const toggleElement = innerRef.current;
    if (!toggleElement || checked === undefined) {
      return;
    }

    toggleElement.checked = Boolean(checked);
  }, [checked]);

  useEffect(() => {
    const toggleElement = innerRef.current;
    if (!toggleElement) {
      return undefined;
    }

    let frameId = null;

    if (typeof toggleElement.requestUpdate === "function") {
      toggleElement.requestUpdate();
    }

    if (typeof toggleElement.wiredRender === "function") {
      frameId = window.requestAnimationFrame(() => {
        toggleElement.wiredRender(true);
      });
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [checked, className, disabled]);

  useEffect(() => {
    const toggleElement = innerRef.current;
    if (!toggleElement || checked !== undefined || hasAppliedDefaultCheckedRef.current) {
      return;
    }

    if (defaultChecked !== undefined) {
      toggleElement.checked = Boolean(defaultChecked);
      hasAppliedDefaultCheckedRef.current = true;
    }
  }, [checked, defaultChecked]);

  useEffect(() => {
    const toggleElement = innerRef.current;
    if (!toggleElement || typeof onChange !== "function") {
      return undefined;
    }

    const handleChange = (event) => {
      onChange(event?.detail?.sourceEvent || event);
    };

    toggleElement.addEventListener("change", handleChange);

    return () => {
      toggleElement.removeEventListener("change", handleChange);
    };
  }, [onChange]);

  return (
    <wired-toggle
      ref={innerRef}
      class={className ? `sketch-toggle wired-rendered ${className}` : "sketch-toggle wired-rendered"}
      disabled={disabled}
      {...props}
    />
  );
});

const SketchIconButton = forwardRef(function SketchIconButton(
  { onClick, disabled, className = "", ...props },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  /*
   * wired-icon-button sizes its circle from the inner button's bounding box at
   * the moment lit calls updated(). If the icon has not laid out yet that box
   * measures near zero and the ellipse is drawn at that size, leaving a button
   * with no visible outline — hence the delayed pass as well as the observer.
   */
  useWiredRedraw(innerRef, [className, disabled], { delayMs: 60 });

  const handleClick = (event) => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (typeof onClick === "function") {
      onClick(event);
    }
  };

  return (
    <wired-icon-button
      ref={innerRef}
      class={className ? `sketch-icon-button wired-rendered ${className}` : "sketch-icon-button wired-rendered"}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      onClick={handleClick}
      {...props}
    />
  );
});

const SketchDialog = forwardRef(function SketchDialog(
  { className = "", open = false, onClose, ...props },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    if (innerRef.current) {
      innerRef.current.open = Boolean(open);
    }
  }, [open]);

  useEffect(() => {
    const dialogElement = innerRef.current;
    if (!dialogElement || typeof onClose !== "function") {
      return undefined;
    }

    const handleClose = () => {
      onClose();
    };

    dialogElement.addEventListener("close", handleClose);
    dialogElement.addEventListener("closed", handleClose);

    return () => {
      dialogElement.removeEventListener("close", handleClose);
      dialogElement.removeEventListener("closed", handleClose);
    };
  }, [onClose]);

  return (
    <wired-dialog
      ref={innerRef}
      class={className ? `sketch-dialog ${className}` : "sketch-dialog"}
      {...props}
    />
  );
});

/*
 * A one-button alert dialog for status/error copy that used to sit in an
 * inline banner at the top of a page. Controlled entirely by `message`: it is
 * open whenever there is one to show, and closes itself back to nothing on
 * dismiss, so callers just need a piece of state and a setter that clears it.
 */
function SketchMessageDialog({ className = "", dismissLabel = "OK", message, onDismiss, title }) {
  return (
    <SketchDialog
      className={className ? `sketch-confirm-dialog ${className}` : "sketch-confirm-dialog"}
      open={Boolean(message)}
      onClose={onDismiss}
    >
      <div className="confirm-dialog-content">
        {title ? <h3 className="confirm-dialog-title">{title}</h3> : null}
        <p className="confirm-dialog-copy">{message}</p>
        <div className="confirm-dialog-actions">
          <SketchButton type="button" onClick={onDismiss}>
            {dismissLabel}
          </SketchButton>
        </div>
      </div>
    </SketchDialog>
  );
}

/*
 * A two-button confirm dialog, for a control whose click cannot be taken back
 * — logging out being the one every screen has. Same shape as
 * SketchMessageDialog above, but the caller owns `open` because the question
 * has to survive the answer being "no".
 */
function SketchConfirmDialog({
  cancelLabel = "Cancel",
  className = "",
  confirmLabel = "Confirm",
  message,
  onCancel,
  onConfirm,
  open = false,
  title,
  tone = "",
}) {
  return (
    <SketchDialog
      className={className ? `sketch-confirm-dialog ${className}` : "sketch-confirm-dialog"}
      open={open}
      onClose={onCancel}
    >
      <div className="confirm-dialog-content">
        {title ? <h3 className="confirm-dialog-title">{title}</h3> : null}
        {message ? <p className="confirm-dialog-copy">{message}</p> : null}
        <div className="confirm-dialog-actions">
          <SketchButton type="button" className="secondary-button" onClick={onCancel}>
            {cancelLabel}
          </SketchButton>
          <SketchButton
            type="button"
            className={tone === "danger" ? "danger-button" : ""}
            onClick={onConfirm}
          >
            {confirmLabel}
          </SketchButton>
        </div>
      </div>
    </SketchDialog>
  );
}

/*
 * A drawn rule, for separating sections inside a card.
 *
 * wired-divider measures its own width to draw, so it needs a redraw when the
 * layout around it settles; redrawOnResize is handled by the element itself.
 */
const SketchDivider = forwardRef(function SketchDivider(
  { className = "", elevation = 1, ...props },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  return (
    <wired-divider
      ref={innerRef}
      class={className ? `sketch-divider ${className}` : "sketch-divider"}
      elevation={elevation}
      {...props}
    />
  );
});

/*
 * A drawn rule for separating side-by-side panels.
 *
 * wired-divider always measures and draws along its own width, so it can only
 * ever be a horizontal rule — rotating the host with CSS would make it
 * re-measure its own post-rotation bounding box and draw at the wrong length.
 * This draws straight onto an SVG sized to the host's own height instead,
 * using the same rough-line primitive wired-divider draws with, and redraws
 * whenever a ResizeObserver reports that height changed.
 */
const SketchVerticalDivider = forwardRef(function SketchVerticalDivider(
  { className = "", elevation = 1, ...props },
  ref,
) {
  const hostRef = useRef(null);
  const svgRef = useRef(null);
  const seedRef = useRef(Math.floor(Math.random() * 2 ** 31));

  useImperativeHandle(ref, () => hostRef.current);

  useEffect(() => {
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg) {
      return undefined;
    }

    const elev = Math.min(Math.max(1, elevation), 5);
    const thickness = elev * 6;

    const redraw = () => {
      const height = Math.round(host.getBoundingClientRect().height);
      if (!height) {
        return;
      }
      while (svg.lastChild) {
        svg.removeChild(svg.lastChild);
      }
      svg.setAttribute("width", `${thickness}`);
      svg.setAttribute("height", `${height}`);
      for (let i = 0; i < elev; i++) {
        drawSketchLine(svg, i * 6 + 3, 0, i * 6 + 3, height, seedRef.current);
      }
    };

    redraw();
    const resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(host);
    return () => resizeObserver.disconnect();
  }, [elevation]);

  return (
    <div
      ref={hostRef}
      className={
        className ? `sketch-vertical-divider ${className}` : "sketch-vertical-divider"
      }
      {...props}
    >
      <svg ref={svgRef} />
    </div>
  );
});

const SketchProgress = forwardRef(function SketchProgress(
  {
    className = "",
    max = 100,
    min = 0,
    percentage = false,
    value = 0,
    ...props
  },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const progressElement = innerRef.current;
    if (!progressElement) {
      return;
    }

    progressElement.min = Number.isFinite(Number(min)) ? Number(min) : 0;
    progressElement.max = Number.isFinite(Number(max)) ? Number(max) : 100;
    progressElement.value = Number.isFinite(Number(value)) ? Number(value) : 0;
    progressElement.percentage = Boolean(percentage);
  }, [max, min, percentage, value]);

  /* Stable, so the observer below is attached once rather than rebuilt on every
     value the bar is handed. */
  const redrawProgress = useCallback(() => {
    const progressElement = innerRef.current;
    if (!progressElement) {
      return;
    }

    if (typeof progressElement.requestUpdate === "function") {
      progressElement.requestUpdate();
    }

    if (typeof progressElement.wiredRender === "function") {
      progressElement.wiredRender(true);
    }
  }, []);

  /*
   * The drawn bar, redrawn once per change rather than three times.
   *
   * wiredRender(true) regenerates the whole rough.js geometry, and this used to
   * fire it three times for every distinct `value` — immediately, again on the
   * next frame, and again on a setTimeout(0) — while also tearing down and
   * rebuilding a ResizeObserver each time. That is harmless on a bar that moves
   * when somebody claims an item, and it is not harmless on the display, whose
   * QR countdown feeds this a new value every second for the whole evening:
   * three full redraws a second, on the one machine in the building that is
   * driving a projector and has nobody sitting at it to notice.
   *
   * The extra two passes were covering a real thing — the element mounts before
   * its box has settled, so a single synchronous draw comes out the wrong size.
   * The ResizeObserver already catches exactly that, and catches it whenever it
   * happens rather than only within a frame of mount. So the duplicates go and
   * the observer, which is the part that was actually load-bearing, is built
   * once for the life of the element instead of once per value.
   */
  useEffect(() => {
    const progressElement = innerRef.current;
    if (!progressElement) {
      return undefined;
    }

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      redrawProgress();
    });

    resizeObserver.observe(progressElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [redrawProgress]);

  useEffect(() => {
    redrawProgress();
  }, [className, max, min, percentage, redrawProgress, value]);

  return (
    <wired-progress
      ref={innerRef}
      class={className ? `sketch-progress wired-rendered ${className}` : "sketch-progress wired-rendered"}
      {...props}
    />
  );
});

/*
 * `wired-slider` reports every step of a drag: it fires its own `change` event
 * from the native `input` event, and stops that one inside its shadow root, so
 * the native `change` that would mark the end of the drag never reaches us.
 *
 * `onChange` keeps that step-by-step reporting, which is what a reading beside
 * the slider wants. `onCommit` is the other half — the value the slider was let
 * go on — for anything with a cost per call, like a write that every display
 * and attendee is subscribed to. It fires once per interaction: on releasing the
 * pointer, on letting go of an arrow key, or on the slider losing focus.
 */
const SketchSlider = forwardRef(function SketchSlider(
  {
    className = "",
    disabled = false,
    max = 100,
    min = 0,
    onChange,
    onCommit,
    step = 1,
    value = 0,
    ...props
  },
  ref,
) {
  const innerRef = useRef(null);
  /* Held in refs because the listeners below are attached once for the life of
     the slider. Call sites pass inline arrows, so re-attaching them on every
     render would mean tearing the listeners down mid-drag — and with them the
     pending change that has not been committed yet. */
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCommitRef.current = onCommit;
  });

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const sliderElement = innerRef.current;
    if (!sliderElement) {
      return;
    }

    sliderElement.min = Number.isFinite(Number(min)) ? Number(min) : 0;
    sliderElement.max = Number.isFinite(Number(max)) ? Number(max) : 100;
    sliderElement.step = Number.isFinite(Number(step)) ? Number(step) : 1;
    sliderElement.value = Number.isFinite(Number(value)) ? Number(value) : 0;
    sliderElement.disabled = Boolean(disabled);
  }, [disabled, max, min, step, value]);

  useEffect(() => {
    const sliderElement = innerRef.current;
    if (!sliderElement) {
      return undefined;
    }

    let frameId = null;

    if (typeof sliderElement.requestUpdate === "function") {
      sliderElement.requestUpdate();
    }

    if (typeof sliderElement.wiredRender === "function") {
      frameId = window.requestAnimationFrame(() => {
        sliderElement.wiredRender(true);
      });
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [className, disabled, max, min, step, value]);

  useEffect(() => {
    const sliderElement = innerRef.current;
    if (!sliderElement) {
      return undefined;
    }

    /* The last step of a drag that nothing has been told about yet. Its target
       is the slider itself, so reading `target.value` at commit time gives the
       value the drag finished on rather than the one this event carried. */
    let uncommittedEvent = null;

    const handleChange = (event) => {
      uncommittedEvent = event;
      onChangeRef.current?.(event);
    };

    const commit = () => {
      if (!uncommittedEvent) {
        return;
      }

      const event = uncommittedEvent;
      uncommittedEvent = null;
      onCommitRef.current?.(event);
    };

    sliderElement.addEventListener("change", handleChange);
    /* On the element for the ways this slider in particular is let go of, and
       on the window for the pointer, which is captured by the range input for
       the length of a drag and can be released well outside it. */
    sliderElement.addEventListener("keyup", commit);
    sliderElement.addEventListener("focusout", commit);
    window.addEventListener("pointerup", commit);
    window.addEventListener("pointercancel", commit);

    return () => {
      sliderElement.removeEventListener("change", handleChange);
      sliderElement.removeEventListener("keyup", commit);
      sliderElement.removeEventListener("focusout", commit);
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
      /* A slider taken off the screen mid-drag — a toggle hiding it, the panel
         closing — still saves what it was dragged to, rather than dropping it. */
      commit();
    };
  }, []);

  return (
    <wired-slider
      ref={innerRef}
      class={className ? `sketch-slider wired-rendered ${className}` : "sketch-slider wired-rendered"}
      disabled={disabled}
      {...props}
    />
  );
});

export {
  SketchButton,
  SketchCard,
  SketchCombo,
  SketchConfirmDialog,
  SketchDialog,
  SketchDivider,
  SketchIconButton,
  SketchInput,
  SketchMessageDialog,
  SketchProgress,
  SketchSearchInput,
  SketchSlider,
  SketchTextarea,
  SketchToggle,
  SketchVerticalDivider,
};
