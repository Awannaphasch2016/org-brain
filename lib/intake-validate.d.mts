export function torContractFields(markdown: string): {
  required: { name: string; label: string; min: number }[];
  optional: { name: string; label: string; min: number }[];
};
export function bundledTorContract(): string;
export function missingIntakeFields(
  tor: string,
  contract: { required: { name: string; label: string; min: number }[] },
): string[];

export function torSectionsFromGuideline(markdown: string): {
  required: { id: string; title: string }[];
  optional: { id: string; title: string }[];
};

export function validateIntake(input: {
  tor?: string;
  analysis?: string;
  elicitationLog?: string;
  structureMarkdown?: string;
  contractMarkdown?: string;
}): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  enforcedSections: string[];
  report: string;
};
