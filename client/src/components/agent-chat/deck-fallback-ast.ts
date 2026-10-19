import { PREBUILT_PRESENTATION_THEMES } from '@shared/schema/document-block.schema';

export function createDefaultDeckAst(
  id: string | number,
  title?: string,
  formatCategory: string = 'executive_brief',
  themeName?: string,
  blocks: any[] = []
) {
  const baseTheme = PREBUILT_PRESENTATION_THEMES['dark_cyberpunk'];
  const designSystem =
    themeName && PREBUILT_PRESENTATION_THEMES[themeName]
      ? PREBUILT_PRESENTATION_THEMES[themeName]
      : baseTheme;

  return {
    id: `deck-${id}`,
    title: title || 'Executive Deliverable',
    formatCategory,
    designSystem,
    blocks,
  };
}
