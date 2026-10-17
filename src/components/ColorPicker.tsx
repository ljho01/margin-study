import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Preset swatches, a free color field and a hex code. onChange follows
 * every move of the field; onCommit fires once a color is settled (swatch
 * click, release of the field, a valid code).
 */
export default function ColorPicker({
  value,
  presets,
  onChange,
  onCommit,
}: {
  value: string;
  presets: string[];
  onChange: (color: string) => void;
  onCommit?: (color: string) => void;
}) {
  const [code, setCode] = useState(value);
  useEffect(() => setCode(value), [value]);
  const pick = (color: string) => {
    onChange(color);
    onCommit?.(color);
  };
  return (
    <div className="w-52 space-y-3">
      <div
        onPointerUp={() => onCommit?.(value)}
        className="color-field"
      >
        <HexColorPicker color={value} onChange={onChange} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={color.toLowerCase() === value.toLowerCase()}
            className={cn(
              "size-6 rounded-full border border-black/10 ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "aria-pressed:ring-2 aria-pressed:ring-ring",
            )}
            style={{ backgroundColor: color }}
            onClick={() => pick(color)}
          />
        ))}
      </div>
      <Input
        aria-label="색상 코드"
        className="h-8 font-mono text-xs uppercase"
        value={code}
        spellCheck={false}
        onChange={(e) => {
          const next = e.target.value.startsWith("#")
            ? e.target.value
            : "#" + e.target.value;
          setCode(next);
          if (HEX.test(next)) pick(next);
        }}
      />
    </div>
  );
}
