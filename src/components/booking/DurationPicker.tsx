interface DurationPickerProps {
  options: number[];
  value: number;
  onChange: (minutes: number) => void;
}

function label(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** Shown only when the event type offers more than one meeting length. */
export function DurationPicker({ options, value, onChange }: DurationPickerProps) {
  if (options.length < 2) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-gray-600">⏱ Length</span>
      {options.map(minutes => (
        <button
          key={minutes}
          type="button"
          onClick={() => onChange(minutes)}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
            value === minutes
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 text-gray-700 hover:border-blue-500 hover:bg-blue-50'
          }`}
        >
          {label(minutes)}
        </button>
      ))}
    </div>
  );
}
