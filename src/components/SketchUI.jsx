import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import "../roughCompat";
import "wired-elements/lib/wired-button.js";
import "wired-elements/lib/wired-card.js";
import "wired-elements/lib/wired-checkbox.js";
import "wired-elements/lib/wired-combo.js";
import "wired-elements/lib/wired-dialog.js";
import "wired-elements/lib/wired-icon-button.js";
import "wired-elements/lib/wired-input.js";
import "wired-elements/lib/wired-item.js";
import "wired-elements/lib/wired-progress.js";
import "wired-elements/lib/wired-slider.js";
import "wired-elements/lib/wired-toggle.js";

const SketchButton = forwardRef(function SketchButton(
  { type = "button", onClick, disabled, className = "", ...props },
  ref,
) {
  const handleClick = (event) => {
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
      ref={ref}
      class={className ? `sketch-button ${className}` : "sketch-button"}
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
      class={className ? `sketch-input ${className}` : "sketch-input"}
      {...props}
    />
  );
});

const SketchCard = forwardRef(function SketchCard(
  {
    children,
    className = "",
    fill = "",
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

  return (
    <wired-card
      ref={innerRef}
      class={className ? `sketch-card ${className}` : "sketch-card"}
      style={mergedStyle}
      {...props}
    >
      {children}
    </wired-card>
  );
});

const SketchSelect = forwardRef(function SketchSelect({ children, className = "", ...props }, ref) {
  const wrapperClassName = `sketch-select${className ? ` ${className}` : ""}`;

  return (
    <SketchCard className={wrapperClassName} elevation={1}>
      <select ref={ref} {...props}>
        {children}
      </select>
    </SketchCard>
  );
});

const SketchCombo = forwardRef(function SketchCombo(
  { children, className = "", onChange, selected, ...props },
  ref,
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => innerRef.current);

  useEffect(() => {
    const comboElement = innerRef.current;
    if (!comboElement || selected === undefined) {
      return;
    }

    comboElement.selected = selected == null ? "" : String(selected);
  }, [selected]);

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

  return (
    <wired-combo
      ref={innerRef}
      class={className ? `sketch-combo ${className}` : "sketch-combo"}
      {...props}
    >
      {children}
    </wired-combo>
  );
});

const SketchCheckbox = forwardRef(function SketchCheckbox(
  { checked, defaultChecked, onChange, className = "", children, ...props },
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
    <wired-checkbox
      ref={innerRef}
      class={className ? `sketch-checkbox ${className}` : "sketch-checkbox"}
      {...props}
    >
      {children}
    </wired-checkbox>
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
      class={className ? `sketch-toggle ${className}` : "sketch-toggle"}
      disabled={disabled}
      {...props}
    />
  );
});

const SketchIconButton = forwardRef(function SketchIconButton(
  { onClick, disabled, className = "", ...props },
  ref,
) {
  return (
    <wired-icon-button
      ref={ref}
      class={className ? `sketch-icon-button ${className}` : "sketch-icon-button"}
      disabled={disabled}
      onClick={onClick}
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

  return (
    <wired-progress
      ref={innerRef}
      class={className ? `sketch-progress ${className}` : "sketch-progress"}
      {...props}
    />
  );
});

const SketchSlider = forwardRef(function SketchSlider(
  {
    className = "",
    disabled = false,
    max = 100,
    min = 0,
    onChange,
    step = 1,
    value = 0,
    ...props
  },
  ref,
) {
  const innerRef = useRef(null);

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
    if (!sliderElement || typeof onChange !== "function") {
      return undefined;
    }

    const handleChange = (event) => {
      onChange(event);
    };

    sliderElement.addEventListener("change", handleChange);

    return () => {
      sliderElement.removeEventListener("change", handleChange);
    };
  }, [onChange]);

  return (
    <wired-slider
      ref={innerRef}
      class={className ? `sketch-slider ${className}` : "sketch-slider"}
      disabled={disabled}
      {...props}
    />
  );
});

export {
  SketchButton,
  SketchCard,
  SketchCheckbox,
  SketchCombo,
  SketchDialog,
  SketchIconButton,
  SketchInput,
  SketchProgress,
  SketchSlider,
  SketchSelect,
  SketchToggle,
};
