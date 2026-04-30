/**
 * OTP Input Component.
 * @module components/auth/OtpInput
 */

export interface OtpInputProps {
  length?: number;
  onComplete: (otp: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export function OtpInput({ length = 6, onComplete, disabled, error }: OtpInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, i: number) => {
    const val = e.target.value;
    if (val.length === length) {
      onComplete(val);
    }
    if (val && i < length - 1) {
      const next = e.target.nextElementSibling as HTMLInputElement | null;
      next?.focus();
    }
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          type="text"
          maxLength={1}
          disabled={disabled}
          onChange={(e) => handleChange(e, i)}
          className={`w-10 h-12 text-center border rounded text-lg font-mono ${error ? "border-red-500" : ""}`}
        />
      ))}
    </div>
  );
}
