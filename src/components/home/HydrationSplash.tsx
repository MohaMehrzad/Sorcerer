export default function HydrationSplash() {
  return (
    <div className="flex items-center justify-center h-dvh">
      <div className="flex gap-1">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-bounce" />
      </div>
    </div>
  );
}
