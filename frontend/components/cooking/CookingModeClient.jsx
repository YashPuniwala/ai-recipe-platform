/* eslint-disable */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatIngredients(ingredients = []) {
  return ingredients
    .map((ing) =>
      `${ing.amount ? `${ing.amount} ` : ""}${ing.item || ""}`.trim(),
    )
    .filter(Boolean)
    .join(", ");
}

function extractDurationSeconds(text) {
  if (!text) return null;
  // Examples: "10 minutes", "1 min", "30 seconds", "2 hours"
  const m = text.match(
    /\b(\d{1,3})\s*(hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)\b/i,
  );
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith("hour") || unit.startsWith("hr")) return value * 3600;
  if (unit.startsWith("min")) return value * 60;
  return value;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0)
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function getSuggestionChips(stepText, ingredients) {
  const chips = [];
  const text = (stepText || "").toLowerCase();

  // Ingredient substitution: try to find first ingredient mentioned in step text
  const foundIng = (ingredients || []).find((ing) => {
    const name = (ing.item || "").toLowerCase();
    if (!name) return false;
    const head = name.split(/[,(/]/)[0].trim();
    if (!head) return false;
    return text.includes(head);
  });
  if (foundIng?.item) {
    chips.push(`Substitute for ${foundIng.item}?`);
  } else {
    chips.push("Any substitutions for this step?");
  }

  // Time / temp / conversion
  const timeMention =
    stepText &&
    stepText.match(
      /\b(\d{1,3})\s*(hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec)\b/i,
    );
  if (timeMention) chips.push(`How long should I cook this?`);

  const measureMention =
    stepText &&
    stepText.match(
      /\b(\d{1,3}(?:\.\d+)?)\s*(tbsp|tsp|cup|cups|oz|ounce|ounces|g|gram|grams|ml|l)\b/i,
    );
  if (measureMention) {
    chips.push(`How much is ${measureMention[0]}?`);
  } else {
    chips.push("Any conversion tips?");
  }

  return chips.slice(0, 3);
}

function TimerCard({ seconds }) {
  const initial = seconds ?? 0;
  const [remaining, setRemaining] = useState(initial);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setRemaining(initial);
    setRunning(false);
  }, [initial]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(t);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  return (
    <div className="mt-6 w-full max-w-xl border-2 border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Detected timer
          </div>
          <div className="text-3xl font-black tracking-tight text-stone-900">
            {formatTime(remaining)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="bg-stone-900 hover:bg-stone-800 border-2 border-stone-950 text-white"
            onClick={() => setRunning((v) => !v)}
          >
            {running ? "Pause" : "Start"}
          </Button>
          <Button
            variant="outline"
            className="border-2 border-stone-900"
            onClick={() => {
              setRunning(false);
              setRemaining(initial);
            }}
          >
            Reset
          </Button>
        </div>
      </div>
      {remaining === 0 && (
        <div className="mt-3 text-sm font-semibold text-green-700">
          Timer done. Continue to the next step when ready.
        </div>
      )}
    </div>
  );
}

function AIChefPanel({
  open,
  onToggle,
  recipe,
  currentStepIndex,
  currentStepText,
  isPro,
  onVoiceCommand,
}) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Ask me anything while you cook." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const recognitionRef = useRef(null);

  const suggestionChips = useMemo(
    () => getSuggestionChips(currentStepText, recipe?.ingredients),
    [currentStepText, recipe?.ingredients],
  );

  const send = useCallback(
    async (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || sending) return;

      setMessages((m) => [...m, { role: "user", content: trimmed }]);
      setInput("");
      setSending(true);

      try {
        const res = await fetch("/api/ai/chef", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipe,
            currentStepIndex,
            currentStepText,
            message: trimmed,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "AI request failed");
        }
        setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
      } catch (e) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              `I couldn't answer that right now. ${e?.message || ""}`.trim(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [currentStepIndex, currentStepText, recipe, sending],
  );

  const startMic = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Voice input isn't supported in this browser.",
        },
      ]);
      return;
    }

    if (!recognitionRef.current) {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
    }

    const rec = recognitionRef.current;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
      const lower = transcript.toLowerCase();

      if (lower === "next step" || lower === "next") {
        onVoiceCommand?.({ type: "next" });
        return;
      }
      if (
        lower === "go back" ||
        lower === "previous step" ||
        lower === "back"
      ) {
        onVoiceCommand?.({ type: "prev" });
        return;
      }
      if (lower === "repeat" || lower === "repeat step") {
        onVoiceCommand?.({ type: "repeat" });
        return;
      }

      send(transcript);
    };
    rec.onerror = () => {};
    rec.start();
  }, [onVoiceCommand, send]);

  return (
    <>
      {/* Always-visible toggle */}
      <button
        onClick={onToggle}
        className="fixed right-3 top-1/2 -translate-y-1/2 z-50 border-2 border-stone-950 bg-stone-900 text-white px-4 py-3 font-bold tracking-tight shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
      >
        Ask AI Chef
      </button>

      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-md border-l-2 border-stone-200 bg-white transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="h-full flex flex-col">
          <div className="p-4 border-b-2 border-stone-200 flex items-center justify-between">
            <div>
              <div className="text-sm font-black text-stone-900">AI Chef</div>
              <div className="text-xs text-stone-600">
                {isPro ? "Pro: unlimited" : "Free: 5 per session"}
              </div>
            </div>
            <Button
              variant="outline"
              className="border-2 border-stone-900"
              onClick={onToggle}
            >
              Close
            </Button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`max-w-[90%] border-2 p-3 ${
                  m.role === "user"
                    ? "ml-auto border-stone-900 bg-stone-900 text-white"
                    : "mr-auto border-stone-200 bg-stone-50 text-stone-900"
                }`}
              >
                <div className="text-sm leading-relaxed">{m.content}</div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t-2 border-stone-200">
            <div className="flex flex-wrap gap-2 mb-3">
              {suggestionChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => send(chip)}
                  className="text-xs font-bold border-2 border-stone-200 bg-white px-3 py-1.5 hover:border-stone-900"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this step..."
                className="flex-1 border-2 border-stone-200 px-3 py-2 outline-none focus:border-stone-900"
                onKeyDown={(e) => {
                  if (e.key === "Enter") send(input);
                }}
              />
              <Button
                variant="outline"
                className="border-2 border-stone-900"
                onClick={startMic}
                title="Voice input"
              >
                🎙️
              </Button>
              <Button
                className="bg-stone-900 hover:bg-stone-800 border-2 border-stone-950 text-white"
                onClick={() => send(input)}
                disabled={sending}
              >
                {sending ? "..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function CookingModeClient({ recipe, isPro }) {
  const steps = useMemo(() => recipe?.instructions || [], [recipe]);
  const [idx, setIdx] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);

  const isComplete = idx >= steps.length;
  const current = steps[idx];
  const currentText = useMemo(() => {
    if (!current) return "";
    const parts = [
      current.title,
      current.instruction,
      current.tip ? `Tip: ${current.tip}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return parts;
  }, [current]);

  const detectedSeconds = useMemo(
    () => extractDurationSeconds(current?.instruction || currentText),
    [current?.instruction, currentText],
  );

  const speak = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(
      currentText || current?.instruction || " ",
    );
    utter.rate = 1;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  }, [current?.instruction, currentText]);

  const go = useCallback(
    (nextIdx) => {
      const next = clamp(nextIdx, 0, steps.length);
      setIdx(next);
    },
    [steps.length],
  );

  const prev = useCallback(() => go(idx - 1), [go, idx]);
  const next = useCallback(() => go(idx + 1), [go, idx]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const target = e.target;
      const tag = target?.tagName?.toLowerCase?.();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable)
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === " ") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, prev]);

  useEffect(() => {
    if (!isComplete) return;
    const burst = () => {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
      });
    };
    burst();
    const t = window.setTimeout(burst, 350);
    return () => window.clearTimeout(t);
  }, [isComplete]);

  return (
    <div className="min-h-screen bg-stone-50">
      <AIChefPanel
        open={aiOpen}
        onToggle={() => setAiOpen((v) => !v)}
        recipe={recipe}
        currentStepIndex={Math.min(idx + 1, steps.length)}
        currentStepText={current?.instruction || currentText}
        isPro={isPro}
        onVoiceCommand={(cmd) => {
          if (cmd.type === "next") next();
          if (cmd.type === "prev") prev();
          if (cmd.type === "repeat") speak();
        }}
      />

      <div className="min-h-screen flex flex-col">
        <div className="p-4 md:p-6 border-b-2 border-stone-200 bg-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-stone-500">
                Cooking Mode
              </div>
              <div className="text-xl md:text-2xl font-black tracking-tight text-stone-900">
                {recipe?.title}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/recipe">
                <Button variant="outline" className="border-2 border-stone-900">
                  Exit
                </Button>
              </Link>
            </div>
          </div>

          {!isComplete && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm font-semibold text-stone-700">
                <span>
                  Step {idx + 1} of {steps.length}
                </span>
                <span className="text-stone-500">Use ← / → or Space</span>
              </div>
              <div className="mt-2 h-2 border-2 border-stone-200 bg-stone-100 overflow-hidden">
                <div
                  className="h-full bg-orange-600"
                  style={{
                    width: `${((idx + 1) / Math.max(steps.length, 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-3xl">
            {isComplete ? (
              <div className="border-2 border-stone-200 bg-white p-10 text-center">
                <div className="text-3xl md:text-4xl font-black tracking-tight text-stone-900">
                  Done!
                </div>
                <div className="mt-3 text-stone-600">
                  You finished {recipe?.title}. Enjoy.
                </div>
                <div className="mt-8 flex flex-wrap gap-3 justify-center">
                  <Button
                    className="bg-stone-900 hover:bg-stone-800 border-2 border-stone-950 text-white"
                    onClick={() => setIdx(0)}
                  >
                    Cook Again
                  </Button>
                  <Link href="/dashboard">
                    <Button
                      variant="outline"
                      className="border-2 border-stone-900"
                    >
                      Back to Dashboard
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="border-2 border-stone-200 bg-white p-6 md:p-10">
                <div className="text-sm font-bold uppercase tracking-wide text-orange-700 mb-3">
                  Step {idx + 1}
                </div>
                <div className="text-2xl md:text-3xl font-black tracking-tight text-stone-900">
                  {current?.title}
                </div>
                <div className="mt-5 text-lg md:text-xl leading-relaxed text-stone-800 whitespace-pre-wrap">
                  {current?.instruction}
                </div>
                {current?.tip && (
                  <div className="mt-5 border-l-4 border-orange-600 bg-orange-50 p-4">
                    <div className="text-sm text-orange-900">
                      <span className="font-bold">Pro tip:</span> {current.tip}
                    </div>
                  </div>
                )}

                {detectedSeconds ? (
                  <TimerCard seconds={detectedSeconds} />
                ) : null}

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="border-2 border-stone-900"
                      onClick={prev}
                      disabled={idx === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      className="bg-orange-600 hover:bg-orange-700 border-2 border-orange-700 text-white"
                      onClick={next}
                    >
                      {idx === steps.length - 1 ? "Finish" : "Next"}
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="border-2 border-stone-900"
                      onClick={speak}
                    >
                      Read Aloud
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 text-xs text-stone-500">
              Ingredients: {formatIngredients(recipe?.ingredients)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
