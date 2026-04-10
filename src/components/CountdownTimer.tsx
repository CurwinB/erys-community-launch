import { useState, useEffect } from "react";

interface CountdownTimerProps {
  targetDate: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calcTimeLeft(target: string): TimeLeft {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

const CountdownTimer = ({ targetDate, className = "", size = "md" }: CountdownTimerProps) => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calcTimeLeft(targetDate));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(calcTimeLeft(targetDate));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const textSize = size === "lg" ? "text-3xl md:text-5xl" : size === "md" ? "text-xl md:text-2xl" : "text-sm";
  const labelSize = size === "lg" ? "text-xs" : "text-[10px]";

  const segments = [
    { value: timeLeft.days, label: "DAYS" },
    { value: timeLeft.hours, label: "HRS" },
    { value: timeLeft.minutes, label: "MIN" },
    { value: timeLeft.seconds, label: "SEC" },
  ];

  return (
    <div className={`flex items-center gap-2 md:gap-3 ${className}`}>
      {segments.map((seg, i) => (
        <div key={seg.label} className="flex items-center gap-2 md:gap-3">
          <div className="flex flex-col items-center">
            <span className={`font-mono font-bold text-primary ${textSize}`}>
              {String(seg.value).padStart(2, "0")}
            </span>
            <span className={`${labelSize} font-medium tracking-widest text-muted-foreground`}>
              {seg.label}
            </span>
          </div>
          {i < segments.length - 1 && (
            <span className={`font-mono text-muted-foreground ${textSize} -mt-4`}>:</span>
          )}
        </div>
      ))}
    </div>
  );
};

export default CountdownTimer;
