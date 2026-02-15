/**
 * Hardcoded config: what each score means and why it might be low.
 * Edit this file to change copy without touching component code.
 */

export type ScoreKey = "humanity" | "integrity" | "rhetoric";

export interface ScoreConfig {
  /** Short label shown in the UI */
  label: string;
  /** Explanation shown in the (i) tooltip – what the score measures */
  description: string;
  /** When score is low (red), this explanation is shown and DOM may be highlighted */
  lowExplanation: string;
}

export const SCORE_CONFIG: Record<ScoreKey, ScoreConfig> = {
  humanity: {
    label: "Humanity",
    description:
      "Likelihood the text is human-written (0 = likely AI-generated, 100 = likely human). Reflects natural language, nuance, and authenticity.",
    lowExplanation:
      "Content may be AI-generated, lack human nuance, or feel impersonal. Consider checking the source and looking for original reporting.",
  },
  integrity: {
    label: "Integrity",
    description:
      "How well claims match evidence and factual support (0 = low, 100 = high). Measures sourcing, accuracy, and balance.",
    lowExplanation:
      "Claims may be unsupported, one-sided, or poorly sourced. Look for citations, primary sources, and alternative viewpoints.",
  },
  rhetoric: {
    label: "Rhetoric",
    description:
      "Level of emotional manipulation (0 = high manipulation/rage-bait, 100 = neutral). Lower scores suggest sensationalism or persuasion over information.",
    lowExplanation:
      "Content may use emotional language, sensationalism, or rage-bait. Headlines and framing might be designed to provoke rather than inform.",
  },
};
