/**
 * First-run onboarding answers (#1084). Lives in `shared/` rather than on the
 * OnboardingDialog component so both the dialog (a `.svelte` file) and the
 * project-ops handler cluster (a plain `.ts` module) can import the type — a
 * type re-exported from a `.svelte` file isn't visible to `.ts` consumers under
 * the ambient `*.svelte` module declaration.
 */
export interface OnboardingAnswers {
  subject: string;
  expertise: 'beginner' | 'familiar' | 'expert';
  use: string;
  depth: 'quick' | 'moderate' | 'deep';
}
