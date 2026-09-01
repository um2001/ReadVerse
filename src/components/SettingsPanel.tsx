import type { Settings } from "../types";

interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

const THEMES = [
  { value: "light" as const, label: "亮色", dot: "#eef4f0" },
  { value: "sepia" as const, label: "护眼", dot: "#c99a62" },
  { value: "night" as const, label: "夜间", dot: "#22332c" },
];

const FONT_FAMILIES = ["默认", "宋体", "楷体", "黑体"];
const LINE_HEIGHTS = ["1.6", "1.8", "2.0", "2.2"];

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">
          阅读主题
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              onClick={() => onChange({ theme: theme.value })}
              className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-3 text-sm transition ${
                settings.theme === theme.value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-soft)]"
              }`}
            >
              <span
                className="h-5 w-5 rounded-full border border-[var(--border)] shadow-sm"
                style={{ background: theme.dot }}
                aria-hidden
              />
              {theme.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-[var(--text)]">
          正文字体
        </span>
        <select
          value={settings.font_family}
          onChange={(event) => onChange({ font_family: event.target.value })}
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-[var(--text)]">
          行距
        </span>
        <select
          value={settings.line_height}
          onChange={(event) => onChange({ line_height: event.target.value })}
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        >
          {LINE_HEIGHTS.map((height) => (
            <option key={height} value={height}>
              {height}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
