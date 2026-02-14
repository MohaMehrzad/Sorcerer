import { Dispatch, SetStateAction } from "react";
import { ClarificationQuestion } from "@/components/autonomous/types";

interface ClarificationSectionProps {
  questions: ClarificationQuestion[];
  clarificationAnswers: Record<string, string>;
  setClarificationAnswers: Dispatch<SetStateAction<Record<string, string>>>;
  missingRequiredCount: number;
  running: boolean;
  onContinue: () => void;
}

export default function ClarificationSection({
  questions,
  clarificationAnswers,
  setClarificationAnswers,
  missingRequiredCount,
  running,
  onContinue,
}: ClarificationSectionProps) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Clarification Required Before Editing
        </h3>
        <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
          Answer the questions below. The agent will use these answers before writing or editing
          files.
        </p>
      </div>

      <div className="space-y-3">
        {questions.map((question) => (
          <div
            key={question.id}
            className="rounded-xl border border-amber-200 dark:border-amber-800 p-3 bg-white/80 dark:bg-neutral-950"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-amber-700 dark:text-amber-300">{question.id}</span>
              {question.required && (
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  required
                </span>
              )}
            </div>
            <p className="text-sm mt-1">{question.question}</p>
            <p className="text-xs text-neutral-500 mt-1">{question.rationale}</p>
            {question.options && question.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {question.options.map((option) => {
                  const selected = (clarificationAnswers[question.id] || "").trim() === option.value;

                  return (
                    <button
                      key={`${question.id}-${option.id}`}
                      type="button"
                      onClick={() =>
                        setClarificationAnswers((prev) => ({
                          ...prev,
                          [question.id]: option.value,
                        }))
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                        selected
                          ? "border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200"
                          : "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                      title={option.description || option.value}
                      disabled={running}
                    >
                      <span>{option.label}</span>
                      {option.recommended && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide opacity-80">
                          recommended
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              value={clarificationAnswers[question.id] || ""}
              onChange={(event) =>
                setClarificationAnswers((prev) => ({
                  ...prev,
                  [question.id]: event.target.value,
                }))
              }
              className="mt-2 w-full min-h-[72px] rounded border border-black/10 dark:border-white/10 px-2 py-1.5 text-sm bg-white/80 dark:bg-neutral-900"
              placeholder={
                question.options && question.options.length > 0
                  ? "Pick an option above or type a custom answer..."
                  : "Your answer..."
              }
              disabled={running || question.allowCustomAnswer === false}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Missing required answers: {missingRequiredCount}
        </p>
        <button
          onClick={onContinue}
          disabled={running || missingRequiredCount > 0}
          className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Continue With Answers
        </button>
      </div>
    </section>
  );
}
